import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Explicit allowlist keeps rules, tests, docs, and local tooling out of hosting.
for (const filename of ["index.html", "admin.html", "favicon.svg", "firebase-config.js", "css", "js", "data"]) {
  await cp(resolve(root, filename), resolve(output, filename), { recursive: true });
}
await writeFile(resolve(output, ".nojekyll"), "");
process.stdout.write("Static site ready in dist/. No production dependencies or secrets are bundled.\n");
