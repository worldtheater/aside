import assert from "node:assert/strict";
import {
  endpoint,
  requestBody,
  readResponse,
  ModelError,
  modelError,
  hasDefaultModel,
} from "../providers.js";
import {
  batches,
  parseBatch,
  processContent as performContent,
  actionInstructions,
} from "../processor.js";
const processContent = (options) =>
  performContent({
    ...options,
    connection: {
      id: "unit",
      url: "https://example.com/v1",
      protocol: "chat",
      model: "fixture",
      ...options.connection,
    },
    key: options.key || "",
  });
import {
  normalizeUsage,
  summarizeUsage,
  filterUsage,
  usageState,
  usageModelKey,
} from "../usage.js";
assert.equal(
  endpoint({ url: "https://api.example.com/v1/", protocol: "chat" }),
  "https://api.example.com/v1/chat/completions",
);
assert.equal(
  endpoint({
    url: "https://api.example.com/v1/responses",
    protocol: "responses",
  }),
  "https://api.example.com/v1/responses",
);
assert.equal(
  endpoint({ url: "http://127.0.0.1:8000/v1", protocol: "chat" }),
  "http://127.0.0.1:8000/v1/chat/completions",
);
for (const url of [
  "http://api.example.com",
  "https://name:secret@example.com",
  "file:///tmp/key",
  "https://api.example.com?key=secret",
])
  assert.throws(() => endpoint({ url, protocol: "chat" }));
