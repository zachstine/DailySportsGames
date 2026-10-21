import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { validatePuzzle } from "../js/core.js";

const root = resolve(import.meta.dirname, "..");
const failures = [];
for (const folder of ["js", "scripts", "tests"]) for (const filename of await readdir(resolve(root, folder))) {
  if (!/\.(m?js)$/.test(filename)) continue;
  const result = spawnSync(process.execPath, ["--check", resolve(root, folder, filename)], { encoding: "utf8" });
  if (result.status) failures.push(result.stderr);
}
for (const filename of ["index.html", "admin.html", "account.html"]) {
  const content = await readFile(resolve(root, filename), "utf8");
  const ids = [...content.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]);
  if (new Set(ids).size !== ids.length) failures.push(`${filename}: duplicate element IDs.`);
  for (const match of content.matchAll(/(?:src|href)="(\.\/[^"#?]+)(?:[^\"]*)"/g)) {
    if (!existsSync(resolve(dirname(resolve(root, filename)), match[1]))) failures.push(`${filename}: missing local asset ${match[1]}`);
  }
  if (!content.includes('name="viewport"')) failures.push(`${filename}: missing viewport.`);
}
for (const filename of ["package.json", "firebase.json", "data/practice.json"]) JSON.parse(await readFile(resolve(root, filename), "utf8"));
failures.push(...validatePuzzle(JSON.parse(await readFile(resolve(root, "data/practice.json"), "utf8"))));
if (failures.length) { process.stderr.write(failures.join("\n") + "\n"); process.exit(1); }
process.stdout.write("JavaScript syntax, HTML asset paths, unique IDs, JSON, and practice puzzle validation passed.\n");
