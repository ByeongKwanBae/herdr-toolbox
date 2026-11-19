import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalCreation, creationCandidates, type CreationSpace } from "../src/core/creation.js";
import { creationAdapter, type CreationApi } from "../src/host/creation-adapter.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(folder: string | null = "C:\\sample") {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  let current: CreationSpace[] = [{ id: "existing", folder: "C:\\old", machine: null }];
  let checks = false;
  let pauses = 0;
  const api: CreationApi = {
    checking: () => checks,
    pickFolder: async () => folder,
    spaces: () => current,
    run: (command, args) => {
      calls.push({ command, args });
      current = [...current, { id: "new", machine: null, folder: String(args.folder) }];
    },
    notify: options => { errors.push(options.body); },
  };
  const host = creationAdapter(api, async ms => { assert.equal(ms, 250); pauses++; });
  const controller = new LocalCreation(() => checks);
  return { api, host, controller, calls, errors,
    get current() { return current; }, set current(value: CreationSpace[]) { current = value; },
    get checks() { return checks; }, set checks(value: boolean) { checks = value; },
    get pauses() { return pauses; },
  };
}

test("cancel never creates, reports an error or leaves a lock", async () => {
  const f = fixture(null);
  assert.equal(await f.controller.begin()!.execute(f.host), "cancelled");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.errors, []);
  assert.equal(f.controller.phase, "idle");
  assert.ok(f.controller.begin());
});

for (const folder of ["C:\\work folder\\한글 프로젝트", "C:\\work\\O'Brien & $(echo nope) `name`", "C:\\"]) {
  test(`selected path is passed unchanged as a local command argument: ${folder}`, async () => {
    const f = fixture(folder);
    assert.equal(await f.controller.begin()!.execute(f.host), "created");
    assert.deepEqual(f.calls, [{ command: "space.new", args: { folder, machine: "" } }]);
    assert.deepEqual(f.errors, []);
  });
}

test("duplicate requests are rejected synchronously while picking", async () => {
  const f = fixture();
  const picker = deferred<string | null>();
  f.api.pickFolder = () => picker.promise;
  const request = f.controller.begin()!;
  assert.equal(f.controller.phase, "picking");
  assert.equal(f.controller.begin(), null);
  const task = request.execute(f.host);
  assert.equal(f.controller.begin(), null);
  assert.equal(await request.execute(f.host), "skipped");
  picker.resolve("C:\\sample");
  assert.equal(await task, "created");
  assert.equal(f.calls.length, 1);
});

test("a pending creation holds the lock until the new Space is observed", async () => {
  const f = fixture();
  const observation = deferred<void>();
  f.api.run = (command, args) => { f.calls.push({ command, args }); };
  f.host.pause = () => observation.promise;
  const task = f.controller.begin()!.execute(f.host);
  await Promise.resolve();
  assert.equal(f.controller.phase, "creating");
  assert.equal(f.controller.begin(), null);
  f.current = [...f.current, { id: "new", machine: null, folder: "C:\\sample" }];
  observation.resolve();
  assert.equal(await task, "created");
  assert.equal(f.controller.busy, false);
});

test("picker rejection is reported once and a later request succeeds", async () => {
  const f = fixture();
  f.api.pickFolder = async () => { throw new Error("Picker unavailable"); };
  assert.equal(await f.controller.begin()!.execute(f.host), "failed");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.errors, ["Picker unavailable"]);
  f.api.pickFolder = async () => "C:\\sample";
  assert.equal(await f.controller.begin()!.execute(f.host), "created");
});

test("creation failure unlocks without retrying and preserves host feedback", async () => {
  const f = fixture();
  const create = f.api.run;
  f.api.run = () => { throw new Error("Invalid folder"); };
  assert.equal(await f.controller.begin()!.execute(f.host), "failed");
  assert.deepEqual(f.errors, ["Invalid folder"]);
  assert.equal(f.controller.phase, "idle");
  f.api.run = create;
  assert.equal(await f.controller.begin()!.execute(f.host), "created");
});

test("normal run return alone is not success; observation stops at 5 seconds", async () => {
  const f = fixture();
  f.api.run = (command, args) => { f.calls.push({ command, args }); return null; };
  assert.equal(await f.controller.begin()!.execute(f.host), "failed");
  assert.equal(f.calls.length, 1);
  assert.equal(f.pauses, 20);
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0], /not confirmed within 5 seconds/);
  assert.equal(f.controller.phase, "idle");
  // Late arrivals cause no second command or assignment.
  f.current = [...f.current, { id: "late", machine: null, folder: "C:\\sample" }];
  assert.equal(f.calls.length, 1);
});

