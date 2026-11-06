import assert from "node:assert/strict";
import { NativeTranslationSession } from "../native-translation.js";

const savedAPI = globalThis.Translator;
const savedSecure = Object.getOwnPropertyDescriptor(
  globalThis,
  "isSecureContext",
);
const savedError = console.error;
const diagnostics = [];
console.error = (...args) => diagnostics.push(args);
Object.defineProperty(globalThis, "isSecureContext", {
  value: true,
  configurable: true,
});
const request = (text, targetLanguage = "zh-Hans") => ({
  type: "native-translate",
  id: text,
  texts: [text],
  sourceLanguage: "en",
  targetLanguage,
});
const signal = new AbortController().signal;
const tick = () => new Promise(setImmediate);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
try {
  // Both creation and translation are shared/serialized across overlapping jobs.
  let created = 0,
    destroyed = 0,
    creationSignal;
  const creating = deferred(),
    translating = deferred(),
    calls = [];
  globalThis.Translator = {
    availability: async () => "available",
    create: async ({ signal }) => {
      created++;
      creationSignal = signal;
      await creating.promise;
      return {
        translate: async (text) => {
          calls.push(text);
          if (text === "first") await translating.promise;
          return `translated:${text}`;
        },
        destroy() {
          destroyed++;
        },
      };
    },
  };
  const session = new NativeTranslationSession(),
    firstJob = new AbortController();
  const first = session.translate(request("first"), firstJob.signal);
  const second = session.translate(request("second"), signal);
  const cancelledJob = new AbortController();
  const skipped = session.translate(request("skip"), cancelledJob.signal);
  const skipCheck = assert.rejects(skipped, (e) => e.code === "cancelled");
  cancelledJob.abort();
  await tick();
  assert.equal(created, 1);
  creating.resolve();
  await tick();
  assert.deepEqual(calls, ["first"]);
  translating.resolve();
  assert.deepEqual(await first, ["translated:first"]);
  firstJob.abort(); // processRequest aborts a completed port's controller.
  assert.deepEqual(await second, ["translated:second"]);
  await skipCheck;
  assert.equal(creationSignal.aborted, false);
  assert.equal(destroyed, 0);
  assert.deepEqual(await session.translate(request("later"), signal), [
    "translated:later",
  ]);
  assert.equal(created, 1);
  assert.deepEqual(calls, ["first", "second", "later"]);
  session.destroy();
  session.destroy();
  assert.equal(destroyed, 1);
  assert(creationSignal.aborted);
  await assert.rejects(
    session.translate(request("closed"), signal),
    (e) => e.code === "cancelled",
  );
  assert.equal(created, 1);

  // A failed session stays failed, including already queued batches. Explicit
  // retry owns a fresh session, and cannot use the damaged instance.
  created = destroyed = 0;
  let fail = true;
  globalThis.Translator.create = async () => {
    created++;
    return {
      translate: async (text) => {
        if (fail) throw new DOMException("Service failed", "UnknownError");
        return text;
      },
      destroy() {
        destroyed++;
      },
    };
  };
  const failedSession = new NativeTranslationSession();
  const failures = await Promise.allSettled([
    failedSession.translate(request("fails"), signal),
    failedSession.translate(request("queued"), signal),
  ]);
  assert.equal(failures[0].status, "rejected");
  assert.equal(failures[1].status, "rejected");
  assert.equal(failures[0].reason, failures[1].reason);
  assert.equal(failures[0].reason.code, "translationFailed");
  assert.equal(diagnostics.length, 1);
  assert.equal(destroyed, 1);
  fail = false;
  await assert.rejects(
    failedSession.translate(request("still paused"), signal),
  );
  assert.equal(created, 1);
  const retry = new NativeTranslationSession();
  await retry.translate(request("retry"), signal);
  assert.equal(created, 2);
  // Changing language replaces the previous pair before preparing the next.
  await retry.translate(request("new language", "ja"), signal);
  assert.equal(created, 3);
  assert.equal(destroyed, 2);
  retry.destroy();
  assert.equal(destroyed, 3);

  // Cancellation of an active batch uses translate's signal, not the session's
  // creation signal. Other batches can continue with the same translator.
  created = destroyed = 0;
  globalThis.Translator.create = async () => {
    created++;
    return {
      translate: async (text, { signal }) => {
        if (text !== "cancel active") return text;
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
      destroy() {
        destroyed++;
      },
    };
  };
  const surviving = new NativeTranslationSession(),
    active = new AbortController();
  const activeCheck = assert.rejects(
    surviving.translate(request("cancel active"), active.signal),
    (e) => e.code === "cancelled",
  );
  await tick();
  active.abort();
  await activeCheck;
  assert.deepEqual(await surviving.translate(request("continue"), signal), [
    "continue",
  ]);
  assert.equal(created, 1);
  assert.equal(destroyed, 0);
  surviving.destroy();
  assert.equal(destroyed, 1);

  // Even a browser that resolves create() after stop must release that late
  // resource; queued batches must never create another one.
  created = destroyed = 0;
  const late = deferred();
  globalThis.Translator.create = async ({ signal }) => {
    created++;
    creationSignal = signal;
    await late.promise;
    return {
      translate() {
        assert.fail("Stopped sessions must not submit text");
      },
      destroy() {
        destroyed++;
      },
    };
  };
  const stopped = new NativeTranslationSession();
  const stoppedResults = Promise.allSettled([
    stopped.translate(request("creating"), signal),
    stopped.translate(request("queued after creation"), signal),
  ]);
  await tick();
  stopped.destroy();
  assert(creationSignal.aborted);
  late.resolve();
  for (const result of await stoppedResults) {
    assert.equal(result.status, "rejected");
    assert.equal(result.reason.code, "cancelled");
  }
  assert.equal(created, 1);
  assert.equal(destroyed, 1);
  assert.equal(diagnostics.length, 1, "Cancellation does not add failure logs");

  created = 0;
  globalThis.Translator.create = async () => {
    created++;
    throw new DOMException("Cannot initialize", "NotSupportedError");
  };
  const unavailable = new NativeTranslationSession();
  const unavailableResults = await Promise.allSettled([
    unavailable.translate(request("first creation failure"), signal),
    unavailable.translate(request("second creation failure"), signal),
  ]);
  assert.equal(created, 1);
  assert.equal(unavailableResults[0].reason, unavailableResults[1].reason);
  assert.equal(
    unavailableResults[0].reason.message,
    "NotSupportedError: Cannot initialize",
  );
} finally {
  console.error = savedError;
  if (savedAPI === undefined) delete globalThis.Translator;
  else globalThis.Translator = savedAPI;
  if (savedSecure)
    Object.defineProperty(globalThis, "isSecureContext", savedSecure);
  else delete globalThis.isSecureContext;
}
console.log(
  "Native session: cross-batch reuse, serialized creation/translation, failure isolation, retry, language changes, batch cancellation and late-resource cleanup passed",
);
