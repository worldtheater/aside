import assert from "node:assert/strict";
import { createProcessor } from "../processor.js";
import {
  actionAvailable,
  translationEngine,
  validateTranslationEngine,
  authorizeTranslation,
} from "../translation-engine.js";
import { microsoftTranslate } from "../microsoft-translation.js";
import {
  nativeTranslate,
  detectNativeLanguage,
} from "../native-translation.js";
import { nativeTranslationPort } from "../native-translation-port.js";
import { configuration } from "../sync-records.js";
import { translationScope, validateTranslationScope } from "../translation.js";

const action = {
  id: "translate",
  kind: "translate",
  name: "Translate",
  instruction: "",
  mode: "paragraph",
  model: "default",
  sourceLanguage: "auto",
  targetLanguage: "ja",
  translationEngine: "microsoft",
};
const settings = {
  actions: [action],
  connections: [],
  defaultConnection: null,
};
assert.equal(translationEngine({ kind: "translate" }), "ai");
assert.equal(translationScope({ kind: "translate" }), "body");
assert.equal(
  translationScope({ kind: "translate", translationScope: "all" }),
  "all",
);
for (const translationScope of ["body", "all"])
  validateTranslationScope({ kind: "translate", translationScope });
for (const invalid of [
  { kind: "translate", translationScope: "invalid" },
  { kind: "summary", translationScope: "all" },
])
  assert.throws(
    () => validateTranslationScope(invalid),
    (e) => e.code === "invalidAction",
  );
assert.equal(actionAvailable(action, settings), true);
assert.equal(
  actionAvailable({ ...action, translationEngine: "ai" }, settings),
  false,
);
assert.throws(
  () => validateTranslationEngine({ ...action, targetLanguage: "instruction" }),
  (e) => e.code === "invalidAction",
);
assert.throws(
  () => validateTranslationEngine({ ...action, kind: "qa" }),
  (e) => e.code === "invalidAction",
);
assert.throws(
  () => validateTranslationEngine({ ...action, translationEngine: "bogus" }),
  (e) => e.code === "invalidAction",
);
const sync = configuration({ settings, credentials: {}, daily: {} });
assert.equal(sync.actions.translate.translationEngine, "microsoft");

class MemoryCache {
  generation = 0;
  data = new Map();
  async getMany(keys) {
    return new Map(
      keys.filter((k) => this.data.has(k)).map((k) => [k, this.data.get(k)]),
    );
  }
  async touch() {}
  async putMany(entries, generation) {
    if (generation === this.generation)
      for (const entry of entries) this.data.set(entry.key, entry.text);
  }
}
const cache = new MemoryCache(),
  process = createProcessor(cache),
  requests = [];
const options = {
  action,
  blocks: [
    { id: "a", text: "Hello" },
    { id: "b", text: "Hello" },
  ],
  signal: new AbortController().signal,
  translation: {
    identity: JSON.stringify(["microsoft", "auto", "ja"]),
    translate: async (texts) => {
      requests.push(texts);
      return texts.map((text) => `translated:${text}`);
    },
  },
  invoke() {
    throw new Error("Direct translation must not call a language model");
  },
};
let result = await process(options);
assert.deepEqual(
  result.parts.map((p) => p.text),
  ["translated:Hello", "translated:Hello"],
);
assert.deepEqual(requests, [["Hello"]]);
result = await process(options);
assert.equal(result.stats.hits, 2);
for (const identity of [
  ["browser", "auto", "ja"],
  ["microsoft", "en", "ja"],
  ["microsoft", "auto", "fr"],
]) {
  result = await process({
    ...options,
    translation: { ...options.translation, identity: JSON.stringify(identity) },
  });
  assert.equal(result.stats.hits, 0);
}
assert.equal(requests.length, 4);
const longText = Array.from(
    { length: 450 },
    (_, i) => `Source sentence ${i}. `,
  ).join(""),
  segments = [];
