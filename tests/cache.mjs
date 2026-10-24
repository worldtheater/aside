import assert from "node:assert/strict";
import {
  createProcessor,
  resultKey,
  splitSource,
  UNIT_CHARS,
  DEFAULT_PROCESSING,
} from "../processor.js";
import { ModelError } from "../providers.js";
class MemoryCache {
  generation = 0;
  data = new Map();
  async getMany(keys) {
    return new Map(
      keys
        .filter((key) => this.data.has(key))
        .map((key) => [key, this.data.get(key)]),
    );
  }
  async touch() {}
  async putMany(entries, generation) {
    if (generation === this.generation)
      for (const entry of entries) this.data.set(entry.key, entry.text);
  }
  clear() {
    this.generation++;
    this.data.clear();
  }
}
const connection = {
  id: "test",
  url: "https://example.com/v1",
  protocol: "responses",
  model: "fixture",
  maxTokens: 4000,
  processing: { concurrency: 2, batchChars: 8000, batchCount: 4 },
};
const action = {
  mode: "paragraph",
  kind: "translate",
  sourceLanguage: "auto",
  targetLanguage: "ja",
  instruction: "Translate accurately",
};
const blocks = Array.from({ length: 10 }, (_, i) => ({
  id: String(i),
  text: "paragraph " + i,
  priority: i === 7 ? 0 : i + 1,
}));
const payload = (extra = {}) => ({
  action,
  connection,
  key: "secret",
  blocks,
  signal: new AbortController().signal,
  ...extra,
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check) => {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await pause(2);
  }
  throw Error("Timed out waiting for test condition");
};
const inputItems = (input) => {
  try {
    return JSON.parse(input).items;
  } catch {
    return null;
  }
};
const response = (input, version = "v1") => {
  const items = inputItems(input);
  return items
    ? JSON.stringify({
        items: items.map((item) => ({
          id: item.id,
          text: version + ": " + item.text,
        })),
      })
    : version + ": " + input;
};
const cache = new MemoryCache(),
  process = createProcessor(cache),
  calls = [];
let running = 0,
  peak = 0;
const invoke = async (c, k, i, input, signal) => {
  calls.push(input);
  running++;
  peak = Math.max(peak, running);
  await pause(input.includes("paragraph 7") ? 5 : 20);
  running--;
  if (signal.aborted) throw new ModelError("cancelled");
  return response(input);
};
const one = await process(payload({ invoke }));
assert.equal(peak, 2);
assert(
  inputItems(calls[0]).some((item) => item.text === "paragraph 7"),
  "Visible content is dispatched first",
);
assert.deepEqual(
  one.parts.map((part) => part.id),
  blocks.map((part) => part.id),
  "Output retains source order despite completion order",
);
const n = calls.length;
const two = await createProcessor(cache)(
  payload({
    invoke,
    blocks: [...blocks].reverse().map((b, i) => ({ ...b, id: "new-" + i })),
    connection: {
      ...connection,
      processing: { concurrency: 1, batchChars: 16000, batchCount: 20 },
    },
  }),
);
assert.equal(calls.length, n);
assert.equal(two.stats.hits, 10);
assert.equal(two.stats.requests, 0);
const changed = await process(
  payload({
    invoke,
    blocks: blocks.map((b, i) =>
      i === 5 ? { ...b, text: "changed paragraph" } : b,
    ),
  }),
);
assert.equal(calls.length, n + 1);
assert.equal(changed.stats.hits, 9);
assert.deepEqual(
  inputItems(calls.at(-1)).map((i) => i.text),
  ["changed paragraph"],
);
for (const override of [
  { instruction: "Different instructions" },
  { targetLanguage: "en" },
  { mode: "whole" },
])
  assert.notEqual(
    await resultKey(connection, action, "same"),
    await resultKey(connection, { ...action, ...override }, "same"),
  );
