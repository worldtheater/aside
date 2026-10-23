import { escapeHtml as e } from "./html.js";
import {
  DAILY_PROMPT,
  hasOutputLanguage,
  DEFAULT_OUTPUT_LENGTH,
} from "./prompts.js";
import {
  MAX_ACTIONS,
  actionLimitError,
  isPresetAction,
} from "./action-policy.js";
import { SelectionTools, selectionResultMarkup } from "./selection-tools.js";
import { providerIcon } from "./provider-icons.js";
import { renderMarkdown } from "./result-content.js";
import {
  applyTheme as applyPageTheme,
  rememberTheme,
  resultColor,
  resultColorPresets,
} from "./theme.js";
import { DEFAULT_PROCESSING, processingPolicy } from "./processor.js";
import type {
  Action,
  Settings,
  Snapshot,
  ProcessJob,
  ProcessResult,
  Daily,
  ConnectionDraft,
  UsageRecord,
  AppearanceTarget,
  LocalePreference,
  Protocol,
  CollectionItem,
  CacheInfo,
  ActionMode,
  Preferences,
  ReasoningEffort,
} from "./types.js";
import {
  C,
  locale,
  setLocale,
  localizeAction,
  localizeActionName,
  usesPresetDefaults,
} from "./copy.js";
import {
  enhanceSelects,
  syncSelects,
  showMenu,
  closeMenu,
} from "./controls.js";
import { getPresets, sample, defaultAppearance } from "./data.js";
import { request, processRequest } from "./client.js";
import {
  modelsEndpoint,
  reasoningLevels,
  reasoningBody,
  ModelError,
  modelError,
  protocolDefaults,
  connectionPurpose,
  defaultConnectionKey,
  DECISION_MODELS_ENABLED,
} from "./providers.js";
import {
  filterUsage,
  summarizeUsage,
  usageByDay,
  usageState,
  usageModelKey,
} from "./usage.js";

const [data, initialCommands] = await Promise.all([
  request("snapshot"),
  chrome.commands.getAll(),
]);
let commandBindings = initialCommands;
rememberTheme(data.preferences);
setLocale(data.preferences.locale);
let presets = getPresets();
let persisted: Snapshot = structuredClone(data);
let activeTrial: ProcessJob | null = null,
  dailyJob: ProcessJob | null = null;
let cacheInfo: CacheInfo | null = null;
const usageView = {
  records: [] as UsageRecord[],
  loaded: false,
  error: "",
  period: "all",
  model: "all",
  limit: 50,
};
const newConnection = (): ConnectionDraft => ({
  id: null,
  name: "",
  url: protocolDefaults.responses,
  model: "",
  protocol: "responses",
  openaiCache: "explicit",
  connected: false,
  maxTokens: 8192,
  key: "",
  processing: { ...DEFAULT_PROCESSING },
});
const errorText = (caught: unknown) => {
  const error = modelError(caught);
  const label =
    C.real.errors[
      error.code as keyof typeof C.real.errors
    ] ||
    error.message ||
    C.real.failed;
  return error.message !== error.code ? `${label}\n${error.message}` : label;
};
const themeMedia = matchMedia("(prefers-color-scheme: dark)");
const app = document.querySelector<HTMLElement>("#app")!;
const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
const toastNode = document.querySelector<HTMLElement>("#toast")!;
interface AppState {
  route: string;
  collectionQuery: string;
  collectionSearchOpen: boolean;
  editor: Action | null;
  initialDraft: string;
  appearanceTarget: AppearanceTarget;
  trial: {
    text: string;
    result: ProcessResult | null;
    busy: boolean;
    stale: boolean;
  };
}
const defaultTrialText = sample.paragraphs.join("\n\n");
const state: AppState = {
  route: "home",
  collectionQuery: "",
  collectionSearchOpen: false,
  editor: null,
  initialDraft: "",
  appearanceTarget: "page",
  trial: {
    text: defaultTrialText,
    result: null,
    busy: false,
    stale: false,
  },
};
let toastTimer: number | undefined,
  dialogTimer: number | undefined,
  pendingNavigation: (() => void) | undefined,
  pendingDelete: string | undefined;
let connectionDraft: ConnectionDraft = structuredClone(
  data.connections[0] || newConnection(),
);
let initialConnectionDraft = JSON.stringify(connectionDraft);
let connectionTest: object | null = null;
let maxHistoryIndex = 0;
let dailyDraft: Daily,
  dailyPreview: { text: string; success: boolean } | null,
  openCollectionId: string;
const routeNames = [
  "home",
  "actions",
  "editor",
  "appearance",
  "connections",
  "shortcuts",
  "usage",
];
const initialRoute = location.hash.slice(1);
state.route =
  routeNames.includes(initialRoute) && initialRoute !== "editor"
    ? initialRoute
    : "home";
history.replaceState({ route: state.route, index: 0 }, "", `#${state.route}`);

const paths: Record<string, string> = {
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
  explain: '<path d="M21 14a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3ZM7 8h10M7 12h6"/>',
  up: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  down: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  question: '<path d="M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
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
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8"/>',
  settings: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.4 6M20 4v7h-7"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
const button = (
  label: string,
  op: string,
  klass = "",
  glyph = "",
  attrs = "",
) =>
  `<button type="button" class="btn ${klass}" data-op="${op}" ${attrs}>${glyph ? icon(glyph) : ""}${e(label)}</button>`;
const iconButton = (
  label: string,
  op: string,
  glyph: string,
  attrs = "",
  showTooltip = true,
) =>
  `<button type="button" class="btn icon ghost" data-op="${op}" aria-label="${e(label)}" ${showTooltip ? `data-tooltip="${e(label)}"` : ""} ${attrs}>${icon(glyph)}</button>`;
const connection = (id: string | null | undefined) => {
  const c = data.connections.find(
    (c) => c.id === (id === "default" ? data.defaultConnection : id),
  );
  return (
    c || {
      id: null,
      name: C.real.noConnection,
      model: C.real.noConnection,
      connected: false,
    }
  );
};
const defaultModel = () => connection(data.defaultConnection).model;
function resolveAction(a: Action): Action;
function resolveAction(a: Action | null | undefined): Action | null;
function resolveAction(a: Action | null | undefined): Action | null {
  return a ? localizeAction(a, locale) : null;
}
const actionById = (id: string | null | undefined) =>
  resolveAction(data.actions.find((a) => a.id === id));
const splitText = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
const selected = (a: unknown, b: unknown) => (a === b ? " selected" : "");
const checked = (value: unknown) => (value ? " checked" : "");
async function persist() {
  const patch: Partial<Settings> = {};
  for (const key of [
    "actions",
    "appearance",
    "customColors",
    "preferences",
    "defaultConnection",
    "defaultDecisionConnection",
  ] as const)
    if (JSON.stringify(data[key]) !== JSON.stringify(persisted[key]))
      Object.assign(patch, { [key]: structuredClone(data[key]) });
  if (!Object.keys(patch).length) return true;
  try {
    await request("settings.save", { patch });
    Object.assign(persisted, patch);
    return true;
  } catch (caught) {
    const error = modelError(caught);
    notify(errorText(error), "error");
    return false;
  }
}
async function reloadData() {
  const fresh = await request("snapshot");
  Object.assign(data, fresh);
  persisted = structuredClone(data);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.collection) {
    data.collection = changes.collection.newValue as CollectionItem[];
    if (state.route === "home") render();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !usageView.loaded) return;
  const entries = Object.entries(changes).filter(([key]) =>
    key.startsWith("usage:"),
  );
  if (!entries.length) return;
  for (const [key, change] of entries) {
    usageView.records = usageView.records.filter(
      (record) => "usage:" + record.id !== key,
    );
    if (change.newValue) usageView.records.push(change.newValue as UsageRecord);
  }
  usageView.records.sort((a, b) => b.startedAt - a.startedAt);
  if (state.route === "usage") render();
});

function dismissNotice() {
  clearTimeout(toastTimer);
  if (toastNode.matches(":popover-open")) toastNode.hidePopover();
  toastNode.hidden = true;
  toastNode.setAttribute("popover", "manual");
  document.body.append(toastNode);
}
function notify(message: string, kind: "success" | "error" = "success") {
  dismissNotice();
  // A modal makes its outside DOM inert, so feedback belongs to that modal.
  (dialog.open ? dialog : document.body).append(toastNode);
  toastNode.dataset.kind = kind;
  toastNode.setAttribute("role", kind === "error" ? "alert" : "status");
  toastNode.setAttribute(
    "aria-live",
    kind === "error" ? "assertive" : "polite",
  );
  toastNode.innerHTML = `${icon(kind === "error" ? "warning" : "check")}<span>${e(message)}</span>${kind === "error" ? iconButton(C.close, "dismiss-notice", "close", "", false) : ""}`;
  if (dialog.open) toastNode.removeAttribute("popover");
  toastNode.hidden = false;
  if (!dialog.open) toastNode.showPopover();
  if (kind === "success") toastTimer = setTimeout(dismissNotice, 3000);
}