test("the baseline is taken after picking, so an earlier same-folder arrival is excluded", async () => {
  const f = fixture();
  f.api.pickFolder = async () => {
    f.current = [...f.current, { id: "arrived-during-picker", machine: null, folder: "C:\\sample" }];
    return "C:\\sample";
  };
  f.api.run = () => null;
  assert.equal(await f.controller.begin()!.execute(f.host), "failed");
  assert.equal(f.pauses, 20);
});

test("ambiguous candidates fail without selecting an arbitrary ID", async () => {
  const f = fixture();
  f.api.run = () => {
    f.current = [...f.current, { id: "a", machine: null, folder: "C:\\sample" }, { id: "b", machine: null, folder: "C:\\sample" }];
  };
  assert.equal(await f.controller.begin()!.execute(f.host), "failed");
  assert.match(f.errors[0], /More than one/);
  assert.equal(f.pauses, 0);
});

test("observations require a new local ID and matching folder", () => {
  const before = new Set(["existing"]);
  const current = [
    { id: "existing", machine: null, folder: "C:\\sample" },
    { id: "remote", machine: "remote", folder: "C:\\sample" },
    { id: "other-folder", machine: null, folder: "C:\\other" },
    { id: "unknown-folder", machine: null, folder: "" },
    { id: "new", machine: null, folder: "c:/SAMPLE/" },
  ];
  assert.deepEqual(creationCandidates(before, current, "C:\\sample"), [current[4]]);
  assert.deepEqual([...before], ["existing"]);
});

test("checking mode prevents reservation and all adapter effects", async () => {
  const f = fixture();
  f.checks = true;
  let picked = false;
  f.api.pickFolder = async () => { picked = true; return "C:\\sample"; };
  assert.equal(f.controller.begin(), null);
  assert.equal(await f.host.pickFolder(), null);
  f.host.create("C:\\sample");
  f.host.failed("ignored");
  assert.equal(picked, false);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.errors, []);
});

test("checking mode reached while picking suppresses creation", async () => {
  const f = fixture();
  f.api.pickFolder = async () => { f.checks = true; return "C:\\sample"; };
  assert.equal(await f.controller.begin()!.execute(f.host), "skipped");
  assert.deepEqual(f.calls, []);
  assert.equal(f.controller.phase, "idle");
});

test("a local group request assigns only the matching new Space after observation", async () => {
  const f = fixture();
  const assigned: string[][] = [];
  f.host.validGroup = id => id === "group";
  f.host.assignGroup = (space, group) => { assigned.push([space, group]); };
  assert.equal(await f.controller.begin("group")!.execute(f.host), "created");
  assert.deepEqual(assigned, [["new", "group"]]);
  assert.equal(f.controller.pending, null);
});

test("a group deleted during picking prevents the command; deletion after command leaves the Space ungrouped", async () => {
  const f = fixture();
  f.host.validGroup = () => false;
  f.host.assignGroup = () => assert.fail("No assignment is allowed");
  assert.equal(await f.controller.begin("group")!.execute(f.host), "failed");
  assert.equal(f.calls.length, 0);
  let valid = true;
  f.host.validGroup = () => valid;
  const create = f.host.create;
  f.host.create = folder => { create(folder); valid = false; };
  assert.equal(await f.controller.begin("group")!.execute(f.host), "failed");
  assert.equal(f.calls.length, 1);
});

test("missing folder metadata cancels automatic grouping without retrying generation", async () => {
  const f = fixture();
  f.host.validGroup = () => true;
  f.host.assignGroup = () => assert.fail("Do not guess a candidate");
  const create = f.host.create;
  f.host.create = folder => { create(folder); f.current = f.current.map(space => space.id === "new" ? { ...space, folder: "" } : space); };
  assert.equal(await f.controller.begin("group")!.execute(f.host), "failed");
  assert.equal(f.calls.length, 1);
  assert.match(f.errors[0], /no folder information/);
});

test("a candidate observed after a delayed wake-up cannot be assigned past five seconds", async () => {
  const f = fixture();
  let now = 0;
  const controller = new LocalCreation(() => false, () => now);
  f.api.run = (command, args) => { f.calls.push({ command, args }); };
  f.host.validGroup = () => true;
  f.host.assignGroup = () => assert.fail("Late candidates must remain ungrouped");
  f.host.pause = async () => {
    now = 6000;
    f.current = [...f.current, { id: "late", machine: null, folder: "C:\\sample" }];
  };
  assert.equal(await controller.begin("group")!.execute(f.host), "failed");
  assert.equal(f.calls.length, 1);
  assert.match(f.errors[0], /within 5 seconds/);
  assert.equal(controller.pending, null);
});
