import type { Connection, Protocol, ReasoningEffort } from "./types.js";

export type ModelConnection = Pick<Connection, "url" | "model" | "protocol"> &
  Partial<Connection>;
interface ReasoningSpec {
  readonly levels: readonly ReasoningEffort[];
  readonly thinking?: "adaptive" | "enabled";
  // These values disable thinking instead of being sent as an effort value.
  readonly disableThinking?: readonly ReasoningEffort[];
}
interface ModelSpec {
  readonly namespaces: readonly string[];
  readonly models: readonly string[];
  readonly api: Partial<Record<Protocol, ReasoningSpec>>;
  readonly source: string;
}

// Model-specific capability contracts.
// Only explicitly listed IDs/aliases are matched; a new family needs verification.
export const MODEL_SPECS_VERIFIED_AT = "2026-10-23";
export const ANTHROPIC_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
const lowToHigh: ReasoningSpec = { levels: ["low", "medium", "high"] };
const lowToMax: ReasoningSpec = { levels: ANTHROPIC_EFFORTS };
const noneToMax: ReasoningSpec = { levels: ["none", ...ANTHROPIC_EFFORTS] };
const minimalToHigh: ReasoningSpec = {
  levels: ["minimal", "low", "medium", "high"],
};
const anthropic: ReasoningSpec = { ...lowToMax, thinking: "adaptive" };
const deepseek: ReasoningSpec = { levels: ["none", "low", "high", "max"] };
const deepseekThinking: ReasoningSpec = {
  ...deepseek,
  thinking: "enabled",
  disableThinking: ["none"],
};
const geminiSource = "https://ai.google.dev/gemini-api/docs/thinking";
const claudeSource =
  "https://platform.claude.com/docs/en/build-with-claude/effort";
const grokSource =
  "https://docs.x.ai/developers/model-capabilities/text/reasoning";
const glmSource = "https://docs.z.ai/guides/capabilities/thinking";

