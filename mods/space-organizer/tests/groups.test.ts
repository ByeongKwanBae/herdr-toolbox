import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeGroups, emptyGroups, groupName, groupStatus, spaceGroup, own, type GroupState, type GroupSpace, type MachineState } from "../src/core/model.js";
import { changeGroups, MembershipPruner, pruneMembers, unfoldSelected } from "../src/core/groups.js";
import { GroupStore, type GroupApi } from "../src/host/group-store.js";

const ready: MachineState[] = [{ name: null, layout: "ready" }, { name: "remote", layout: "ready" }];
const spaces: GroupSpace[] = [{ id: "local", machine: null }, { id: "remote/id", machine: "remote" }];
function state(): GroupState {
  return { schemaVersion: 1, groups: [
    { id: "a", name: "Alpha", machine: null, folded: false },
    { id: "b", name: "Beta", machine: null, folded: true },
    { id: "r", name: "Alpha", machine: "remote", folded: false },
  ], members: { local: "a", "remote/id": "r" } };
}

test("group names use NFC, code points and machine-local case-insensitive uniqueness", () => {
  assert.equal(groupName("  e\u0301  "), "é");
  assert.equal(groupName("😀".repeat(60)), "😀".repeat(60));
  for (const name of ["", "   ", "😀".repeat(61), "bad\nname", "\tname", "name\u007f", "name\u0085"]) assert.throws(() => groupName(name));
  assert.throws(() => changeGroups(state(), { type: "create", id: "new", machine: null, name: " ALPHA " }, spaces, ready), /already exists/);
  assert.doesNotThrow(() => changeGroups(state(), { type: "create", id: "new", machine: "third", name: "Alpha" }, spaces, [...ready, { name: "third", layout: "ready" }]));
});

test("create, rename, move, ungroup and delete keep immutable state and never close Spaces", () => {
  const original = state(), snapshot = JSON.stringify(original);
  let next = changeGroups(original, { type: "create", id: "new", machine: null, name: "New", space: "local" }, spaces, ready);
  assert.equal(next.members.local, "new");
  next = changeGroups(next, { type: "rename", group: "new", name: "Renamed" }, spaces, ready);
  assert.equal(next.groups.find(group => group.id === "new")!.name, "Renamed");
  next = changeGroups(next, { type: "assign", space: "local", group: "b" }, spaces, ready);
  assert.equal(next.members.local, "b");
  next = changeGroups(next, { type: "delete", group: "b" }, spaces, ready);
  assert.equal(own(next.members, "local"), false);
  assert.equal(next.members["remote/id"], "r");
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal(spaces.length, 2);
  next = changeGroups(next, { type: "assign", space: "remote/id", group: null }, spaces, ready);
  assert.equal(own(next.members, "remote/id"), false);
});

test("cross-machine moves, stale targets and edits on unavailable machines fail", () => {
  assert.throws(() => changeGroups(state(), { type: "assign", space: "local", group: "r" }, spaces, ready), /same machine/);
  assert.throws(() => changeGroups(state(), { type: "create", id: "x", name: "X", machine: "remote", space: "local" }, spaces, ready), /same machine/);
  assert.throws(() => changeGroups(state(), { type: "assign", space: "missing", group: "a" }, spaces, ready), /no longer exists/);
  assert.throws(() => changeGroups(state(), { type: "rename", group: "gone", name: "Name" }, spaces, ready), /no longer exists/);
  assert.throws(() => changeGroups(state(), { type: "delete", group: "r" }, spaces, [{ name: "remote", layout: "unavailable" }]), /not ready/);
  assert.equal(changeGroups(state(), { type: "fold", group: "r" }, spaces, []).groups[2].folded, true);
});

test("malformed and future schemas are rejected; a missing key starts in memory only", () => {
  assert.equal(decodeGroups(undefined).ok, true);
  for (const value of [[], "bad", {}, { ...state(), schemaVersion: 2 }, { ...state(), members: { wrong: "missing" } },
    { ...state(), groups: [...state().groups, state().groups[0]] },
    { ...state(), groups: [{ id: "a", machine: "", name: "Alpha", folded: false }] },
    Object.create({ schemaVersion: 1, groups: [], members: {} }),
  ]) assert.equal(decodeGroups(value).ok, false);
  assert.equal(decodeGroups(state()).ok, true);
});

