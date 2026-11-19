import { test } from "node:test";
import assert from "node:assert/strict";
import { GroupDrag } from "../src/core/drag.js";
import { changeGroups } from "../src/core/groups.js";
import { type GroupState, type GroupSpace, type MachineState } from "../src/core/model.js";

const state: GroupState = { schemaVersion: 1, groups: [
  { id: "empty", name: "Empty", machine: null, folded: false },
  { id: "folded", name: "Folded", machine: null, folded: true },
  { id: "wsl", name: "WSL", machine: "ts-wsl", folded: false },
], members: { remote: "wsl" } };
const spaces: GroupSpace[] = [{ id: "local", machine: null }, { id: "remote", machine: "ts-wsl" }];
const machines: MachineState[] = [{ name: null, layout: "ready" }, { name: "ts-wsl", layout: "ready" }];
const local = { machine: null, group: "empty" };
function gesture(source = spaces[0]) {
  const drag = new GroupDrag(); drag.begin(source, { x: 10, y: 10 }); drag.move({ x: 20, y: 30 }); return drag;
}

test("a click or small pointer jitter never changes membership", () => {
  const drag = new GroupDrag(); drag.begin(spaces[0], { x: 10, y: 10 });
  drag.move({ x: 12, y: 13 }, local);
  assert.equal(drag.active, false); assert.equal(drag.over, undefined);
  assert.equal(drag.release(local, state, spaces, machines), null);
  assert.equal(drag.source, undefined);
});
test("dropping onto empty or folded groups changes only membership and preserves folding", () => {
  for (const group of ["empty", "folded"]) {
    const change = gesture().release({ machine: null, group }, state, spaces, machines);
    assert.ok(change);
    const next = changeGroups(state, change, spaces, machines);
    assert.equal(next.members.local, group); assert.deepEqual(next.groups, state.groups);
    assert.equal(state.members.local, undefined);
  }
});
test("remote WSL Spaces can join and leave groups on their own machine", () => {
  const remoteState: GroupState = { ...state, members: {} };
  const change = gesture(spaces[1]).release({ machine: "ts-wsl", group: "wsl" }, remoteState, spaces, machines);
  assert.ok(change);
  const joined = changeGroups(remoteState, change, spaces, machines);
  assert.equal(joined.members.remote, "wsl");
  const leave = gesture(spaces[1]).release({ machine: "ts-wsl", group: null }, joined, spaces, machines);
  assert.ok(leave); assert.equal(changeGroups(joined, leave, spaces, machines).members.remote, undefined);
});
test("cross-machine targets never highlight and cannot receive membership, including ungroup targets", () => {
  for (const group of ["wsl", null]) {
    const target = { machine: "ts-wsl", group }, drag = gesture();
    drag.move({ x: 30, y: 30 }, target);
    assert.equal(drag.over, undefined); assert.equal(drag.accepts(target), false);
    assert.throws(() => drag.release(target, state, spaces, machines), /same machine/);
    assert.equal(drag.source, undefined);
  }
});
test("a vanished Space or changed machine cannot be assigned by a stale gesture", () => {
  for (const current of [[], [{ id: "local", machine: "ts-wsl" }]]) {
    const drag = gesture();
    assert.throws(() => drag.release(local, state, current, machines), /no longer exists/);
    assert.equal(drag.active, false);
  }
});
test("a deleted or moved group is revalidated on release", () => {
  for (const groups of [[], [{ ...state.groups[0], machine: "ts-wsl" }]]) {
    const drag = gesture();
    assert.throws(() => drag.release(local, { ...state, groups }, spaces, machines), /no longer available/);
    assert.equal(drag.source, undefined);
  }
});
test("disconnect and loading during a drag reject both assignment and ungrouping", () => {
  for (const layout of ["loading", "unavailable"] as const) {
    for (const group of ["wsl", null]) {
      const drag = gesture(spaces[1]);
      assert.throws(() => drag.release({ machine: "ts-wsl", group }, state, spaces, [{ name: "ts-wsl", layout }]), /not ready/);
      assert.equal(drag.source, undefined);
    }
  }
});
test("dropping into the current group is a no-op", () => {
  assert.equal(gesture(spaces[1]).release({ machine: "ts-wsl", group: "wsl" }, state, spaces, machines), null);
  assert.equal(gesture().release({ machine: null, group: null }, state, spaces, machines), null);
});
test("leaving a target clears its highlight; cancelling cannot later apply a drop", () => {
  const drag = gesture(); drag.move({ x: 30, y: 30 }, local);
  assert.deepEqual(drag.over, local);
  drag.move({ x: 32, y: 32 }); assert.equal(drag.over, undefined);
  drag.cancel(); assert.equal(drag.active, false);
  assert.equal(drag.release(local, state, spaces, machines), null);
});
test("a new press replaces any previous gesture", () => {
  const drag = gesture(); drag.begin(spaces[1], { x: 0, y: 0 });
  assert.equal(drag.source, "remote"); assert.equal(drag.active, false);
  assert.equal(drag.release(local, state, spaces, machines), null);
});