result = await process({
  ...options,
  action: { ...action, mode: "whole" },
  blocks: [{ id: "long", text: longText }],
  translation: {
    identity: "long",
    translate: async (texts) => {
      segments.push(...texts);
      return texts;
    },
  },
});
assert.equal(segments.join(""), longText);
assert.ok(segments.every((t) => t.length <= 4000));
assert.equal(result.parts[0].source, longText);
await assert.rejects(
  process({
    ...options,
    refresh: true,
    translation: { identity: "bad", translate: async () => [] },
  }),
  (e) => e.code === "translationFailed",
);
const controller = new AbortController();
let started;
const ready = new Promise((resolve) => {
  started = resolve;
});
const cancelled = process({
  ...options,
  signal: controller.signal,
  translation: {
    identity: "cancel",
    translate: (_texts, signal) =>
      new Promise((_resolve, reject) => {
        started();
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  },
});
await ready;
controller.abort();
await assert.rejects(cancelled, (e) => e.code === "cancelled");

let allowed = false,
  fetched = [];
globalThis.chrome = {
  permissions: { contains: async () => allowed, request: async () => allowed },
};
globalThis.fetch = async (url, init) => {
  fetched.push({ url: new URL(url), init });
  return Response.json([{ translations: [{ text: "Olá" }] }]);
};
const signal = new AbortController().signal;
await assert.rejects(
  authorizeTranslation(action),
  (e) => e.code === "translationPermission",
);
await assert.rejects(
  microsoftTranslate(["Hello"], "auto", "pt-BR", signal),
  (e) => e.code === "translationPermission",
);
assert.equal(fetched.length, 0);
allowed = true;
assert.deepEqual(await microsoftTranslate(["Hello"], "auto", "pt-BR", signal), [
  "Olá",
]);
assert.equal(fetched[0].url.searchParams.get("to"), "pt");
assert.equal(fetched[0].url.searchParams.has("from"), false);
assert.equal(fetched[0].init.body, '["Hello"]');
assert.equal(fetched[0].init.credentials, "omit");
assert.equal(fetched[0].init.headers.Authorization, undefined);
globalThis.fetch = async () =>
  new Response("private service error", { status: 429 });
await assert.rejects(
  microsoftTranslate(["Hello"], "en", "ja", signal),
  (e) => e.code === "rateLimited" && !e.message.includes("private"),
);
globalThis.fetch = async () => Response.json([{ translations: [] }]);
await assert.rejects(
  microsoftTranslate(["Hello"], "en", "ja", signal),
  (e) => e.code === "translationFailed",
);
globalThis.fetch = async () => {
  throw new Error("sensitive network data");
};
await assert.rejects(
  microsoftTranslate(["Hello"], "en", "ja", signal),
  (e) => e.code === "translationFailed" && !e.message.includes("sensitive"),
);

const nativeRequest = {
  type: "native-translate",
  id: "test",
  texts: ["Hello", "World"],
  sourceLanguage: "auto",
  targetLanguage: "zh-Hans",
};
Object.defineProperty(globalThis, "isSecureContext", {
  value: true,
  configurable: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: { userActivation: { isActive: true } },
  configurable: true,
});
// Native APIs can emit start/end progress even for already available resources.
function emitInitializationProgress(monitor) {
  const events = new EventTarget();
  monitor?.(events);
  for (const loaded of [0, 1])
    events.dispatchEvent(
      Object.assign(new Event("downloadprogress"), { loaded }),
    );
}
let created = 0,
  destroyed = 0,
  detected = 0;
globalThis.Translator = {
  availability: async ({ sourceLanguage, targetLanguage }) => {
    assert.equal(sourceLanguage, "en");
    assert.equal(targetLanguage, "zh");
    return "available";
  },
  create: async ({ monitor }) => {
    emitInitializationProgress(monitor);
    created++;
    return {
      translate: async (text) => `本地:${text}`,
      destroy() {
        destroyed++;
      },
    };
  },
};
globalThis.LanguageDetector = {
  availability: async () => "available",
  create: async ({ monitor }) => {
    emitInitializationProgress(monitor);
    return {
      detect: async (text) => {
        assert.equal(
          text,
          "Hello\n\nWorld",
          "Detect from all input text, not each short fragment",
        );
        detected++;
        return [{ detectedLanguage: "en", confidence: 1 }];
      },
      destroy() {
        destroyed++;
      },
    };
  },
};
assert.deepEqual(await nativeTranslate(nativeRequest, signal), [
  "本地:Hello",
  "本地:World",
]);
assert.equal(created, 1);
assert.equal(detected, 1);
assert.equal(destroyed, 2);
assert.deepEqual(
  await nativeTranslate(
    { ...nativeRequest, sourceLanguage: "zh-Hans" },
    signal,
  ),
  nativeRequest.texts,
);
const availableEvents = [];
navigator.userActivation.isActive = false;
for (let batch = 0; batch < 2; batch++)
  assert.deepEqual(
    await nativeTranslate(nativeRequest, signal, (event) =>
      availableEvents.push(event),
    ),
    ["本地:Hello", "本地:World"],
  );
assert.equal(
  availableEvents.filter((event) => event.state === "ready").length,
  4,
);
assert(
  !availableEvents.some(
    (event) => event.state === "downloading" || event.progress !== undefined,
  ),
  "Repeated use of ready translators and detectors must not report a download",
);
// Explicit languages bypass detection; cancellation releases a pending detector
// and must not create a translator after detection eventually settles.
const nativeDetector = globalThis.LanguageDetector;
let finishDetection,
  detectorDestroyed = 0;
globalThis.LanguageDetector = {
  availability: async () => "available",
  create: async () => ({
    detect: () =>
      new Promise((resolve) => {
        finishDetection = resolve;
      }),
    destroy: () => detectorDestroyed++,
  }),
};
assert.deepEqual(
  await nativeTranslate({ ...nativeRequest, sourceLanguage: "en" }, signal),
  ["本地:Hello", "本地:World"],
);
assert.equal(finishDetection, undefined);
const detecting = new AbortController();
const translatorCount = created;
const pendingDetection = nativeTranslate(nativeRequest, detecting.signal);
await new Promise(setImmediate);
detecting.abort();
assert.equal(detectorDestroyed, 1);
finishDetection([{ detectedLanguage: "en", confidence: 1 }]);
await assert.rejects(pendingDetection, (e) => e.code === "cancelled");
assert.equal(created, translatorCount);
assert.equal(detectorDestroyed, 1);
globalThis.LanguageDetector.create = async () => ({
  detect: async () => [{ detectedLanguage: "und", confidence: 0 }],
  destroy() {},
});
await assert.rejects(
  detectNativeLanguage("???", signal),
  (e) => e.code === "translationDetection" && e.message === e.code,
);
globalThis.LanguageDetector.create = async () => ({
  detect: async () => {
    throw new DOMException("Detection failed", "UnknownError");
  },
  destroy() {},
});
await assert.rejects(
  detectNativeLanguage("Hello", signal),
  (e) =>
    e.code === "translationDetection" &&
    e.message === "UnknownError: Detection failed",
);
globalThis.LanguageDetector = nativeDetector;
const createTranslator = globalThis.Translator.create;
for (const failure of [
  new DOMException("Other generic failures occurred.", "UnknownError"),
  new Error("Native service failure"),
  "Native service failure",
]) {
  let released = false;
  globalThis.Translator.create = async () => ({
    translate: async () => {
      throw failure;
    },
    destroy() {
      released = true;
    },
  });
  await assert.rejects(
    nativeTranslate({ ...nativeRequest, sourceLanguage: "en" }, signal),
    (e) => e.code === "translationFailed" && e.message === String(failure),
  );
  assert(released, "A failed translator must still be released for retry");
}
globalThis.Translator.create = createTranslator;
// A masked availability result is not proof of a download or a required click.
// Trust successful creation even without a transient user activation.
for (const availability of ["downloadable", "downloading"]) {
  globalThis.Translator.availability = async () => availability;
  const progress = [];
  assert.deepEqual(
    await nativeTranslate(
      { ...nativeRequest, sourceLanguage: "en" },
      signal,
      (event) => progress.push(event),
      () => assert.fail("Ready resources must not ask for an extra click"),
    ),
    ["本地:Hello", "本地:World"],
  );
  assert(
    !progress.some((event) =>
      ["activation", "downloading"].includes(event.state),
    ),
  );
}
globalThis.Translator.availability = async () => "unavailable";
await assert.rejects(
  nativeTranslate(nativeRequest, signal),
  (e) => e.code === "translationLanguageUnavailable",
);
globalThis.Translator.availability = async () => "downloadable";
navigator.userActivation.isActive = false;
globalThis.Translator.create = async () => {
  throw new DOMException("User activation is required", "NotAllowedError");
};
await assert.rejects(
  nativeTranslate(nativeRequest, signal),
  (e) => e.code === "translationDownload",
);
const aborted = new AbortController();
aborted.abort();
await assert.rejects(
  nativeTranslate(nativeRequest, aborted.signal),
  (e) => e.code === "cancelled",
);
delete globalThis.Translator;
await assert.rejects(
  nativeTranslate(nativeRequest, signal),
  (e) => e.code === "translationUnavailable",
);

// Download progress must distinguish completed transfer from ready resources.
const { prepareNativePack } = await import("../native-translation.js");
const { isNativePackProgress, nativePackStatus } =
  await import("../native-packs.js");
const pair = { kind: "translator", sourceLanguage: "en", targetLanguage: "zh" };
const events = [];
let finishCreate, monitor;
navigator.userActivation.isActive = true;
globalThis.Translator = {
  availability: async () => "downloadable",
  create: (options) => {
    if (!navigator.userActivation.isActive)
      throw new DOMException("User activation is required", "NotAllowedError");
    monitor = new EventTarget();
    options.monitor(monitor);
    return new Promise((resolve) => {
      finishCreate = resolve;
    });
  },
};
const preparation = prepareNativePack(pair, signal, (event) =>
  events.push(event),
);
await new Promise(setImmediate);
for (const loaded of [0, 0.4, 1])
  monitor.dispatchEvent(
    Object.assign(new Event("downloadprogress"), { loaded }),
  );
assert.deepEqual(
  events.map((event) => event.state),
  ["checking", "preparing", "preparing", "downloading", "preparing"],
);
assert.equal(events.at(-1).progress, 1);
assert.equal(
  events.some((event) => event.state === "ready"),
  false,
);
let released = 0;
finishCreate({ destroy: () => released++ });
await preparation;
assert.equal(events.at(-1).state, "ready");
assert.equal(released, 1);
assert.equal(
  nativePackStatus(
    { pack: pair, state: "downloading", progress: 0.57 },
    { downloading: "Downloading" },
  ),
  "Downloading 57%",
);
assert(isNativePackProgress(events[0]));
assert(
  !isNativePackProgress({
    pack: pair,
    state: "downloading",
    progress: Infinity,
  }),
);
assert(
  !isNativePackProgress({
    pack: {
      kind: "translator",
      sourceLanguage: "<script>",
      targetLanguage: "en",
    },
    state: "ready",
  }),
);

navigator.userActivation.isActive = false;
const blockedEvents = [];
await assert.rejects(
  prepareNativePack(pair, signal, (event) => blockedEvents.push(event)),
  (e) => e.code === "translationDownload",
);
assert.equal(blockedEvents.at(-1).state, "activation");
navigator.userActivation.isActive = true;
const cancellation = new AbortController(),
  cancelledEvents = [];
const cancelledPreparation = prepareNativePack(
  pair,
  cancellation.signal,
  (event) => cancelledEvents.push(event),
);
await new Promise(setImmediate);
cancellation.abort();
monitor.dispatchEvent(
  Object.assign(new Event("downloadprogress"), { loaded: 0.9 }),
);
finishCreate({ destroy: () => released++ });
await assert.rejects(cancelledPreparation, (e) => e.code === "cancelled");
assert(!cancelledEvents.some((event) => event.state === "ready"));
assert.equal(
  released,
  2,
  "Late resources must also be released on cancellation",
);

navigator.userActivation.isActive = false;
globalThis.Translator.create = async () => {
  throw new DOMException("policy", "NotAllowedError");
};
await assert.rejects(
  prepareNativePack(pair, signal),
  (e) =>
    e.code === "translationFailed" && e.message === "NotAllowedError: policy",
);
let attempts = 0,
  activations = 0;
globalThis.Translator.create = async () => {
  attempts++;
  throw new DOMException("User activation is required", "NotAllowedError");
};
await assert.rejects(
  nativeTranslate(
    { ...nativeRequest, sourceLanguage: "en" },
    signal,
    () => {},
    async () => {
      activations++;
    },
  ),
  (e) => e.code === "translationFailed",
);
assert.equal(
  attempts,
  2,
  "A failed explicit activation does not start a retry loop",
);
assert.equal(activations, 1);
delete globalThis.Translator;

const listeners = new Set(),
  sent = [];
const port = {
  onMessage: {
    addListener: (f) => listeners.add(f),
    removeListener: (f) => listeners.delete(f),
  },
  postMessage: (message) => sent.push(message),
};
const translate = nativeTranslationPort(port),
  pending = translate(["Hello"], "en", "ja", signal);
for (const f of [...listeners])
  f({ type: "native-result", id: "unrelated", texts: ["wrong"] });
assert.equal(listeners.size, 1);
for (const f of [...listeners])
  f({ type: "native-result", id: sent[0].id, texts: ["こんにちは"] });
assert.deepEqual(await pending, ["こんにちは"]);
assert.equal(listeners.size, 0);
for (const [error, detail] of [
  ["translationFailed", "UnknownError: Other generic failures occurred."],
  ["translationDetection", "UnknownError: Detection failed"],
  ["translationFailed", { invalid: "detail" }],
]) {
  const failed = translate(["Hello"], "en", "ja", signal);
  for (const f of [...listeners])
    f({ type: "native-result", id: sent.at(-1).id, error, detail });
  await assert.rejects(
    failed,
    (e) =>
      e.code === error &&
      e.message === (typeof detail === "string" ? detail : error),
  );
  assert.equal(listeners.size, 0);
}
const abortPort = new AbortController(),
  waiting = translate(["Hello"], "en", "ja", abortPort.signal);
abortPort.abort();
await assert.rejects(waiting, (e) => e.code === "cancelled");
assert.equal(listeners.size, 0);
// Diagnostics preserve the exact failed input and distinguish preparation from
// text submission. They stay in the calling document's console.
const consoleError = console.error;
const diagnostics = [];
console.error = (...args) => diagnostics.push(args);
try {
  const diagnosticRequest = {
    ...nativeRequest,
    sourceLanguage: "en",
    texts: [
      "First text",
      'NUL\u0000 / zero width\u200b / NBSP\u00a0 / 😀\n"quoted"',
      "Last text",
    ],
  };
  const submitted = [];
  globalThis.Translator = {
    availability: async () => "available",
    create: async () => ({
      translate: async (text) => {
        submitted.push(text);
        if (submitted.length === 2)
          throw new DOMException(
            "Other generic failures occurred.",
            "UnknownError",
          );
        return text;
      },
      destroy() {},
    }),
  };
  await assert.rejects(nativeTranslate(diagnosticRequest, signal));
  assert.deepEqual(submitted, diagnosticRequest.texts.slice(0, 2));
  assert.deepEqual(diagnostics.pop(), [
    "[Aside] Native translation failed",
    {
      requestId: nativeRequest.id,
      stage: "translate",
      sourceLanguage: "en",
      targetLanguage: "zh",
      failedTextIndex: 1,
      texts: diagnosticRequest.texts,
      error: "UnknownError: Other generic failures occurred.",
    },
  ]);
  submitted.length = 0;
  globalThis.Translator.create = async () => {
    throw new DOMException(
      "Unable to create translator for the given source and target language.",
      "NotSupportedError",
    );
  };
  await assert.rejects(nativeTranslate(diagnosticRequest, signal));
  const preparationFailure = diagnostics.pop()[1];
  assert.equal(preparationFailure.stage, "prepare-translator");
  assert.equal(preparationFailure.failedTextIndex, null);
  assert.deepEqual(preparationFailure.texts, diagnosticRequest.texts);
  assert.deepEqual(submitted, []);

  globalThis.LanguageDetector.create = async () => ({
    detect: async () => {
      throw new Error("Detection failed");
    },
    destroy() {},
  });
  await assert.rejects(
    nativeTranslate({ ...diagnosticRequest, sourceLanguage: "auto" }, signal),
  );
  assert.equal(diagnostics.length, 1, "Detection errors are logged only once");
  assert.deepEqual(diagnostics.pop(), [
    "[Aside] Native language detection failed",
    {
      stage: "detect-language",
      text: diagnosticRequest.texts.join("\n\n"),
      error: "Error: Detection failed",
    },
  ]);

  const stopping = new AbortController();
  globalThis.Translator.create = async () => ({
    translate: async () => {
      stopping.abort();
      throw new DOMException("Aborted", "AbortError");
    },
    destroy() {},
  });
  await assert.rejects(
    nativeTranslate(diagnosticRequest, stopping.signal),
    (e) => e.code === "cancelled",
  );
  globalThis.Translator.create = async () => ({
    translate: async (text) => text,
    destroy() {},
  });
  await nativeTranslate(diagnosticRequest, signal);
  assert.deepEqual(diagnostics, [], "Success and cancellation do not log text");
} finally {
  console.error = consoleError;
  delete globalThis.Translator;
}
console.log(
  "Translation engines: routing, cache isolation, deduplication, splitting, cancellation, permissions, native capabilities and port cleanup passed",
);
await import("./native-translation-session.mjs");
