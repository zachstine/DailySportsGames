import { cp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const pages = [
  "index.html",
  "admin.html",
  "account.html",
  "create/index.html",
  "admin/submissions/index.html",
];
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Explicit allowlist keeps rules, tests, docs, and local tooling out of hosting.
for (const filename of [
  "index.html",
  "admin.html",
  "account.html",
  "create",
  "admin",
  "favicon.svg",
  "firebase-config.js",
  "css",
  "js",
  "data",
]) {
  await cp(resolve(root, filename), resolve(output, filename), { recursive: true });
}
// Every deployment gives local module imports and styles the same content
// revision. Cached modules cannot mix old storage or Firebase code with new UI.
const scripts = (await readdir(resolve(output, "js")))
  .filter((name) => name.endsWith(".js"))
  .sort()
  .map((name) => `js/${name}`);
const styles = (await readdir(resolve(output, "css")))
  .filter((name) => name.endsWith(".css"))
  .sort()
  .map((name) => `css/${name}`);
const hash = createHash("sha256");
for (const filename of [...pages, "firebase-config.js", ...scripts, ...styles]) {
  hash.update(filename);
  hash.update(await readFile(resolve(output, filename)));
}
const version = hash.digest("hex").slice(0, 12);
for (const filename of scripts) {
  const source = await readFile(resolve(output, filename), "utf8");
  await writeFile(
    resolve(output, filename),
    source.replace(/(from\s+["'])(\.{1,2}\/[^"']+\.js)(?:\?[^"']*)?(["'])/g, `$1$2?v=${version}$3`),
  );
}
for (const filename of pages) {
  const source = await readFile(resolve(output, filename), "utf8");
  await writeFile(
    resolve(output, filename),
    source.replace(
      /((?:src|href)=["'])((?:\.{1,2}\/)+[^"']+\.(?:js|css))(?:\?[^"']*)?(["'])/g,
      `$1$2?v=${version}$3`,
    ),
  );
}
await writeFile(resolve(output, ".nojekyll"), "");
process.stdout.write(
  "Static site ready in dist/. No production dependencies or secrets are bundled.\n",
);
