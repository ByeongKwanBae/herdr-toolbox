import { test } from "node:test";
import assert from "node:assert/strict";
import { absoluteFolder, folderRequest, childFolder, parentFolder, newFolderName, posixPage, windowsPage, FolderBrowser, FOLDER_LIMIT, type FolderPage } from "../src/core/folders.js";
import { RemoteDirectory, encodedPowerShell, windowsFoldersScript, POSIX_FOLDERS, POSIX_VALIDATE_FOLDER, POSIX_ADD_FOLDER, type DirectoryExec } from "../src/host/remote-directory.js";
import { FolderCreation, creationCandidates, type CreationSpace } from "../src/core/creation.js";
import { remoteCreationAdapter, type RemoteCreationApi } from "../src/host/creation-adapter.js";

const posix = (path = "/home/user", names: string[] = []) => ["SO-FOLDERS-1", "/home/user", path, ...names, ""].join("\0");
const windows = (path = "C:\\Users\\User", names: string[] = []) => JSON.stringify({ version: 1, path, home: "C:\\Users\\User", roots: ["C:\\", "D:\\"], folders: names.map(name => ({ name })) });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("parents stop at POSIX, drive and UNC roots, with Windows separator variants", () => {
  assert.equal(parentFolder("/", "linux"), null);
  assert.equal(parentFolder("/home/user/", "macos"), "/home");
  assert.equal(parentFolder("/home", "linux"), "/");
  assert.equal(parentFolder("C:\\", "windows"), null);
  assert.equal(parentFolder("C:/work/folder/", "windows"), "C:\\work");
  assert.equal(parentFolder("C:\\work", "windows"), "C:\\");
  assert.equal(parentFolder("\\\\server\\share", "windows"), null);
  assert.equal(parentFolder("\\\\server\\share\\folder", "windows"), "\\\\server\\share\\");
  assert.equal(parentFolder("C:relative", "windows"), null);
});
test("folder requests accept absolute paths and home aliases, rejecting relative paths and NUL", () => {
  for (const platform of ["linux", "macos", "windows"] as const) {
    for (const path of [undefined, "", "~", "~/한글 folder"]) assert.doesNotThrow(() => folderRequest(path, platform));
    for (const path of ["relative", "../escape", "bad\0path", "~/bad\0path"]) assert.throws(() => folderRequest(path, platform));
  }
  assert.equal(absoluteFolder("C:relative", "windows"), false);
  assert.doesNotThrow(() => folderRequest("\\\\server\\share\\한글 folder", "windows"));
  assert.doesNotThrow(() => folderRequest("~\\Documents", "windows"));
});
test("new folder names reject traversal and controls while preserving literal POSIX filename data", () => {
  for (const name of ["", "   ", ".", "..", "../escape", "/absolute", "two/folders", "bad\0name", "line\nbreak", "tab\tname", "bad\x7f"]) assert.throws(() => newFolderName(name));
  for (const name of ["한글 😀 folder", "O'Brien $(touch marker) `x`", "--option", "back\\slash", " leading and trailing "]) assert.equal(newFolderName(name), name);
});