// Action-specific output contracts participate in cache identity even with a saved prompt.
const savedPrompt = {
  mode: "paragraph",
  instruction: "Preserve meaning and tone.",
};
assert.notEqual(
  await resultKey(connection, { ...savedPrompt, kind: "plain" }, "诸如此类"),
  await resultKey(connection, { ...savedPrompt, kind: "custom" }, "诸如此类"),
);
for (const override of [
  { model: "other" },
  { url: "https://another.example/v1" },
  { protocol: "anthropic" },
  { maxTokens: 2000 },
])
  assert.notEqual(
    await resultKey(connection, action, "same"),
    await resultKey({ ...connection, ...override }, action, "same"),
  );
assert.equal(
  await resultKey(connection, action, "same"),
  await resultKey(
    {
      ...connection,
      name: "renamed",
      processing: DEFAULT_PROCESSING,
      openaiCache: "auto",
    },
    action,
    "same",
  ),
);
const duplicate = await process(
  payload({
    invoke,
    blocks: [
      { id: "a", text: "duplicate" },
      { id: "b", text: "duplicate" },
    ],
  }),
);
assert.equal(duplicate.stats.shared, 1);
assert.equal(inputItems(calls.at(-1)).length, 1);
assert.equal(duplicate.parts.length, 2);
const whole = await process(
  payload({
    invoke,
    action: { ...action, mode: "whole" },
    blocks: blocks.slice(0, 2),
  }),
);
assert.equal(whole.parts.length, 1);
assert.equal(
  whole.parts[0].source,
  blocks
    .slice(0, 2)
    .map((b) => b.text)
    .join("\n\n"),
);
const text = "One sentence. ".repeat(900) + "🌿".repeat(3000),
  pieces = splitSource(text);
assert.equal(pieces.join(""), text);
assert(
  pieces.every((p) => p.length <= UNIT_CHARS && !/[\uD800-\uDBFF]$/.test(p)),
);
const large = await process(
  payload({ invoke, blocks: [{ id: "long", text }] }),
);
assert.equal(large.parts.length, 1);
assert(
  calls
    .slice(-large.stats.requests)
    .every(
      (input) =>
        inputItems(input).reduce((n, i) => n + i.text.length, 0) <=
        connection.processing.batchChars,
    ),
);
const beforeLong = calls.length;
await process(
  payload({
    invoke,
    blocks: [{ id: "new-long", text }],
    connection: {
      ...connection,
      processing: {
        ...connection.processing,
        batchChars: 16000,
        batchCount: 20,
      },
    },
  }),
);
assert.equal(calls.length, beforeLong);
// Explicit refresh replaces only successful results; errors and partial output leave the prior value intact.
const target = [{ id: "a", text: "duplicate" }];
const refreshed = await process(
  payload({
    blocks: target,
    refresh: true,
    invoke: async (c, k, i, input) => response(input, "v2"),
  }),
);
assert.equal(refreshed.parts[0].text, "v2: duplicate");
await assert.rejects(() =>
  process(
    payload({
      blocks: target,
      refresh: true,
      invoke: async () => {
        throw new ModelError("serviceError");
      },
    }),
  ),
);
assert.equal(
  (await process(payload({ blocks: target, invoke }))).parts[0].text,
  "v2: duplicate",
);
for (const invalid of ["null", '{"items":[null]}', '{"items":[]}']) {
  await assert.rejects(
    () =>
      process(
        payload({
          blocks: [{ id: "bad", text: "not-cacheable " + invalid }],
          invoke: async () => invalid,
        }),
      ),
    (e) => e.code === "invalidOutput",
  );
}
// A shared in-flight request survives cancellation of its first subscriber.
const sharedCache = new MemoryCache(),
  shared = createProcessor(sharedCache),
  a = new AbortController(),
  b = new AbortController();
let release,
  sharedSignal,
  sharedCalls = 0;
const delayed = async (c, k, i, input, signal) => {
  sharedCalls++;
  sharedSignal = signal;
  await new Promise((r) => (release = r));
  if (signal.aborted) throw new ModelError("cancelled");
  return response(input);
};
const first = shared(
  payload({ blocks: target, signal: a.signal, invoke: delayed }),
);
await until(() => release);
const second = shared(
  payload({ blocks: target, signal: b.signal, invoke: delayed }),
);
await pause(10);
a.abort();
await assert.rejects(first, (e) => e.code === "cancelled");
assert(!sharedSignal.aborted);
release();
assert.equal((await second).stats.shared, 1);
assert.equal(sharedCalls, 1);
// With no subscribers, queued work and the upstream fetch are both cancelled.
let requestCount = 0,
  activeSignal;
