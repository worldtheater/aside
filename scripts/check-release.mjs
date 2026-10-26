import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tag = process.argv[2];
assert.match(
  tag || "",
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/,
  "Release tag must use vX.Y.Z, for example v0.1.1",
);
const version = tag.slice(1);
const [manifest, pkg, lock] = await Promise.all(
  ["manifest.json", "package.json", "package-lock.json"].map(async (file) =>
    JSON.parse(await readFile(file, "utf8")),
  ),
);
for (const [field, value] of [
  ["manifest.json version", manifest.version],
  ["package.json version", pkg.version],
  ["package-lock.json version", lock.version],
  ['package-lock.json packages[""].version', lock.packages?.[""].version],
]) {
  assert.equal(value, version, `${field} must match ${tag}`);
}
console.log(`Release version verified: ${tag}`);
