import { test } from "node:test";
import assert from "node:assert/strict";
import { desiredOrder, movePlan, OrderSynchronizer, orderIntent, type OrderSpace } from "../src/core/ordering.js";
import { emptyGroups, type GroupState } from "../src/core/model.js";

const space = (id: string, machine: string | null = null, repo: string | null = null, linked = false): OrderSpace => ({ id, machine, repo, linked });
const grouped = (): GroupState => ({ schemaVersion: 1, groups: [
  { id: "first", machine: null, name: "First", folded: true },
  { id: "second", machine: null, name: "Second", folded: false },
  { id: "remote", machine: "remote", name: "Remote", folded: false },
], members: { a: "first", c: "first", b: "second", r2: "remote" } });

test("group order preserves machine blocks and the existing order inside each area", () => {
  const current = [space("u"), space("b"), space("c"), space("a"), space("r1", "remote"), space("r2", "remote")];
  assert.deepEqual(desiredOrder(current, grouped()).map(item => item.id), ["c", "a", "b", "u", "r2", "r1"]);
  const unfolded = grouped(); unfolded.groups[0].folded = false;
  assert.deepEqual(desiredOrder(current, grouped()), desiredOrder(current, unfolded));
});

test("worktrees nest only below a parent on the same machine and in the same group", () => {
  const current = [space("kid", null, "repo", true), space("unrelated"), space("parent", null, "repo"), space("remote-kid", "remote", "repo", true)];
  const same: GroupState = { ...grouped(), members: { parent: "first", kid: "first" } };
  assert.deepEqual(desiredOrder(current, same), [{ id: "parent", tree: null }, { id: "kid", tree: "└─" }, { id: "unrelated", tree: null }, { id: "remote-kid", tree: null }]);
  const different = { ...same, members: { parent: "first", kid: "second" } };
  assert.equal(desiredOrder(current, different).find(item => item.id === "kid")!.tree, null);
});

test("move indexes are global, one-based and simulated after earlier moves", () => {
  const current = [space("a"), space("b"), space("c"), space("r1", "remote"), space("r2", "remote"), space("r3", "remote")];
  const target = ["c", "b", "a", "r3", "r2", "r1"];
  const plan = movePlan(current, target);
  const actual = current.map(item => item.id);
  for (const move of plan) actual.splice(move.index - 1, 0, actual.splice(actual.indexOf(move.id), 1)[0]);
  assert.deepEqual(actual, target);
  assert.ok(plan.some(move => move.id === "r3" && move.index === 4));
  assert.deepEqual(movePlan(current, current.map(item => item.id)), []);
});

test("permutation and cross-machine violations are rejected before commands", () => {
  const current = [space("a"), space("r", "remote")];
  for (const target of [["a", "a"], ["a"], ["a", "missing"], ["r", "a"]]) assert.throws(() => movePlan(current, target));
});

test("generated reverse and rotation plans converge for varied block sizes", () => {
  for (let count = 0; count <= 25; count++) {
    const local = Array.from({ length: count }, (_, i) => space(`s${i}`));
    const remote = Array.from({ length: count }, (_, i) => space(`r${i}`, "remote"));
    const current = [...local, ...remote];
    const target = [...local].reverse().concat(remote.slice(1), remote.slice(0, 1)).map(item => item.id);
    const actual = current.map(item => item.id);
    for (const move of movePlan(current, target)) actual.splice(move.index - 1, 0, actual.splice(actual.indexOf(move.id), 1)[0]);
    assert.deepEqual(actual, target);
  }
});

test("a conflicting operation stops after three spaced attempts even as IDs churn", () => {
  const sync = new OrderSynchronizer();
  let current = [space("a"), space("b")];
  assert.ok(sync.step(current, ["b", "a"], 0).moves.length);
  assert.deepEqual(sync.step(current, ["b", "a"], 999).moves, []);
  current = [...current, space("new")];
  assert.ok(sync.step(current, ["b", "a", "new"], 1000).moves.length);
  current = [space("a"), space("b")];
  assert.ok(sync.step(current, ["b", "a"], 2000).moves.length);
  assert.equal(sync.step(current, ["b", "a"], 3000).warn, true);
  assert.equal(sync.failed, true);
  assert.deepEqual(sync.step(current, ["b", "a"], 9000), { moves: [], warn: false });
  sync.reset();
  assert.ok(sync.step(current, ["b", "a"], 9001).moves.length);
});

test("folding and renaming do not create a fresh ordering intent", () => {
  const state = grouped(), changed = grouped();
  changed.groups[0].folded = false; changed.groups[1].name = "Renamed";
  assert.equal(orderIntent(changed), orderIntent(state));
  changed.members.a = "second";
  assert.notEqual(orderIntent(changed), orderIntent(state));
});

test("late convergence hides the warning without granting another exhausted retry budget", () => {
  const sync = new OrderSynchronizer(), current = [space("a"), space("b")];
  for (const now of [0, 1000, 2000, 3000]) sync.step(current, ["b", "a"], now);
  assert.equal(sync.failed, true);
  assert.deepEqual(sync.step([space("b"), space("a")], ["b", "a"], 4000), { moves: [], warn: false });
  assert.equal(sync.failed, false);
  assert.deepEqual(sync.step(current, ["b", "a"], 5000), { moves: [], warn: false });
  assert.equal(sync.failed, true);
  assert.deepEqual(desiredOrder([], emptyGroups()), []);
});