assert.equal(
  (
    await requestBody(
      { url: "https://example.com", protocol: "responses", model: "test" },
      "I",
      "X",
    )
  ).input[0].content[0].text,
  "I",
);
assert.equal(
  (await requestBody({ protocol: "anthropic", model: "test" }, "I", "X"))
    .system[0].text,
  "I",
);
assert.equal(
  (await requestBody({ protocol: "chat", model: "test" }, "I", "X")).messages[1]
    .content,
  "X",
);
assert.equal(
  (await requestBody({ protocol: "chat", model: "test" }, "I", "X"))
    .stream_options.include_usage,
  true,
);
const stream = (frames) =>
  new Response(
    new ReadableStream({
      start(c) {
        const bytes = new TextEncoder().encode(frames);
        for (let i = 0; i < bytes.length; i += 3)
          c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
assert.equal(
  await readResponse(
    stream(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n',
    ),
    "chat",
  ),
  "你好",
);
assert.equal(
  await readResponse(
    stream(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"answer"}\n\ndata: {"type":"response.completed"}\n\n',
    ),
    "responses",
  ),
  "answer",
);
assert.equal(
  await readResponse(
    stream(
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"text"}}\n\ndata: {"type":"message_stop"}\n\n',
    ),
    "anthropic",
  ),
  "text",
);
await assert.rejects(
  () =>
    readResponse(
      stream('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
      "chat",
    ),
  (e) => e.code === "interrupted",
);
await assert.rejects(
  () =>
    readResponse(
      stream('data: {"choices":[{"finish_reason":"length"}]}\n\n'),
      "chat",
    ),
  (e) => e.code === "outputLimit",
);
await assert.rejects(
  () => readResponse(new Response("", { status: 401 }), "chat"),
  (e) => e.code === "authError",
);
const events = {
  chat: {
    delta: (text) => ({ choices: [{ delta: { content: text } }] }),
    reasoning: { choices: [{ delta: { reasoning_content: "hidden" } }] },
    end: "[DONE]",
  },
  responses: {
    delta: (delta) => ({ type: "response.output_text.delta", delta }),
    reasoning: { type: "response.reasoning_text.delta", delta: "hidden" },
    end: { type: "response.completed" },
  },
  anthropic: {
    delta: (text) => ({
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    }),
    reasoning: {
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "hidden" },
    },
    end: { type: "message_stop" },
  },
};
for (const [protocol, event] of Object.entries(events)) {
  let controller, firstDelta;
  const seen = [],
    first = new Promise((resolve) => (firstDelta = resolve));
  const response = new Response(
    new ReadableStream({
      start(c) {
        controller = c;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  const send = (value) =>
    controller.enqueue(
      new TextEncoder().encode(
        `data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`,
      ),
    );
  const pending = readResponse(response, protocol, (text) => {
    seen.push(text);
    firstDelta();
  });
  send(event.reasoning);
  send(event.delta("你好"));
  await first;
  assert.deepEqual(
    seen,
    ["你好"],
    "Text must arrive while the response is still open; reasoning stays private",
  );
  send(event.delta(" 🌿"));
  send(event.end);
  controller.close();
  assert.equal(await pending, "你好 🌿");
  assert.deepEqual(seen, ["你好", " 🌿"]);
}
const partial = [];
await assert.rejects(
  () =>
    readResponse(
      stream('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
      "chat",
      (text) => partial.push(text),
    ),
  (e) => e.code === "interrupted",
);
assert.deepEqual(
  partial,
  ["partial"],
  "An interrupted stream still delivers the text already received",
);
const frame = (value) =>
  "data: " +
  (typeof value === "string" ? value : JSON.stringify(value)) +
  "\n\n";
const usageFixtures = {
  chat: [
    { choices: [{ delta: { content: "OK" } }], usage: null },
    {
      choices: [],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 60 },
      },
    },
    "[DONE]",
  ],
  responses: [
    { type: "response.output_text.delta", delta: "OK" },
    {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 },
        },
      },
    },
  ],
  anthropic: [
    {
      type: "message_start",
      message: {
        usage: {
          input_tokens: 20,
          output_tokens: 1,
          cache_read_input_tokens: 60,
          cache_creation_input_tokens: 20,
        },
      },
    },
    { type: "content_block_delta", delta: { type: "text_delta", text: "OK" } },
    { type: "message_delta", delta: {}, usage: { output_tokens: 5 } },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 20 },
    },
    { type: "message_stop" },
  ],
};
for (const [protocol, frames] of Object.entries(usageFixtures)) {
  const reports = [];
  await readResponse(
    stream(frames.map(frame).join("")),
    protocol,
    undefined,
    (value) => reports.push(value),
  );
  const last = reports.at(-1);
  assert(last.final);
  assert.equal(last.tokens.inputTokens, 100);
  assert.equal(last.tokens.outputTokens, 20);
  assert.equal(last.tokens.totalTokens, 120);
  assert.equal(last.tokens.cachedTokens, 60);
  assert.equal(
    last.tokens.cacheWriteTokens,
    protocol === "anthropic" ? 20 : protocol === "responses" ? 10 : null,
  );
}
const noCache = normalizeUsage(
  { prompt_tokens: 10, completion_tokens: 5 },
  "chat",
);
assert.equal(noCache.cachedTokens, null);
assert.equal(noCache.totalTokens, 15);
assert.equal(
  normalizeUsage(
    { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 70 },
    "chat",
  ).cachedTokens,
  70,
);
assert.equal(
  normalizeUsage(
    {
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 0 },
      prompt_cache_hit_tokens: 70,
    },
    "chat",
  ).cachedTokens,
  0,
  "Explicit zero is not replaced by an alias",
);
assert.equal(
  normalizeUsage({ prompt_tokens: "100", completion_tokens: -1 }, "chat")
    .totalTokens,
  null,
);
let snapshot;
await assert.rejects(
  () =>
    readResponse(
      stream(
        [
          usageFixtures.chat[0],
          { choices: [{ finish_reason: "length" }] },
          usageFixtures.chat[1],
          "[DONE]",
        ]
          .map(frame)
          .join(""),
      ),
      "chat",
      undefined,
      (value) => (snapshot = value),
    ),
  (e) => e.code === "outputLimit",
);
assert.equal(
  snapshot.tokens.totalTokens,
  120,
  "Output limits still capture the final usage chunk",
);
await assert.rejects(
  () =>
    readResponse(
      stream(frame(usageFixtures.anthropic[0])),
      "anthropic",
      undefined,
      (value) => (snapshot = value),
    ),
  (e) => e.code === "interrupted",
);
assert.equal(snapshot.final, false);
assert.equal(snapshot.tokens.inputTokens, 100);
await readResponse(
  stream(
    [
      usageFixtures.anthropic[0],
      usageFixtures.anthropic[1],
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ]
      .map(frame)
      .join(""),
  ),
  "anthropic",
  undefined,
  (value) => (snapshot = value),
);
assert.equal(
  snapshot.final,
  false,
  "A stop event without final counters does not make initial usage complete",
);
const jsonUsage = {
  input_tokens: 10,
  output_tokens: 5,
  input_tokens_details: { cached_tokens: 0 },
};
assert.equal(
  await readResponse(
    new Response(
      JSON.stringify({
        output: [{ content: [{ type: "output_text", text: "OK" }] }],
        usage: jsonUsage,
      }),
      { headers: { "content-type": "application/json" } },
    ),
    "responses",
    undefined,
    (value) => (snapshot = value),
  ),
  "OK",
);
assert.equal(snapshot.tokens.totalTokens, 15);
const limitedJson = [];
await assert.rejects(
  () =>
    readResponse(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "Partial JSON output" },
              finish_reason: "length",
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
      "chat",
      (text) => limitedJson.push(text),
    ),
  (e) => e.code === "outputLimit",
);
assert.deepEqual(
  limitedJson,
  ["Partial JSON output"],
  "Non-streaming output limits retain received text, just like streams",
);

