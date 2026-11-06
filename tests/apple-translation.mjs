import assert from "node:assert/strict";
// Exercise the Safari adapter, background ownership and native wire contract.
// This doubles the OS bridge; safari-native.swift separately uses the real API.
const event = () => {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    fire: (...args) => Promise.all([...listeners].map((fn) => fn(...args))),
  };
};
const tick = () => new Promise(setImmediate);
const calls = [],
  sessions = new Set(),
  nativePorts = new Set();
let availability = "available",
  fail = false,
  prepareError,
  delayed;
const sender = {
  id: "aside-test",
  url: "https://example.test/article",
  tab: { id: 1 },
};
globalThis.chrome = {
  runtime: {
    id: sender.id,
    getURL: (p) => "safari-web-extension://fixture/" + p,
    onConnect: event(),
    connect({ name }) {
      let closed = false;
      const client = { name, onMessage: event(), onDisconnect: event() };
      const background = {
        name,
        sender,
        onMessage: event(),
        onDisconnect: event(),
      };
      client.postMessage = (m) => {
        if (closed) throw Error("closed");
        void background.onMessage.fire(m);
      };
      background.postMessage = (m) => {
        if (!closed) void client.onMessage.fire(m);
      };
      client.disconnect = background.disconnect = () => {
        if (closed) return;
        closed = true;
        void client.onDisconnect.fire();
        void background.onDisconnect.fire();
      };
      void this.onConnect.fire(background);
      return client;
    },
    connectNative() {
      const port = {
        onMessage: event(),
        onDisconnect: event(),
        disconnect() {
          nativePorts.delete(port);
          void port.onDisconnect.fire();
        },
      };
      nativePorts.add(port);
      return port;
    },
    async sendNativeMessage(_, message) {
      calls.push(message);
      switch (message.command) {
        case "availability":
          return { value: availability };
        case "detect":
          return { value: "en" };
        case "create":
          sessions.add(message.sessionId);
          return { value: true };
        case "destroy":
          sessions.delete(message.sessionId);
          return {};
        case "cancel":
          return {};
        case "prepare":
          if (!delayed)
            queueMicrotask(() => {
              for (const port of nativePorts)
                void port.onMessage.fire({
                  name: "translation-prepared",
                  userInfo: {
                    requestId: message.id,
                    value: true,
                    error: prepareError,
                  },
                });
            });
          return { value: true };
        case "translate":
          assert(
            sessions.has(message.sessionId),
            "translation must own a native session",
          );
          if (fail)
            return { error: "translationFailed", detail: "Apple test failure" };
          return { value: message.texts.map((t) => "译:" + t) };
      }
      throw Error("unexpected native command");
    },
  },
};
const { registerAppleTranslation } =
  await import("../apple-translation-background.js");
registerAppleTranslation();
const {
  NativeTranslationSession,
  detectNativeLanguage,
  nativePackAvailability,
} = await import("../native-translation.js");
const { isAppleCommand } = await import("../apple-translation-protocol.js");
const request = (text, targetLanguage = "zh-Hans") => ({
  type: "native-translate",
  id: text,
  texts: [text],
  sourceLanguage: "en",
  targetLanguage,
});
const signal = new AbortController().signal;
assert.equal(await detectNativeLanguage("hello world", signal), "en");
assert.equal(await nativePackAvailability({ kind: "detector" }), "available");
const session = new NativeTranslationSession();
assert.deepEqual(
  await Promise.all([
    session.translate(request("one"), signal),
    session.translate(request("two"), signal),
  ]),
  [["译:one"], ["译:two"]],
);
assert.equal(calls.filter((c) => c.command === "create").length, 1);
assert.equal(sessions.size, 1);
await session.translate(request("language changed", "ja"), signal);
assert.equal(calls.filter((c) => c.command === "create").length, 2);
assert.equal(sessions.size, 1, "changing language releases old session");
session.destroy();
await tick();
assert.equal(sessions.size, 0);

availability = "downloadable";
const preparing = new NativeTranslationSession();
assert.deepEqual(
  await preparing.translate(request("after preparation"), signal),
  ["译:after preparation"],
);
assert.equal(nativePorts.size, 0, "preparation event listener is released");
preparing.destroy();
prepareError = "cancelled";
const cancelled = new NativeTranslationSession();
await assert.rejects(
  cancelled.translate(request("cancelled"), signal),
  (e) => e.code === "cancelled",
);
cancelled.destroy();
prepareError = undefined;

delayed = true;
const waiting = new NativeTranslationSession();
const pending = waiting.translate(request("waiting"), signal);
await tick();
waiting.destroy();
await assert.rejects(pending, (e) => e.code === "cancelled");
await tick();
assert.equal(nativePorts.size, 0);
delayed = false;

availability = "available";
fail = true;
const failed = new NativeTranslationSession();
const savedError = console.error;
console.error = () => {};
try {
  await assert.rejects(
    failed.translate(request("failure"), signal),
    (e) => e.code === "translationFailed" && e.message === "Apple test failure",
  );
  const count = calls.length;
  await assert.rejects(
    failed.translate(request("latched"), signal),
    (e) => e.code === "translationFailed",
  );
  assert.equal(
    calls.length,
    count,
    "failed session must not create or translate again",
  );
} finally {
  console.error = savedError;
}
fail = false;
const retry = new NativeTranslationSession();
assert.deepEqual(await retry.translate(request("retry"), signal), ["译:retry"]);
retry.destroy();
await tick();
assert.equal(sessions.size, 0);

assert(!isAppleCommand({ id: "id", command: "read-file", path: "/tmp" }));
assert(!isAppleCommand({ id: "id", command: "translate", texts: [1] }));
assert(
  !isAppleCommand({
    id: "id",
    command: "create",
    sourceLanguage: "en&url=bad",
    targetLanguage: "zh",
  }),
);
let disconnected = false;
await chrome.runtime.onConnect.fire({
  name: "apple-translation",
  sender: { id: "other", url: sender.url, tab: sender.tab },
  disconnect() {
    disconnected = true;
  },
});
assert(disconnected, "external extension must not access native translation");
console.log(
  "PASS: Apple bridge batching, page ownership, language changes, preparation completion/cancel, failure/retry and sender boundary.",
);
