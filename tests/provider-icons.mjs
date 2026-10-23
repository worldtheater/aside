import assert from "node:assert/strict";
import { providerIdentity } from "../provider-icons.js";
const connection = {
  url: "http://localhost:8317/v1",
  model: "",
  name: "Local proxy",
};
for (const [id, host, model, name] of [
  ["openai", "api.openai.com", "gpt-6-luna", "openAICPA"],
  ["anthropic", "api.anthropic.com", "anthropic/claude-sonnet", "Anthropic"],
  [
    "gemini",
    "generativelanguage.googleapis.com",
    "models/gemini-flash",
    "Gemini",
  ],
  ["deepseek", "api.deepseek.com", "deepseek-flash", "DeepSeek"],
  ["xai", "api.x.ai", "x-ai/grok-4", "xAI"],
  ["kimi", "api.moonshot.cn", "moonshotai/kimi-k2", "Kimi"],
  ["glm", "open.bigmodel.cn", "z-ai/glm-5", "智谱"],
]) {
  assert.equal(
    providerIdentity({ ...connection, url: `https://${host}/v1` })?.id,
    id,
  );
  assert.equal(providerIdentity({ ...connection, model })?.id, id);
  assert.equal(providerIdentity({ ...connection, name })?.id, id);
}
assert.equal(
  providerIdentity({
    ...connection,
    model: "deepseek-flash",
    name: "OpenAI proxy",
  })?.id,
  "deepseek",
);
assert.equal(
  providerIdentity({
    ...connection,
    url: "https://api.anthropic.com/v1",
    model: "gpt-proxy-alias",
  })?.id,
  "anthropic",
);
assert.equal(
  providerIdentity({ ...connection, url: "https://api.z.ai/api/paas/v4" })?.id,
  "glm",
);
assert.equal(
  providerIdentity({ ...connection, url: "https://api.moonshot.ai/v1" })?.id,
  "kimi",
);
assert.equal(
  providerIdentity({
    ...connection,
    url: "https://api.openai.com.example.org/v1",
  }),
  undefined,
);
assert.equal(
  providerIdentity({ ...connection, url: "https://notopenai.com/v1" }),
  undefined,
);
assert.equal(providerIdentity({ ...connection, url: "https://" }), undefined);
assert.equal(
  providerIdentity({
    ...connection,
    model: "local-model",
    protocol: "responses",
  }),
  undefined,
);
console.log(
  "PASS: seven provider brands, official domains, proxy model identities, connection aliases and unknown services.",
);