const now = new Date(2026, 9, 17, 12),
  records = [
    {
      startedAt: new Date(2026, 9, 17, 0).getTime(),
      connectionId: "a",
      model: "m",
      tokens: normalizeUsage(
        {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_cache_hit_tokens: 60,
        },
        "chat",
      ),
      usageFinal: true,
    },
    {
      startedAt: new Date(2026, 9, 16, 23).getTime(),
      connectionId: "b",
      model: "m",
      tokens: normalizeUsage(
        {
          input_tokens: 20,
          output_tokens: 1,
          cache_read_input_tokens: 60,
          cache_creation_input_tokens: 20,
        },
        "anthropic",
      ),
      usageFinal: false,
    },
    {
      startedAt: new Date(2026, 8, 1).getTime(),
      connectionId: "a",
      model: "m",
      tokens: null,
      usageFinal: false,
    },
  ];
assert.equal(usageState(records[1]), "partial");
assert.equal(usageState(records[2]), "missing");
assert.deepEqual(summarizeUsage(records), {
  calls: 3,
  reported: 1,
  partial: 1,
  missing: 1,
  inputTokens: 200,
  outputTokens: 21,
  cachedTokens: 120,
  cacheWriteTokens: 20,
  reasoningTokens: null,
  totalTokens: 221,
});
assert.equal(summarizeUsage([records[2]]).inputTokens, null);
assert.equal(
  filterUsage(records, { period: "today", model: "all" }, now).length,
  1,
);
assert.equal(
  filterUsage(records, { period: "7", model: "all" }, now).length,
  2,
);
assert.equal(
  filterUsage(records, { period: "all", model: usageModelKey(records[0]) }, now)
    .length,
  2,
);
const blocks = Array.from({ length: 20 }, (_, i) => ({
  id: String(i),
  text: "Sample " + i,
}));
assert.equal(batches(blocks).length, 3);
assert.throws(
  () =>
    parseBatch(
      '{"items":[{"id":"0","text":"x"},{"id":"0","text":"y"}]}',
      blocks.slice(0, 2),
    ),
  (e) => e.code === "invalidOutput",
);
assert.deepEqual(
  parseBatch(
    '{"items":[{"id":"1","text":"b"},{"id":"0","text":"a"}]}',
    blocks.slice(0, 2),
  ).map((x) => x.text),
  ["a", "b"],
);
assert(
  actionInstructions({
    kind: "translate",
    sourceLanguage: "ja",
    targetLanguage: "en",
    instruction: "Keep structure.",
  }).includes("ja into en"),
);
let calls = 0;
const signal = new AbortController().signal;
const result = await processContent({
  action: { mode: "paragraph", instruction: "Explain" },
  blocks,
  connection: {},
  key: "",
  signal,
  invoke: async (c, k, i, text) => {
    calls++;
    return JSON.stringify({
      items: JSON.parse(text).items.map((x) => ({
        id: x.id,
        text: "Result " + x.id,
      })),
    });
  },
});
assert.equal(result.parts.length, 20);
assert.equal(calls, 4);
const aborted = new AbortController();
aborted.abort();
await assert.rejects(
  () =>
    processContent({
      action: { mode: "paragraph", instruction: "x" },
      blocks,
      signal: aborted.signal,
    }),
  (e) => e.code === "cancelled",
);
for (const mode of ["paragraph", "whole"]) {
  const input = blocks.slice(0, 2),
    received = [],
    requested = [];
  const output = await processContent({
    action: { mode, instruction: "Explain" },
    blocks: input,
    signal,
    onDelta: (id, text) => received.push({ id, text }),
    invoke: async (c, k, instructions, text, s, onDelta) => {
      assert(
        !instructions.includes('"items"'),
        "Selected text streams directly, without a JSON envelope",
      );
      requested.push(text);
      onDelta("First");
      onDelta(" next");
      return "First next";
    },
  });
  assert.deepEqual(
    requested,
    mode === "whole"
      ? [input.map((b) => b.text).join("\n\n")]
      : input.map((b) => b.text),
  );
  assert.deepEqual(
    output.parts.map((p) => ({ id: p.id, source: p.source })),
    mode === "whole"
      ? [{ id: "whole", source: requested[0] }]
      : input.map((b) => ({ id: b.id, source: b.text })),
  );
  assert.deepEqual(
    output.parts.map((p) =>
      received
        .filter((delta) => delta.id === p.id)
        .map((delta) => delta.text)
        .join(""),
    ),
    output.parts.map((p) => p.text),
  );
  assert.deepEqual(
    [...new Set(received.map((delta) => delta.id))],
    output.parts.map((p) => p.id),
    "Concurrent streams preserve source order",
  );
}
const stopped = new AbortController();
let streamedCalls = 0;
await assert.rejects(
  () =>
    processContent({
      action: { mode: "paragraph", instruction: "Explain" },
      blocks: blocks.slice(0, 2),
      signal: stopped.signal,
      onDelta: () => stopped.abort(),
      invoke: async (c, k, i, text, s, onDelta) => {
        streamedCalls++;
        onDelta("partial");
        return "partial";
      },
    }),
  (e) => e.code === "cancelled",
);
assert.equal(
  streamedCalls,
  1,
  "Stopping a text stream must not request subsequent paragraphs",
);
console.log(
  "PASS: service URLs, 3 protocol payloads and text/usage streams, cached/cache-write accounting, cumulative and missing usage, summaries/date/model filters, fragmented Unicode SSE, terminal/error handling, batching and cancellation.",
);

