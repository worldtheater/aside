import type { Locale, ProcessingAction, Scope } from "./types.js";
import { resolveOutputLanguage } from "./prompts.js";
import { ModelError } from "./providers.js";

export function translationScope(action?: Partial<ProcessingAction>): Scope {
  return action?.kind === "translate"
    ? (action.translationScope ?? "body")
    : "body";
}

export function validateTranslationScope(
  action: Partial<ProcessingAction>,
): void {
  if (
    action.translationScope !== undefined &&
    (action.kind !== "translate" ||
      !["body", "all"].includes(action.translationScope))
  )
    throw new ModelError("invalidAction");
}

export const UI_CONTEXT_LIMITS = { sourceChars: 100, fieldChars: 160 };
export function needsUiContext(text: string): boolean {
  return (
    text.trim().length <= UI_CONTEXT_LIMITS.sourceChars &&
    !/[.!?。！？]$/.test(text.trim())
  );
}

// Numeric formatting may contain punctuation, spaces or currency/math symbols.
// Letters and combining marks keep mixed prose, model names and written units.
export function isNumericOnly(text: string): boolean {
  return /\p{N}/u.test(text) && /^[\p{N}\p{P}\p{S}\s]+$/u.test(text);
}

export function hasSameLanguages(
  action?: Partial<ProcessingAction>,
  locale?: Locale,
): boolean {
  const target = locale
    ? resolveOutputLanguage(action?.targetLanguage, locale)
    : action?.targetLanguage;
  return Boolean(
    action?.kind === "translate" &&
    action.sourceLanguage &&
    action.sourceLanguage !== "auto" &&
    action.sourceLanguage.toLowerCase() === target?.toLowerCase(),
  );
}
