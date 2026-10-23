import assert from "node:assert/strict";
import { callDecision } from "../decision.js";
import {
  callModel,
  connectionPurpose,
  defaultConnectionKey,
  endpoint,
  modelsEndpoint,
  listModels,
} from "../providers.js";
import {
  lightsDecisionInput,
  lightsEffect,
  lightsCacheKey,
  validateCandidates,
} from "../lights-decision.js";
const connection = {
  id: "jev",
  protocol: "typesafe",
  url: "https://api.typesafe.ai/v1",
  name: "Jev",
  model: "jev-preview",
  connected: true,
  maxTokens: 8192,
};
assert.equal(endpoint(connection), "https://api.typesafe.ai/v1/systemone");
assert.equal(
  modelsEndpoint({ ...connection, url: endpoint(connection) }),
  "https://api.typesafe.ai/v1/models",
);
assert.equal(connectionPurpose(connection), "decision");
assert.equal(defaultConnectionKey(connection), "defaultDecisionConnection");
assert.equal(defaultConnectionKey({ protocol: "chat" }), "defaultConnection");
await assert.rejects(
  callModel(
    connection,
    "key",
    "Do something",
    "text",
    new AbortController().signal,
  ),
  (e) => e.code === "invalidProtocol",
);
const candidate = {
  id: "local",
  tag: "canvas",
  label: "Ambient backdrop",
  context: "A heading",
  position: "absolute; z-index 0",
  width: 800,
  height: 400,
  behindText: true,
  brightness: 0.94,
  darkFraction: 0.02,
  lightFraction: 0.98,
  colorfulFraction: 0.01,
  transparentFraction: 0,
  backgroundBrightness: 0.1,
  visualKey: "abc",
  image: "aGVsbG8=",
};
validateCandidates([candidate]);
for (const invalid of [
  [],
  Array(7).fill(candidate),
  [candidate, candidate],
  [{ ...candidate, brightness: NaN }],
  [{ ...candidate, image: "https://evil.test" }],
])
  assert.throws(() => validateCandidates(invalid));
const input = lightsDecisionInput([candidate]);
assert.equal(Object.keys(input.assets).length, 1);
const answer = {
  type: "choice",
  choice: "decorative_background",
  confidence: 0.98,
  probabilities: {
    decorative_background: 0.985,
    monochrome_mark: 0.005,
    content_media: 0.005,
    uncertain: 0.005,
  },
};
assert.equal(lightsEffect(candidate, answer), "dim");
assert.equal(
  lightsEffect({ ...candidate, behindText: false }, answer),
  "preserve",
);
assert.equal(
  lightsEffect(candidate, { ...answer, confidence: 0.4 }),
  "preserve",
);
assert.equal(
  lightsEffect(candidate, { ...answer, choice: "content_media" }),
  "preserve",
);
const mark = {
  ...candidate,
  tag: "img",
  darkFraction: 0.95,
  brightness: 0.03,
  transparentFraction: 0.7,
};
assert.equal(
  lightsEffect(mark, { ...answer, choice: "monochrome_mark" }),
  "lighten",
);
assert.equal(
  lightsEffect(
    { ...mark, colorfulFraction: 0.5 },
    { ...answer, choice: "monochrome_mark" },
  ),
  "backdrop",
);
assert.equal(
  lightsEffect({ ...candidate, tag: "background" }, answer),
  "shade",
);
assert.equal(
  lightsEffect(
    { ...mark, backgroundBrightness: 0.9 },
    { ...answer, choice: "monochrome_mark" },
  ),
  "preserve",
);
assert.equal(
  lightsEffect(
    { ...mark, transparentFraction: 0 },
    { ...answer, choice: "monochrome_mark" },
  ),
  "preserve",
);
assert.equal(
  lightsEffect(
    { ...mark, colorfulFraction: 0.3 },
    { ...answer, choice: "content_media" },
  ),
  "backdrop",
);
assert.equal(
  lightsEffect(
    { ...mark, colorfulFraction: 0.3 },
    { ...answer, choice: "uncertain" },
  ),
  "backdrop",
);
assert.equal(
  lightsEffect(mark, { ...answer, choice: "monochrome_mark", confidence: 0.6 }),
  "backdrop",
);
assert.equal(
  lightsEffect(
    { ...mark, transparentFraction: 0 },
    { ...answer, choice: "uncertain" },
  ),
  "preserve",
);
const key = await lightsCacheKey(connection, candidate);
assert.equal(
  await lightsCacheKey(connection, {
    ...candidate,
    id: "another",
    image: "differentEncoding",
  }),
  key,
);
for (const changed of [
  { ...candidate, visualKey: "changed" },
  { ...candidate, context: "Chart legend" },
])
  assert.notEqual(await lightsCacheKey(connection, changed), key);
assert.notEqual(
  await lightsCacheKey({ ...connection, model: "another" }, candidate),
  key,
);
const originalFetch = globalThis.fetch;
const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
let usage;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), modelsEndpoint(connection));
    assert.equal(options.headers.Authorization, "Bearer test-key");
    return reply({
      models: [
        {
          name: "jev-preview",
          description: "Preview",
          release_date: "2026-10-14",
        },
      ],
    });
  };
  assert.deepEqual(await listModels(connection, "test-key"), [
    { id: "jev-preview", name: "jev-preview" },
  ]);
  globalThis.fetch = async (url, options) => {
    assert.equal(url, endpoint(connection));
    assert.equal(options.headers["TypeSafe-Danger-Zone-Images"], "true");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "jev-preview");
    assert(!("messages" in body));
    assert(!("max_tokens" in body));
    return reply({
      answers: { element_0: answer },
      usage: { input_tokens: 123, output_tokens: 20 },
    });
  };
  const result = await callDecision(
    connection,
    "test-key",
    input,
    new AbortController().signal,
    (value) => {
      usage = value;
    },
  );
  assert.equal(result.element_0.choice, answer.choice);
  assert.equal(usage.tokens.totalTokens, 143);
  assert.equal(usage.final, true);
  for (const data of [
    { answers: {} },
    { answers: { element_0: { ...answer, choice: "execute-script" } } },
    { answers: { element_0: { ...answer, confidence: 2 } } },
    { answers: { element_0: { ...answer, probabilities: {} } } },
  ]) {
    globalThis.fetch = async () => reply(data);
    await assert.rejects(
      callDecision(
        connection,
        "test-key",
        input,
        new AbortController().signal,
        () => {},
      ),
      (e) => e.code === "invalidDecision",
    );
  }
  globalThis.fetch = async () =>
    reply({ error: { message: "test-key denied" } }, 401);
  await assert.rejects(
    callDecision(
      connection,
      "test-key",
      input,
      new AbortController().signal,
      () => {},
    ),
    (e) => e.code === "authError" && !e.message.includes("test-key"),
  );
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async () => {
    throw new DOMException("Abort", "AbortError");
  };
  await assert.rejects(
    callDecision(connection, "test-key", input, controller.signal, () => {}),
    (e) => e.code === "cancelled",
  );
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  "PASS: TypeSafe wire contract, model discovery, usage, cancellation, validation, conservative effects and evidence-aware cache keys.",
);