// Current Responses / Messages / Interactions contracts and stable cache boundaries.
const base = {
  id: "connection-a",
  url: "https://api.example.com/v1",
  model: "configured-model",
  maxTokens: 2048,
};
const openai = { ...base, protocol: "responses", openaiCache: "explicit" };
const firstBody = await requestBody(openai, "Stable rules", "Page one");
const secondBody = await requestBody(openai, "Stable rules", "Page two");
assert.equal(firstBody.prompt_cache_key, secondBody.prompt_cache_key);
assert.match(firstBody.prompt_cache_key, /^[a-f0-9]{64}$/);
assert.deepEqual(firstBody.input[0], secondBody.input[0]);
assert.equal(firstBody.input[0].role, "developer");
assert.deepEqual(firstBody.input[0].content[0].prompt_cache_breakpoint, {
  mode: "explicit",
});
assert.deepEqual(firstBody.prompt_cache_options, { mode: "explicit" });
assert.equal(
  firstBody.input[1].content[0].prompt_cache_breakpoint,
  undefined,
  "Variable page text is outside the cache boundary",
);
assert.equal(firstBody.max_output_tokens, 2048);
assert.equal(firstBody.store, false);
for (const change of [{ id: "connection-b" }, { model: "other-model" }])
  assert.notEqual(
    firstBody.prompt_cache_key,
    (await requestBody({ ...openai, ...change }, "Stable rules", "Page one"))
      .prompt_cache_key,
  );
