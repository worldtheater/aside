import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  requestBody,
  reasoningBody,
  reasoningLevels,
  listModels,
  promptCacheKey,
  endpoint,
} from "../providers.js";
import { resultKey, actionInstructions } from "../processor.js";
const base = {
  id: "reasoning",
  url: "https://example.com/v1",
  model: "gpt-6-sol",
  maxTokens: 4096,
  protocol: "responses",
};
for (const protocol of ["responses", "chat", "anthropic", "gemini"]) {
  const c = {
    ...base,
    protocol,
    model: {
      responses: "gpt-6-sol",
      chat: "gpt-6-sol",
      anthropic: "claude-opus-5-5",
      gemini: "gemini-3.8-flash",
    }[protocol],
  };
  const ordinary = await requestBody(c, "Rules", "Source");
  assert.equal(ordinary.reasoning, undefined);
  assert.equal(ordinary.reasoning_effort, undefined);
  assert.equal(ordinary.output_config, undefined);
  assert.equal(ordinary.thinking, undefined);
  assert.equal(ordinary.generation_config?.thinking_level, undefined);
  for (const effort of reasoningLevels(c)) {
    const body = await requestBody(
      { ...c, reasoningEffort: effort },
      "Rules",
      "Source",
    );
    if (protocol === "responses") {
      assert.deepEqual(body.reasoning, { effort });
      assert.equal(body.reasoning_effort, undefined);
    }
    if (protocol === "chat") {
      assert.equal(body.reasoning_effort, effort);
      assert.equal(body.reasoning, undefined);
    }
    if (protocol === "anthropic") {
      assert.deepEqual(body.output_config, { effort });
      assert.deepEqual(body.thinking, { type: "adaptive" });
      assert.equal(body.max_tokens, 4096);
    }
    if (protocol === "gemini")
      assert.deepEqual(body.generation_config, {
        thinking_level: effort,
        max_output_tokens: 4096,
      });
    assert.equal(body.stream, true);
  }
  await assert.rejects(
    () =>
      requestBody({ ...c, reasoningEffort: "unsupported" }, "Rules", "Source"),
    (e) => e.code === "invalidReasoning",
  );
}
assert.deepEqual(
  (
    await requestBody(
      {
        ...base,
        protocol: "gemini",
        model: "gemini-3.8-flash",
        maxTokens: undefined,
        reasoningEffort: "low",
      },
      "I",
      "X",
    )
  ).generation_config,
  { thinking_level: "low" },
);
for (const [protocol, reasoningEffort] of [
  ["gemini", "max"],
  ["anthropic", "none"],
])
  assert.throws(
    () => reasoningBody({ ...base, protocol, reasoningEffort }),
    (e) => e.code === "invalidReasoning",
  );
// Model contracts are independent of the transport's union of enum values.
for (const [protocol, model, levels] of [
  ["gemini", "gemini-3.8-flash", ["low", "medium", "high"]],
  ["gemini", "models/gemini-3.8-flash", ["low", "medium", "high"]],
  ["gemini", "google/gemini-4-argon", ["low", "medium", "high"]],
  ["gemini", "gemini-3.6-flash", ["minimal", "low", "medium", "high"]],
  ["gemini", "gemini-3-pro-preview", ["low", "high"]],
  ["gemini", "gemini-2.5-flash", ["low", "medium", "high"]],
  [
    "responses",
    "openai/gpt-6-astra",
    ["low", "medium", "high", "xhigh", "max"],
  ],
  ["responses", "gpt-6.1-sol", ["low", "medium", "high", "xhigh", "max"]],
  ["chat", "gpt-6-luna", ["none", "low", "medium", "high", "xhigh", "max"]],
  ["responses", "gpt-5.5", ["none", "low", "medium", "high", "xhigh"]],
  ["chat", "gpt-5", ["minimal", "low", "medium", "high"]],
  ["anthropic", "claude-sonnet-4-6", ["low", "medium", "high", "max"]],
  ["anthropic", "claude-opus-4-5", ["low", "medium", "high"]],
  ["anthropic", "claude-opus-5-5", ["low", "medium", "high", "xhigh", "max"]],
  ["chat", "deepseek-flash", ["none", "low", "high", "max"]],
  ["responses", "deepseek-v4-pro", ["none", "low", "high", "max"]],
  ["chat", "kimi-k3", ["low", "high", "max"]],
  ["chat", "glm-5.3", ["low", "high", "max"]],
  ["chat", "glm-5.2", ["none", "high", "max"]],
  ["responses", "grok-4.6", ["low", "medium", "high", "xhigh"]],
  ["responses", "grok-4.5", ["low", "medium", "high"]],
  ["responses", "gpt-6-future", []],
  ["responses", "other/gpt-6-astra", []],
  ["anthropic", "gpt-6-astra", []],
  ["chat", "kimi-k2.6", []],
  ["gemini", "private-model", []],
  ["typesafe", "gpt-6-sol", []],
])
  assert.deepEqual(
    reasoningLevels({ ...base, model, protocol }),
    levels,
    model + "/" + protocol,
  );
