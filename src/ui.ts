import { escapeHtml as e } from "./html.js";

const paths: Record<string, string> = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  github:
    '<path d="M9 19c-4.3 1.3-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.4 6.4-1.5 6.4-7A5.4 5.4 0 0 0 19 4.8a5.1 5.1 0 0 0-.1-3.8S17.7.7 15 2.5a13.4 13.4 0 0 0-7 0C5.3.7 4.1 1 4.1 1A5.1 5.1 0 0 0 4 4.8a5.4 5.4 0 0 0-1.5 3.8c0 5.4 3.3 6.6 6.4 7a3.4 3.4 0 0 0-.9 2.6V22"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  bookmark: '<path d="M8 3h8a2 2 0 0 1 2 2v16l-6-4-6 4V5a2 2 0 0 1 2-2Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z"/>',
  system:
    '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  swap: '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
  book: '<path d="M4 3h7a3 3 0 0 1 3 3v15a4 4 0 0 0-4-2H4Zm10 3a3 3 0 0 1 3-3h3v16h-3a4 4 0 0 0-3 2"/>',
  page: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
  spark:
    '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z"/>',
  translate:
    '<path d="M3 5h11M8 3v2m-3 3c1 4 4 6 8 8M12 5c0 5-4 9-9 11m11 5 4-11 4 11m-7-3h6"/>',
  explain:
    '<path d="M21 14a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3ZM7 8h10M7 12h6"/>',
  up: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  down: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  question:
    '<path d="M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  palette:
    '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="8" r=".7"/><circle cx="15" cy="7" r=".7"/><circle cx="6" cy="14" r=".7"/><path d="M19 18c-7 3-9-1-6-4s8-1 7-7"/>',
  plug: '<path d="M9 3v5m6-5v5M6 8h12v3a6 6 0 0 1-12 0Zm6 9v4"/>',
  window:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18m-14-2h.01M10 7h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14m8-14v14"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 14h10l1-14M10 10v6m4-6v6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  select: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  pin: '<path d="m16 3 5 5-4 3-.5 4.5-2 2-8-8 2-2L13 7l3-4ZM10.5 13.5 4 20"/>',
  expand: '<path d="m9 5 7 7-7 7"/>',
  collapse: '<path d="m15 5-7 7 7 7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8"/>',
  settings: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.4 6M20 4v7h-7"/>',
};
export const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
export const button = (
  label: string,
  op: string,
  klass = "",
  glyph = "",
  attrs = "",
) =>
  `<button type="button" class="btn ${klass}" data-op="${op}" ${attrs}>${glyph ? icon(glyph) : ""}${e(label)}</button>`;
export const iconButton = (
  label: string,
  op: string,
  glyph: string,
  attrs = "",
  showTooltip = true,
) =>
  `<button type="button" class="btn icon ghost" data-op="${op}" aria-label="${e(label)}" ${showTooltip ? `data-tooltip="${e(label)}"` : ""} ${attrs}>${icon(glyph)}</button>`;

export function heading(title: unknown, intro: unknown, controls = "") {
  return `<div class="page-heading"><div><h1>${e(title)}</h1>${intro ? `<p>${e(intro)}</p>` : ""}</div>${controls}</div>`;
}

export const selected = (a: unknown, b: unknown) =>
  a === b ? " selected" : "";