assert.notEqual(
  firstBody.prompt_cache_key,
  (await requestBody(openai, "Changed rules", "Page one")).prompt_cache_key,
);
const automatic = await requestBody(
  { ...openai, openaiCache: "auto" },
  "Rules",
  "Page",
);
assert.equal(automatic.prompt_cache_options, undefined);
assert.equal(automatic.input[0].content[0].prompt_cache_breakpoint, undefined);
for (const field of ["instructions", "messages", "max_tokens"])
  assert.equal(firstBody[field], undefined);
const claude = await requestBody(
  { ...base, protocol: "anthropic" },
  "Rules",
  "Page",
);
assert.deepEqual(claude.system, [
  { type: "text", text: "Rules", cache_control: { type: "ephemeral" } },
]);
assert.equal(
  claude.cache_control,
  undefined,
  "Only reusable system text is cached, not every changing user input",
);
assert.equal(claude.messages[0].content, "Page");
const gemini = await requestBody(
  { ...base, model: "models/gemini-test", protocol: "gemini" },
  "Rules",
  "Page",
);
assert.equal(
  endpoint({ ...base, protocol: "gemini" }),
  "https://api.example.com/v1/interactions",
);
assert.deepEqual(gemini, {
  model: "models/gemini-test",
  stream: true,
  store: false,
  system_instruction: "Rules",
  input: [{ type: "user_input", content: [{ type: "text", text: "Page" }] }],
  generation_config: { max_output_tokens: 2048 },
});
assert.equal(
  gemini.cachedContent,
  undefined,
  "Interactions uses implicit caching; no GenerateContent cache objects",
);
await assert.rejects(
  () =>
    requestBody(
      { ...base, protocol: "responses", maxTokens: -1 },
      "Rules",
      "Page",
    ),
  (e) => e.code === "invalidConnection",
);

const geminiUsage = {
  total_input_tokens: 100,
  total_output_tokens: 20,
  total_thought_tokens: 7,
  total_cached_tokens: 60,
  total_tokens: 127,
};
const geminiReports = [],
  geminiText = [];