const abortAll = new AbortController();
const all = shared(
  payload({
    blocks: [
      { id: "x", text: "cancel1" },
      { id: "y", text: "cancel2" },
      { id: "z", text: "cancel3" },
    ],
    connection: {
      ...connection,
      processing: { ...connection.processing, concurrency: 1, batchCount: 1 },
    },
    signal: abortAll.signal,
    invoke: async (c, k, i, input, signal) => {
      requestCount++;
      activeSignal = signal;
      await new Promise((resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new ModelError("cancelled")),
          { once: true },
        ),
      );
      return response(input);
    },
  }),
);
await until(() => activeSignal);
abortAll.abort();
await assert.rejects(all, (e) => e.code === "cancelled");
await pause(10);
assert(activeSignal.aborted);
assert.equal(requestCount, 1);
// An older request cannot overwrite a newer forced refresh, even if it finishes last.
let oldRelease;
const old = shared(
  payload({
    blocks: [{ id: "race", text: "race" }],
    invoke: async (c, k, i, input) => {
      await new Promise((r) => (oldRelease = r));
      return response(input, "old");
    },
  }),
);
await until(() => oldRelease);
const fresh = await shared(
  payload({
    blocks: [{ id: "race", text: "race" }],
    refresh: true,
    invoke: async (c, k, i, input) => response(input, "fresh"),
  }),
);
oldRelease();
await old;
assert.equal(
  (await shared(payload({ blocks: [{ id: "race", text: "race" }], invoke })))
    .parts[0].text,
  fresh.parts[0].text,
);
// Clear invalidates pending writes, without cancelling a valid result being delivered to its caller.
let clearRelease;
const pending = shared(
  payload({
    blocks: [{ id: "clear", text: "clear pending" }],
    invoke: async (c, k, i, input) => {
      await new Promise((r) => (clearRelease = r));
      return response(input);
    },
  }),
);
await until(() => clearRelease);
sharedCache.clear();
clearRelease();
await pending;
assert.equal(sharedCache.data.size, 0);
// Streaming output is ordered even when later paragraphs finish first; cached streams use the same contract.
const streamed = [],
  streamCache = new MemoryCache(),
  streamProcess = createProcessor(streamCache);
const streamOptions = payload({
  blocks: [
    { id: "a", text: "slow" },
    { id: "b", text: "fast" },
  ],
  onDelta: (id, text) => streamed.push([id, text]),
  invoke: async (c, k, i, input, signal, onDelta) => {
    if (input === "slow") await pause(20);
    onDelta(input);
    return input;
  },
});
await streamProcess(streamOptions);
assert.deepEqual(streamed, [
  ["a", "slow"],
  ["b", "fast"],
]);
streamed.length = 0;
await streamProcess({
  ...streamOptions,
  invoke: () => {
    throw Error("Unexpected provider call");
  },
});
assert.deepEqual(streamed, [
  ["a", "slow"],
  ["b", "fast"],
]);
const writeFailure = new MemoryCache();
writeFailure.putMany = async () => {
  throw Error("Quota exceeded");
};
const saved = await createProcessor(writeFailure)(
  payload({ blocks: target, invoke }),
);
assert(saved.stats.writeFailed);
assert(saved.parts[0].text);
console.log(
  "PASS: durable-cache contract, semantic identity, modified-only misses, batching-independent segments, visible-first bounded concurrency, duplicate requests, streaming order, cancellation ownership, forced refresh races and cache-clear barriers.",
);
// Distinct requests from different callers still share one connection's concurrency cap.
const globalProcess = createProcessor(new MemoryCache());
let activeCount = 0,
  maxActive = 0;