function stopJob() {
  activeTrial?.cancel();
  activeTrial = null;
  state.trial.busy = false;
}
function dirty() {
  return state.editor && JSON.stringify(state.editor) !== state.initialDraft;
}
function navigate(route: string) {
  dismissNotice();
  stopJob();
  closeMenu();
  if (route !== state.route) {
    const index = (history.state?.index || 0) + 1;
    maxHistoryIndex = index;
    history.pushState({ route, index }, "", `#${route}`);
  }
  state.route = route;
  if (route === "usage" && usageView.loaded) void loadUsage();
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", (event) => {
  dismissNotice();
  stopJob();
  state.route = routeNames.includes(event.state?.route)
    ? event.state.route
    : "home";
  if (state.route === "editor" && !state.editor) state.route = "actions";
  if (state.route !== event.state?.route)
    history.replaceState(
      { route: state.route, index: event.state?.index || 0 },
      "",
      `#${state.route}`,
    );
  render();
  window.scrollTo(0, 0);
});
function confirmDiscard(callback: () => void) {
  pendingNavigation = callback;
  showDialog(
    `<h2>${C.discardTitle}</h2><p>${C.discardText}</p><div class="dialog-actions">${button(C.keepEditing, "dialog-close")}${button(C.discard, "discard", "danger")}</div>`,
  );
}
function showDialog(content: string, { wide = false, showClose = true } = {}) {
  dismissNotice();
  closeMenu();
  clearTimeout(dialogTimer);
  if (dialog.open) dialog.close();
  dialog.className = `dialog${wide ? " wide" : ""}`;
  dialog.innerHTML = `${showClose ? iconButton(C.cancel, "dialog-close", "close", "", false) : ""}${content}`;
  if (showClose)
    dialog.querySelector<HTMLButtonElement>("button")!.classList.add("dialog-close");
  dialog.showModal();
  dialog.getBoundingClientRect();
  requestAnimationFrame(() => dialog.classList.add("is-visible"));
  enhanceSelects(dialog);
}
function closeDialog(callback?: () => void) {
  dismissNotice();
  if (dialog.querySelector<HTMLTextAreaElement>("#daily-prompt")!) {
    dailyJob?.cancel();
    dailyJob = null;
  }
  closeMenu();
  clearTimeout(dialogTimer);
  dialog.classList.remove("is-visible");
  const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : 180;
  dialogTimer = setTimeout(() => {
    dialog.close();
    callback?.();
  }, duration);
}
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
dialog.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (
    event.clientX < r.left ||
    event.clientX > r.right ||
    event.clientY < r.top ||
    event.clientY > r.bottom
  )
    closeDialog();
});
function applyTheme() {
  applyPageTheme(data.preferences);
}
themeMedia.addEventListener("change", () => {
  if (data.preferences.theme === "system") {
    applyTheme();
    if (state.route === "appearance") renderStylePreview();
  }
});
function changeLocale(preference: LocalePreference) {
  const pristine = state.editor && !dirty();
  data.preferences.locale = preference;
  setLocale(preference);
  presets = getPresets();
  if (pristine) {
    state.editor = resolveAction(state.editor);
    state.initialDraft = JSON.stringify(state.editor);
    state.trial.stale = Boolean(state.trial.result);
  }
  persist();
  render();
}
function renderPreferences() {
  return `<div class="preference-controls">
    <div class="language-control">
    <select id="ui-locale" class="compact-locale" aria-label="${C.uiLanguage}">${Object.entries(
      C.locales,
    )
      .map(
        ([key, label]) =>
          `<option value="${key}"${selected(data.preferences.locale, key)}>${label}</option>`,
      )
      .join("")}</select>
    <span class="language-label" aria-hidden="true"><span class="${locale === "zh-CN" ? "active" : ""}">${C.languageShort["zh-CN"]}</span><span>/</span><span class="${locale === "en" ? "active" : ""}">${C.languageShort.en}</span></span></div>
    ${iconButton(C.uiTheme, "theme-menu", "palette", 'aria-haspopup="true"', false)}
  </div>`;
}
function renderSidebar() {
  const route = state.route === "editor" ? "actions" : state.route;
  const link = (name: keyof typeof C.nav, glyph: string) =>
    `<button class="sidebar-link" data-route="${name}" ${name === "home" ? 'data-op="home"' : ""} ${route === name ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${C.nav[name]}</span></button>`;
  return `<aside class="sidebar" id="sidebar" aria-label="${C.pageMenu}"><div class="sidebar-brand"><img src="icons/icon-32.png" alt="" width="28" height="28"><strong>${C.brand}</strong>${iconButton(C.closeNavigation, "navigation-close", "close", "", false)}</div>
    <nav><div class="sidebar-group"><h2>${C.contentGroup}</h2>${link("home", "bookmark")}</div><div class="sidebar-group"><h2>${C.settings}</h2>${link("actions", "spark")}${link("appearance", "palette")}${link("connections", "plug")}${link("shortcuts", "keyboard")}${link("usage", "list")}</div></nav></aside>
    <button class="sidebar-backdrop" data-op="navigation-close" aria-label="${C.closeNavigation}" tabindex="-1"></button>`;
}
const narrowNavigation = matchMedia("(max-width: 860px)");
function setNavigationOpen(open: boolean) {
  app.querySelector(".app-shell")?.classList.toggle("navigation-open", open);
  const sidebar = app.querySelector<HTMLElement>(".sidebar");
  const main = app.querySelector<HTMLElement>(".main");
  if (sidebar) sidebar.inert = narrowNavigation.matches && !open;
  if (main) main.inert = narrowNavigation.matches && open;
  app
    .querySelector("[data-op=navigation-open]")
    ?.setAttribute("aria-expanded", String(open));
}
narrowNavigation.addEventListener("change", () => setNavigationOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (event.target as HTMLElement).closest(".collection-search")) {
    event.preventDefault();
    setCollectionSearchOpen(false);
    return;
  }
  if (!app.querySelector(".navigation-open") || !narrowNavigation.matches)
    return;
  if (event.key === "Escape") {
    setNavigationOpen(false);
    app.querySelector<HTMLElement>("[data-op=navigation-open]")?.focus();
  } else if (event.key === "Tab") {
    const buttons = app.querySelectorAll<HTMLButtonElement>(".sidebar button");
    const first = buttons[0],
      last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
function showThemeMenu(trigger: HTMLElement) {
  showMenu(
    trigger,
    `<div class="theme-menu"><div class="menu-label">${C.colorMode}</div><div class="theme-modes">${Object.entries(
      C.themes,
    )
      .map(
        ([key, label]) =>
          `<button data-op="theme-mode" data-value="${key}" aria-pressed="${data.preferences.theme === key}">${icon({ light: "sun", dark: "moon", system: "system" }[key as "light" | "dark" | "system"])}<span>${label}</span></button>`,
      )
      .join(
        "",
      )}</div><div class="menu-label">${C.colorPalette}</div><div class="palette-options">${Object.entries(
      C.palettes,
    )
      .map(
        ([key, label]) =>
          `<button class="menu-row" data-op="theme-palette" data-value="${key}" aria-pressed="${data.preferences.palette === key}"><span class="palette-preview palette-${key}" aria-hidden="true"><i></i><i></i><i></i></span><span>${label}</span>${data.preferences.palette === key ? icon("check") : ""}</button>`,
      )
      .join("")}</div></div>`,
    C.uiTheme,
  );
}
function render() {
  closeMenu();
  applyTheme();
  const route = state.route === "editor" ? "actions" : state.route;
  app.innerHTML = `<div class="app-shell">${renderSidebar()}<main class="main"><header class="topbar"><div class="topbar-navigation">${iconButton(C.pageMenu, "navigation-open", "menu", 'aria-controls="sidebar" aria-expanded="false"')}<nav class="history-controls" aria-label="${C.pageMenu}">${iconButton(C.previous, "history-back", "back", history.state.index === 0 ? "disabled" : "", false)}${iconButton(C.forward, "history-forward", "arrow", history.state.index >= maxHistoryIndex ? "disabled" : "", false)}</nav></div>${renderPreferences()}</header>
    <div class="workspace ${route === "home" ? "home-workspace" : ""}">${state.route === "home" ? renderHome() : state.route === "editor" ? renderEditor() : route === "actions" ? renderLibrary() : route === "appearance" ? renderAppearance() : route === "connections" ? renderConnections() : route === "usage" ? renderUsage() : route === "shortcuts" ? renderShortcuts() : renderHome()}</div></main></div>`;
  setNavigationOpen(false);
  if (state.route === "editor") renderTrialResult();
  if (state.route === "appearance") renderStylePreview();
  enhanceSelects(app);
  if (state.route === "usage") mountUsageChart();
}
function heading(title: unknown, intro: unknown, controls = "") {
  return `<div class="page-heading"><div><h1>${e(title)}</h1><p>${e(intro)}</p></div>${controls}</div>`;
}
async function loadUsage() {
  usageView.loaded = true;
  usageView.error = "";
  try {
    [usageView.records, cacheInfo] = await Promise.all([
      request("usage.list"),
      request("cache.stats"),
    ]);
  } catch (caught) {
    const error = modelError(caught);
    usageView.error = errorText(error);
  }
  if (state.route === "usage") render();
}
function renderUsage() {
  if (!usageView.loaded) queueMicrotask(loadUsage);
  const U = C.usage,
    models = new Map(
      usageView.records.map((r) => [
        usageModelKey(r),
        `${r.connectionName} · ${r.model}`,
      ]),
    );
  if (usageView.model !== "all" && !models.has(usageView.model))
    usageView.model = "all";
  const records = filterUsage(usageView.records, usageView),
    summary = summarizeUsage(records),
    number = (value: number | null | undefined) =>
      value === null || value === undefined
        ? "—"
        : new Intl.NumberFormat(locale).format(value);
  const fields = [
    "inputTokens",
    "outputTokens",
    "cachedTokens",
    "cacheWriteTokens",
    "reasoningTokens",
    "totalTokens",
  ] as const;
  const time = new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${heading(U.title, U.intro, button(U.clear, "usage-clear-ask", "ghost danger", "", usageView.records.length ? "" : "disabled"))}
    <div class="usage-filters"><div class="toolbar-field"><label for="usage-period">${U.period}</label><select id="usage-period">${Object.entries(
      U.periods,
    )
      .map(
        ([value, label]) =>
          `<option value="${value}"${selected(usageView.period, value)}>${label}</option>`,
      )
      .join(
        "",
      )}</select></div><div class="toolbar-field"><label for="usage-model">${U.model}</label><select id="usage-model"><option value="all">${U.allModels}</option>${[...models].map(([value, label]) => `<option value="${e(value)}"${selected(usageView.model, value)}>${e(label)}</option>`).join("")}</select></div></div>
    <div class="usage-summary">${fields.map((field) => `<section class="usage-metric"><span>${U[field]}</span><strong data-usage-total="${field}">${number(summary[field])}</strong><small>${field === "cachedTokens" || field === "cacheWriteTokens" ? U.withinInput : U.tokens}</small></section>`).join("")}</div>
    ${renderUsageChart(records)}
    <div class="usage-record-heading"><h2>${U.records}</h2><span class="small muted" id="usage-coverage">${U.coverage(summary)}</span></div>
    <p class="usage-note small muted">${U.note}</p>
    ${usageView.error ? `<p class="usage-note" role="alert">${e(usageView.error)}</p>${button(C.real.retry, "usage-reload")}` : ""}
    ${
      records.length
        ? `<div class="usage-table-wrap"><table class="usage-table"><thead><tr><th>${U.time}</th><th>${U.source}</th><th>${U.model}</th><th>${U.status}</th>${fields.map((field) => `<th class="numeric">${U[field]}</th>`).join("")}</tr></thead><tbody>${records
            .slice(0, usageView.limit)
            .map(
              (record) =>
                `<tr data-usage-id="${record.id}"><td class="usage-time">${time.format(new Date(record.startedAt))}</td><td>${U.sources[record.source] || U.sources.processing}<small>${e(record.actionName)}</small></td><td class="usage-model-cell"><strong>${e(record.model)}</strong><small>${e(record.connectionName)}</small></td><td><span class="badge ${record.status === "success" ? "neutral" : "usage-warning"}" ${record.errorCode ? `data-tooltip="${e(C.real.errors[record.errorCode as keyof typeof C.real.errors] || record.errorCode)}"` : ""}>${U.statuses[record.status]}</span><small>${U.reporting[usageState(record)]}</small></td>${fields.map((field) => `<td class="numeric" data-token="${field}" ${record.tokens?.[field] === null || record.tokens?.[field] === undefined ? `aria-label="${e(U.unreported)}"` : ""}>${number(record.tokens?.[field])}</td>`).join("")}</tr>`,
            )
            .join(
              "",
            )}</tbody></table></div>${records.length > usageView.limit ? `<div class="usage-more">${button(U.more, "usage-more")}</div>` : ""}`
        : `<div class="collection-empty">${icon("list")}<h3>${U.empty}</h3><p>${U.emptyHint}</p></div>`
    }
    <section class="local-cache"><div class="row spread"><h2>${U.localCache}</h2><div class="row">${button(U.cacheReload, "cache-reload", "ghost")}${button(U.cacheClear, "cache-clear-ask", "ghost danger")}</div></div><p id="cache-info">${cacheInfo ? U.cacheInfo(cacheInfo.entries, (cacheInfo.bytes / 1048576).toFixed(2), cacheInfo.maxBytes / 1048576) : "—"}</p><p class="small muted">${U.cacheNote}</p></section>`;
}
function renderUsageChart(records: UsageRecord[]) {
  const U = C.usage;
  const days = usageByDay(records, usageView.period);
  const header = `<div class="usage-chart-heading"><h2 id="usage-chart-title">${U.dailyUsage}</h2><span>${U.tokens}</span></div>`;
  if (!days.length)
    return `<section class="usage-chart" aria-labelledby="usage-chart-title">${header}<p class="usage-chart-empty">${U.chartEmpty}</p></section>`;
  const number = new Intl.NumberFormat(locale);
  const compact = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const tick = new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
  });
  const highest = days.reduce(
    (max, day) => Math.max(max, day.totalTokens ?? 0),
    2,
  );
  const step = 10 ** Math.floor(Math.log10(highest));
  const scale =
    highest < 10
      ? Math.ceil(highest / 2) * 2
      : Math.ceil(highest / step) * step;
  const labelStep = Math.min(7, Math.max(1, Math.ceil(days.length / 8)));
  const detail = (day: (typeof days)[number]) =>
    `${U.chartDay(date.format(day.date), day.totalTokens === null ? U.chartMissing : U.chartValue(number.format(day.totalTokens)), number.format(day.calls))}${day.incomplete && day.totalTokens !== null ? " · " + U.chartPartial : ""}`;
  return `<section class="usage-chart" id="usage-chart" aria-labelledby="usage-chart-title">${header}
    <div class="usage-chart-tip" id="usage-chart-tip" role="tooltip" aria-hidden="true"></div>
    <div class="usage-chart-body"><div class="usage-chart-axis" aria-hidden="true"><span>${compact.format(scale)}</span><span>${compact.format(scale / 2)}</span><span>0</span></div>
    <div class="usage-chart-scroll"><div class="usage-chart-plot" style="--days:${days.length}"><div class="usage-chart-grid" aria-hidden="true"></div>${days.map((day, index) => `<button type="button" class="usage-chart-day" data-usage-day="${day.date}" data-usage-detail="${e(detail(day))}" aria-label="${e(detail(day))}"><span class="usage-chart-column" aria-hidden="true">${day.totalTokens === null ? '<span class="usage-chart-missing">—</span>' : `<span class="usage-chart-bar${day.totalTokens === 0 ? " usage-chart-zero" : ""}" style="height:${(day.totalTokens / scale) * 100}%"></span>`}</span><span class="usage-chart-date" aria-hidden="true">${index === days.length - 1 || (index % labelStep === 0 && days.length - 1 - index >= labelStep) ? tick.format(day.date) : ""}</span></button>`).join("")}</div></div></div></section>`;
}
function mountUsageChart() {
  const chart = document.querySelector<HTMLElement>("#usage-chart");
  const tip = chart?.querySelector<HTMLElement>("#usage-chart-tip");
  if (!chart || !tip) return;
  const scroll = chart.querySelector<HTMLElement>(".usage-chart-scroll")!;
  scroll.scrollLeft = scroll.scrollWidth;
  let activeDay: HTMLElement | null = null;
  const hide = () => {
    activeDay = null;
    tip.classList.remove("visible");
    tip.setAttribute("aria-hidden", "true");
  };
  const position = () => {
    if (!activeDay) return;
    const bar = activeDay.querySelector<HTMLElement>(
      ".usage-chart-column > span",
    )!;
    const anchor = bar.getBoundingClientRect();
    const viewport = scroll.getBoundingClientRect();
    if (anchor.right <= viewport.left || anchor.left >= viewport.right) {
      hide();
      return;
    }
    // Keep the tip outside the scrolling plot so tall and edge bars cannot clip it.
    const bounds = chart.getBoundingClientRect();
    const left = anchor.left + (anchor.width - tip.offsetWidth) / 2;
    tip.style.setProperty("--tip-width", `${tip.offsetWidth}px`);
    tip.style.setProperty(
      "--tip-left",
      `${left - bounds.left - chart.clientLeft}px`,
    );
    const above = anchor.top - tip.offsetHeight - 8;
    const top = above >= 8 ? above : anchor.top + 8;
    tip.style.top = `${top - bounds.top - chart.clientTop}px`;
  };
  const inspect = (event: Event) => {
    const day = (event.target as Element).closest<HTMLElement>(
      "[data-usage-detail]",
    );
    if (!day) return;
    activeDay = day;
    tip.textContent = day.dataset.usageDetail!;
    tip.classList.add("visible");
    tip.setAttribute("aria-hidden", "false");
    position();
  };
  chart.addEventListener("pointerover", inspect);
  chart.addEventListener("focusin", inspect);
  chart.addEventListener("pointerout", (event) => {
    if (!activeDay?.contains(event.relatedTarget as Node | null)) hide();
  });
  chart.addEventListener("focusout", hide);
  chart.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  scroll.addEventListener("scroll", position);
}
function resultContext() {
  const result = state.trial.result,
    action = state.editor;
  if (!result || !action) return null;
  return {
    result,
    action,
    sample: state.trial.text === defaultTrialText ? sample : undefined,
    text: result.parts.map((p) => p.text).join("\n\n"),
    sourceText: result.parts.map((p) => p.source).join("\n\n"),
  };
}
function bookmarkButton() {
  const item = resultContext();
  if (!item) return "";
  const saved = data.collection.some(
    (c) => c.text === item.text && c.sourceText === item.sourceText,
  );
  return iconButton(
    saved ? C.bookmarked : C.bookmark,
    "bookmark",
    saved ? "check" : "bookmark",
    saved || state.trial.stale ? "disabled" : "",
  );
}
async function saveBookmark() {
  const item = resultContext();
  if (!item || state.trial.stale) return;
  if (
    data.collection.some(
      (c) => c.text === item.text && c.sourceText === item.sourceText,
    )
  )
    return;
  await request("collection.add", {
    item: {
      title: item.sample?.title || item.action.name,
      actionName: item.action.name,
      text: item.text,
      sourceText: item.sourceText,
      sourceTitle: item.sample?.title || C.customInput,
      url: "",
    },
  });
  await reloadData();
  render();
  notify(C.bookmarkAdded);
}
function dailyContent(config: Daily) {
  return {
    label: config.result
      ? ""
      : connection(config.model || "default").connected
        ? C.real.dailyReadyHint
        : C.real.dailyConnectionHint,
    text: config.result || C.real.dailyEmpty,
  };
}
async function generateDaily(config: Daily, preview = false) {
  if (dailyJob) return;
  const job = processRequest({
    daily: structuredClone(config),
    saveDaily: !preview,
  });
  dailyJob = job;
  if (preview) {
    dailyPreview = null;
    renderDailyPreview();
  } else {
    data.daily.result = C.real.dailyWorking;
    render();
  }
  try {
    const result = await job.promise;
    if (dailyJob !== job) return;
    if (preview) {
      dailyPreview = {
        text: result.parts[0].text,
        success: true,
      };
    } else {
      await reloadData();
      render();
    }
  } catch (caught) {
    const error = modelError(caught);
    if (dailyJob !== job || error.code === "cancelled") return;
    if (preview) {
      dailyPreview = { text: errorText(error), success: false };
    } else {
      await reloadData();
      render();
      notify(errorText(error), "error");
    }
  } finally {
    if (dailyJob === job) {
      dailyJob = null;
      if (dialog.open && dialog.querySelector("#daily-prompt"))
        renderDailyPreview();
    }
  }
}
function collectionTitle(item: CollectionItem) {
  const text = (item.sourceText || item.text).trim().replace(/\s+/g, " ");
  const sentence =
    new Intl.Segmenter(locale, { granularity: "sentence" })
      .segment(text)
      [Symbol.iterator]()
      .next().value?.segment || text;
  return sentence.length > 160
    ? sentence.slice(0, 160).trimEnd() + "…"
    : sentence.trim();
}
function collectionSource(item: CollectionItem) {
  try {
    const url = new URL(item.url);
    return ["https:", "http:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}
function collectionFavicon(url: URL) {
  const favicon = new URL(chrome.runtime.getURL("/_favicon/"));
  favicon.searchParams.set("pageUrl", url.href);
  favicon.searchParams.set("size", "32");
  return favicon.href;
}
function collectionItems() {
  const query = state.collectionQuery.trim().toLocaleLowerCase(locale);
  return data.collection
    .filter((item) => {
      const source = collectionSource(item)?.hostname || "";
      return [
        item.title,
        item.sourceText,
        item.text,
        item.sourceTitle,
        source,
        item.actionName,
        localizeActionName(item.actionName, locale),
      ].some((text) => text.toLocaleLowerCase(locale).includes(query));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function collectionCount() {
  const count = collectionItems().length;
  return count === data.collection.length
    ? C.home.count(count)
    : C.home.matchedCount(count, data.collection.length);
}
function dailyCard(
  text: string,
  caption: string,
  date: string | null,
  controls = "",
) {
  const dateLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date ? new Date(date + "T12:00:00") : new Date());
  return `<section class="daily-card" aria-label="${C.home.daily}"><div class="daily-topline"><h2>${C.home.daily}</h2><span class="daily-date">${dateLabel}</span>${controls ? `<div class="row daily-controls">${controls}</div>` : ""}</div><p class="daily-thought">${e(text)}</p>${caption ? `<span class="daily-caption">${e(caption)}</span>` : ""}</section>`;
}
function renderShortcutBinding(name: string) {
  const shortcut = commandBindings.find((command) => command.name === name)?.shortcut;
  return shortcut
    ? `<kbd>${e(shortcut)}</kbd>`
    : `<span class="muted">${C.shortcuts.unset}</span>`;
}
function renderShortcuts() {
  return `${heading(C.nav.shortcuts, C.shortcuts.intro, button(C.shortcuts.settings, "shortcut-settings", "", "keyboard"))}
    <p class="shortcut-help">${e(C.shortcuts.help(chrome.runtime.getManifest().name))}</p>
    <section class="shortcut-list" aria-label="${C.nav.shortcuts}">${Object.entries(C.shortcuts.items).map(([name, item]) =>
      `<div class="shortcut-row"><div><h2>${e(item.name)}</h2><p>${e(item.description)}</p></div><span class="shortcut-binding" data-command-binding="${e(name)}" aria-live="polite">${renderShortcutBinding(name)}</span></div>`
    ).join("")}</section>`;
}
async function refreshShortcuts() {
  try {
    commandBindings = await chrome.commands.getAll();
    document.querySelectorAll<HTMLElement>("[data-command-binding]").forEach((binding) => {
      const markup = renderShortcutBinding(binding.dataset.commandBinding!);
      if (binding.innerHTML !== markup) binding.innerHTML = markup;
    });
  } catch (error) {
    console.info("Could not read keyboard shortcuts", error);
  }
}
window.addEventListener("focus", refreshShortcuts);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refreshShortcuts();
});

function renderHome() {
  const thought = dailyContent(data.daily);
  return `${heading(C.home.title, C.home.intro)}${dailyCard(thought.text, thought.label, data.daily.result ? data.daily.date : null, `${iconButton(C.real.dailyGenerate, "daily-refresh", "refresh")}${iconButton(C.home.dailySettings, "daily-settings", "settings")}`)}
    <section class="collection-section" aria-label="${C.home.collectionTitle}"><div class="collection-bar"><div class="row collection-heading"><h2>${C.home.collectionTitle}</h2><span class="collection-count" id="collection-count">${collectionCount()}</span></div><div class="collection-tools"><div class="collection-search${state.collectionSearchOpen ? " is-open" : ""}">${iconButton(state.collectionSearchOpen ? C.home.closeSearch : C.home.search, "collection-search-toggle", "search", `aria-expanded="${state.collectionSearchOpen}" aria-controls="collection-search"`, false)}<input id="collection-search" type="search" aria-label="${C.home.search}" placeholder="${C.home.search}" value="${e(state.collectionQuery)}"${state.collectionSearchOpen ? "" : " disabled"}></div></div></div>
    <div class="collection-grid" id="collection-grid">${renderCollectionCards()}</div></section>`;
}
function setCollectionSearchOpen(open: boolean) {
  state.collectionSearchOpen = open;
  const field = document.querySelector<HTMLInputElement>("#collection-search")!;
  const trigger = document.querySelector<HTMLButtonElement>(
    '[data-op="collection-search-toggle"]',
  )!;
  field.parentElement!.classList.toggle("is-open", open);
  field.disabled = !open;
  trigger.setAttribute("aria-expanded", String(open));
  const label = open ? C.home.closeSearch : C.home.search;
  trigger.setAttribute("aria-label", label);
  if (open) field.focus({ preventScroll: true });
  else {
    state.collectionQuery = field.value = "";
    updateCollectionResults();
    trigger.focus({ preventScroll: true });
  }
}
function renderCollectionCards() {
  const items = collectionItems();
  if (!items.length)
    return `<div class="collection-empty">${icon("bookmark")}<h3>${data.collection.length ? C.home.noMatches : C.home.empty}</h3>${data.collection.length ? button(C.home.clearSearch, "collection-reset", "ghost") : `<p>${C.home.emptyHint}</p>`}</div>`;
  return items
    .map((item) => {
      const source = collectionSource(item);
      const sourceLabel = source?.hostname || C.home.localSource;
      const sourceContent = `${source ? `<img src="${e(collectionFavicon(source))}" alt="" width="16" height="16">` : icon("bookmark")}<span>${e(sourceLabel)}</span>`;
      return `<article class="collection-card"><button class="collection-card-open" data-op="collection-open" data-id="${e(item.id)}"><div class="collection-card-meta"><span>${e(localizeActionName(item.actionName, locale))}</span><time datetime="${e(item.createdAt)}">${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(item.createdAt))}</time></div><h3>${e(collectionTitle(item))}</h3><p>${e(item.text)}</p></button><div class="collection-card-footer">${source ? `<a class="collection-origin" href="${e(source.href)}" target="_blank" rel="noopener noreferrer" aria-label="${e(item.sourceTitle)}">${sourceContent}</a>` : `<span class="collection-origin" aria-label="${e(item.sourceTitle)}">${sourceContent}</span>`}${iconButton(C.home.options, "collection-menu", "more", `data-id="${e(item.id)}" aria-haspopup="true"`)}</div></article>`;
    })
    .join("");
}
function updateCollectionResults() {
  document.querySelector<HTMLElement>("#collection-grid")!.innerHTML =
    renderCollectionCards();
  document.querySelector<HTMLElement>("#collection-count")!.textContent =
    collectionCount();
}
function showCollectionMenu(trigger: HTMLElement) {
  const item = data.collection.find((item) => item.id === trigger.dataset.id);
  if (!item) return;
  openCollectionId = item.id;
  showMenu(
    trigger,
    `<div class="collection-menu">${collectionSource(item) ? button(C.home.openSource, "collection-source-open", "menu-row", "arrow") : ""}${button(C.copy, "collection-copy", "menu-row", "copy")}${button(C.remove, "collection-remove-ask", "menu-row danger", "trash")}</div>`,
    C.home.options,
  );
}
function openCollection(id: string | undefined) {
  if (!id) return;
  openCollectionId = id;
  const item = data.collection.find((c) => c.id === id);
  if (!item) return;
  const source = collectionSource(item);
  showDialog(
    `<div class="collection-dialog-meta">${e(localizeActionName(item.actionName, locale))} · ${C.output}</div><h2>${e(collectionTitle(item))}</h2><div class="collection-detail-body"><div class="collection-detail-text">${e(item.text)}</div><details class="collection-original"><summary>${C.home.original}</summary><p>${e(item.sourceText)}</p></details><p class="collection-source">${C.home.source} · ${source ? `<a href="${e(source.href)}" target="_blank" rel="noopener noreferrer">${e(item.sourceTitle || source.hostname)}</a>` : e(item.sourceTitle)}</p></div><div class="dialog-actions">${button(C.remove, "collection-remove-ask", "danger dialog-delete")}${button(C.copy, "collection-copy", "", "copy")}</div>`,
    { wide: true },
  );
}
function showDailyError(message: string, field: string) {
  const error = dialog.querySelector<HTMLElement>("#daily-error")!;
  error.textContent = message;
  error.hidden = false;
  dialog.querySelector<HTMLElement>(field)!.focus();
}
function openDailySettings() {
  dailyDraft = structuredClone(data.daily);
  if (Object.values(DAILY_PROMPT).includes(dailyDraft.prompt))
    dailyDraft.prompt = C.home.promptDefault;
  dailyPreview = null;
  showDialog(
    `<h2>${C.home.dailySettings}</h2><p>${C.home.promptHelp}</p>
    <div class="daily-settings-grid"><section aria-label="${C.home.saveSettings}">
      <label class="field"><span class="field-label">${C.home.prompt}</span><textarea id="daily-prompt" rows="4">${e(dailyDraft.prompt)}</textarea></label>
      <label class="field"><span class="field-label">${C.model}</span><select id="daily-model" aria-describedby="daily-model-hint">${modelOptions(dailyDraft.model || "default")}</select><span class="field-note" id="daily-model-hint" hidden></span></label>
      ${renderOutputLanguageField(dailyDraft.outputLanguage, 'id="daily-output-language"')}
      <div class="daily-collection"><label class="setting-row"><span>${C.home.useCollection}</span><input type="checkbox" class="switch" id="daily-use-collection"${checked(dailyDraft.useCollection)}></label><p class="field-note">${C.home.useCollectionHint}</p></div>
      <div class="error" id="daily-error" role="alert" hidden></div>
    </section><aside class="daily-preview" aria-label="${C.home.previewTitle}">
      <h3 class="field-label">${C.home.previewTitle}</h3>
      <div class="daily-preview-panel">
        <div id="daily-preview-content" aria-live="polite"></div>
        <div class="daily-preview-actions">${button(C.home.preview, "daily-preview", "", "play")}</div>
      </div>
    </aside></div>
    <div class="daily-settings-footer"><p id="daily-save-hint"></p><div class="dialog-actions">${button(C.cancel, "dialog-close")}${button(C.home.saveSettings, "daily-save", "primary", "check")}</div></div>`,
    { wide: true },
  );
  renderDailyPreview();
}
function invalidateDailyPreview() {
  dailyJob?.cancel();
  dailyJob = null;
  dailyPreview = null;
  renderDailyPreview();
}
function renderDailyPreview() {
  const busy = Boolean(dailyJob),
    success = Boolean(dailyPreview?.success),
    selectedModel = connection(dailyDraft.model || "default"),
    text = busy
      ? C.real.dailyWorking
      : success
        ? dailyPreview!.text
        : C.home.previewEmpty;
  dialog.querySelector<HTMLElement>("#daily-preview-content")!.innerHTML =
    dailyPreview && !success && !busy
      ? `<div class="error" id="daily-preview-error" role="alert">${e(dailyPreview.text)}</div>`
      : `<div class="${success ? "daily-preview-text" : "daily-preview-placeholder"}">${e(text)}</div>`;
  const generate = dialog.querySelector<HTMLButtonElement>(
    "[data-op=daily-preview]",
  )!;
  generate.disabled = busy || !selectedModel.connected;
  generate.setAttribute("aria-busy", String(busy));
  generate.innerHTML = `${icon("play")}${e(busy ? C.real.dailyWorking : C.home.preview)}`;
  const modelHint = dialog.querySelector<HTMLElement>("#daily-model-hint")!;
  modelHint.hidden = selectedModel.connected;
  modelHint.textContent = selectedModel.connected ? "" : C.real.dailyConnectionHint;
  dialog.querySelector<HTMLElement>("#daily-save-hint")!.textContent = success
    ? C.home.savePreviewHint
    : C.home.saveSettingsHint;
  dialog.querySelector<HTMLElement>("[data-op=daily-save]")!.innerHTML =
    `${icon("check")}${e(success ? C.home.savePreview : C.home.saveSettings)}`;
}

function renderLibrary() {
  return `${heading(C.libraryTitle, C.libraryIntro, button(C.newAction, "new", "primary", "plus", data.actions.length >= MAX_ACTIONS ? "disabled" : ""))}
    <div class="library-bar"><span class="badge neutral">${C.actionCount(data.actions.length)}</span></div>
    <div id="action-rows" class="action-table">${renderActionRows()}</div>`;
}
function renderActionRows() {
  const actions = data.actions.map((a) => resolveAction(a));
  return actions.length
    ? actions
        .map(
          (a) => `<div class="action-row">
    <button class="action-open" data-op="edit-action" data-id="${e(a.id)}"><span class="icon-tile tone-${e(a.kind)}">${icon(a.icon)}</span><div class="grow"><div class="action-title">${e(a.name)}</div><div class="action-description">${e(a.description || a.instruction.slice(0, 55) + (a.instruction.length > 55 ? "…" : ""))}</div></div></button>
    <div class="row-meta">${a.kind === "translate" ? e(C.languages[a.sourceLanguage as keyof typeof C.languages] + " → " + C.languages[a.targetLanguage as keyof typeof C.languages]) : C.modeShort[a.mode]}<small>${C.placements[a.placement]}</small></div>
    <label class="toggle-label" data-tooltip="${e(C.quickHelp)}"><input class="switch" type="checkbox" data-quick="${e(a.id)}" aria-label="${e(C.quickToggle(a.name))}"${checked(a.quick)}><span>${C.quick}</span></label>
    ${iconButton(C.actionOptions, "action-menu", "more", `data-id="${e(a.id)}"`)}
    </div>`,
        )
        .join("")
    : `<div class="empty-list">${C.noActions}</div>`;
}
function beginEdit(id: string | null | undefined = undefined, replace = false) {
  if (!replace && state.editor?.id && state.editor.id === id) {
    navigate("editor");
    return;
  }
  if (!replace && dirty()) {
    confirmDiscard(() => beginEdit(id, true));
    return;
  }
  stopJob();
  const item = actionById(id);
  if (!item && data.actions.length >= MAX_ACTIONS) {
    notify(C.real.errors.actionLimit, "error");
    return;
  }
  state.editor = item
    ? structuredClone(item)
    : {
        id: "",
        name: "",
        instruction: "",
        icon: "spark",
        mode: "paragraph",
        placement: "inline",
        model: "default",
        quick: false,
        kind: "custom",
      };
  state.initialDraft = JSON.stringify(state.editor);
  state.trial = {
    text: defaultTrialText,
    result: null,
    busy: false,
    stale: false,
  };
  navigate("editor");
}
function modelOptions(current: unknown) {
  return (
    `<option value="default"${selected(current, "default")}>${e(C.followDefault(defaultModel()))}</option>` +
    data.connections
      .filter((c) => c.connected && connectionPurpose(c) === "generation")
      .map((raw) => {
        const c = connection(raw.id);
        return `<option value="${e(c.id)}"${selected(current, c.id)}>${e(c.name)} · ${e(c.model)}</option>`;
      })
      .join("")
  );
}
function renderEditor() {
  const a = state.editor!,
    t = state.trial;
  return `<div class="page-heading editor-heading"><div><h1>${a.id ? C.editTitle : C.createTitle}</h1><p>${C.editorIntro}</p></div><div class="row editor-actions"><span id="save-state" class="save-state">${dirty() ? C.unsaved : C.allSaved}</span>${button(C.cancel, "editor-cancel")}${button(C.save, "save", "primary", "check")}</div></div>
  <div class="editor-grid"><section aria-label="${C.editTitle}">
    <label class="field"><span class="field-label">${C.actionName}</span><input id="action-name" data-draft="name" value="${e(a.name)}" placeholder="${C.actionPlaceholder}" maxlength="48"></label>
    ${a.kind === "translate" ? renderTranslationFields(a) : hasOutputLanguage(a) ? renderOutputLanguageField(a.outputLanguage, 'data-language="outputLanguage"') : ""}
    ${
      a.kind === "qa"
        ? `<label class="field"><span class="field-label">${C.outputLength}</span><select data-draft="outputLength" aria-label="${C.outputLength}">${Object.entries(
            C.outputLengths,
          )
            .map(
              ([id, label]) =>
                `<option value="${id}"${selected(a.outputLength || DEFAULT_OUTPUT_LENGTH, id)}>${label}</option>`,
            )
            .join(
              "",
            )}</select><span class="field-note">${C.outputLengthHint}</span></label>`
        : ""
    }
    <label class="field"><span class="field-label">${a.kind === "translate" ? C.translationInstructions : C.instruction}</span><textarea id="instruction" data-draft="instruction" rows="6" placeholder="${C.instructionPlaceholder}">${e(a.instruction)}</textarea></label>
    <div class="field"><div class="field-label" id="mode-label">${C.mode}</div><div class="mode-options" role="radiogroup" aria-labelledby="mode-label">${["paragraph", "whole"].map((mode) => `<label class="mode-option"><div class="row"><input type="radio" name="process-mode" value="${mode}"${checked(a.mode === mode)}><span>${C.modes[mode as keyof typeof C.modes]}</span></div><p>${C.modeHints[mode as keyof typeof C.modeHints]}</p></label>`).join("")}</div></div>
    <details class="advanced"><summary>${C.advanced}</summary><div class="advanced-body">
      <label class="field"><span class="field-label">${C.model}</span><select data-draft="model">${modelOptions(a.model)}</select></label>
      <label class="field"><span class="field-label">${C.placement}</span><select data-draft="placement">${Object.entries(
        C.placements,
      )
        .map(
          ([id, label]) =>
            `<option value="${id}"${selected(a.placement, id)}>${label}</option>`,
        )
        .join(
          "",
        )}</select><span class="field-note">${C.placementHelp}</span></label>
    </div></details><div id="editor-error" class="error" role="alert" hidden></div>
  </section><aside class="test-panel" aria-labelledby="trial-heading">
    <div class="test-header"><h2 id="trial-heading">${C.test}</h2></div>
    <textarea id="test-input" class="test-input" aria-label="${C.input}" rows="5" placeholder="${C.testInputPlaceholder}">${e(t.text)}</textarea>
    <div class="test-run-row"><div class="test-run-details"><span class="run-meta" id="test-run-meta"></span><p class="test-notice">${C.processingNotice}</p></div><button class="btn primary compact" id="test-run" data-op="test-run"></button></div>
    <div id="test-results" aria-live="polite"></div>
  </aside></div>`;
}
function languageOptions(current: unknown, allowAuto: boolean) {
  return Object.entries(C.languages)
    .filter(([key]) => allowAuto || key !== "auto")
    .map(
      ([key, label]) =>
        `<option value="${key}"${selected(current, key)}>${label}</option>`,
    )
    .join("");
}
function renderOutputLanguageField(value: string | undefined, attrs: string) {
  return `<label class="field"><span class="field-label">${C.outputLanguage}</span><select ${attrs} aria-label="${C.outputLanguage}"><option value="interface"${selected(value || "interface", "interface")}>${C.followInterfaceLanguage}</option>${languageOptions(value, false)}</select></label>`;
}
function renderTranslationFields(a: Action) {
  return `<div class="translation-fields"><label class="field"><span class="field-label">${C.sourceLanguage}</span><select data-language="sourceLanguage" aria-label="${C.sourceLanguage}">${languageOptions(a.sourceLanguage, true)}</select></label>
    ${iconButton(C.swapLanguages, "swap-languages", "swap", a.sourceLanguage === "auto" ? "disabled" : "")}
    <label class="field"><span class="field-label">${C.targetLanguage}</span><select data-language="targetLanguage" aria-label="${C.targetLanguage}">${languageOptions(a.targetLanguage, false)}</select></label></div><p class="field-note translation-hint">${C.translationHint}</p>`;
}
function renderTrialResult() {
  if (state.route !== "editor") return;
  document.querySelector<HTMLElement>("#save-state")!.textContent = dirty()
    ? C.unsaved
    : C.allSaved;
  const t = state.trial,
    a = state.editor!,
    result = document.querySelector<HTMLElement>("#test-results")!;
  document.querySelector<HTMLElement>("#test-run-meta")!.textContent =
    `${C.paragraphs(splitText(t.text).length)} · ${connection(a.model).model}`;
  document.querySelector<HTMLElement>("#test-run")!.innerHTML =
    `${t.busy ? '<span class="spinner"></span>' : icon("play")}${t.busy ? C.stop : t.result ? C.rerun : C.run}`;
  if (t.busy) {
    result.innerHTML = `<div class="test-result result-busy"><span class="spinner"></span>${C.running}</div>`;
    return;
  }
  if (!t.result) {
    result.innerHTML = `<div class="test-result result-empty">${C.emptyResult}</div>`;
    return;
  }
  result.innerHTML = `<div class="test-result"><div class="result-label"><span>${C.output}</span><div class="row result-actions">${bookmarkButton()}${iconButton(C.copy, "copy-trial", "copy")}</div></div>${t.stale ? `<div class="stale">${C.stale}</div>` : ""}<div class="result-paper"></div></div>`;
  renderMarkdown(
    result.querySelector<HTMLElement>(".result-paper")!,
    t.result.parts.map((part) => part.text).join("\n\n"),
  );
}
function invalidateTrial() {
  activeTrial?.cancel();
  activeTrial = null;
  state.trial.busy = false;
  state.trial.stale = Boolean(state.trial.result);
  renderTrialResult();
}
async function runTrial() {
  if (!state.editor) return;
  if (state.trial.busy) {
    stopJob();
    renderTrialResult();
    return;
  }
  if (!state.editor.instruction.trim() || !state.trial.text.trim()) {
    notify(C.inputRequired, "error");
    return;
  }
  const refresh = Boolean(state.trial.result);
  state.trial.busy = true;
  state.trial.result = null;
  renderTrialResult();
  const job = processRequest({
    source: "trial",
    refresh,
    action: structuredClone(state.editor),
    blocks: splitText(state.trial.text).map((text, i) => ({
      id: String(i),
      text,
    })),
  });
  activeTrial = job;
  try {
    const result = await job.promise;
    if (activeTrial !== job) return;
    state.trial.result = result;
    state.trial.stale = false;
  } catch (caught) {
    const error = modelError(caught);
    if (error.code !== "cancelled") notify(errorText(error), "error");
  } finally {
    if (activeTrial === job) {
      activeTrial = null;
      state.trial.busy = false;
      if (state.route === "editor") renderTrialResult();
    }
  }
}
async function saveAction() {
  const a = state.editor;
  if (!a) return;
  if (!a.name.trim() || !a.instruction.trim()) {
    const error = document.querySelector<HTMLElement>("#editor-error")!;
    error.textContent = C.required;
    error.hidden = false;
    document
      .querySelector<HTMLElement>(
        !a.name.trim() ? "#action-name" : "#instruction",
      )!
      .focus();
    return;
  }
  const next = {
    ...a,
    quick: data.actions.find((item) => item.id === a.id)?.quick ?? false,
    id: a.id || crypto.randomUUID(),
    name: a.name.trim(),
    instruction: a.instruction.trim(),
  };
  next.builtin = usesPresetDefaults(next, locale);
  if (
    !presets.some(
      (p) => p.name === next.name && p.instruction === next.instruction,
    )
  )
    delete next.description;
  const previous = data.actions;
  const candidates = previous.some((item) => item.id === next.id)
    ? previous.map((item) => (item.id === next.id ? next : item))
    : [...previous, next];
  const limit = actionLimitError(candidates);
  if (limit) {
    const error = document.querySelector<HTMLElement>("#editor-error")!;
    error.textContent = C.real.errors[limit];
    error.hidden = false;
    return;
  }
  data.actions = candidates;
  if (!(await persist())) {
    data.actions = previous;
    return;
  }
  state.editor = null;
  state.initialDraft = "";
  navigate("actions");
  notify(C.saved(next.name));
}
function styleVariables(target: AppearanceTarget) {
  const s = data.appearance[target];
  const color = resultColor(s.color, document.documentElement.dataset.theme);
  return `--result-color:${color};--result-size:${s.size}px;--result-line:${s.line};--result-bg:${s.tint ? (target === "selection" ? "var(--panel)" : `color-mix(in srgb, ${color} 9%, var(--surface))`) : "transparent"};${target === "page" && !s.customTypography ? "font-size:inherit;line-height:inherit;" : ""}`;
}
function renderAppearance() {
  const target = state.appearanceTarget,
    s = data.appearance[target];
  const swatch = (color: string, label: string) =>
    `<button type="button" class="swatch ${color === s.color ? "active" : ""}" style="background:${e(resultColor(color, document.documentElement.dataset.theme))}" data-op="swatch" data-color="${e(color)}" aria-label="${e(label)}" aria-pressed="${color === s.color}"></button>`;
  return `${heading(C.appearanceTitle, C.appearanceIntro)}<div class="settings-grid appearance-grid"><section>
    <label class="field"><span class="field-label">${C.styleTarget}</span><select id="style-target">${Object.entries(
      C.styleTargets,
    )
      .map(
        ([key, label]) =>
          `<option value="${key}"${selected(target, key)}>${label}</option>`,
      )
      .join("")}</select></label>
    <div class="settings-section"><div class="field-label">${C.textColor}</div><div class="swatches">${button(target === "page" ? C.real.pageColor : C.defaultTextColor, "swatch", "", "", `data-color="auto" aria-pressed="${s.color === "auto"}"`)}${button(C.themeColor, "swatch", "", "palette", `data-color="theme" aria-pressed="${s.color === "theme"}"`)}<div class="swatch-colors">${resultColorPresets.map((preset, i) => swatch(preset.id, C.paletteNames[i])).join("")}${(data.customColors ?? []).map((color) => `<span class="custom-swatch">${swatch(color, C.customColor(color))}${iconButton(C.removeColor(color), "remove-color", "close", `data-value="${e(color)}" data-color-remove`, false)}</span>`).join("")}<span class="color-picker"><input type="color" id="result-color" value="${s.color === "auto" || s.color === "theme" ? getComputedStyle(document.documentElement).getPropertyValue("--result-accent").trim() : resultColor(s.color, document.documentElement.dataset.theme)}" aria-label="${C.textColor}">${iconButton(C.addColor, "add-color", "plus")}</span></div></div></div>
    <div class="settings-section">${target === "page" ? `<div class="field"><label class="setting-row"><strong>${C.customTypography}</strong><input class="switch" type="checkbox" data-style="customTypography"${checked(Boolean(s.customTypography))}></label><p class="field-note">${C.typographyHint}</p></div>` : ""}<div id="typography-controls"${target === "page" && !s.customTypography ? " hidden" : ""}><label class="field"><span class="setting-row"><strong>${C.fontSize}</strong><output id="size-value">${s.size}px</output></span><input type="range" data-style="size" min="12" max="30" step="1" value="${s.size}" aria-label="${C.fontSize}"></label>
    <label class="field"><span class="setting-row"><strong>${C.lineHeight}</strong><output id="line-value">${s.line}</output></span><input type="range" data-style="line" min="1.3" max="2.2" step="0.1" value="${s.line}" aria-label="${C.lineHeight}"></label></div>
    <label class="setting-row"><strong>${C.tint}</strong><input class="switch" type="checkbox" data-style="tint"${checked(s.tint)}></label></div>
    <div class="row"><span class="grow"></span>${button(C.resetStyle, "reset-style", "ghost compact", "refresh")}</div></section>
    <aside class="style-preview"><div class="preview-bar">${icon("palette")}${C.livePreview}<span class="grow"></span><span>${C.styleTargets[target]}</span></div><div id="style-preview-content"></div></aside></div>`;
}
function createSelectionPanel(prefix: string, actions: string) {
  const panel = document.createElement("section");
  panel.className = "selection-result";
  panel.innerHTML = selectionResultMarkup(
    `<div id="${prefix}-output" class="processed-text ${data.appearance.selection.tint ? "tinted" : ""}" style="${styleVariables("selection")}"></div>`,
    `<span id="${prefix}-result-status" class="selection-result-status" role="status"></span>`,
    `<div id="${prefix}-result-actions" class="selection-result-actions">${actions}</div>`,
  );
  return panel;
}
function renderStylePreview() {
  const target = state.appearanceTarget;
  const node = document.querySelector<HTMLElement>("#style-preview-content")!;
  const picker = document.querySelector<HTMLInputElement>("#result-color")!;
  const color = data.appearance[target].color;
  document
    .querySelectorAll<HTMLElement>('.swatches [data-color^="preset:"]')
    .forEach((swatch) => {
      swatch.style.background = resultColor(
        swatch.dataset.color!,
        document.documentElement.dataset.theme,
      );
    });
  if (!color.startsWith("#"))
    picker.value = color === "auto" || color === "theme"
      ? getComputedStyle(document.documentElement).getPropertyValue("--result-accent").trim()
      : resultColor(color, document.documentElement.dataset.theme);
  document.querySelector<HTMLButtonElement>('[data-op="add-color"]')!.disabled =
    color.startsWith("preset:") || (data.customColors ?? []).includes(picker.value);
  if (target === "selection") {
    node.innerHTML = `<div class="selection-style-stage"><div class="selection-tools" id="style-selection-tools" inert></div></div>`;
    const root = node.querySelector<HTMLElement>(".selection-tools")!;
    const actions = data.actions.map((a) => resolveAction(a));
    const sampleAction =
      actions.find((a) => a.kind === "translate") || actions[0] || presets[0];
    const tools = new SelectionTools(root, {
      config: () => ({
        ...data,
        actions: actions.length ? actions : [sampleAction],
        strings: C.real,
      }),
      selected: () => sampleAction.id,
      icon,
      selection: () => sample.paragraphs[1],
      run: async () => {},
      dismissResult: () => {},
      home: () => {},
      saved: () => {},
      pinned: () => false,
      togglePin: () => {},
      error: errorText,
    });
    const panel = createSelectionPanel(
      "style-selection",
      `${iconButton(C.real.bookmark, "", "bookmark")}${iconButton(C.copy, "", "copy")}${iconButton(C.real.regenerate, "", "refresh")}`,
    );
    tools.setResult(panel);
    renderMarkdown(
      panel.querySelector<HTMLElement>("#style-selection-output")!,
      sample.translations[1],
    );
    panel.querySelector<HTMLElement>(".selection-result-status")!.textContent =
      C.real.done;
  } else
    node.innerHTML = `<div class="preview-content"><p class="eyebrow" style="margin-bottom:22px">${sample.category}</p><p class="original-text"><span class="preview-source">${sample.paragraphs[1]}</span><span class="processed-text ${data.appearance[target].tint ? "tinted" : ""}" style="${styleVariables(target)}">${sample.translations[1]}</span></p></div>`;
}
function modelPicker() {
  const d = connectionDraft,
    models = d.models || [];
  const placeholder =
    d.models === undefined
      ? C.real.loadModels
      : models.length
        ? C.real.selectModel
        : C.real.noModels;
  return `<label class="field"><span class="field-label">${C.modelName}</span><select data-connection="model" ${!models.length || connectionTest ? "disabled" : ""}><option value="" disabled${selected(!models.some((m) => m.id === d.model) ? "" : d.model, "")}>${e(d.model && d.models === undefined ? d.model + " · " + placeholder : placeholder)}</option>${models.map((model) => `<option value="${e(model.id)}"${selected(d.model, model.id)}>${e(model.name === model.id ? model.id : model.name + " · " + model.id)}</option>`).join("")}</select><small class="field-note">${C.real.modelListHint}</small></label>`;
}
function reasoningPicker() {
  const d = connectionDraft,
    levels = reasoningLevels(d),
    invalid = d.reasoningEffort !== undefined && !levels.includes(d.reasoningEffort);
  return `<label class="field"><span class="field-label">${C.real.reasoningEffort}</span><select data-connection="reasoningEffort" ${!d.model || (!levels.length && !invalid) || connectionTest ? "disabled" : ""}>${invalid ? `<option value="${e(d.reasoningEffort)}" selected disabled>${e(C.real.reasoningInvalid(d.reasoningEffort!))}</option>` : ""}<option value=""${selected(d.reasoningEffort || "", "")}>${C.real.reasoningDefault}</option>${levels.map((level) => `<option value="${level}"${selected(d.reasoningEffort, level)}>${C.real.reasoningLevels[level]}</option>`).join("")}</select><small class="field-note${invalid ? " error" : ""}">${invalid ? C.real.errors.invalidReasoning : levels.length ? C.real.reasoningHint : C.real.reasoningUnsupported}</small></label>`;
}
function syncReasoningControl() {
  const picker = document.querySelector<HTMLElement>("#connection-reasoning");
  if (!picker) return;
  picker.innerHTML = reasoningPicker();
  enhanceSelects(picker);
}
function syncConnectionControls() {
  const picker = document.querySelector<HTMLElement>("#connection-model");
  if (!picker) return;
  document.querySelector<HTMLElement>("#connection-provider")!.innerHTML =
    providerIcon(connectionDraft) || icon("plug");
  picker.innerHTML = modelPicker();
  enhanceSelects(picker);
  syncReasoningControl();
  const test = document.querySelector<HTMLButtonElement>(
    '[data-op="test-connection"]',
  )!;
  test.disabled = Boolean(connectionTest);
  test.textContent = connectionTest ? C.testingConnection : C.testConnection;
  document.querySelector<HTMLButtonElement>(
    '[data-op="save-connection"]',
  )!.disabled =
    Boolean(connectionTest) ||
    !connectionDraft.models?.some(
      (model) => model.id === connectionDraft.model,
    );
}
function renderConnections() {
  const d = connectionDraft,
    stored = data.connections.find((c) => c.id === d.id),
    isNew = !d.id,
    purpose = connectionPurpose(d);
  return `${heading(C.connectionsTitle, C.connectionsIntro)}<div class="connection-workspace">
    <aside class="connection-master"><div class="connection-master-header"><h2>${C.connectionList}</h2>${iconButton(C.addConnection, "add-connection", "plus")}</div><div class="connection-items">
    ${isNew ? `<div class="connection-item selected"><span class="icon-tile">${icon("plug")}</span><div><strong>${C.newConnection}</strong><small>${C.unsaved}</small></div></div>` : ""}
    ${data.connections
      .toSorted((a, b) =>
        connectionPurpose(a).localeCompare(connectionPurpose(b)),
      )
      .map((raw) => {
        const c = connection(raw.id);
        return `<button class="connection-item ${d.id === c.id ? "selected" : ""}" data-op="select-connection" data-id="${c.id}" aria-pressed="${d.id === c.id}"><span class="icon-tile">${providerIcon(raw) || icon("plug")}</span><div class="grow"><strong>${e(c.name)}</strong><small>${c.connected ? e(c.model) : C.notConnected}</small></div>${connectionPurpose(raw) === "generation" && c.id === data.defaultConnection ? `<span class="badge">${C.default}</span>` : ""}</button>`;
      })
      .join("")}</div></aside>
    <section class="connection-detail"><div class="connection-detail-header"><div class="connection-heading"><h2 class="connection-title"><span id="connection-provider">${providerIcon(d) || icon("plug")}</span><span>${isNew ? C.newConnection : e(stored?.name)}</span></h2>${purpose === "generation" && stored?.connected ? (d.id === data.defaultConnection ? `<span class="connection-default-label" data-tooltip="${e(C.defaultConnectionHint)}">${C.default}</span>` : button(C.setDefault, "set-default", "connection-default-action", "", `data-id="${d.id}"`)) : ""}</div>${d.connected ? `<span class="badge"><i class="dot"></i>${C.connected}</span>` : `<span class="badge neutral">${C.notConnected}</span>`}</div>
    <div class="connection-form">
      ${
        DECISION_MODELS_ENABLED
          ? `<label class="field"><span class="field-label">${C.real.modelPurpose}</span><select data-connection-purpose>${Object.entries(
              C.real.purposes,
            )
              .map(
                ([value, label]) =>
                  `<option value="${value}"${selected(purpose, value)}>${label}</option>`,
              )
              .join(
                "",
              )}</select><small class="field-note">${purpose === "decision" ? C.real.decisionHint : C.defaultConnectionHint}</small></label>`
          : ""
      }
      <label class="field"><span class="field-label">${C.real.protocol}</span><select data-connection="protocol">${Object.entries(
        C.real.protocols,
      )
        .filter(([key]) =>
          key === "typesafe"
            ? DECISION_MODELS_ENABLED && purpose === "decision"
            : purpose === "generation",
        )
        .map(
          ([key, label]) =>
            `<option value="${key}"${selected(d.protocol, key)}>${label}</option>`,
        )
        .join("")}</select></label>
      ${[
        ["name", C.connectionName],
        ["url", C.serviceUrl],
      ]
        .map(
          ([key, label]) =>
            `<label class="field"><span class="field-label">${label}</span><input data-connection="${key}" type="${key === "url" ? "url" : "text"}" value="${e(d[key as "name" | "url" | "model"])}" placeholder="${C.connectionPlaceholders[key as keyof typeof C.connectionPlaceholders]}"></label>`,
        )
        .join("")}
      <div id="connection-model">${modelPicker()}</div>
      <label class="field"><span class="field-label">${C.apiKey}</span><input data-connection="key" type="password" value="${e(d.key || "")}" placeholder="${d.hasKey ? C.real.keepKey : C.real.noSavedKey}" autocomplete="off"></label>
      ${purpose === "generation" ? `<div id="connection-reasoning">${reasoningPicker()}</div>` : `<p class="field-note">${C.real.decisionExperimental}</p>`}
      ${
        d.protocol === "responses"
          ? `<label class="field"><span class="field-label">${C.real.openaiCache}</span><select data-connection="openaiCache">${Object.entries(
              C.real.cacheModes,
            )
              .map(
                ([key, label]) =>
                  `<option value="${key}"${selected(d.openaiCache || "auto", key)}>${label}</option>`,
              )
              .join(
                "",
              )}</select><small class="field-note">${C.real.cacheHint}</small></label>`
          : ""
      }${purpose === "generation" && d.protocol !== "chat" ? `<label class="field"><span class="field-label">${C.real.maxTokens}</span><input type="number" min="1" data-connection="maxTokens" value="${d.maxTokens}"></label>` : ""}</div>${
        purpose === "generation"
          ? `<details class="advanced"><summary>${C.real.processingOptions}</summary><div class="advanced-body connection-form">${(
              [
                ["concurrency", 1, 8],
                ["batchChars", 4000, 32000],
                ["batchCount", 1, 32],
              ] as const
            )
              .map(
                ([field, min, max]) =>
                  `<label class="field"><span class="field-label">${C.real[field]}</span><input type="number" min="${min}" max="${max}" data-connection="${field}" value="${(d.processing ?? DEFAULT_PROCESSING)[field]}"></label>`,
              )
              .join(
                "",
              )}</div><p class="field-note">${C.real.processingHint}</p></details>`
          : ""
      }
    <div id="connection-status" role="status" class="small muted"></div>
    <div class="connection-detail-actions">${!isNew ? button(C.real.removeConnection, "remove-connection", "danger") : ""}${button(connectionTest ? C.testingConnection : C.testConnection, "test-connection", "", "", connectionTest ? "disabled" : "")}<span class="grow"></span>${button(C.cancel, "cancel-connection")}${button(C.save, "save-connection", "primary", "check", connectionTest || !d.models?.some((model) => model.id === d.model) ? "disabled" : "")}</div>
    <p class="connection-note">${C.connectionNote}</p></section></div>`;
}
function selectConnection(id: string | null | undefined, replace = false) {
  if (!replace && JSON.stringify(connectionDraft) !== initialConnectionDraft) {
    confirmDiscard(() => selectConnection(id, true));
    return;
  }
  connectionTest = null;
  connectionDraft = id
    ? {
        ...structuredClone(data.connections.find((c) => c.id === id)!),
        key: "",
      }
    : newConnection();
  initialConnectionDraft = JSON.stringify(connectionDraft);
  render();
}
function setConnectionStatus(text = "", result: "success" | "error" | "" = "") {
  const status = document.querySelector<HTMLElement>("#connection-status");
  if (!status) return;
  status.textContent = text;
  status.dataset.result = result;
}
function validConnection(testOnly = false) {
  try {
    modelsEndpoint(connectionDraft);
    if (!testOnly) {
      processingPolicy(connectionDraft.processing);
      reasoningBody(connectionDraft);
      if (!connectionDraft.name.trim())
        throw new ModelError("invalidConnection");
      if (
        !connectionDraft.models?.some(
          (model) => model.id === connectionDraft.model,
        )
      )
        throw new ModelError("modelRequired");
    }
    return true;
  } catch (caught) {
    const error = modelError(caught);
    setConnectionStatus(errorText(error), "error");
    return false;
  }
}
async function grantConnection(draft = connectionDraft) {
  const origin = new URL(modelsEndpoint(draft)).origin + "/*";
  if (!(await chrome.permissions.request({ origins: [origin] }))) {
    throw new ModelError("permissionRequired");
  }
}
async function copyResult(result: ProcessResult | null) {
  if (!result) return;
  try {
    await navigator.clipboard.writeText(
      result.parts.map((p) => p.text).join("\n\n"),
    );
    notify(C.copied);
  } catch {
    notify(C.copyFailed, "error");
  }
}

document.addEventListener("click", async (event) => {
  try {
    const target = (event.target as HTMLElement).closest("button");
    if (!target || target.disabled) return;
    if (target.dataset.route) {
      navigate(target.dataset.route);
      return;
    }
    const op = target.dataset.op;
    if (op === "history-back") {
      history.back();
    } else if (op === "history-forward") {
      history.forward();
    } else if (op === "home") {
      navigate("home");
    } else if (op === "shortcut-settings") {
      await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    } else if (op === "navigation-open") {
      setNavigationOpen(true);
      app.querySelector<HTMLElement>("[data-op=navigation-close]")?.focus();
    } else if (op === "navigation-close") {
      setNavigationOpen(false);
      app.querySelector<HTMLElement>("[data-op=navigation-open]")?.focus();
    } else if (op === "theme-menu") {
      showThemeMenu(target);
    } else if (op === "cache-reload") {
      await loadUsage();
    } else if (op === "cache-clear-ask") {
      showDialog(
        `<h2>${C.usage.cacheClearTitle}</h2><p>${C.usage.cacheClearText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close")}${button(C.usage.cacheClear, "cache-clear", "danger dialog-delete")}</div>`,
        { showClose: false },
      );
    } else if (op === "cache-clear") {
      await request("cache.clear");
      closeDialog(() => {
        void loadUsage();
        notify(C.usage.cacheCleared);
      });
    } else if (op === "usage-more") {
      usageView.limit += 50;
      render();
    } else if (op === "usage-reload") {
      await loadUsage();
    } else if (op === "usage-clear-ask") {
      showDialog(
        `<h2>${C.usage.clearTitle}</h2><p>${C.usage.clearText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close")}${button(C.usage.clear, "usage-clear", "danger dialog-delete")}</div>`,
        { showClose: false },
      );
    } else if (op === "usage-clear") {
      await request("usage.clear");
      usageView.records = [];
      usageView.limit = 50;
      closeDialog(() => {
        render();
        notify(C.usage.cleared);
      });
    } else if (op === "theme-mode" || op === "theme-palette") {
      if (op === "theme-mode")
        data.preferences.theme = target.dataset.value as Preferences["theme"];
      else data.preferences.palette = target.dataset.value!;
      rememberTheme(data.preferences);
      persist();
      applyTheme();
      if (state.route === "appearance") renderStylePreview();
      showThemeMenu(
        document.querySelector<HTMLElement>("[data-op=theme-menu]")!,
      );
    } else if (op === "bookmark") {
      await saveBookmark();
    } else if (op === "collection-search-toggle") {
      setCollectionSearchOpen(!state.collectionSearchOpen);
    } else if (op === "collection-reset") {
      state.collectionQuery = "";
      render();
    } else if (op === "collection-menu") {
      showCollectionMenu(target);
    } else if (op === "collection-source-open") {
      const item = data.collection.find((item) => item.id === openCollectionId);
      const source = item && collectionSource(item);
      if (source) await chrome.tabs.create({ url: source.href });
    } else if (op === "collection-open") {
      openCollection(target.dataset.id);
    } else if (op === "collection-copy") {
      const item = data.collection.find((c) => c.id === openCollectionId);
      copyResult(
        item
          ? {
              parts: [
                { id: item.id, source: item.sourceText, text: item.text },
              ],
              mode: "whole",
            }
          : null,
      );
    } else if (op === "collection-remove-ask") {
      showDialog(
        `<h2>${C.home.removeTitle}</h2><p>${C.home.removeText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close")}${button(C.remove, "collection-remove", "danger dialog-delete")}</div>`,
        { showClose: false },
      );
    } else if (op === "collection-remove") {
      await request("collection.remove", { id: openCollectionId });
      await reloadData();
      closeDialog(() => {
        render();
        notify(C.home.removed);
      });
    } else if (op === "daily-settings") {
      openDailySettings();
    } else if (op === "daily-refresh") {
      await generateDaily(data.daily);
    } else if (op === "daily-preview") {
      if (!dailyDraft.prompt.trim()) {
        showDailyError(C.home.promptRequired, "#daily-prompt");
        return;
      }
      await generateDaily(dailyDraft, true);
    } else if (op === "daily-save") {
      if (!dailyDraft.prompt.trim()) {
        showDailyError(C.home.promptRequired, "#daily-prompt");
        return;
      }
      const next: Daily = {
        model: dailyDraft.model || "default",
        prompt: dailyDraft.prompt,
        outputLanguage: dailyDraft.outputLanguage || "interface",
        useCollection: dailyDraft.useCollection,
        result: dailyPreview?.success ? dailyPreview.text : data.daily.result,
        date: dailyPreview?.success
          ? new Date().toLocaleDateString("en-CA")
          : data.daily.date,
      };
      data.daily = await request("daily.save", { daily: next });
      closeDialog(() => {
        render();
        notify(C.home.settingsSaved);
      });
    } else if (op === "new") {
      beginEdit();
    } else if (op === "edit-action") {
      beginEdit(target.dataset.id);
    } else if (op === "editor-cancel") {
      state.editor = null;
      state.initialDraft = "";
      navigate("actions");
    } else if (op === "dismiss-notice") {
      dismissNotice();
    } else if (op === "dialog-close") {
      closeDialog();
    } else if (op === "discard") {
      const proceed = pendingNavigation;
      pendingNavigation = undefined;
      closeDialog(proceed);
    } else if (op === "save") {
      await saveAction();
    } else if (op === "test-run") {
      await runTrial();
    } else if (op === "copy-trial") {
      copyResult(state.trial.result);
    } else if (op === "action-menu") {
      const a = actionById(target.dataset.id);
      if (!a) return;
      pendingDelete = a.id;
      const index = data.actions.findIndex((item) => item.id === a.id);
      showMenu(
        target,
        `<div class="action-popover">${button(C.edit, "menu-edit", "ghost", "edit")}${button(C.moveUp, "move-action-up", "ghost", "up", index === 0 ? "disabled" : "")}${button(C.moveDown, "move-action-down", "ghost", "down", index === data.actions.length - 1 ? "disabled" : "")}${button(C.duplicate, "duplicate", "ghost", "copy", data.actions.length >= MAX_ACTIONS ? "disabled" : "")}${isPresetAction(a) ? "" : button(C.remove, "remove-ask", "danger", "close")}</div>`,
        C.actionOptions,
      );
    } else if (op === "menu-edit") {
      beginEdit(pendingDelete);
    } else if (op === "move-action-up" || op === "move-action-down") {
      const index = data.actions.findIndex((item) => item.id === pendingDelete);
      const destination = index + (op === "move-action-up" ? -1 : 1);
      if (index < 0 || destination < 0 || destination >= data.actions.length) return;
      closeMenu();
      const previous = data.actions;
      const id = previous[index].id;
      const ordered = [...previous];
      [ordered[index], ordered[destination]] = [
        ordered[destination],
        ordered[index],
      ];
      data.actions = ordered;
      if (!(await persist())) data.actions = previous;
      render();
      document
        .querySelector<HTMLButtonElement>(
          `[data-op="action-menu"][data-id="${CSS.escape(id)}"]`,
        )
        ?.focus();
    } else if (op === "duplicate") {
      if (data.actions.length >= MAX_ACTIONS) {
        notify(C.real.errors.actionLimit, "error");
        return;
      }
      const item = structuredClone(actionById(pendingDelete));
      if (!item) return;
      item.id = crypto.randomUUID();
      item.name = `${item.name} · ${C.copiedSuffix}`;
      item.builtin = false;
      data.actions.push(item);
      if (!(await persist())) {
        data.actions = data.actions.filter((a) => a.id !== item.id);
        return;
      }
      beginEdit(item.id);
      notify(C.duplicated);
    } else if (op === "remove-ask") {
      const action = actionById(pendingDelete);
      if (!action || isPresetAction(action)) return;
      showDialog(
        `<h2>${C.removeTitle}</h2><p>${C.removeText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close")}${button(C.remove, "remove-confirm", "danger dialog-delete")}</div>`,
        { showClose: false },
      );
    } else if (op === "remove-confirm") {
      const action = actionById(pendingDelete);
      if (!action || isPresetAction(action)) return;
      const previous = data.actions;
      data.actions = previous.filter((a) => a.id !== pendingDelete);
      if (!(await persist())) {
        data.actions = previous;
        return;
      }
      if (state.editor?.id === pendingDelete) state.editor = null;
      closeDialog(() => {
        render();
        notify(C.removed);
      });
    } else if (op === "swatch") {
      data.appearance[state.appearanceTarget].color = target.dataset.color!;
      persist();
      render();
    } else if (op === "add-color") {
      const color = document.querySelector<HTMLInputElement>("#result-color")!.value;
      if ((data.customColors ?? []).includes(color)) return;
      const previous = data.customColors,
        style = data.appearance[state.appearanceTarget],
        previousColor = style.color;
      data.customColors = [...(previous ?? []), color];
      style.color = color;
      if (!(await persist())) {
        data.customColors = previous;
        style.color = previousColor;
      }
      render();
    } else if (op === "remove-color") {
      const previous = data.customColors;
      data.customColors = (previous ?? []).filter(
        (color) => color !== target.dataset.value,
      );
      if (!(await persist())) data.customColors = previous;
      render();
    } else if (op === "reset-style") {
      data.appearance[state.appearanceTarget] = structuredClone(
        defaultAppearance[state.appearanceTarget],
      );
      persist();
      render();
    } else if (op === "add-connection") {
      selectConnection(null);
    } else if (op === "select-connection") {
      selectConnection(target.dataset.id);
    } else if (op === "cancel-connection") {
      selectConnection(connectionDraft.id || data.defaultConnection, true);
    } else if (op === "test-connection") {
      if (!validConnection(true)) return;
      const attempt = {},
        draft = structuredClone(connectionDraft);
      connectionTest = attempt;
      connectionDraft.models = undefined;
      syncConnectionControls();
      setConnectionStatus();
      try {
        await grantConnection(draft);
        if (connectionTest !== attempt) return;
        const models = await request("connection.test", {
          connection: {
            id: draft.id,
            url: draft.url,
            protocol: draft.protocol,
          },
          key: draft.key || undefined,
        });
        if (connectionTest !== attempt) return;
        connectionDraft.models = models;
        if (!models.some((model) => model.id === connectionDraft.model)) {
          connectionDraft.model = "";
          connectionDraft.reasoningEffort = undefined;
        }
        setConnectionStatus(
          models.length ? C.connectionTested : C.real.noModels,
          "success",
        );
      } catch (error) {
        if (connectionTest !== attempt) return;
        setConnectionStatus(errorText(error), "error");
      } finally {
        if (connectionTest === attempt) {
          connectionTest = null;
          syncConnectionControls();
        }
      }
    } else if (op === "save-connection") {
      if (!validConnection()) return;
      await grantConnection();
      const saved = await request("connection.save", {
        connection: connectionDraft,
        key: connectionDraft.key || undefined,
      });
      await reloadData();
      selectConnection(saved.id, true);
      notify(C.connectionSaved);
    } else if (op === "remove-connection") {
      showDialog(
        `<h2>${C.real.removeConnection}</h2><p>${C.real.removeConnectionText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close")}${button(C.remove, "remove-connection-confirm", "danger dialog-delete")}</div>`,
        { showClose: false },
      );
    } else if (op === "remove-connection-confirm") {
      await request("connection.remove", { id: connectionDraft.id! });
      await reloadData();
      closeDialog(() => {
        selectConnection(data.defaultConnection, true);
        notify(C.real.connectionRemoved);
      });
    } else if (op === "set-default") {
      const next = data.connections.find((c) => c.id === target.dataset.id)!;
      data[defaultConnectionKey(next)] = next.id;
      await persist();
      render();
      notify(C.defaultChanged);
    } else if (op === "swap-languages") {
      const action = state.editor;
      if (!action) return;
      [action.sourceLanguage, action.targetLanguage] = [
        action.targetLanguage,
        action.sourceLanguage,
      ];
      invalidateTrial();
      render();
    }
  } catch (caught) {
    const error = modelError(caught);
    notify(errorText(error), "error");
  }
});
function updateConnectionField(field: string, value: string) {
  if (
    ["url", "protocol", "model", "key"].includes(field) &&
    connectionDraft[field as "url" | "protocol" | "model" | "key"] !== value
  )
    connectionDraft.reasoningEffort = undefined;
  if (
    (field === "url" || field === "protocol" || field === "key") &&
    connectionDraft[field] !== value
  ) {
    connectionTest = null;
    connectionDraft.models = undefined;
    connectionDraft.model = "";
  }
  if (field === "protocol") {
    const protocol = value as Protocol,
      previous = connectionDraft.protocol;
    if (
      protocol !== previous &&
      connectionDraft.url === protocolDefaults[previous]
    )
      connectionDraft.url = protocolDefaults[protocol];
    connectionDraft.protocol = protocol;
  } else if (field === "maxTokens") connectionDraft.maxTokens = Number(value);
  else if (
    field === "concurrency" ||
    field === "batchChars" ||
    field === "batchCount"
  )
    connectionDraft.processing = {
      ...(connectionDraft.processing ?? DEFAULT_PROCESSING),
      [field]: Number(value),
    };
  else if (field === "reasoningEffort")
    connectionDraft.reasoningEffort = value
      ? (value as ReasoningEffort)
      : undefined;
  else if (field === "openaiCache")
    connectionDraft.openaiCache = value as "auto" | "explicit";
  else if (
    field === "name" ||
    field === "url" ||
    field === "model" ||
    field === "key"
  )
    connectionDraft[field] = value;
  document.querySelector<HTMLElement>("#connection-provider")!.innerHTML =
    providerIcon(connectionDraft) || icon("plug");
  if (field !== "model") syncConnectionControls();
  else {
    syncReasoningControl();
    document.querySelector<HTMLButtonElement>(
      '[data-op="save-connection"]',
    )!.disabled = !connectionDraft.models?.some((model) => model.id === value);
  }
}
document.addEventListener("input", (event) => {
  const t = event.target;
  if (!(
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  ))
    return;
  if (t.dataset.draft) {
    if (!state.editor) return;
    Object.assign(state.editor, { [t.dataset.draft]: t.value });
    invalidateTrial();
    const error = document.querySelector<HTMLElement>("#editor-error")!;
    if (error) error.hidden = true;
  } else if (t.id === "test-input") {
    state.trial.text = t.value;
    invalidateTrial();
  } else if (t.id === "collection-search") {
    state.collectionQuery = t.value;
    updateCollectionResults();
  } else if (t.id === "daily-prompt") {
    dailyDraft.prompt = t.value;
    dialog.querySelector<HTMLElement>("#daily-error")!.hidden = true;
    invalidateDailyPreview();
  } else if (t.id === "daily-use-collection") {
    dailyDraft.useCollection = (t as HTMLInputElement).checked;
    invalidateDailyPreview();
  } else if (t.dataset.connection) {
    updateConnectionField(t.dataset.connection, t.value);
    setConnectionStatus();
  } else if (t.dataset.style) {
    const key = t.dataset.style;
    Object.assign(data.appearance[state.appearanceTarget], {
      [key]:
        t.type === "checkbox"
          ? (t as HTMLInputElement).checked
          : Number(t.value),
    });
    persist();
    if (key === "customTypography")
      document.querySelector<HTMLElement>("#typography-controls")!.hidden = !(
        t as HTMLInputElement
      ).checked;
    const output = document.querySelector(`#${key}-value`);
    if (output) output.textContent = key === "size" ? `${t.value}px` : t.value;
    renderStylePreview();
  } else if (t.id === "result-color") {
    data.appearance[state.appearanceTarget].color = t.value;
    persist();
    document.querySelectorAll<HTMLElement>(".swatches [data-color]").forEach((s) => {
      s.classList.toggle("active", s.dataset.color === t.value);
      s.setAttribute("aria-pressed", String(s.dataset.color === t.value));
    });
    renderStylePreview();
  }
});
document.addEventListener("change", async (event) => {
  const t = event.target;
  if (!(
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  ))
    return;
  if (t.hasAttribute("data-connection-purpose")) {
    updateConnectionField(
      "protocol",
      t.value === "decision" ? "typesafe" : "responses",
    );
    render();
  } else if (t.dataset.connection) {
    updateConnectionField(t.dataset.connection, t.value);
    if (t.dataset.connection === "protocol") render();
  } else if (t.id === "ui-locale") {
    changeLocale(t.value as LocalePreference);
  } else if (t.id === "daily-model") {
    dailyDraft.model = t.value;
    invalidateDailyPreview();
  } else if (t.id === "daily-output-language") {
    dailyDraft.outputLanguage = t.value;
    invalidateDailyPreview();
  } else if (t.id === "usage-period" || t.id === "usage-model") {
    usageView[t.id === "usage-period" ? "period" : "model"] = t.value;
    usageView.limit = 50;
    render();
  } else if (t.dataset.language) {
    const action = state.editor;
    if (!action) return;
    action[
      t.dataset.language as
        "sourceLanguage" | "targetLanguage" | "outputLanguage"
    ] = t.value;
    invalidateTrial();
    render();
  } else if (t.dataset.quick) {
    const action = data.actions.find((a) => a.id === t.dataset.quick)!;
    const previous = action.quick,
      next = (t as HTMLInputElement).checked;
    action.quick = next;
    if (!(await persist())) action.quick = previous;
    const rows = document.querySelector<HTMLElement>("#action-rows");
    if (rows) rows.innerHTML = renderActionRows();
  } else if (t.name === "process-mode") {
    if (!state.editor) return;
    state.editor.mode = t.value as ActionMode;
    state.editor.placement = t.value === "whole" ? "panel" : "inline";
    invalidateTrial();
    document.querySelector<HTMLSelectElement>("[data-draft=placement]")!.value =
      state.editor.placement;
    syncSelects();
  } else if (t.id === "style-target") {
    state.appearanceTarget = t.value as AppearanceTarget;
    render();
  }
});
render();