assert.equal(
  await readResponse(
    stream(
      [
        {
          event_type: "step.delta",
          delta: {
            type: "thought_summary",
            content: { type: "text", text: "private" },
          },
        },
        {
          event_type: "step.delta",
          delta: { type: "text", text: "你好" },
          metadata: {
            total_usage: {
              ...geminiUsage,
              total_output_tokens: 1,
              total_tokens: 108,
            },
          },
        },
        { event_type: "step.delta", delta: { type: "text", text: " 🌿" } },
        {
          event_type: "interaction.completed",
          interaction: { status: "completed", usage: geminiUsage },
        },
      ]
        .map(frame)
        .join(""),
    ),
    "gemini",
    (text) => geminiText.push(text),
    (value) => geminiReports.push(value),
  ),
  "你好 🌿",
);
assert.deepEqual(geminiText, ["你好", " 🌿"]);
assert.equal(geminiReports[0].final, false);
assert.equal(geminiReports.at(-1).final, true);
assert.deepEqual(geminiReports.at(-1).tokens, {
  inputTokens: 100,
  outputTokens: 20,
  cachedTokens: 60,
  cacheWriteTokens: null,
  reasoningTokens: 7,
  totalTokens: 127,
});
assert.equal(
  normalizeUsage({ total_input_tokens: 100, total_output_tokens: 20 }, "gemini")
    .totalTokens,
  null,
  "Do not assume omitted thought usage is zero",
);
assert.equal(
  normalizeUsage(
    {
      total_input_tokens: 100,
      total_output_tokens: 20,
      total_thought_tokens: 7,
    },
    "gemini",
  ).totalTokens,
  127,
);
assert.equal(
  normalizeUsage(
    {
      input_tokens: 100,
      output_tokens: 20,
      output_tokens_details: { reasoning_tokens: 7 },
    },
    "responses",
  ).totalTokens,
  120,
  "OpenAI output already includes reasoning",
);
assert.equal(
  normalizeUsage(
    {
      total_input_tokens: 100,
      total_output_tokens: 20,
      total_thought_tokens: 7,
      total_tokens: 130,
    },
    "gemini",
  ).totalTokens,
  130,
  "Prefer provider totals, including unrepresented internal usage",
);
assert.equal(
  await readResponse(
    new Response(
      JSON.stringify({
        status: "completed",
        steps: [
          { type: "thought", content: [{ type: "text", text: "private" }] },
          {
            type: "model_output",
            content: [{ type: "text", text: "Buffered" }],
          },
        ],
        usage: geminiUsage,
      }),
      { headers: { "content-type": "application/json" } },
    ),
    "gemini",
  ),
  "Buffered",
);
for (const [protocol, end, code] of [
  [
    "responses",
    {
      type: "response.failed",
      response: { usage: { input_tokens: 5, output_tokens: 1 } },
    },
    "serviceError",
  ],
  [
    "responses",
    {
      type: "response.incomplete",
      response: { incomplete_details: { reason: "max_output_tokens" } },
    },
    "outputLimit",
  ],
  [
    "gemini",
    { event_type: "interaction.status_update", status: "incomplete" },
    "outputLimit",
  ],
  [
    "gemini",
    { event_type: "interaction.status_update", status: "failed" },
    "serviceError",
  ],
  [
    "gemini",
    { event_type: "error", error: { message: "Rejected" } },
    "serviceError",
  ],
  [
    "anthropic",
    {
      type: "message_delta",
      delta: { stop_reason: "max_tokens" },
      usage: { output_tokens: 50 },
    },
    "outputLimit",
  ],
])
  await assert.rejects(
    () => readResponse(stream(frame(end)), protocol),
    (e) => e.code === code,
  );
for (const protocol of ["responses", "anthropic", "gemini"])
  await assert.rejects(
    () => readResponse(stream("data: [DONE]\n\n"), protocol),
    (e) => e.code === "interrupted",
    "Only Chat Completions treats [DONE] as completion",
  );
await assert.rejects(
  () =>
    readResponse(
      stream(
        frame({
          event_type: "step.delta",
          delta: { type: "text", text: "partial" },
        }),
      ),
      "gemini",
    ),
  (e) => e.code === "interrupted",
);
// The semantic terminal event finishes a request even if a proxy leaves its HTTP body open.
let cancelled = false;
const openResponse = new Response(
  new ReadableStream({
    start(c) {
      c.enqueue(
        new TextEncoder().encode(
          frame({
            event_type: "step.delta",
            delta: { type: "text", text: "Done" },
          }) +
            frame({
              event_type: "interaction.completed",
              interaction: { status: "completed" },
            }),
        ),
      );
    },
    cancel() {
      cancelled = true;
    },
  }),
  { headers: { "content-type": "text/event-stream" } },
);
assert.equal(await readResponse(openResponse, "gemini"), "Done");
assert(cancelled);
for (const ending of ["\r\n", "\r", "\n"])
  assert.equal(
    await readResponse(
      stream(
        (
          frame({
            event_type: "step.delta",
            delta: { type: "text", text: "逐字 🌿" },
          }) + frame({ event_type: "interaction.completed" })
        ).replaceAll("\n", ending),
      ),
      "gemini",
    ),
    "逐字 🌿",
  );
console.log(
  "PASS: latest three provider formats, explicit/implicit prefix caching, stable keys, Gemini text/thought separation and usage, protocol-specific completion, error/truncation and SSE chunk boundaries.",
);

