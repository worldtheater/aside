import links from "../website/links.json";
import languages from "../website/languages.json";
import { messages } from "./copy.js";
import type { Locale } from "./locale.js";

export function productHomepage(locale: Locale): string {
  const path = languages.find((language) => language.code === locale)!.path;
  return new URL(path ? `${path}/` : "", links.homepage).href;
}

export function productShareText(locale: Locale): string {
  return `${messages[locale].share.text}\n\n${productHomepage(locale)}`;
}