for (const platform of ["linux", "macos"] as const) test(`${platform} adds a single folder using separate argv without replaying the mutation`, async () => {
  const calls: string[][] = [], name = "한글 O'Brien $(touch marker) `x`";
  let attempts = 0;
  const reader = new RemoteDirectory("remote", async (_command, args, options) => {
    assert.equal(options.on, "remote"); calls.push(args);
    if (calls.length === 1) return { code: 0, stdout: platform, stderr: "" };
    if (args[1] === POSIX_ADD_FOLDER) {
      attempts++;
      assert.equal(args.at(-2), "/parent"); assert.equal(args.at(-1), name);
      assert.equal(args[1].includes(name), false);
      return attempts === 1 ? { code: 0, stdout: posix(`/parent/${name}`), stderr: "" } : { code: 1, stdout: "", stderr: "File exists" };
    }
    return { code: 0, stdout: posix("/parent"), stderr: "" };
  });
  assert.equal((await reader.addFolder("/parent", name)).path, `/parent/${name}`);
  await assert.rejects(reader.addFolder("/parent", name), /File exists/);
  assert.equal(attempts, 2);
});
test("invalid Add Folder requests cause no remote operations", async () => {
  const reader = new RemoteDirectory("remote", async () => assert.fail("invalid names must not reach the machine"));
  for (const name of ["", ".", "..", "../escape", "line\nbreak"]) await assert.rejects(reader.addFolder("/parent", name));
});
test("POSIX listing preserves Unicode, quotes, backslashes and newlines as filename data", () => {
  const names = ["한글 folder", "O'Brien $(touch nope) `x`", "back\\slash", "line\nbreak"];
  const page = posixPage(posix("/tmp", names), "macos");
  assert.equal(page.platform, "macos");
  for (const name of names) assert.equal(page.folders.find(entry => entry.name === name)?.path, `/tmp/${name}`);
  assert.equal(childFolder("/", "folder", "linux"), "/folder");
});
test("Windows listing handles zero/one entries, drive roots and UNC paths", () => {
  assert.deepEqual(windowsPage(windows("C:\\")).folders, []);
  assert.equal(windowsPage(windows("C:\\", ["한글 folder"])).folders[0].path, "C:\\한글 folder");
  assert.equal(windowsPage(windows("\\\\server\\share\\", ["one"])).folders[0].path, "\\\\server\\share\\one");
});
test("missing or malformed Windows output reports a recoverable protocol error", () => {
  for (const output of ["", "not json", "{truncated"]) assert.throws(() => windowsPage(output), { message: "Invalid remote folder response." });
});
test("listing output is bounded and rejects malformed headers, names and filesystem paths", () => {
  const names = Array.from({ length: FOLDER_LIMIT + 1 }, (_, i) => `folder-${i}`);
  assert.equal(posixPage(posix("/tmp", names), "linux").folders.length, FOLDER_LIMIT);
  assert.equal(windowsPage(windows("C:\\", names)).limited, true);
  for (const data of ["bad", "SO-FOLDERS-1\0relative\0/\0", posix("/tmp", ["../escape"]), posix("/tmp", ["."]), posix("/tmp", [...names, "overflow"])]) assert.throws(() => posixPage(data, "linux"));
  for (const data of ["null", "{}", windows("relative"), windows("C:\\", [".."]), windows("C:\\", ["bad\\name"])]) assert.throws(() => windowsPage(data));
});
for (const platform of ["linux", "macos"] as const) test(`${platform} detection and listing use remote argv data and cache only the platform`, async () => {
  const calls: { command: string; args: string[]; on: string }[] = [];
  const selected = "/tmp/한글 ' $(touch nope) `x`";
  const execute: DirectoryExec = async (command, args, options) => {
    calls.push({ command, args, on: options.on });
    return { code: 0, stdout: calls.length === 1 ? platform : posix(selected, ["child"]), stderr: "" };
  };
  const reader = new RemoteDirectory("remote", execute);
  assert.equal((await reader.read(selected)).path, selected);
  await reader.read(selected);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.on === "remote" && call.command === "sh"));
  assert.equal(calls[1].args.at(-1), selected);
  assert.equal(calls[1].args[2].includes(selected), false);
  assert.equal(POSIX_FOLDERS.includes("\0"), false);
});
test("PowerShell encodes path data without executable interpolation, including curly quotes and Unicode", () => {
  const path = "C:\\한글 😀 O'Brien ‘x’ $() `x`\nfolder";
  const encoded = encodedPowerShell(path);
  assert.equal(Buffer.from(encoded, "base64").toString("utf16le"), path);
  const script = windowsFoldersScript(path);
  assert.equal(script.includes(path), false);
  assert.ok(script.includes(encoded));
  assert.equal(Buffer.from(encodedPowerShell(script), "base64").toString("utf16le"), script);
});
test("a Windows remote with Git sh still selects PowerShell and sends only encoded scripts", async () => {
  const calls: { command: string; args: string[] }[] = [];
  const reader = new RemoteDirectory("win", async (command, args) => {
    calls.push({ command, args });
    if (command === "sh") return { code: 64, stdout: "", stderr: "" };
    const script = Buffer.from(args.at(-1)!, "base64").toString("utf16le");
    return { code: 0, stdout: script.includes("Get-ChildItem") ? windows("D:\\work", ["child"]) : "windows", stderr: "" };
  });
  const page = await reader.read("D:\\work");
  assert.equal(page.platform, "windows");
  assert.equal(page.folders[0].path, "D:\\work\\child");
  assert.ok(calls.slice(1).every(call => call.command === "powershell.exe" && call.args.includes("-EncodedCommand")));
});
test("PowerShell Core is used when Windows PowerShell cannot start", async () => {
  const calls: string[] = [];
  const reader = new RemoteDirectory("win", async (command, args) => {
    calls.push(command);
    if (command !== "pwsh") throw new Error("not installed");
    const script = Buffer.from(args.at(-1)!, "base64").toString("utf16le");
    return { code: 0, stdout: script.includes("Get-ChildItem") ? windows() : "windows", stderr: "" };
  });
  await reader.read();
  assert.deepEqual(calls, ["sh", "powershell.exe", "pwsh", "pwsh"]);
});
test("permission failures do not fall back to another OS or return an empty successful list", async () => {
  let calls = 0;
  const reader = new RemoteDirectory("linux", async () => ++calls === 1 ? { code: 0, stdout: "linux", stderr: "" } : { code: 1, stdout: "", stderr: "Permission denied" });
  await assert.rejects(reader.read("/root"), /Permission denied/);
  assert.equal(calls, 2);
});
test("an unsupported/unreachable machine produces a recoverable error", async () => {
  await assert.rejects(new RemoteDirectory("remote", async () => { throw new Error("offline"); }).read(), /Reconnect and retry/);
});
test("out-of-order navigation cannot replace a newer selected directory", async () => {
  const first = deferred<FolderPage>(), second = deferred<FolderPage>();
  const browser = new FolderBrowser(path => path === "/first" ? first.promise : second.promise);
  const old = browser.navigate("/first"), current = browser.navigate("/second");
  assert.equal(browser.selectable, false);
  second.resolve(posixPage(posix("/second"), "linux")); await current;
  first.resolve(posixPage(posix("/first"), "linux")); await old;
  assert.equal(browser.page!.path, "/second"); assert.equal(browser.selectable, true);
});
test("a failed navigation cannot create in the previously displayed folder and can be retried", async () => {
  const browser = new FolderBrowser(async path => { if (path === "/bad") throw new Error("denied"); return posixPage(posix(path), "linux"); });
  await browser.navigate("/good"); await browser.navigate("/bad");
  assert.equal(browser.page!.path, "/good"); assert.equal(browser.selectable, false);
  await browser.navigate("/recovered"); assert.equal(browser.selectable, true);
});
test("closing a popup ignores delayed listings and prevents later navigation", async () => {
  const read = deferred<FolderPage>(); let calls = 0;
  const browser = new FolderBrowser(() => { calls++; return read.promise; });
  const task = browser.navigate(); browser.close(); read.resolve(posixPage(posix(), "linux")); await task;
  assert.equal(browser.page, null); assert.equal(browser.selectable, false);
  await browser.navigate("/tmp"); assert.equal(calls, 1);
});