test("prototype-named opaque IDs remain own membership keys without pollution", () => {
  const special = [{ id: "__proto__", machine: null }, { id: "constructor", machine: null }];
  let next = changeGroups(state(), { type: "assign", space: "__proto__", group: "a" }, special, ready);
  next = changeGroups(next, { type: "assign", space: "constructor", group: "b" }, special, ready);
  assert.equal(Object.getPrototypeOf(next.members), Object.prototype);
  assert.equal(own(next.members, "__proto__"), true);
  assert.equal(spaceGroup(next, special[0])?.id, "a");
  assert.equal(spaceGroup(next, special[1])?.id, "b");
  const decoded = decodeGroups(JSON.parse(JSON.stringify(next)));
  assert.equal(decoded.ok, true);
  assert.equal(spaceGroup({ ...next, members: {} }, special[1]), undefined);
  assert.equal(spaceGroup(next, { id: "__proto__", machine: "remote" }), undefined);
});

test("group status follows blocked > done > working > idle", () => {
  const item = (status: GroupSpace["status"]): GroupSpace => ({ id: String(status), machine: null, status });
  assert.equal(groupStatus([item("idle"), item("done"), item("working"), item("blocked")]), "blocked");
  assert.equal(groupStatus([item("working"), item("done")]), "done");
  assert.equal(groupStatus([item(null)]), undefined);
});

test("membership deletion requires two ready observations at least a second apart", () => {
  const pruner = new MembershipPruner(), current = state();
  assert.deepEqual(pruner.observe(current, [spaces[1]], ready, 0), []);
  assert.deepEqual(pruner.observe(current, [spaces[1]], ready, 999), []);
  const candidates = pruner.observe(current, [spaces[1]], ready, 1000);
  assert.deepEqual(candidates, [{ id: "local", group: "a", machine: null }]);
  const next = pruneMembers(current, candidates, [spaces[1]], ready);
  assert.equal(own(next.members, "local"), false);
  assert.equal(next.groups.length, current.groups.length);
  // A reappearing Space or a newer membership must survive a stale cleanup proposal.
  assert.equal(pruneMembers(current, candidates, spaces, ready).members.local, "a");
  assert.equal(pruneMembers({ ...current, members: { ...current.members, local: "b" } }, candidates, [], ready).members.local, "b");
});

for (const mode of ["loading", "unavailable", "absent"] as const) {
  test(`${mode} machines cancel deletion evidence and preserve membership`, () => {
    const pruner = new MembershipPruner(), current = state();
    pruner.observe(current, [], ready, 0);
    const offline: MachineState[] = mode === "absent" ? [] : [{ name: null, layout: mode }, { name: "remote", layout: mode }];
    assert.deepEqual(pruner.observe(current, [], offline, 1500), []);
    assert.deepEqual(pruner.observe(current, [], ready, 2000), []);
    assert.equal(pruner.observe(current, [], ready, 3000).length, 2);
  });
}

test("selected groups can be revealed without altering other fold states", () => {
  const current = state();
  const next = unfoldSelected({ ...current, members: { ...current.members, local: "b" } }, spaces[0]);
  assert.equal(next.groups.find(group => group.id === "b")!.folded, false);
  assert.equal(unfoldSelected(current, undefined), current);
});

function storeFixture() {
  let value: unknown;
  let current = spaces;
  let check = false, writes = 0, sequence = 0;
  const api: GroupApi = { checking: () => check, shared: () => value, setShared: (_key, next) => { value = next; writes++; },
    spaces: () => current, machines: () => ready, id: () => `id-${++sequence}` };
  return { api, store: new GroupStore(api), get value() { return value; }, set value(next: unknown) { value = next; },
    get current() { return current; }, set current(next: GroupSpace[]) { current = next; },
    set check(next: boolean) { check = next; }, get writes() { return writes; } };
}

test("separate overlay stores re-read latest shared data before every action", () => {
  const f = storeFixture(), other = new GroupStore(f.api);
  assert.equal(f.store.read().ok, true);
  assert.equal(f.writes, 0);
  f.store.create(null, "First", "local");
  other.create("remote", "Second", "remote/id");
  f.store.change({ type: "rename", group: "id-1", name: "Renamed" });
  const decoded = decodeGroups(f.value);
  assert.ok(decoded.ok);
  assert.equal(decoded.state.groups.length, 2);
  assert.equal(decoded.state.members["remote/id"], "id-2");
  assert.equal(decoded.state.groups[0].name, "Renamed");
});

test("checking and malformed data cause no writes; stale targets cannot be created or moved", () => {
  const f = storeFixture();
  f.check = true;
  assert.equal(f.store.create(null, "No effect"), false);
  assert.equal(f.writes, 0);
  f.check = false;
  const future = { ...state(), schemaVersion: 99 };
  f.value = future;
  assert.throws(() => f.store.create(null, "No effect"), /preserved/);
  assert.equal(f.value, future);
  assert.equal(f.writes, 0);
  f.value = state(); f.current = [];
  assert.throws(() => f.store.create(null, "Stale", "local"), /no longer exists/);
  assert.equal(f.writes, 0);
});
