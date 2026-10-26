import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "aside-release-"));
const script = fileURLToPath(
  new URL("../scripts/check-release.mjs", import.meta.url),
);
const version = "0.1.1";
async function writeVersions(overrides = {}) {
  const files = {
    "manifest.json": { version },
    "package.json": { version },
    "package-lock.json": { version, packages: { "": { version } } },
    ...overrides,
  };
  await Promise.all(
    Object.entries(files).map(([file, data]) =>
      writeFile(join(directory, file), JSON.stringify(data)),
    ),
  );
}
function check(tag) {
  const result = spawnSync(process.execPath, [script, ...tag], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.ifError(result.error);
  return result;
}

try {
  await writeVersions();
  const valid = check(["v0.1.1"]);
  assert.equal(valid.status, 0, valid.stderr);
  for (const tag of [
    [],
    ["0.1.1"],
    ["v01.1.1"],
    ["v0.1.1-beta.1"],
    ["v0.1.2"],
  ]) {
    assert.notEqual(check(tag).status, 0, `Reject ${tag}`);
  }
  for (const [file, data] of [
    ["manifest.json", { version: "0.1.0" }],
    ["package.json", { version: "0.1.0" }],
    ["package-lock.json", { version: "0.1.0", packages: { "": { version } } }],
    ["package-lock.json", { version, packages: { "": { version: "0.1.0" } } }],
  ]) {
    await writeVersions({ [file]: data });
    const result = check(["v0.1.1"]);
    assert.notEqual(result.status, 0, `Reject mismatched ${file}`);
    assert(result.stderr.includes(`${file} `), result.stderr);
  }
  console.log("Release version checks passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
