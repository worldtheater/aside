import type { Preferences } from "./types.js";

type ThemePreference = Pick<Preferences, "theme" | "palette">;
const key = "pagework-theme";

export function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.palette = preference.palette;
  document.documentElement.dataset.theme =
    preference.theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference.theme;
}

// Only a first-paint snapshot; chrome.storage remains the settings source of truth.
export function rememberTheme({ theme, palette }: ThemePreference) {
  try {
    localStorage.setItem(key, JSON.stringify({ theme, palette }));
  } catch {
    // Unavailable browser storage must not prevent the interface from opening.
  }
}

export function restoreTheme() {
  let preference: ThemePreference = { theme: "system", palette: "graphite" };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (
      saved &&
      ["system", "light", "dark"].includes(saved.theme) &&
      typeof saved.palette === "string"
    )
      preference = saved;
  } catch {
    // A missing or unreadable snapshot is rebuilt when settings arrive.
  }
  applyTheme(preference);
}

// Named presets adapt to the result surface; custom hex colors stay exact.
export const resultColorPresets = [
  { id: "preset:green", light: "#28755b", dark: "#9bc9b0" },
  { id: "preset:graphite", light: "#303b37", dark: "#b6bdc8" },
  { id: "preset:indigo", light: "#596da5", dark: "#a9bce8" },
  { id: "preset:brown", light: "#956942", dark: "#d5b98a" },
];

export function resultColor(color: string, theme: string | undefined) {
  if (color === "auto") return "var(--ink)";
  if (color === "theme") return "var(--result-accent)";
  const preset = resultColorPresets.find((preset) => preset.id === color);
  return preset ? preset[theme === "dark" ? "dark" : "light"] : color;
}
