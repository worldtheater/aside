import assert from "node:assert/strict";
import { listModels, modelsEndpoint } from "../providers.js";
const base = { url: "https://models.example/proxy/v1", protocol: "responses" };
for (const [protocol, path] of [
  ["responses", "responses"],
  ["chat", "chat/completions"],
  ["anthropic", "messages"],
  ["gemini", "interactions"],
]) {
  assert.equal(modelsEndpoint({ ...base, protocol }), base.url + "/models");
  assert.equal(
    modelsEndpoint({ ...base, protocol, url: base.url + "/" + path + "/" }),
    base.url + "/models",
  );
}
for (const url of [
  "http://models.example",
  "https://models.example?key=secret",
  "https://name:secret@models.example",
])
  assert.throws(
    () => modelsEndpoint({ ...base, url }),
    (error) => error.code === "invalidUrl",
  );
const originalFetch = globalThis.fetch;
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
try {
  for (const protocol of ["responses", "chat", "anthropic", "gemini"]) {
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), ...options });
      if (protocol === "gemini")
        return json({
          models: [{ name: "models/model-a", displayName: "Model A" }],
          ...(requests.length === 1
            ? { nextPageToken: "page-2" }
            : { models: [{ name: "models/model-b", displayName: "Model B" }] }),
        });
      if (protocol === "anthropic")
        return json({
          data: [
            {
              id: requests.length === 1 ? "model-a" : "model-b",
              display_name: requests.length === 1 ? "Model A" : "Model B",
            },
          ],
          has_more: requests.length === 1,
          last_id: "model-a",
        });
      return json({
        data: [{ id: "model-a" }, { id: "model-a" }, { id: "model-b" }],
      });
    };
    const models = await listModels({ ...base, protocol }, "test-key");
    assert.deepEqual(
      models.map((m) => m.id),
      ["model-a", "model-b"],
    );
    assert.equal(
      requests.length,
      protocol === "gemini" || protocol === "anthropic" ? 2 : 1,
    );
    for (const request of requests) {
      assert.equal(request.method, "GET");
      assert.equal(request.body, undefined);
      assert.equal(request.redirect, "error");
      assert.equal(request.cache, "no-store");
      assert(!request.url.includes("test-key"));
      assert.equal(request.headers.Accept, "application/json");
      if (protocol === "anthropic") {
        assert.equal(request.headers["x-api-key"], "test-key");
        assert.equal(request.headers["anthropic-version"], "2023-06-01");
      } else if (protocol === "gemini")
        assert.equal(request.headers["x-goog-api-key"], "test-key");
      else assert.equal(request.headers.Authorization, "Bearer test-key");
    }
    if (protocol === "anthropic")
      assert.equal(
        new URL(requests[1].url).searchParams.get("after_id"),
        "model-a",
      );
    if (protocol === "gemini")
      assert.equal(
        new URL(requests[1].url).searchParams.get("pageToken"),
        "page-2",
      );
  }
  globalThis.fetch = async () => json({ data: [] });
  assert.deepEqual(await listModels(base, ""), []);
  for (const data of [
    null,
    {},
    { data: [null] },
    { data: [{ id: "" }] },
    { data: "bad" },
  ]) {
    globalThis.fetch = async () => json(data);
    await assert.rejects(
      () => listModels(base, ""),
      (e) => e.code === "invalidModelList",
    );
  }
  globalThis.fetch = async () => new Response("<html>not an API</html>");
  await assert.rejects(
    () => listModels(base, ""),
    (e) => e.code === "invalidModelList",
  );
  for (const [status, code] of [
    [401, "authError"],
    [403, "authError"],
    [429, "rateLimited"],
    [500, "serviceError"],
  ]) {
    globalThis.fetch = async () =>
      json({ error: { message: "Rejected test-key" } }, status);
    await assert.rejects(
      () => listModels(base, "test-key"),
      (e) => e.code === code && !e.message.includes("test-key"),
    );
  }
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    () => listModels(base, ""),
    (e) => e.code === "networkError",
  );
  globalThis.fetch = async () =>
    json({ data: [{ id: "a" }], has_more: true, last_id: "a" });
  await assert.rejects(
    () => listModels({ ...base, protocol: "anthropic" }, ""),
    (e) => e.code === "invalidModelList",
  );
  globalThis.fetch = async () => json({ data: [], has_more: true });
  await assert.rejects(
    () => listModels({ ...base, protocol: "anthropic" }, ""),
    (e) => e.code === "invalidModelList",
  );
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  "PASS: model-list URLs, four protocol auth formats, Gemini/Anthropic pagination, normalization/deduplication, empty/malformed lists, service errors, key redaction and pagination cycles.",
);
