import type { Action, Locale, LocalePreference } from "./types.js";
import { resolveLocale } from "./locale.js";
import en from "./locales/en.js";
import zh from "./locales/zh-CN.js";
import zhTW from "./locales/zh-TW.js";
import ja from "./locales/ja.js";
import ko from "./locales/ko.js";
import fr from "./locales/fr.js";
import de from "./locales/de.js";
import es from "./locales/es.js";
import ptBR from "./locales/pt-BR.js";
import ru from "./locales/ru.js";
import id from "./locales/id.js";
import it from "./locales/it.js";
import tr from "./locales/tr.js";
import th from "./locales/th.js";
import vi from "./locales/vi.js";
import type { Copy } from "./locales/en.js";
export type { Copy } from "./locales/en.js";

export const messages: Record<Locale, Copy> = {
  en,
  "zh-CN": zh,
  "zh-TW": zhTW,
  ja,
  ko,
  fr,
  de,
  es,
  "pt-BR": ptBR,
  ru,
  id,
  it,
  tr,
  th,
  vi,
};

// Model, output-language and display settings do not customize a preset's text.
export function usesPresetDefaults(action: Action, language: Locale): boolean {
  if (action.kind === "custom" || action.id !== action.kind) return false;
  const preset = messages[language].presets[action.kind];
  return (
    action.name.trim() === preset.name &&
    action.instruction.trim() === preset.instruction
  );
}

const formerPlainNames = [
  "古文转白话",
  "Classical to modern Chinese",
  "Classical Chinese gloss",
];

// Editing a preset's behavior does not turn its default display copy into a
// user-authored name. Custom actions and renamed presets keep their own copy.
export function localizeAction(action: Action, language: Locale): Action {
  const kind = action.kind;
  if (kind === "explain") action = { ...action, icon: "explain" };
  if (kind === "custom") return action;
  const preset = messages[language].presets[kind];
  if (action.builtin) return { ...action, ...preset };
  if (action.id !== kind) return action;
  const defaults = Object.values(messages).map((copy) => copy.presets[kind]);
  return {
    ...action,
    ...(defaults.some((copy) => copy.name === action.name) ||
    (kind === "plain" && formerPlainNames.includes(action.name))
      ? { name: preset.name }
      : {}),
    ...(defaults.some((copy) => copy.description === action.description)
      ? { description: preset.description }
      : {}),
  };
}

// Collection records store the action's display name at the time of saving.
export function localizeActionName(name: string, language: Locale): string {
  if (formerPlainNames.includes(name))
    return messages[language].presets.plain.name;
  for (const kind of Object.keys(
    messages.en.presets,
  ) as (keyof typeof messages.en.presets)[]) {
    if (
      Object.values(messages).some((copy) => copy.presets[kind].name === name)
    )
      return messages[language].presets[kind].name;
  }
  return name;
}

export let locale: Locale = "en";
export let C: Copy = en;
export function setLocale(preference: LocalePreference) {
  locale = resolveLocale(preference);
  C = messages[locale];
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    document.title = C.brand;
  }
}
