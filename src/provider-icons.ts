import type { Connection } from "./types.js";

type ProviderIdentity = Pick<Connection, "url" | "model" | "name">;
const providers = [
  {
    id: "openai",
    name: "OpenAI",
    hosts: ["openai.com"],
    model: /^(?:openai\/)?(?:gpt-|chatgpt-|o[134](?:-|$))/i,
    alias: /openai|chatgpt/i,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    hosts: ["anthropic.com"],
    model: /^(?:anthropic\/)?claude(?:-|$)/i,
    alias: /anthropic|claude/i,
  },
  {
    id: "gemini",
    name: "Gemini",
    hosts: ["generativelanguage.googleapis.com", "aiplatform.googleapis.com"],
    model: /^(?:google\/|models\/)?gemini(?:-|$)/i,
    alias: /gemini/i,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    hosts: ["deepseek.com"],
    model: /^(?:deepseek\/)?deepseek(?:-|$)/i,
    alias: /deepseek|深度求索/i,
  },
  {
    id: "xai",
    name: "xAI",
    hosts: ["x.ai"],
    model: /^(?:x-ai\/|xai\/)?grok(?:-|$)/i,
    alias: /xai|x\.ai|grok/i,
  },
  {
    id: "kimi",
    name: "Kimi",
    hosts: ["moonshot.cn", "moonshot.ai", "kimi.com"],
    model: /^(?:moonshotai\/)?(?:kimi|moonshot)(?:-|$)/i,
    alias: /kimi|moonshot|月之暗面/i,
  },
  {
    id: "glm",
    name: "GLM",
    hosts: ["bigmodel.cn", "z.ai"],
    model: /^(?:z-ai\/|zai\/)?glm(?:-|$)/i,
    alias: /glm|zhipu|z\.ai|智谱/i,
  },
] as const;

// A wire protocol does not identify the provider: proxies can serve many brands.
export function providerIdentity(connection: ProviderIdentity) {
  let host = "";
  try {
    host = new URL(connection.url).hostname;
  } catch {
    /* The URL may still be incomplete while editing. */
  }
  return (
    providers.find((provider) =>
      provider.hosts.some(
        (domain) => host === domain || host.endsWith("." + domain),
      ),
    ) ||
    providers.find((provider) =>
      provider.model.test(connection.model.trim()),
    ) ||
    providers.find((provider) => provider.alias.test(connection.name))
  );
}

export function providerIcon(connection: ProviderIdentity): string {
  const provider = providerIdentity(connection);
  return provider
    ? `<span class="provider-icon" role="img" aria-label="${provider.name}" data-provider="${provider.id}" style="--provider-icon:url('icons/providers/${provider.id}.svg')"></span>`
    : "";
}
