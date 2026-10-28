import assert from "node:assert/strict";
import { createSecretRedactor } from "../redaction.js";
import { callModel, listModels } from "../providers.js";
import { callDecision } from "../decision.js";
import { createProcessor, resultKey } from "../processor.js";

const key = "sk-fixture-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const other = "other-fixture-9876543210";
const secrets = [key, other];
const redact = createSecretRedactor(secrets);
const clean = (value) => {
  for (const secret of secrets) assert(!JSON.stringify(value).includes(secret));
};
assert.equal(
  redact.text(`before ${key} and ${other} after`),
  "before [redacted] and [redacted] after",
);
assert.equal(
  createSecretRedactor(["", "abc", "abcde"]).text("abcde abc"),
  "[redacted] [redacted]",
);
const escapedKey = 'key-"quote\\slash';
assert.equal(
  createSecretRedactor([escapedKey]).text(JSON.stringify({ key: escapedKey })),
  '{"key":"[redacted]"}',
);
const encoded = JSON.stringify({ [key]: other }).replaceAll("-", "\\u002d");
assert.equal(redact.content(encoded), '{"[redacted]":"[redacted]"}');
const ordinaryJson = '{\n  "text": "normal"\n}';
assert.equal(redact.content(ordinaryJson), ordinaryJson);
// Every possible split, consecutive keys, and ordinary prefix-like text.
const text = `before ${key}${other} after sk-fixture`;
for (let split = 0; split <= text.length; split++) {
  let output = "";
  const stream = redact.stream((part) => {
    output += part;
    clean(output);
  });
  stream.push(text.slice(0, split));
  stream.push(text.slice(split));
  stream.finish();
  assert.equal(output, redact.text(text));
}
let incremental = "";
const held = redact.stream((part) => (incremental += part));
held.push("before " + key.slice(0, 15));
assert.equal(
  incremental,
  "before ",
  "Potential key prefixes must not be emitted",
);
held.push(key.slice(15) + " after");
held.finish();
assert.equal(incremental, "before [redacted] after");
let overlapping = "";
const overlap = createSecretRedactor(["abc", "abcde"]).stream(
  (s) => (overlapping += s),
);
overlap.push("abc");
assert.equal(overlapping, "");
overlap.push("de!");
overlap.finish();
assert.equal(overlapping, "[redacted]!");

const connection = {
  id: "redaction",
  url: "https://example.test/v1",
  protocol: "chat",
  model: "fixture",
  maxTokens: 2048,
};
const signal = new AbortController().signal;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const frame = (value) => "data: " + JSON.stringify(value) + "\n\n";
const sse = (frames) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(frames);
        for (let i = 0; i < bytes.length; i += 7)
          controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
const delta = (protocol, text) =>
  protocol === "chat"
    ? { choices: [{ delta: { content: text } }] }
    : protocol === "responses"
      ? { type: "response.output_text.delta", delta: text }
      : protocol === "anthropic"
        ? { type: "content_block_delta", delta: { type: "text_delta", text } }
        : { event_type: "step.delta", delta: { type: "text", text } };
const done = (protocol) =>
  protocol === "chat"
    ? "data: [DONE]\n\n"
    : frame(
        protocol === "responses"
          ? { type: "response.completed" }
          : protocol === "anthropic"
            ? { type: "message_stop" }
            : { event_type: "interaction.completed" },
      );