test("typing a new address during a pending listing prevents the response from replacing it", async () => {
  const read = deferred<FolderPage>();
  const browser = new FolderBrowser(() => read.promise);
  const task = browser.navigate("/first");
  browser.noteAddressEdit();
  read.resolve(posixPage(posix("/first"), "linux")); await task;
  assert.equal(browser.canSyncAddress, false);
  await browser.navigate("/typed");
  assert.equal(browser.canSyncAddress, true);
});

test("creation preflight validates the chosen directory without enumerating children", async () => {
  const calls: string[][] = [];
  const reader = new RemoteDirectory("linux", async (_command, args) => {
    calls.push(args);
    return { code: 0, stdout: calls.length === 1 ? "linux" : posix("/chosen"), stderr: "" };
  });
  assert.equal(await reader.validate("/chosen"), "/chosen");
  assert.equal(calls[1][1], POSIX_VALIDATE_FOLDER);
  assert.equal(POSIX_VALIDATE_FOLDER.includes("for p"), false);
  assert.equal(windowsFoldersScript("C:\\chosen", true).includes("Get-ChildItem"), false);
});

for (const platform of ["linux", "macos", "windows"] as const) test(`${platform} creation passes the selected remote path and machine unchanged and assigns only its matching new Space`, async () => {
  const folder = platform === "windows" ? "D:\\한글 O'Brien $(x)" : "/tmp/한글 O'Brien $(x)";
  let current: CreationSpace[] = [{ id: "other", machine: "other", folder }];
  const calls: unknown[] = [], errors: string[] = [], assignments: string[] = [];
  const api: RemoteCreationApi = {
    checking: () => false, ready: () => true, validateFolder: async path => path, spaces: () => current,
    run: (command, args) => { calls.push([command, args]); current = [...current, { id: "new", machine: "remote", folder: String(args.folder) }]; },
    failed: message => errors.push(message),
  };
  const host = remoteCreationAdapter(api, "remote", folder, async () => {});
  host.validGroup = () => true; host.assignGroup = (space, group) => assignments.push(`${space}:${group}`);
  const creation = new FolderCreation(() => false, Date.now, { machine: "remote", platform });
  const request = creation.begin("group")!; assert.equal(creation.begin(), null);
  assert.equal(await request.execute(host), "created");
  assert.deepEqual(calls, [["space.new", { machine: "remote", folder }]]);
  assert.deepEqual(assignments, ["new:group"]); assert.deepEqual(errors, []);
  assert.equal(creation.busy, false);
});
test("POSIX creation matching preserves case and excludes every other machine", () => {
  const candidates: CreationSpace[] = [{ id: "case", machine: "remote", folder: "/Work" }, { id: "wrong", machine: "other", folder: "/work" }, { id: "local", machine: null, folder: "/work" }];
  assert.deepEqual(creationCandidates(new Set(), candidates, "/work", { machine: "remote", platform: "linux" }), []);
  assert.deepEqual(creationCandidates(new Set(), [{ id: "new", machine: "remote", folder: "c:/WORK/" }], "C:\\work", { machine: "remote", platform: "windows" }).map(space => space.id), ["new"]);
});
test("an empty folder field cannot match the POSIX filesystem root", () => {
  const candidates: CreationSpace[] = [{ id: "unknown", machine: "remote", folder: "" }, { id: "root", machine: "remote", folder: "/" }];
  assert.deepEqual(creationCandidates(new Set(), candidates, "/", { machine: "remote", platform: "macos" }).map(space => space.id), ["root"]);
});
test("remote creation without a group opens the selected folder once", async () => {
  const spaces: CreationSpace[] = [];
  const calls: unknown[] = [];
  const api: RemoteCreationApi = {
    checking: () => false, ready: () => true, validateFolder: async path => path, spaces: () => spaces,
    run: (command, args) => { calls.push([command, args]); spaces.push({ id: "new", machine: "remote", folder: String(args.folder) }); },
    failed: message => assert.fail(message),
  };
  const creation = new FolderCreation(() => false, Date.now, { machine: "remote", platform: "linux" });
  const request = creation.begin()!;
  assert.equal(await request.execute(remoteCreationAdapter(api, "remote", "/", async () => {})), "created");
  assert.equal(await request.execute(remoteCreationAdapter(api, "remote", "/", async () => {})), "skipped");
  assert.deepEqual(calls, [["space.new", { machine: "remote", folder: "/" }]]);
});
test("a duplicate remote candidate is never assigned or followed by another creation", async () => {
  let spaces: CreationSpace[] = [], creates = 0, assigns = 0;
  const errors: string[] = [];
  const api: RemoteCreationApi = {
    checking: () => false, ready: () => true, validateFolder: async path => path, spaces: () => spaces,
    run: () => { creates++; spaces = [{ id: "a", machine: "remote", folder: "/tmp" }, { id: "b", machine: "remote", folder: "/tmp" }]; },
    failed: message => errors.push(message),
  };
  const host = remoteCreationAdapter(api, "remote", "/tmp", async () => {});
  host.validGroup = () => true; host.assignGroup = () => { assigns++; };
  const creation = new FolderCreation(() => false, Date.now, { machine: "remote", platform: "linux" });
  assert.equal(await creation.begin("group")!.execute(host), "failed");
  assert.equal(creates, 1); assert.equal(assigns, 0); assert.match(errors[0], /More than one/);
});
test("cancel, checking, disconnected machine and vanished folder never issue a creation command", async () => {
  for (const problem of ["checking", "offline", "vanished", "cancelled"] as const) {
    let cancelled = false, calls = 0;
    const api: RemoteCreationApi = {
      checking: () => problem === "checking" || cancelled, ready: () => problem !== "offline",
      validateFolder: async () => { if (problem === "vanished") throw new Error("Folder removed"); if (problem === "cancelled") cancelled = true; return "/tmp"; },
      spaces: () => [], run: () => { calls++; }, failed: () => {},
    };
    const creation = new FolderCreation(api.checking, Date.now, { machine: "remote", platform: "linux" });
    const request = creation.begin(); if (request) await request.execute(remoteCreationAdapter(api, "remote", "/tmp", async () => {}));
    assert.equal(calls, 0); assert.equal(creation.busy, false);
  }
});