const concurrentInvoke = async (c, k, i, input) => {
  activeCount++;
  maxActive = Math.max(maxActive, activeCount);
  await pause(10);
  activeCount--;
  return response(input);
};
await Promise.all(
  ["tab-a", "tab-b", "tab-c"].map((tab) =>
    globalProcess(
      payload({
        blocks: Array.from({ length: 5 }, (_, i) => ({
          id: String(i),
          text: tab + i,
        })),
        invoke: concurrentInvoke,
        connection: {
          ...connection,
          processing: { ...connection.processing, batchCount: 1 },
        },
      }),
    ),
  ),
);
assert.equal(maxActive, 2);
// Cancellation while IndexedDB is resolving must never enqueue a provider request afterward.
const reading = new MemoryCache();
let finishRead;
reading.getMany = () => new Promise((r) => (finishRead = r));
const cancelled = new AbortController();
let unexpected = 0;
const readingJob = createProcessor(reading)(
  payload({
    signal: cancelled.signal,
    invoke: async () => {
      unexpected++;
      return "wrong";
    },
  }),
);
await until(() => finishRead);
cancelled.abort();
finishRead(new Map());
await assert.rejects(readingJob, (e) => e.code === "cancelled");
assert.equal(unexpected, 0);
console.log(
  "PASS: connection-wide concurrency across distinct jobs and cancellation during cache lookup.",
);
// Completed batches remain reusable if the caller stops before the rest of the page finishes.
const resumeCache = new MemoryCache(),
  resume = createProcessor(resumeCache),
  stop = new AbortController();
let partialCalls = 0;
const resumePayload = payload({
  connection: {
    ...connection,
    processing: { ...connection.processing, concurrency: 1, batchCount: 2 },
  },
  invoke: async (c, k, i, input) => {
    partialCalls++;
    return response(input);
  },
});
await assert.rejects(
  () =>
    resume({
      ...resumePayload,
      signal: stop.signal,
      onProgress: (parts) => {
        if (parts.length >= 2) stop.abort();
      },
    }),
  (e) => e.code === "cancelled",
);
const resumed = await resume(resumePayload);
assert(resumed.stats.hits >= 2);
assert.equal(resumed.parts.length, blocks.length);
console.log(
  "PASS: completed batches survive cancellation and are reused on resume.",
);

// Same-language requests must fail before looking up cache or invoking a provider.
const invalidCache = new MemoryCache();
invalidCache.getMany = async () => {
  throw Error("Unexpected cache read");
};
await assert.rejects(
  () =>
    createProcessor(invalidCache)(
      payload({
        action: { ...action, sourceLanguage: "en", targetLanguage: "en" },
        invoke: async () => {
          throw Error("Unexpected model call");
        },
      }),
    ),
  (error) => error.code === "sameLanguages",
);
const { hasSameLanguages } = await import("../translation.js");
assert(
  !hasSameLanguages({
    ...action,
    sourceLanguage: "auto",
    targetLanguage: "en",
  }),
);
assert(
  !hasSameLanguages({
    ...action,
    sourceLanguage: "zh-Hans",
    targetLanguage: "zh-Hant",
  }),
);
assert(
  !hasSameLanguages({
    ...action,
    kind: "custom",
    sourceLanguage: "en",
    targetLanguage: "en",
  }),
);
console.log(
  "PASS: same-language translation is blocked before cache/provider access; detection, script conversion and other actions remain available.",
);

// Short labels remain independent across UI contexts, including shared requests.
const uiContext = {
  pageTitle: "Documentation",
  sectionTitle: "TypeSafe primitives",
  tableHeaders: "Question type Goal Returns",
};
const storeContext = {
  ...uiContext,
  sectionTitle: "Store policies",
  tableHeaders: "Product Returns",
};
assert.notEqual(
  await resultKey(connection, action, "Returns"),
  await resultKey(connection, action, "Returns", uiContext),
);
assert.notEqual(
  await resultKey(connection, action, "Returns", uiContext),
  await resultKey(connection, action, "Returns", storeContext),
);
assert.equal(
  await resultKey(connection, action, "Returns", uiContext),
  await resultKey(connection, action, "Returns", {
    tableHeaders: uiContext.tableHeaders,
    sectionTitle: uiContext.sectionTitle,
    pageTitle: uiContext.pageTitle,
  }),
);
const contextCalls = [],
  contextProcess = createProcessor(new MemoryCache());
