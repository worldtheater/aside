import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { createPrivateStorage } from "../private-storage.js";
const changes = [];
const first = createPrivateStorage((change) => changes.push(change));
const second = createPrivateStorage(() => {});
assert.deepEqual(await first.get(null), {});
const input = {
  settings: { connections: [{ id: "a" }] },
  protectedConfiguration: { ciphertext: "encrypted" },
};
await first.set(input);
input.settings.connections[0].id = "changed";
assert.equal((await second.get("settings")).settings.connections[0].id, "a");
assert.deepEqual(Object.keys(await second.get(["settings", "missing"])), [
  "settings",
]);
const snapshot = await first.get("settings");
snapshot.settings.connections = [];
assert.equal((await first.get("settings")).settings.connections.length, 1);
const before = changes.length;
await first.set(await second.get(null));
assert.equal(changes.length, before, "No-op writes must not restart sync");
await Promise.all([first.set({ left: 1 }), second.set({ right: 2 })]);
assert.deepEqual(await first.get(["left", "right"]), { left: 1, right: 2 });
await first.remove(["settings", "missing"]);
assert.deepEqual(await second.get("settings"), {});
assert.equal(changes.at(-1).settings.oldValue.connections[0].id, "a");
assert(!Object.hasOwn(changes.at(-1).settings, "newValue"));
await first.remove(["left", "right", "protectedConfiguration"]);
assert.deepEqual(await first.get(null), {});
console.log(
  "Private extension settings: persistence, isolation of returned values, atomic writes and change events passed.",
);
