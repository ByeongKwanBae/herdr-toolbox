import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { RemoteDirectory, type DirectoryExec } from "../src/host/remote-directory.js";

// Execute the actual platform script in an isolated filesystem fixture. This
// intentionally never connects to Herdr, remote machines or an open terminal.
test("native directory scripts preserve filenames, cap listings and validate without listing", async () => {
  const cache = resolve(".cache/native-directory-tests");
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(join(cache, "fixture-"));
  const canonical = await realpath(root);
  assert.ok(canonical.startsWith((await realpath(cache)) + sep));
  const windows = process.platform === "win32";
  const execute: DirectoryExec = async (program, args) => {
    // Probe the native Windows transport even if Git Bash happens to be installed.
    if (windows && program === "sh") return { code: 64, stdout: "", stderr: "" };
    const result = spawnSync(program, args, { encoding: "utf8", windowsHide: true, timeout: 15000 });
    if (result.error) throw result.error;
    return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
  const reader = new RemoteDirectory("isolated-native-fixture", execute);
  try {
    const names = ["한글 folder", "O'Brien $() `x`", "[brackets]", "😀 emoji", ".hidden", ...(windows ? [] : ["line\nbreak", "back\\slash"])];
    for (const name of names) await mkdir(join(root, name));
    await writeFile(join(root, "plain-file"), "excluded");
    await symlink(join(root, names[0]), join(root, "folder-link"), windows ? "junction" : "dir");
    const page = await reader.read(root);
    assert.equal(page.path, canonical);
    assert.deepEqual(new Set(page.folders.map(entry => entry.name)), new Set([...names, "folder-link"]));
    assert.equal(await reader.validate(root), canonical);
    assert.equal((await reader.read(join(root, names[0]))).folders.length, 0);
    for (const name of ["missing", "plain-file"]) {
      await assert.rejects(reader.validate(join(root, name)), error => {
        assert.ok(error instanceof Error && error.message.length > 0);
        assert.doesNotMatch(error.message, /CLIXML|<Objs|<S S=|SyntaxError/);
        return true;
      });
    }
    const many = join(root, "many"); await mkdir(many);
    await Promise.all(Array.from({ length: 503 }, (_, index) => mkdir(join(many, `folder-${index}`))));
    const bounded = await reader.read(many);
    assert.equal(bounded.folders.length, 500); assert.equal(bounded.limited, true);
    assert.equal(await reader.validate(many), await realpath(many));
    const home = await reader.read("~");
    assert.equal(home.path, home.home);
    const drive = await reader.read(page.roots[0]);
    assert.ok(drive.roots.includes(drive.path));
  } finally {
    // Verify the absolute target before recursively deleting only this fixture.
    assert.ok(resolve(root).startsWith(cache + sep) && await realpath(root) === canonical);
    await rm(root, { recursive: true, force: true });
  }
});