export const MODEL_SPECS: readonly ModelSpec[] = [
  {
    namespaces: ["openai"],
    models: ["gpt-6.1-sol", "gpt-6-astra"],
    api: { responses: lowToMax, chat: lowToMax },
    source: "https://developers.openai.com/api/docs/guides/latest-model",
  },
  {
    namespaces: ["openai"],
    models: [
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ],
    api: { responses: noneToMax, chat: noneToMax },
    source: "https://developers.openai.com/api/docs/models/gpt-5.6",
  },
  ...["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.2"].map(
    (model): ModelSpec => {
      const reasoning: ReasoningSpec = {
        levels: ["none", "low", "medium", "high", "xhigh"],
      };
      return {
        namespaces: ["openai"],
        models: [model],
        api: { responses: reasoning, chat: reasoning },
        source: `https://developers.openai.com/api/docs/models/${model}`,
      };
    },
  ),
  {
    namespaces: ["openai"],
    models: ["gpt-5.1"],
    api: {
      responses: { levels: ["none", ...lowToHigh.levels] },
      chat: { levels: ["none", ...lowToHigh.levels] },
    },
    source: "https://developers.openai.com/api/docs/models/gpt-5.1",
  },
  {
    namespaces: ["openai"],
    models: ["gpt-5"],
    api: { responses: minimalToHigh, chat: minimalToHigh },
    source: "https://developers.openai.com/api/docs/models/gpt-5",
  },
  {
    namespaces: ["gemini", "google"],
    models: [
      "gemini-4-argon",
      "gemini-3.8-flash",
      "gemini-3.1-pro-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
    api: { gemini: lowToHigh },
    source: geminiSource,
  },
  {
    namespaces: ["gemini", "google"],
    models: ["gemini-3.7-flash"],
    api: { gemini: lowToHigh },
    source: "https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash",
  },
  {
    namespaces: ["gemini", "google"],
    models: [
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3-flash-preview",
      "gemini-robotics-er-2-preview",
    ],
    api: { gemini: minimalToHigh },
    source: geminiSource,
  },
  {
    namespaces: ["gemini", "google"],
    models: ["gemini-3-pro-preview"],
    api: { gemini: { levels: ["low", "high"] } },
    source: geminiSource,
  },
  {
    namespaces: ["gemini", "google"],
    models: ["gemini-3.1-flash-lite-image"],
    api: { gemini: { levels: ["minimal", "high"] } },
    source: geminiSource,
  },
  {
    namespaces: ["anthropic"],
    models: [
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-sonnet-5-5",
      "claude-sonnet-5",
      "claude-haiku-5-5",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-mythos-5-1",
      "claude-mythos-5",
    ],
    api: { anthropic },
    source: claudeSource,
  },
  {
    namespaces: ["anthropic"],
    models: ["claude-opus-4-6", "claude-sonnet-4-6"],
    api: {
      anthropic: {
        levels: ["low", "medium", "high", "max"],
        thinking: "adaptive",
      },
    },
    source: claudeSource,
  },
  {
    namespaces: ["anthropic"],
    models: ["claude-opus-4-5", "claude-opus-4-5-20251101"],
    api: { anthropic: lowToHigh },
    source: claudeSource,
  },
  {
    namespaces: ["deepseek"],
    models: [
      "deepseek-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4-pro",
    ],
    api: {
      responses: deepseek,
      chat: deepseekThinking,
      anthropic: deepseekThinking,
    },
    source: "https://api-docs.deepseek.com/guides/thinking_mode/",
  },
  {
    namespaces: ["kimi", "moonshotai", "moonshot"],
    models: ["kimi-k3"],
    api: { chat: { levels: ["low", "high", "max"] } },
    source: "https://www.kimi.ai/help/kimi-api/api-model-selection",
  },
  {
    namespaces: ["zai", "z-ai", "zhipu"],
    models: ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx"],
    api: { chat: { levels: ["low", "high", "max"], thinking: "enabled" } },
    source: glmSource,
  },
  {
    namespaces: ["zai", "z-ai", "zhipu"],
    models: ["glm-5.2"],
    api: {
      chat: {
        levels: ["none", "high", "max"],
        thinking: "enabled",
        disableThinking: ["none"],
      },
    },
    // Expose distinct behaviors, not the aliases minimal/low/medium/xhigh.
    source: glmSource,
  },
  {
    namespaces: ["xai", "x-ai"],
    models: ["grok-4.7", "grok-4.6"],
    api: { responses: { levels: ["low", "medium", "high", "xhigh"] } },
    source: grokSource,
  },
  {
    namespaces: ["xai", "x-ai"],
    models: ["grok-4.5"],
    api: { responses: lowToHigh },
    source: grokSource,
  },
];

export function findModelSpec(
  connection: ModelConnection,
): ModelSpec | undefined {
  const model = connection.model
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");
  return MODEL_SPECS.find((spec) =>
    spec.models.some(
      (id) =>
        model === id ||
        spec.namespaces.some((namespace) => model === `${namespace}/${id}`),
    ),
  );
}

export function reasoningSpec(
  connection: ModelConnection,
): ReasoningSpec | undefined {
  const known = findModelSpec(connection)?.api[connection.protocol];
  // Only Messages currently reports a documented effort capability schema.
  if (connection.protocol !== "anthropic") return known;
  const catalog = connection.models?.find(
    (model) => model.id === connection.model,
  );
  if (!catalog) return known;
  const levels = catalog.reasoningEfforts;
  if (!known && levels === undefined) return undefined;
  return {
    ...known,
    // Catalogs may narrow a known contract or describe a private model.
    levels:
      levels === undefined
        ? known!.levels
        : (known?.levels ?? ANTHROPIC_EFFORTS).filter((level) =>
            levels.includes(level),
          ),
    thinking: known
      ? known.thinking === "adaptive" && catalog.adaptiveThinking === false
        ? undefined
        : known.thinking
      : catalog.adaptiveThinking === true
        ? "adaptive"
        : undefined,
  };
}

export function reasoningLevels(
  connection: ModelConnection,
): readonly ReasoningEffort[] {
  return reasoningSpec(connection)?.levels ?? [];
}
