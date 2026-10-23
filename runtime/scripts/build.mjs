import { build } from "esbuild";
import { chmod, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });

for (const entry of ["server", "cli", "level-import-cli"]) {
  const outfile = new URL(`../dist/${entry}.mjs`, import.meta.url);
  await build({
    entryPoints: [fileURLToPath(new URL(`../src/${entry}.ts`, import.meta.url))],
    outfile: fileURLToPath(outfile),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    sourcemap: false,
    legalComments: "none",
  });
  if (process.platform !== "win32" && entry === "cli") await chmod(outfile, 0o755);
}
