// Interface locales, native menu labels, and their corresponding output languages.
export const LOCALES = {
  en: { name: "English", short: "EN", output: "en" },
  "zh-CN": { name: "简体中文", short: "简", output: "zh-Hans" },
  "zh-TW": { name: "繁體中文", short: "繁", output: "zh-Hant" },
  ja: { name: "日本語", short: "JA", output: "ja" },
  ko: { name: "한국어", short: "KO", output: "ko" },
  fr: { name: "Français", short: "FR", output: "fr" },
  de: { name: "Deutsch", short: "DE", output: "de" },
  es: { name: "Español", short: "ES", output: "es" },
  "pt-BR": { name: "Português (Brasil)", short: "PT", output: "pt-BR" },
  ru: { name: "Русский", short: "RU", output: "ru" },
  id: { name: "Bahasa Indonesia", short: "ID", output: "id" },
  it: { name: "Italiano", short: "IT", output: "it" },
  tr: { name: "Türkçe", short: "TR", output: "tr" },
  th: { name: "ไทย", short: "TH", output: "th" },
  vi: { name: "Tiếng Việt", short: "VI", output: "vi" },
} as const;
export type Locale = keyof typeof LOCALES;
export type LocalePreference = Locale | "system";

export function resolveLocale(
  preference: LocalePreference,
  browserLanguage = navigator.language,
): Locale {
  if (preference !== "system") return preference;
  const [language, ...subtags] = browserLanguage.toLowerCase().split("-");
  if (language === "zh") {
    if (subtags.includes("hans")) return "zh-CN";
    return subtags.some((tag) => ["hant", "tw", "hk", "mo"].includes(tag))
      ? "zh-TW"
      : "zh-CN";
  }
  return (
    (Object.keys(LOCALES) as Locale[]).find(
      (locale) => locale.split("-")[0] === language,
    ) || "en"
  );
}

// Shared English names for output-language menus and model instructions.
export const LANGUAGE_NAMES = {
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  ar: "Arabic",
  ru: "Russian",
  "pt-BR": "Portuguese (Brazil)",
  id: "Indonesian",
  it: "Italian",
  tr: "Turkish",
  th: "Thai",
  vi: "Vietnamese",
};
