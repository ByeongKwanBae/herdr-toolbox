import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
function check(directory) {
  const result = spawnSync(process.env.HERDR_APP_BIN || "herdr-app", ["check", directory], { cwd: root, encoding: "utf8" });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.error) throw result.error;
  // Herdr 0.1.16 can exit 0 even when it prints "check failed".
  if (result.status !== 0 || /check failed/i.test((result.stdout || "") + (result.stderr || ""))) process.exitCode = 1;
}
check("./dist/mods/space-organizer");
// Check eagerly constructed native elements in both self-overlay views too.
for (const view of ["menu", "group", "folders"]) {
  const directory = join(root, ".cache/app-checks", view);
  await mkdir(directory, { recursive: true });
  await copyFile(join(root, "dist/mods/space-organizer/main.js"), join(directory, "organizer.js"));
  await writeFile(join(directory, "main.js"), `import Organizer from "./organizer.js";\nexport default class Probe extends Organizer { init(_props, cx) { super.init({ view: ${JSON.stringify(view)} }, cx); } }\n`);
  await writeFile(join(directory, "mod.json"), '{"place":"none"}\n');
  check(directory);
}
