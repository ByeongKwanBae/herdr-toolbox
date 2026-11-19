import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cache = join(root, ".cache/herdr-sdk");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export async function verifySdk() {
  const lock = JSON.parse(await readFile(join(root, "sdk.lock.json"), "utf8"));
  for (const [name, hash] of Object.entries(lock.files)) {
    let bytes;
    try { bytes = await readFile(join(cache, name)); }
    catch { throw new Error(`SDK missing: ${name}. Run npm run sdk:sync using Herdr ${lock.appVersion}.`); }
    if (sha256(bytes) !== hash) throw new Error(`SDK hash mismatch: ${name}. Run npm run sdk:sync; review SDK changes explicitly before changing sdk.lock.json.`);
  }
  const metadata = JSON.parse(await readFile(join(cache, "sdk.json"), "utf8"));
  if (metadata.appVersion !== lock.appVersion) throw new Error("Cached SDK version does not match sdk.lock.json.");
  return lock;
}

async function sync() {
  const lock = JSON.parse(await readFile(join(root, "sdk.lock.json"), "utf8"));
  const appHome = process.env.HERDR_APP_HOME || join(homedir(), ".config/herdr-app");
  const app = process.env.HERDR_APP_BIN || "herdr-app";
  const version = execFileSync(app, ["--version"], { encoding: "utf8" }).trim().replace(/^herdr-app\s+/, "");
  if (version !== lock.appVersion) throw new Error(`Expected Herdr ${lock.appVersion}, found ${version}. Review the SDK lock before upgrading.`);
  const files = new Map();
  for (const [name, hash] of Object.entries({ ...lock.files, ...lock.upstream })) {
    const bytes = await readFile(join(appHome, name));
    if (sha256(bytes) !== hash) throw new Error(`Installed file differs from sdk.lock.json: ${name}`);
    if (Object.hasOwn(lock.files, name)) files.set(name, bytes);
  }
  await mkdir(cache, { recursive: true });
  for (const [name, bytes] of files) await writeFile(join(cache, name), bytes);
  await writeFile(join(cache, "sdk.json"), JSON.stringify({ appVersion: version }) + "\n");
  console.log(`SDK ready: Herdr ${version}, ${files.size} verified declarations.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv[2] === "sync") await sync();
    else if (process.argv[2] === "verify") { await verifySdk(); console.log("SDK hashes and version match."); }
    else throw new Error("Usage: node scripts/sdk.mjs sync|verify");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