const gemini = { ...base, protocol: "gemini", model: "gemini-3.8-flash" };
assert.throws(
  () => reasoningBody({ ...gemini, reasoningEffort: "minimal" }),
  (e) => e.code === "invalidReasoning",
);
assert.deepEqual(reasoningBody(gemini), {});
// Stale or overly broad metadata cannot re-enable an invalid known level.
assert.deepEqual(
  reasoningLevels({
    ...gemini,
    models: [{ id: gemini.model, reasoningEfforts: ["minimal", "high"] }],
  }),
  ["low", "medium", "high"],
);
assert.deepEqual(
  reasoningLevels({
    ...base,
    protocol: "anthropic",
    model: "claude-opus-4-5",
    models: [
      { id: "claude-opus-4-5", reasoningEfforts: ["high", "xhigh", "max"] },
    ],
  }),
  ["high"],
);
assert.deepEqual(
  reasoningBody({
    ...base,
    protocol: "anthropic",
    model: "claude-opus-4-5",
    reasoningEffort: "high",
  }),
  { output_config: { effort: "high" } },
);
for (const [protocol, model, reasoningEffort, expected] of [
  ["responses", "deepseek-flash", "none", { reasoning: { effort: "none" } }],
  ["chat", "deepseek-flash", "none", { thinking: { type: "disabled" } }],
  [
    "chat",
    "deepseek-flash",
    "low",
    { reasoning_effort: "low", thinking: { type: "enabled" } },
  ],
  [
    "anthropic",
    "deepseek-flash",
    "high",
    { output_config: { effort: "high" }, thinking: { type: "enabled" } },
  ],
  [
    "chat",
    "glm-5.3",
    "low",
    { reasoning_effort: "low", thinking: { type: "enabled" } },
  ],
  ["chat", "glm-5.2", "none", { thinking: { type: "disabled" } }],
  ["chat", "kimi-k3", "max", { reasoning_effort: "max" }],
])
  assert.deepEqual(
    reasoningBody({ ...base, model, protocol, reasoningEffort }),
    expected,
  );
const { MODEL_SPECS } = await import("../model-spec.js");
const ids = new Set();
for (const spec of MODEL_SPECS)
  for (const model of spec.models) {
    assert(!ids.has(model), "Overlapping model spec: " + model);
    ids.add(model);
    for (const [protocol, contract] of Object.entries(spec.api)) {
      const c = { ...base, model, protocol };
      for (const effort of contract.levels)
        await requestBody({ ...c, reasoningEffort: effort }, "Rules", "Source");
      assert.deepEqual(reasoningBody(c), {});
    }
  }
