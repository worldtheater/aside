import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import http from "node:http";
import "fake-indexeddb/auto";

// Exercise the built Safari background with WebExtension API doubles. This is
// not a Safari end-to-end test: native installation/permissions need a real Mac.
const base = new URL("../dist/safari/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", base)));
assert.equal(manifest.background.type, "module");
assert.deepEqual(manifest.background.scripts, ["background.js"]);
assert.equal(manifest.background.persistent, false);
for (const field of [
  "key",
  "update_url",
  "minimum_chrome_version",
  "browser_specific_settings",
])
  assert.equal(manifest[field], undefined);
assert(!manifest.permissions.includes("favicon"));
assert(manifest.permissions.includes("nativeMessaging"));
assert.deepEqual(manifest.optional_host_permissions, [
  "https://*/*",
  "http://*/*",
]);
assert.equal(manifest.commands["text-translate"].suggested_key.mac, "Alt+T");

function event() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    fire: (...args) =>
      Promise.all([...listeners].map((listener) => listener(...args))),
    listeners,
  };
}
const origin = "safari-web-extension://aside-fixture/";
const id = "safari-fixture";
const forbidden = () => {
  throw new Error("Safari must not access native local/sync settings");
};
const noStorage = {
  get: forbidden,
  set: forbidden,
  remove: forbidden,
  setAccessLevel: forbidden,
};
const session = {};
const checkedOrigins = [];
globalThis.location = { href: origin + "_generated_background_page.html" };
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US", userAgent: "Version/26.0 Safari/625.1" },
  configurable: true,
});
// Node's real channel is not needed to exercise local settings notifications.
globalThis.BroadcastChannel = class {
  postMessage() {}
  close() {}
};
globalThis.chrome = {
  runtime: {
    id,
    getURL: (path) => origin + path.replace(/^\//, ""),
    onMessage: event(),
    onConnect: event(),
    onInstalled: event(),
    getPlatformInfo: async () => ({ os: "mac" }),
    sendMessage: async () => {},
  },
  storage: {
    local: noStorage,
    sync: noStorage,
    session: {
      get: async (key) => ({ [key]: structuredClone(session[key]) }),
      set: async (values) => Object.assign(session, structuredClone(values)),
    },
    onChanged: event(),
  },
  tabs: {
    query: async () => [],
    sendMessage: async () => {},
    onActivated: event(),
    onRemoved: event(),
    onDetached: event(),
    onAttached: event(),
    onReplaced: event(),
  },
  scripting: { getRegisteredContentScripts: async () => [] },
  permissions: {
    contains: async ({ origins }) => {
      for (const pattern of origins) {
        assert.equal(
          new URL(pattern).port,
          "",
          "Safari rejects ports in host permission patterns",
        );
        checkedOrigins.push(pattern);
      }
      return true;
    },
  },
  contextMenus: {
    onClicked: event(),
    create: (_, cb) => cb(),
    removeAll: (cb) => cb(),
  },
  commands: { onCommand: event() },
};
await import(new URL("background.js", base));
await chrome.runtime.onInstalled.fire({ reason: "install" });
const handler = [...chrome.runtime.onMessage.listeners][0];
const sender = { id, url: origin + "index.html" };
const send = (message, from = sender) =>
  new Promise((resolve) => handler(message, from, resolve));
for (const type of [
  "sync.status",
  "sync.connect",
  "sync.run",
  "sync.clear",
  "sync.stop",
]) {
  const result = await send({ type });
  assert.equal(result.ok, false, type);
  assert.equal(result.error, "notAllowed", type);
}
const fixtureKey = "safari-test-only-key";
let authorization;
const server = http.createServer((req, res) => {
  authorization = req.headers.authorization;
  if (req.method === "POST") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: "Translated fixture" } }],
        }) +
        "\n\ndata: " +
        JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }) +
        "\n\ndata: [DONE]\n\n",
    );
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const connection = {
    name: "Safari fixture",
    protocol: "chat",
    url: `http://127.0.0.1:${server.address().port}/v1`,
    model: "fixture-model",
    models: [{ id: "fixture-model", name: "fixture-model" }],
    maxTokens: 1024,
  };
  const saved = await send({
    type: "connection.save",
    connection,
    key: fixtureKey,
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  connection.id = saved.value.id;
  const initialSettings = await send({ type: "snapshot" });
  const updated = await send({
    type: "actions.save",
    changes: [
      {
        ...initialSettings.value.actions.find(
          (action) => action.id === "translate",
        ),
        translationEngine: "ai",
      },
    ],
  });
  assert.equal(updated.ok, true, JSON.stringify(updated));
  const tested = await send({ type: "connection.test", connection });
  assert.equal(tested.ok, true, JSON.stringify(tested));
  assert.equal(tested.value[0].id, "fixture-model");
  assert.equal(authorization, `Bearer ${fixtureKey}`);
  assert(checkedOrigins.includes("http://127.0.0.1/*"));
  const frames = [];
  const port = {
    name: "process",
    sender,
    onDisconnect: event(),
    onMessage: event(),
    postMessage: (message) => frames.push(message),
  };
  await chrome.runtime.onConnect.fire(port);
  await port.onMessage.fire({
    actionId: "translate",
    source: "text",
    blocks: [{ id: "source", text: "Test translation" }],
    translation: { sourceLanguage: "auto", targetLanguage: "zh-Hans" },
    stream: true,
  });
  assert(
    !frames.some((frame) => frame.type === "error"),
    JSON.stringify(frames),
  );
  assert(
    frames.some(
      (frame) => frame.type === "delta" && frame.text === "Translated fixture",
    ),
  );
  assert.equal(
    frames.find((frame) => frame.type === "done").result.parts[0].text,
    "Translated fixture",
  );
  const { localStore, storageChanges } = await import(
    new URL("extension-storage.js", base)
  );
  const persisted = await localStore.get(null);
  assert(persisted.protectedConfiguration.ciphertext);
  assert(
    !JSON.stringify(persisted).includes(fixtureKey),
    "Persisted settings must not contain plaintext API keys",
  );
  const snapshot = await send({ type: "snapshot" });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.value.defaultConnection, connection.id);
  assert(!JSON.stringify(snapshot).includes(fixtureKey));
  const untrusted = { id, url: "https://example.com/", tab: { id: 1 } };
  assert.equal(
    (await send({ type: "snapshot" }, untrusted)).error,
    "notAllowed",
  );
  const publicSettings = await send({ type: "settings.public" }, untrusted);
  assert.equal(publicSettings.ok, true);
  assert(!JSON.stringify(publicSettings).includes(fixtureKey));
  let changes = 0;
  const onChange = () => changes++;
  storageChanges.addListener(onChange);
  await chrome.storage.onChanged.fire({ settings: { newValue: {} } }, "local");
  assert.equal(
    changes,
    0,
    "Native local writes cannot impersonate trusted Safari configuration",
  );
  await localStore.set({ testFlag: true });
  assert.equal(changes, 1);
  storageChanges.removeListener(onChange);
  await localStore.remove("testFlag");
  assert.equal(
    (await send({ type: "connection.remove", id: connection.id })).ok,
    true,
  );
  await localStore.set({
    "native-language-packs": ["fixture"],
    retiredSetting: true,
  });
  assert.equal(
    (await send({ type: "settings.reset" }, untrusted)).error,
    "notAllowed",
  );
  assert.equal((await send({ type: "settings.reset" })).ok, true);
  const resetSnapshot = await send({ type: "snapshot" });
  assert.deepEqual(resetSnapshot.value.connections, []);
  assert.deepEqual(resetSnapshot.value.collection, []);
  assert.equal(
    resetSnapshot.value.actions.find((action) => action.kind === "translate")
      .translationEngine,
    "microsoft",
  );
  const resetValues = await localStore.get(null);
  assert.equal(resetValues.protectedConfiguration, undefined);
  assert.equal(resetValues["native-language-packs"], undefined);
  assert.equal(resetValues.retiredSetting, undefined);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
// A page content script must not open the private extension settings database.
execFileSync(process.execPath, [
  "--input-type=module",
  "-e",
  `
  import assert from 'node:assert/strict';
  globalThis.location = {href: 'https://example.com/'};
  globalThis.chrome = {runtime: {getURL: () => ${JSON.stringify(origin)}}};
  await assert.rejects(import(${JSON.stringify(new URL("extension-storage.js", base).href)}), /only available to extension pages/);
`,
]);
console.log(
  "PASS: Safari background starts without sync, HTTP connection testing, streamed translation, encrypted local persistence, full local reset, and content-script boundaries.",
);