// Edited preset behavior keeps localized default labels without rewriting user content.
const { messages, localizeAction } = await import("../copy.js");
for (const kind of Object.keys(messages.en.presets)) {
  const action = {
    id: kind,
    kind,
    ...messages.en.presets[kind],
    builtin: false,
    instruction: "CUSTOM_PROMPT",
    model: "saved-model",
    targetLanguage: "ja",
  };
  const before = structuredClone(action),
    localized = localizeAction(action, "zh-CN");
  assert.equal(localized.name, messages["zh-CN"].presets[kind].name);
  assert.equal(
    localized.description,
    messages["zh-CN"].presets[kind].description,
  );
  assert.equal(localized.instruction, "CUSTOM_PROMPT");
  assert.equal(localized.model, "saved-model");
  assert.equal(localized.targetLanguage, "ja");
  assert.equal(localizeAction(localized, "en").name, action.name);
  assert.deepEqual(
    action,
    before,
    "Resolving display copy never mutates stored actions",
  );
  assert.equal(
    localizeAction(
      { ...action, name: "My own action", description: "My own description" },
      "zh-CN",
    ).name,
    "My own action",
  );
  assert.equal(
    localizeAction(
      { ...action, name: "My own action", description: "My own description" },
      "zh-CN",
    ).description,
    "My own description",
  );
  assert.equal(
    localizeAction({ ...action, id: "user-created-id" }, "zh-CN").name,
    action.name,
  );
  assert.equal(
    localizeAction({ ...action, kind: "custom" }, "zh-CN").name,
    action.name,
  );
  assert.equal(
    localizeAction({ ...action, builtin: true }, "zh-CN").instruction,
    messages["zh-CN"].presets[kind].instruction,
  );
}
console.log(
  "PASS: edited preset localization, bilingual round trips, custom names/prompts/models/languages preserved and read-only display resolution.",
);

// Deletion protection follows factory identity, not mutable behavior or display flags.
const { PRESET_ACTION_IDS, isPresetAction } =
  await import("../action-policy.js");
const { getPresets } = await import("../data.js");
assert.deepEqual(
  getPresets()
    .map((action) => action.id)
    .sort(),
  [...PRESET_ACTION_IDS].sort(),
);
for (const id of PRESET_ACTION_IDS)
  assert(isPresetAction({ id, kind: "custom", builtin: false }));
assert(!isPresetAction({ id: "copied-preset", kind: "plain", builtin: true }));
console.log(
  "PASS: preset identity survives edits and excludes copied/custom actions.",
);

for (const message of [
  "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
  "The message port closed before a response was received.",
  "Could not establish connection. Receiving end does not exist.",
  "Extension context invalidated.",
]) {
  const error = modelError(new Error(message));
  assert.equal(error.code, "extensionDisconnected");
  assert.equal(error.message, message, "Keep native diagnostics available");
}
const serviceError = new ModelError(
  "serviceError",
  "The message channel closed upstream.",
);
assert.equal(
  modelError(serviceError),
  serviceError,
  "Provider errors keep their explicit code",
);
assert.equal(modelError(new Error("Unexpected failure")).code, "serviceError");
console.log(
  "PASS: extension channel/context failures remain distinct from provider failures.",
);

// Setup guidance follows a usable default generation model, not merely a saved row.
const setupModel = {
  id: "setup",
  protocol: "chat",
  model: "fixture",
  connected: true,
};
assert.equal(
  hasDefaultModel({ connections: [], defaultConnection: null }),
  false,
);
assert.equal(
  hasDefaultModel({ connections: [setupModel], defaultConnection: "setup" }),
  true,
);
for (const [model, selected] of [
  [setupModel, null],
  [setupModel, "deleted"],
  [{ ...setupModel, connected: false }, "setup"],
  [{ ...setupModel, model: "  " }, "setup"],
  [{ ...setupModel, protocol: "typesafe" }, "setup"],
])
  assert.equal(
    hasDefaultModel({ connections: [model], defaultConnection: selected }),
    false,
  );
