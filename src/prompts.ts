import type { Locale, ProcessingAction, OutputLength } from "./types.js";

// Model instructions are shared across interface locales. Output language is a separate setting.
export const ACTION_PROMPTS = {
  plain:
    "Explain the meaning of the supplied classical or historical text, in any language. Identify the source language and interpret its vocabulary, grammar, idioms, and allusions in their historical context. Treat even a short fragment as the complete source for this invocation. For a word or phrase, give a concise gloss; for a sentence or passage, give a fluent, faithful rendition in clear contemporary language, preserving meaning, names, events, and tone. Append brief notes on archaic terms or allusions only where needed to understand the source. If a reading is uncertain, state that uncertainty briefly. Start with the rendition and end with any necessary notes, without addressing the reader.",
  explain:
    "Explain the supplied content to a reader without specialist knowledge. Start with the main idea, explain key concepts, and give an everyday example when helpful. For uncommon characters or words in the source, add a concise pronunciation note alongside their first explanation. Use tone-marked Hanyu Pinyin for Chinese and IPA or the language's standard reading notation for other languages. Choose the reading that fits the context; if it is uncertain, say so briefly rather than inventing a pronunciation. Keep the explanation concise and focus pronunciation notes on words that need them.",
  summary:
    "Summarize the entire content as three key takeaways. Give a conclusion and a brief supporting reason for each. Do not repeat every paragraph or introduce unsupported information.",
  qa:
    "Answer the question in the supplied text directly. Lead with the answer and include only the reasons or steps needed to make it useful. If the available information is insufficient, briefly state what is uncertain or missing. Do not invent facts, repeat the question, add a preamble, or invite further conversation.",
};
export const DEFAULT_OUTPUT_LENGTH: OutputLength = "brief";
export const OUTPUT_LENGTH_PROMPTS: Record<OutputLength, string> = {
  brief: "Aim for 1–3 short sentences, giving the answer and only the most essential qualification.",
  balanced: "Aim for one concise paragraph of about 4–6 sentences, or a similarly short list of steps.",
  detailed: "Aim for 2–3 short paragraphs, including the key reasons, steps, or one useful example. Keep the answer focused.",
};
// One daily reflection, with editable defaults in the interface language.
export const DAILY_PROMPT: Record<Locale, string> = {
  "zh-CN": "围绕阅读与思考，写一句简短、自然的随想。语气平实，不编造出处。",
  en: "Write a short reflection on reading and thinking. Be natural and understated. Do not invent an attribution.",
};

export const hasOutputLanguage = (action: Pick<ProcessingAction, "kind">) =>
  action.kind === "plain" ||
  action.kind === "explain" ||
  action.kind === "summary" ||
  action.kind === "qa";

// Omission deliberately means follow the current interface, rather than the locale at creation time.
export const resolveOutputLanguage = (
  value: string | undefined,
  locale: Locale,
) =>
  !value || value === "interface"
    ? locale === "zh-CN"
      ? "zh-Hans"
      : "en"
    : value;