const originalFetch = globalThis.fetch;
let models;
try {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "fixture",
            capabilities: {
              effort: {
                supported: true,
                low: { supported: true },
                high: { supported: true },
                max: { supported: false },
              },
              thinking: { types: { adaptive: { supported: true } } },
            },
          },
          {
            id: "no-effort",
            capabilities: {
              effort: { supported: false },
              thinking: { types: { adaptive: { supported: false } } },
            },
          },
          {
            id: "effort-only",
            capabilities: {
              effort: { supported: true, low: { supported: true } },
              thinking: { types: { adaptive: { supported: false } } },
            },
          },
          { id: "proxy-without-capabilities" },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  models = await listModels({ ...base, protocol: "anthropic" }, "");
} finally {
  globalThis.fetch = originalFetch;
}
const anthropic = { ...base, model: "fixture", protocol: "anthropic", models };
assert.deepEqual(reasoningLevels(anthropic), ["low", "high"]);
assert.deepEqual(reasoningLevels({ ...anthropic, model: "no-effort" }), []);
assert.throws(
  () => reasoningBody({ ...anthropic, reasoningEffort: "max" }),
  (e) => e.code === "invalidReasoning",
);
assert.deepEqual(
  reasoningBody({ ...anthropic, model: "effort-only", reasoningEffort: "low" }),
  { output_config: { effort: "low" } },
);
assert.deepEqual(
  reasoningLevels({ ...anthropic, model: "proxy-without-capabilities" }),
  [],
);
assert.throws(
  () =>
    reasoningBody({
      ...anthropic,
      model: "proxy-without-capabilities",
      reasoningEffort: "high",
    }),
  (e) => e.code === "invalidReasoning",
);
// Independent adaptive metadata is respected, but cannot widen a known contract.
assert.deepEqual(
  reasoningBody({
    ...base,
    protocol: "anthropic",
    model: "claude-opus-5-5",
    reasoningEffort: "low",
    models: [{ id: "claude-opus-5-5", adaptiveThinking: false }],
  }),
  { output_config: { effort: "low" } },
);
assert.deepEqual(
  reasoningBody({
    ...base,
    protocol: "anthropic",
    model: "claude-opus-4-5",
    reasoningEffort: "low",
    models: [
      {
        id: "claude-opus-4-5",
        reasoningEfforts: ["low"],
        adaptiveThinking: true,
      },
    ],
  }),
  { output_config: { effort: "low" } },
);
assert.deepEqual(
  reasoningLevels({
    ...base,
    protocol: "anthropic",
    model: "private",
    models: [{ id: "private", adaptiveThinking: true }],
  }),
  [],
);
const action = { mode: "paragraph", kind: "custom", instruction: "Rules" },
  hash = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Keeping service defaults preserves existing cache identities without invalidating stored results.
assert.equal(
  await resultKey(base, action, "same"),
  hash([
    "pagework-result-v1",
    base.id,
    endpoint(base),
    base.protocol,
    base.model,
    base.maxTokens,
    action.mode,
    actionInstructions(action),
    "same",
  ]),
);
assert.equal(
  await promptCacheKey(base, "Rules"),
  hash([base.id, base.model, "Rules"]),
);
const low = { ...base, reasoningEffort: "low" },
  high = { ...base, reasoningEffort: "high" };
assert.notEqual(
  await resultKey(low, action, "same"),
  await resultKey(high, action, "same"),
);
assert.notEqual(
  await resultKey(base, action, "same"),
  await resultKey({ ...base, reasoningEffort: "none" }, action, "same"),
);
assert.notEqual(
  await promptCacheKey(low, "Rules"),
  await promptCacheKey(high, "Rules"),
);
assert.equal(
  (await requestBody(high, "Rules", "A")).prompt_cache_key,
  (await requestBody(high, "Rules", "B")).prompt_cache_key,
);
assert.notEqual(
  await resultKey({ ...anthropic, reasoningEffort: "low" }, action, "same"),
  await resultKey(
    {
      ...anthropic,
      reasoningEffort: "low",
      models: [
        {
          id: "fixture",
          name: "fixture",
          reasoningEfforts: ["low"],
          adaptiveThinking: false,
        },
      ],
    },
    action,
    "same",
  ),
);
console.log(
  "PASS: protocol reasoning parameters, service-default omission, catalog capabilities, invalid-level rejection, preserved default cache keys and reasoning-specific cache/prefix identities.",
);
