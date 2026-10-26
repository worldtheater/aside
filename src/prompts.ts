import type { Locale, ProcessingAction, OutputLength } from "./types.js";
import { LOCALES } from "./locale.js";

// Built-in tasks are separate from optional, user-authored additions and output language.
export const ACTION_PROMPTS = {
  translate:
    "Translate the text faithfully and naturally, preserving its structure.",
  plain:
    "Explain classical or historical text in clear modern language, adding brief notes where needed. Begin directly with the rendition, without a title.",
  explain:
    "Explain the content's meaning, key concepts, and background, with pronunciation notes for uncommon words.",
  summary: "Extract the key points of the supplied content.",
  qa: "Answer the question directly.",
};

export function hasDefaultInstructions(
  action: Pick<ProcessingAction, "kind">,
): action is { kind: keyof typeof ACTION_PROMPTS } {
  return (
    action.kind !== undefined && Object.hasOwn(ACTION_PROMPTS, action.kind)
  );
}

export const followsInstructionLanguage = (
  action: Pick<ProcessingAction, "kind" | "targetLanguage" | "outputLanguage">,
) =>
  (action.kind === "translate"
    ? action.targetLanguage
    : action.outputLanguage) === "instruction";

export const requiresInstructions = (
  action: Pick<ProcessingAction, "kind" | "targetLanguage" | "outputLanguage">,
) => !hasDefaultInstructions(action) || followsInstructionLanguage(action);

export const DEFAULT_OUTPUT_LENGTH: OutputLength = "brief";
export const OUTPUT_LENGTH_PROMPTS: Record<OutputLength, string> = {
  brief:
    "Aim for 1–3 short sentences, giving the answer and only the most essential qualification.",
  balanced:
    "Aim for one concise paragraph of about 4–6 sentences, or a similarly short list of steps.",
  detailed:
    "Aim for 2–3 short paragraphs, including the key reasons, steps, or one useful example. Keep the answer focused.",
};
// One daily reflection, with editable defaults in the interface language.
export const DAILY_PROMPT: Record<Locale, string> = {
  "zh-CN": "围绕阅读与思考，写一句简短、自然的随想。语气平实，不编造出处。",
  en: "Write a short reflection on reading and thinking. Be natural and understated. Do not invent an attribution.",
  "zh-TW": "圍繞閱讀與思考，寫一句簡短、自然的隨想。語氣平實，不編造出處。",
  ja: "読書と思考について、短く自然な所感を一文で書いてください。落ち着いた語り口にし、出典を捏造しないでください。",
  ko: "독서와 사유에 관한 짧고 자연스러운 생각을 한 문장으로 써 주세요. 담백한 어조로 쓰고 출처를 지어내지 마세요.",
  fr: "Écrivez une brève réflexion sur la lecture et la pensée. Adoptez un ton naturel et sobre. N’inventez pas d’attribution.",
  de: "Schreibe einen kurzen Gedanken über das Lesen und Nachdenken. Formuliere natürlich und unaufdringlich. Erfinde keine Quellenangabe.",
  es: "Escribe una breve reflexión sobre la lectura y el pensamiento. Usa un tono natural y sobrio. No inventes atribuciones.",
  "pt-BR":
    "Escreva uma breve reflexão sobre leitura e pensamento. Use um tom natural e discreto. Não invente uma autoria.",
  ru: "Напишите короткое размышление о чтении и мышлении. Используйте естественный, сдержанный тон. Не приписывайте текст вымышленному автору.",
  id: "Tulis renungan singkat tentang membaca dan berpikir. Gunakan gaya yang alami dan sederhana. Jangan mengarang atribusi.",
  it: "Scrivi una breve riflessione sulla lettura e sul pensiero. Usa un tono naturale e sobrio. Non inventare attribuzioni.",
  tr: "Okuma ve düşünme üzerine kısa bir düşünce yaz. Doğal ve sade bir üslup kullan. Gerçek olmayan bir kaynak veya yazar belirtme.",
  th: "เขียนข้อคิดสั้น ๆ เกี่ยวกับการอ่านและการคิด ใช้ภาษาที่เป็นธรรมชาติและเรียบง่าย ไม่แต่งเติมที่มาหรือชื่อผู้กล่าว",
  vi: "Viết một suy ngẫm ngắn về việc đọc và suy nghĩ. Dùng giọng văn tự nhiên, giản dị. Không bịa nguồn hay tác giả.",
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
) => (!value || value === "interface" ? LOCALES[locale].output : value);
