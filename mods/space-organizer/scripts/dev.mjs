import { spawnSync } from "node:child_process";
import { readFile, lstat, realpath, copyFile, rename, watch } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.env.HERDR_DEV_MOD_DIR;
if (!target || basename(target) !== "space-organizer") throw new Error("Set HERDR_DEV_MOD_DIR to an explicit existing mods/space-organizer clone. The default spaces mod is never a target.");
const targetDir = resolve(target);
// Refuse junctions/symlinks in the target path, including parent directories.
for (let cursor = targetDir; ; cursor = dirname(cursor)) {
  if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Linked development target refused: ${cursor}`);
  if (dirname(cursor) === cursor) break;
}
const canonical = await realpath(targetDir);
if (canonical.toLowerCase() !== targetDir.toLowerCase()) throw new Error("Unexpected development target resolution.");
const manifest = JSON.parse(await readFile(join(targetDir, "mod.json"), "utf8"));
if (manifest.cloned_from?.name !== "spaces") throw new Error("Use herdr-app do mod.clone --name spaces --as space-organizer before development sync.");

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status === 0;
}

async function sync() {
  if (!run(["scripts/sdk.mjs", "verify"]) || !run(["node_modules/typescript/bin/tsc", "--noEmit"]) || !run(["scripts/build.mjs"])) {
    console.error("Development sync skipped; the installed build is unchanged.");
    return false;
  }
  // Publish the executable last. Only files owned by this mod are copied.
  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md", "mod.json", "main.js"]) {
    const temporary = join(targetDir, `.${name}.space-organizer-next`);
    await copyFile(join(root, "dist/mods/space-organizer", name), temporary);
    await rename(temporary, join(targetDir, name));
  }
  console.log("Development build synced. Check herdr-app status for reload errors.");
  return true;
}

if (!await sync() && process.argv.includes("--once")) process.exitCode = 1;
if (!process.argv.includes("--once")) {
  console.log("Watching src/, manifest/ and sdk.lock.json; Ctrl+C stops.");
  const iterator = watch(root, { recursive: true });
  for await (const event of iterator) {
    const name = event.filename?.replaceAll("\\", "/") ?? "";
    if (name.startsWith("src/") || name.startsWith("manifest/") || name === "sdk.lock.json") await sync();
  }
}
