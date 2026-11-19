import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { verifySdk } from "./sdk.mjs";

await verifySdk();
const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "dist/mods/space-organizer");
const externals = ["herdr", "gpui-kit", "gpui-base"];
const result = await build({
  absWorkingDir: root, entryPoints: ["src/main.ts"], outfile: join(out, "main.js"),
  bundle: true, format: "esm", platform: "neutral", target: "es2020",
  external: externals, minify: false, sourcemap: false, legalComments: "eof",
  metafile: true, write: false,
});
for (const output of Object.values(result.metafile.outputs)) {
  for (const dep of output.imports) {
    if (!dep.external || !externals.includes(dep.path) || dep.kind !== "import-statement") {
      throw new Error(`Unsupported runtime import: ${dep.path} (${dep.kind})`);
    }
  }
}
for (const file of result.outputFiles) {
  if (/\brequire\s*\(|\b__require\b|\bsetTimeout\s*\(|\bsetInterval\s*\(/.test(file.text)) throw new Error("Forbidden runtime dependency in bundle.");
}
// Validate every output before publishing files into the local build directory.
await mkdir(out, { recursive: true });
for (const file of result.outputFiles) await writeFile(file.path, file.contents);
await copyFile(join(root, "manifest/mod.json"), join(out, "mod.json"));
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) await copyFile(join(root, name), join(out, name));
await mkdir(join(root, "artifacts"), { recursive: true });
await writeFile(join(root, "artifacts/build-meta.json"), JSON.stringify(result.metafile, null, 2));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
console.log(`Built Space Organizer ${pkg.version}: ESM, external ${externals.join(", ")}.`);