const originalFetch = globalThis.fetch;
try {
  const calls = [
    () => listModels(connection, key, [other]),
    () =>
      callModel(
        connection,
        key,
        "instructions",
        "input",
        signal,
        undefined,
        undefined,
        [other],
      ),
    () =>
      callDecision(
        { ...connection, protocol: "typesafe" },
        key,
        { state: {}, questions: {} },
        signal,
        () => {},
        undefined,
        [other],
      ),
  ];
  // Credentials crossing the old 240-character limit must be removed before truncation.
  for (const secret of secrets) {
    for (const prefix of ["Rejected ", "X".repeat(230)]) {
      globalThis.fetch = async () =>
        json({ error: { message: prefix + secret } }, 401);
      for (const run of calls)
        await assert.rejects(run, (error) => {
          assert.equal(error.code, "authError");
          assert(!error.message.includes(secret.slice(0, 10)));
          assert(!error.stack.includes(secret.slice(0, 10)));
          return true;
        });
    }
  }
  for (const protocol of ["chat", "responses", "anthropic", "gemini"]) {
    const c = { ...connection, protocol };
    let delivered = "";
    const emit = (text) => {
      delivered += text;
      clean(delivered);
    };
    const output = `Before ${key} and ${other} after sk-`;
    globalThis.fetch = async (_url, options) => {
      assert.equal(
        options.headers.Authorization ||
          options.headers["x-api-key"] ||
          options.headers["x-goog-api-key"],
        protocol === "chat" || protocol === "responses" ? `Bearer ${key}` : key,
      );
      clean(JSON.parse(options.body));
      return sse(
        [...output].map((s) => frame(delta(protocol, s))).join("") +
          done(protocol),
      );
    };
    const result = await callModel(
      c,
      key,
      "instructions",
      "input",
      signal,
      emit,
      undefined,
      [other],
    );
    assert.equal(result, redact.text(output));
    assert.equal(delivered, result, "Stream and final result must agree");
    for (const ending of [
      "",
      frame({ type: "error", error: { message: "X".repeat(230) + key } }),
    ]) {
      delivered = "";
      globalThis.fetch = async () =>
        sse(frame(delta(protocol, "safe " + key.slice(0, 20))) + ending);
      await assert.rejects(
        () => callModel(c, key, "I", "X", signal, emit, undefined, [other]),
        (error) => {
          assert(!error.message.includes(key.slice(0, 10)));
          return true;
        },
      );
      assert.equal(
        delivered,
        "safe ",
        "A failed stream must discard a pending credential prefix",
      );
    }
    delivered = "";
    globalThis.fetch = async () =>
      json(
        protocol === "chat"
          ? { choices: [{ message: { content: output } }] }
          : protocol === "responses"
            ? {
                status: "completed",
                output: [{ content: [{ type: "output_text", text: output }] }],
              }
            : protocol === "anthropic"
              ? { content: [{ type: "text", text: output }] }
              : { output_text: output },
      );
    assert.equal(
      await callModel(c, key, "I", "X", signal, emit, undefined, [other]),
      redact.text(output),
    );
    assert.equal(delivered, redact.text(output));
  }
  // HTTP 200 error bodies follow the same redact-before-truncate rule.
  globalThis.fetch = async () =>
    json({ error: { message: "X".repeat(230) + key } });
  await assert.rejects(calls[1], (e) => !e.message.includes(key.slice(0, 10)));

  const cache = {
    generation: 0,
    data: new Map(),
    async getMany(keys) {
      return new Map(
        keys.filter((k) => this.data.has(k)).map((k) => [k, this.data.get(k)]),
      );
    },
    async putMany(entries) {
      for (const e of entries) this.data.set(e.key, e.text);
    },
    async touch() {},
  };
  const process = createProcessor(cache);
  const action = { kind: "custom", instruction: "Explain", mode: "whole" };
  const input = "Source " + other;
  const options = {
    action,
    blocks: [{ id: "one", text: input }],
    connection,
    key,
    secrets: [other],
    signal,
  };
  globalThis.fetch = async () =>
    json({
      choices: [{ message: { content: "Output " + key + " " + other } }],
    });
  let streamed = "";
  const result = await process({
    ...options,
    onProgress: clean,
    onDelta: (_id, s) => {
      streamed += s;
      clean(streamed);
    },
  });
  clean(result);
  assert.equal(result.parts[0].source, "Source [redacted]");
  for (const value of cache.data.values()) clean(value);
  assert.equal(streamed, result.parts[0].text);
  // A cache hit created before this fix must not send credentials back to the page.
  cache.data.set(await resultKey(connection, action, input), "Old " + other);
  const cached = await process({ ...options, onProgress: clean });
  assert.equal(cached.stats.hits, 1);
  assert.equal(cached.parts[0].text, "Old [redacted]");
  cache.data.clear();
  // Decode batch text before final redaction, including JSON unicode escapes.
  globalThis.fetch = async () =>
    json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [
                { id: "0", text: key },
                { id: "1", text: other },
              ],
            }).replaceAll("-", "\\u002d"),
          },
        },
      ],
    });
  const batch = await process({
    ...options,
    refresh: true,
    action: { ...action, mode: "paragraph" },
    blocks: [
      { id: "a", text: "First" },
      { id: "b", text: "Second" },
    ],
  });
  assert.deepEqual(
    batch.parts.map((p) => p.text),
    ["[redacted]", "[redacted]"],
  );
  for (const value of cache.data.values()) clean(value);
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  "PASS: known-key redaction before truncation, all streaming splits/protocols, interrupted prefixes, normal suffixes, auth preservation, final results and cached/batch outputs.",
);