const contextInvoke = async (c, k, instructions, input, signal, onDelta) => {
  contextCalls.push({ instructions, input });
  const data = JSON.parse(input),
    label = (item) => item.context.sectionTitle;
  if (data.items)
    return JSON.stringify({
      items: data.items.map((item) => ({ id: item.id, text: label(item) })),
    });
  onDelta?.(label(data));
  return label(data);
};
const contextualBlocks = [
  { id: "api", text: "Returns", context: uiContext },
  { id: "store", text: "Returns", context: storeContext },
  { id: "api-copy", text: "Returns", context: uiContext },
];
const contextual = await contextProcess(
  payload({ blocks: contextualBlocks, invoke: contextInvoke }),
);
assert.deepEqual(
  contextual.parts.map((p) => p.text),
  ["TypeSafe primitives", "Store policies", "TypeSafe primitives"],
);
assert.equal(contextual.stats.shared, 1);
const contextCount = contextCalls.length;
const contextualAgain = await contextProcess(
  payload({ blocks: contextualBlocks.slice(0, 2), invoke: contextInvoke }),
);
assert.equal(contextualAgain.stats.hits, 2);
assert.equal(contextCalls.length, contextCount);
const directDeltas = [];
const streamedContext = await contextProcess(
  payload({
    blocks: [{ id: "stream", text: "Returns", context: uiContext }],
    refresh: true,
    onDelta: (id, text) => directDeltas.push(text),
    invoke: contextInvoke,
  }),
);
assert.deepEqual(JSON.parse(contextCalls.at(-1).input), {
  text: "Returns",
  context: uiContext,
});
assert.equal(streamedContext.parts[0].source, "Returns");
assert.equal(directDeltas.join(""), "TypeSafe primitives");
// Context is never passed to non-translation actions or ordinary paragraphs.
for (const options of [
  { action: { ...action, kind: "custom" } },
  {
    blocks: [
      {
        id: "paragraph",
        text: "This complete sentence needs no label context.",
        context: uiContext,
      },
    ],
  },
]) {
  await createProcessor(new MemoryCache())(
    payload({
      blocks: [contextualBlocks[0]],
      ...options,
      invoke: async (c, k, i, input) => {
        assert(inputItems(input).every((item) => !item.context));
        return response(input);
      },
    }),
  );
}
for (const context of [
  null,
  [],
  { pageTitle: "x".repeat(161) },
  { pageTitle: 42 },
  { nearbyText: "not an approved context field" },
]) {
  await assert.rejects(
    () =>
      contextProcess(
        payload({
          blocks: [{ id: "invalid", text: "Returns", context }],
          invoke: () => {
            throw Error("Invalid context reached provider");
          },
        }),
      ),
    (e) => e.code === "invalidInput",
  );
}
const concurrentContext = createProcessor(new MemoryCache()),
  contextReleases = [];
const contextJob = (context) =>
  concurrentContext(
    payload({
      blocks: [{ id: "label", text: "Returns", context }],
      invoke: async (c, k, i, input) => {
        await new Promise((r) => contextReleases.push(r));
        return contextInvoke(c, k, i, input);
      },
    }),
  );
const apiJob = contextJob(uiContext);
await until(() => contextReleases.length === 1);
const apiDuplicate = contextJob(uiContext),
  storeJob = contextJob(storeContext);
await until(() => contextReleases.length === 2);
contextReleases.forEach((release) => release());
const contextResults = await Promise.all([apiJob, apiDuplicate, storeJob]);
assert.deepEqual(
  contextResults.map((r) => r.parts[0].text),
  ["TypeSafe primitives", "TypeSafe primitives", "Store policies"],
);
assert.equal(contextResults[1].stats.shared, 1);
console.log(
  "PASS: bounded UI context, semantic context cache identity, direct streaming, context-separated deduplication and concurrent requests.",
);
