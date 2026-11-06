import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.argv[2]) {
  for (const platform of ["chrome-extension", "safari-web-extension"]) {
    const run = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), platform],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
  }
  console.log(
    "PASS: reset waits for writes, clears private/native settings and device keys, restores factory defaults, and recovers damaged credentials.",
  );
  process.exit(0);
}
const origin = `${process.argv[2]}://reset-fixture/`;
globalThis.location = { href: origin + "index.html" };
globalThis.BroadcastChannel = class {
  postMessage() {}
  close() {}
};
const values = {};
globalThis.chrome = {
  runtime: { getURL: (path) => origin + path },
  storage: {
    local: {
      setAccessLevel: async () => {},
      get: async (keys) =>
        structuredClone(
          keys === null
            ? values
            : Object.fromEntries(
                (Array.isArray(keys) ? keys : [keys]).map((key) => [
                  key,
                  values[key],
                ]),
              ),
        ),
      set: async (data) => Object.assign(values, structuredClone(data)),
      remove: async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys])
          delete values[key];
      },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
};
const { initialize, mutate, readStore, resetStore } =
  await import("../store.js");
const { localStore } = await import("../extension-storage.js");
const { decryptCredentials } = await import("../credential-store.js");
await initialize();
const initial = await readStore();
await mutate((data) => {
  data.credentials.secret = "reset-test-secret";
  data.settings.actions = [];
  data.collection = [{ id: "old-collection" }];
  data.daily.result = "old thought";
});
await localStore.set({
  "native-language-packs": ["old"],
  configurationSync: { enabled: true },
  retiredKey: "old",
});
const oldCiphertext = (await localStore.get("protectedConfiguration"))
  .protectedConfiguration;
let release;
const hold = new Promise((resolve) => {
  release = resolve;
});
const write = mutate(async (data) => {
  await hold;
  data.daily.result = "late write";
});
const reset = resetStore();
release();
await Promise.all([write, reset]);
assert.deepEqual(await readStore(), initial);
assert.deepEqual(Object.keys(await localStore.get(null)).sort(), [
  "collection",
  "daily",
  "qaShortcutDefaultApplied",
  "settings",
]);
await assert.rejects(decryptCredentials(oldCiphertext));
const fresh = await readStore();
assert.equal(
  fresh.settings.actions.find((action) => action.kind === "translate")
    .translationEngine,
  "microsoft",
);
await mutate((data) => {
  data.credentials.new = "new-key";
});
assert.equal(
  (await readStore()).credentials.new,
  "new-key",
  "New credentials work after reset",
);
await localStore.set({
  protectedConfiguration: { version: 1, iv: "bad", ciphertext: "bad" },
});
await resetStore();
assert.deepEqual(await readStore(), initial);
