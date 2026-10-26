import {
  renderUsage,
  renderUsageDetails,
  mountUsageChart,
  updateUsagePage,
} from "./usage-page.js";
import { icon, button, iconButton, heading, selected } from "./ui.js";
import { LOCALES } from "./locale.js";
import { HoverTips } from "./hover-tips.js";
import { showColorPicker } from "./color-picker.js";
import { escapeHtml as e } from "./html.js";
import {
  DAILY_PROMPT,
  hasOutputLanguage,
  hasDefaultInstructions,
  followsInstructionLanguage,
  requiresInstructions,
  resolveOutputLanguage,
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
  UsageOverview,
  UsageCursor,
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
import { summarizeUsage } from "./usage.js";

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
  error: "",
  period: "all",
  model: "all",
  overview: {
    summary: summarizeUsage([]),
    days: [],
    models: [],
    totalRecords: 0,
  } as UsageOverview,
  loading: false,
};
const newConnection = (): ConnectionDraft => ({
  id: null,
  name: "",
  url: protocolDefaults.responses,
  model: "",
  protocol: "responses",
  openaiCache: "auto",
  connected: false,
  maxTokens: 8192,
  key: "",
  processing: { ...DEFAULT_PROCESSING },
});
const errorText = (caught: unknown) => {
  const error = modelError(caught);
  const label =
    C.real.errors[error.code as keyof typeof C.real.errors] ||
    error.message ||
    C.real.failed;
  return error.message !== error.code ? `${label}\n${error.message}` : label;
};
const themeMedia = matchMedia("(prefers-color-scheme: dark)");
const app = document.querySelector<HTMLElement>("#app")!;
const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
const tips = new HoverTips(document.body, "[data-tooltip]");
window.addEventListener("resize", () => tips.hide(true));
window.addEventListener("scroll", () => tips.hide(true));
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
  "help",
];
const initialRoute = location.hash.slice(1);
state.route =
  routeNames.includes(initialRoute) && initialRoute !== "editor"
    ? initialRoute
    : "home";
history.replaceState({ route: state.route, index: 0 }, "", `#${state.route}`);

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
    if (!data.collection.length) {
      state.collectionQuery = "";
      state.collectionSearchOpen = false;
    }
    if (state.route === "home") render();
  }
});
const usageChanges = new BroadcastChannel("aside-usage");
let usageRefreshTimer: number | undefined;
usageChanges.onmessage = () => {
  if (state.route !== "usage") return;
  clearTimeout(usageRefreshTimer);
  usageRefreshTimer = setTimeout(() => void loadUsage(), 80);
};

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
  render();
  if (route === "usage") void loadUsage();
  window.scrollTo(0, 0);
  void refreshDailyOnVisit();
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
  if (state.route === "usage") void loadUsage();
  window.scrollTo(0, 0);
  void refreshDailyOnVisit();
});
function confirmDiscard(callback: () => void) {
  pendingNavigation = callback;
  showDialog(
    `<h2>${C.discardTitle}</h2><p>${C.discardText}</p><div class="dialog-actions">${button(C.keepEditing, "dialog-close")}${button(C.discard, "discard", "danger")}</div>`,
  );
}
function showDialog(content: string, { wide = false, showClose = true } = {}) {
  tips.hide(true);
  dismissNotice();
  closeMenu();
  clearTimeout(dialogTimer);
  if (dialog.open) dialog.close();
  dialog.className = `dialog${wide ? " wide" : ""}`;
  dialog.innerHTML = `${showClose ? iconButton(C.cancel, "dialog-close", "close", "", false) : ""}${content}`;
  if (showClose)
    dialog
      .querySelector<HTMLButtonElement>("button")!
      .classList.add("dialog-close");
  dialog.showModal();
  dialog.getBoundingClientRect();
  requestAnimationFrame(() => dialog.classList.add("is-visible"));
  enhanceSelects(dialog);
}
function closeDialog(callback?: () => void) {
  tips.hide(true);
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
  const languages = [
    ["system", C.systemLanguage],
    ...Object.entries(LOCALES).map(([key, value]) => [key, value.name]),
  ];
  return `<div class="preference-controls">
    <div class="language-control">
    <select id="ui-locale" class="compact-locale" data-search="false" aria-label="${C.uiLanguage}">${languages
      .map(
        ([key, label]) =>
          `<option value="${key}"${selected(data.preferences.locale, key)}>${label}</option>`,
      )
      .join("")}</select>
    <span class="language-label" aria-hidden="true">${icon("translate")}<span class="active">${LOCALES[locale].short}</span></span></div>
    ${iconButton(C.uiTheme, "theme-menu", "palette", 'aria-haspopup="true"', false)}
  </div>`;
}
function renderSidebar() {
  const route = state.route === "editor" ? "actions" : state.route;
  const link = (name: keyof typeof C.nav, glyph: string) =>
    `<button class="sidebar-link" data-route="${name}" ${name === "home" ? 'data-op="home"' : ""} ${route === name ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${C.nav[name]}</span></button>`;
  return `<aside class="sidebar" id="sidebar" aria-label="${C.pageMenu}"><div class="sidebar-brand"><img src="icons/icon-32.png" alt="" width="28" height="28"><strong>${C.brand}</strong>${iconButton(C.closeNavigation, "navigation-close", "close", "", false)}</div>
    <nav><div class="sidebar-group"><h2>${C.contentGroup}</h2>${link("home", "bookmark")}</div><div class="sidebar-group"><h2>${C.settings}</h2>${link("actions", "spark")}${link("appearance", "palette")}${link("connections", "plug")}${link("shortcuts", "keyboard")}${link("usage", "list")}</div></nav><div class="sidebar-footer">${link("help", "question")}</div></aside>
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
  if (
    event.key === "Escape" &&
    state.route === "home" &&
    state.collectionSearchOpen &&
    !dialog.open &&
    !app.querySelector(".navigation-open")
  ) {
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
  tips.hide(true);
  closeMenu();
  applyTheme();
  const route = state.route === "editor" ? "actions" : state.route;
  app.innerHTML = `<div class="app-shell">${renderSidebar()}<main class="main"><header class="topbar"><div class="topbar-navigation">${iconButton(C.pageMenu, "navigation-open", "menu", 'aria-controls="sidebar" aria-expanded="false"')}<nav class="history-controls" aria-label="${C.pageMenu}">${iconButton(C.previous, "history-back", "back", history.state.index === 0 ? "disabled" : "", false)}${iconButton(C.forward, "history-forward", "arrow", history.state.index >= maxHistoryIndex ? "disabled" : "", false)}</nav></div>${renderPreferences()}</header>
    <div class="workspace ${route === "home" ? "home-workspace" : ""}">${state.route === "home" ? renderHome() : state.route === "editor" ? renderEditor() : route === "actions" ? renderLibrary() : route === "appearance" ? renderAppearance() : route === "connections" ? renderConnections() : route === "usage" ? renderUsage(usageView, cacheInfo) : route === "shortcuts" ? renderShortcuts() : route === "help" ? renderHelp() : renderHome()}</div></main></div>`;
  setNavigationOpen(false);
  if (state.route === "editor") renderTrialResult();
  if (state.route === "appearance") renderStylePreview();
  enhanceSelects(app);
  if (state.route === "usage") mountUsageChart();
}
let usageLoadVersion = 0;
async function loadUsage(mode: "refresh" | "more" | "reset" = "refresh") {
  const append = mode === "more";
  clearTimeout(usageRefreshTimer);
  const version = ++usageLoadVersion;
  const filter = { period: usageView.period, model: usageView.model };
  const last = append ? usageView.records.at(-1) : undefined;
  const before: UsageCursor | undefined = last
    ? [last.startedAt, last.id]
    : undefined;
  usageView.loading = true;
  usageView.error = "";
  if (state.route === "usage")
    app.querySelector(".workspace")?.setAttribute("aria-busy", "true");
  const chartTip = app.querySelector(".usage-chart-tip");
  chartTip?.classList.remove("visible");
  chartTip?.setAttribute("aria-hidden", "true");
  try {
    const readRecords = async () => {
      const desired =
        mode === "refresh" ? Math.max(1, usageView.records.length) : 1;
      const records: UsageRecord[] = [];
      let cursor = before;
      while (records.length < desired) {
        const page = await request("usage.list", { filter, before: cursor });
        if (!page.length) break;
        records.push(...page);
        const last = page.at(-1)!;
        cursor = [last.startedAt, last.id];
      }
      return records;
    };
    const [records, overview, info] = await Promise.all([
      readRecords(),
      append ? usageView.overview : request("usage.overview", { filter }),
      append ? cacheInfo : request("cache.stats"),
    ]);
    if (version !== usageLoadVersion) return;
    if (
      filter.model !== "all" &&
      !overview.models.some(({ value }) => value === filter.model)
    ) {
      usageView.model = "all";
      await loadUsage();
      return;
    }
    usageView.records = append ? [...usageView.records, ...records] : records;
    usageView.overview = overview;
    cacheInfo = info;
  } catch (caught) {
    if (version !== usageLoadVersion) return;
    usageView.error = errorText(modelError(caught));
  } finally {
    if (version === usageLoadVersion) {
      usageView.loading = false;
      if (state.route === "usage") {
        tips.hide(true);
        closeMenu();
        updateUsagePage(
          app.querySelector<HTMLElement>(".workspace")!,
          usageView,
          cacheInfo,
          mode !== "reset",
        );
      }
    }
  }
}
async function showUsageDetails(id: string) {
  const record = usageView.records.find((item) => item.id === id);
  if (!record) return;
  const details = await request("usage.details", { id });
  showDialog(renderUsageDetails(record, details), { wide: true });
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
async function refreshDailyOnVisit() {
  if (
    state.route !== "home" ||
    document.hidden ||
    data.preferences.hideDaily ||
    dialog.open ||
    dailyJob
  )
    return;
  try {
    // Serialize the date check and generation across open extension pages.
    await navigator.locks.request("daily-generation", async () => {
      const fresh = await request("snapshot");
      if (
        state.route !== "home" ||
        document.hidden ||
        fresh.preferences.hideDaily ||
        dialog.open ||
        dailyJob
      )
        return;
      if (JSON.stringify(data.daily) !== JSON.stringify(fresh.daily)) {
        data.daily = fresh.daily;
        render();
      }
      const config = fresh.daily;
      if (
        config.result &&
        config.date === new Date().toLocaleDateString("en-CA")
      )
        return;
      const modelId =
        !config.model || config.model === "default"
          ? fresh.defaultConnection
          : config.model;
      if (
        !fresh.connections.some(
          (model) => model.id === modelId && model.connected,
        ) ||
        !config.prompt.trim()
      )
        return;
      await generateDaily(config);
    });
  } catch (caught) {
    notify(errorText(caught), "error");
  }
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
function dailyCard() {
  const config = data.daily;
  const needsModel = !connection(config.model || "default").connected;
  const content = config.result
    ? e(config.result)
    : needsModel
      ? e(C.home.setupHint).replace(
          "{link}",
          `<button type="button" class="daily-setup" data-route="connections">${e(C.home.setupLink)}</button>`,
        )
      : e(C.real.dailyReadyHint);
  const date = config.result ? config.date : null;
  const dateLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date ? new Date(date + "T12:00:00") : new Date());
  return `<section class="daily-region" aria-label="${C.home.daily}"><div class="daily-card"><div class="daily-topline"><h2>${C.home.daily}</h2><span class="daily-date">${dateLabel}</span></div><p class="daily-thought${config.result ? "" : " daily-guidance"}">${content}</p></div><div class="daily-controls">${iconButton(C.settings, "daily-settings", "settings")}${iconButton(C.real.dailyRefresh, "daily-refresh", "refresh")}${iconButton(C.close, "daily-hide-ask", "close")}</div></section>`;
}
function renderHelp() {
  const H = C.about;
  const manifest = chrome.runtime.getManifest();
  const repository = manifest.homepage_url!;
  const licenseLink = `<a class="help-license" href="${e(repository + "/blob/main/LICENSE")}" target="_blank" rel="noopener noreferrer">${e(H.licenseName)}</a>`;
  const externalLink = (label: string, url: string, glyph: string) =>
    `<a class="btn ghost" href="${e(url)}" target="_blank" rel="noopener noreferrer">${icon(glyph)}<span>${e(label)}</span>${icon("arrow")}</a>`;
  const libraries = [
    {
      name: "Dark Reader",
      role: H.darkReader,
      license: "MIT",
      url: "https://github.com/darkreader/darkreader",
    },
    {
      name: "Marked",
      role: H.marked,
      license: "MIT",
      url: "https://github.com/markedjs/marked",
    },
    {
      name: "DOMPurify",
      role: H.dompurify,
      license: "Apache-2.0 / MPL-2.0",
      url: "https://github.com/cure53/DOMPurify",
    },
  ];
  return `${heading(C.nav.help, "")}
    <div class="help-layout">
      <section class="help-current-version" aria-labelledby="help-version-title"><h2 id="help-version-title">${e(H.version)}</h2><span class="help-version">${e(manifest.version)}</span></section>
      <section class="help-resources" aria-labelledby="help-links-title"><h2 id="help-links-title">${e(H.resources)}</h2><div class="help-links">
        ${externalLink(H.project, repository, "github")}${externalLink(H.feedback, repository + "/issues", "explain")}${externalLink(H.privacy, "https://worldtheater.github.io/aside/privacy.html", "lock")}
      </div></section>
      <section class="help-credits" aria-labelledby="help-credits-title"><h2 id="help-credits-title">${e(H.openSource)}</h2><p>${e(H.licenseIntro).replace("{license}", licenseLink)}</p>
        <ul>${libraries.map((library) => `<li><a href="${e(library.url)}" target="_blank" rel="noopener noreferrer"><strong>${e(library.name)}</strong><span>${e(library.role)}</span></a><small>${e(library.license)}</small></li>`).join("")}</ul>
      </section>
    </div>`;
}
function renderShortcutBinding(name: string) {
  const shortcut = commandBindings.find(
    (command) => command.name === name,
  )?.shortcut;
  return shortcut
    ? `<kbd>${e(shortcut)}</kbd>`
    : `<span class="muted">${C.shortcuts.unset}</span>`;
}
function renderShortcuts() {
  return `${heading(C.nav.shortcuts, C.shortcuts.intro, button(C.shortcuts.settings, "shortcut-settings", "", "keyboard"))}
    <p class="shortcut-help">${e(C.shortcuts.help(chrome.runtime.getManifest().name))}</p>
    <section class="shortcut-list" aria-label="${C.nav.shortcuts}">${Object.entries(
      C.shortcuts.items,
    )
      .map(
        ([name, item]) =>
          `<div class="shortcut-row"><div><h2>${e(item.name)}</h2><p>${e(item.description)}</p></div><span class="shortcut-binding" data-command-binding="${e(name)}" aria-live="polite">${renderShortcutBinding(name)}</span></div>`,
      )
      .join("")}</section>`;
}
async function refreshShortcuts() {
  try {
    commandBindings = await chrome.commands.getAll();
    document
      .querySelectorAll<HTMLElement>("[data-command-binding]")
      .forEach((binding) => {
        const markup = renderShortcutBinding(binding.dataset.commandBinding!);
        if (binding.innerHTML !== markup) binding.innerHTML = markup;
      });
  } catch (error) {
    console.info("Could not read keyboard shortcuts", error);
  }
}
window.addEventListener("focus", refreshShortcuts);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void refreshShortcuts();
    void refreshDailyOnVisit();
  }
});

function renderHome() {
  return `${heading(C.home.title, C.home.intro, data.preferences.hideDaily ? button(C.home.dailyRestore, "daily-restore", "ghost", "plus") : "")}${data.preferences.hideDaily ? "" : dailyCard()}
    <section class="collection-section" aria-label="${C.home.collectionTitle}"><div class="collection-bar"><div class="row collection-heading"><h2>${C.home.collectionTitle}</h2><span class="collection-count" id="collection-count">${collectionCount()}</span></div><div class="collection-tools"${data.collection.length ? "" : " hidden"}><div class="collection-search${state.collectionSearchOpen ? " is-open" : ""}">${iconButton(state.collectionSearchOpen ? C.home.closeSearch : C.home.search, "collection-search-toggle", "search", `aria-expanded="${state.collectionSearchOpen}" aria-controls="collection-search"`, false)}<input id="collection-search" type="search" aria-label="${C.home.search}" placeholder="${C.home.search}" value="${e(state.collectionQuery)}"${state.collectionSearchOpen ? "" : " disabled"}></div></div></div>
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
    return `<div class="collection-empty">${icon("bookmark")}<h3>${data.collection.length ? C.home.noMatches : C.home.empty}</h3>${data.collection.length ? button(C.home.clearSearch, "collection-reset", "ghost") : ""}</div>`;
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
    `<div class="collection-dialog-meta">${e(localizeActionName(item.actionName, locale))} · ${C.output}</div><h2>${e(collectionTitle(item))}</h2><div class="collection-detail-body"><div class="collection-detail-text"></div><details class="collection-original"><summary>${C.home.original}</summary><p>${e(item.sourceText)}</p></details><p class="collection-source">${C.home.source} · ${source ? `<a href="${e(source.href)}" target="_blank" rel="noopener noreferrer">${e(item.sourceTitle || source.hostname)}</a>` : e(item.sourceTitle)}</p></div><div class="dialog-actions">${button(C.remove, "collection-remove-ask", "danger dialog-delete")}${button(C.copy, "collection-copy", "", "copy")}</div>`,
    { wide: true },
  );
  renderMarkdown(
    dialog.querySelector<HTMLElement>(".collection-detail-text")!,
    item.text,
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
    <div class="daily-settings-footer"><div class="dialog-actions">${button(C.cancel, "dialog-close", "ghost")}${button(C.home.saveSettings, "daily-save", "primary", "check")}</div></div>`,
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
  modelHint.textContent = selectedModel.connected
    ? ""
    : C.real.dailyConnectionHint;
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
    <div class="row-meta">${a.kind === "translate" ? e(C.languages[a.sourceLanguage as keyof typeof C.languages] + " → " + (a.targetLanguage === "interface" ? C.followInterfaceLanguage : a.targetLanguage === "instruction" ? C.followInstructionLanguage : C.languages[a.targetLanguage as keyof typeof C.languages])) : C.modeShort[a.mode]}<small>${C.placements[a.placement]}</small></div>
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
  return `<div class="page-heading editor-heading"><div><h1>${a.id ? C.editTitle : C.createTitle}</h1><p>${C.editorIntro}</p></div><div class="row editor-actions"><span id="save-state" class="save-state"${dirty() ? "" : " hidden"}>${C.unsaved}</span>${button(C.cancel, "editor-cancel", "ghost")}${button(C.save, "save", "primary", "check")}</div></div>
  <div class="editor-grid"><section aria-label="${C.editTitle}">
    <label class="field"><span class="field-label">${C.actionName}</span><input id="action-name" data-draft="name" value="${e(a.name)}" placeholder="${C.actionPlaceholder}" maxlength="48"></label>
    ${a.kind === "translate" ? renderTranslationFields(a) : hasOutputLanguage(a) ? renderOutputLanguageField(a.outputLanguage, 'data-language="outputLanguage"', true) : ""}
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
    <label class="field"><span class="field-label">${followsInstructionLanguage(a) ? C.additionalInstructionsRequired : hasDefaultInstructions(a) ? C.additionalInstructions : C.instruction}</span><textarea id="instruction" data-draft="instruction" rows="6" placeholder="${e(followsInstructionLanguage(a) ? C.instructionLanguageHint : hasDefaultInstructions(a) ? C.additionalInstructionsPlaceholder : C.instructionPlaceholder)}">${e(a.instruction)}</textarea></label>
    <div class="field"><div class="field-label" id="mode-label">${C.mode}</div><div class="mode-options" role="radiogroup" aria-labelledby="mode-label">${["paragraph", "whole"].map((mode) => `<label class="mode-option"><div class="row"><input type="radio" name="process-mode" value="${mode}"${checked(a.mode === mode)}><span>${C.modes[mode as keyof typeof C.modes]}</span></div><p>${C.modeHints[mode as keyof typeof C.modeHints]}</p></label>`).join("")}</div></div>
  </section><div class="editor-advanced"><details class="advanced"><summary>${C.advanced}</summary><div class="advanced-body">
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
    </div></details><div id="editor-error" class="error" role="alert" hidden></div></div><aside class="test-panel" aria-labelledby="trial-heading">
    <div class="test-header"><h2 id="trial-heading">${C.test}</h2></div>
    <textarea id="test-input" class="test-input" aria-label="${C.input}" rows="5" placeholder="${C.testInputPlaceholder}">${e(t.text)}</textarea>
    <div id="test-results" aria-live="polite"></div>
    <div class="test-run-row"><p class="test-notice">${C.processingNotice}</p><button class="btn primary compact" id="test-run" data-op="test-run"></button></div>
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
function renderOutputLanguageField(
  value: string | undefined,
  attrs: string,
  allowInstruction = false,
) {
  return `<label class="field"><span class="field-label">${C.outputLanguage}</span><select ${attrs} data-search="false" aria-label="${C.outputLanguage}"><option value="interface"${selected(value || "interface", "interface")}>${C.followInterfaceLanguage}</option>${allowInstruction ? `<option value="instruction"${selected(value, "instruction")}>${C.followInstructionLanguage}</option>` : ""}${languageOptions(value, false)}</select></label>`;
}
function renderTranslationFields(a: Action) {
  return `<div class="translation-fields"><label class="field"><span class="field-label">${C.sourceLanguage}</span><select data-language="sourceLanguage" data-search="false" aria-label="${C.sourceLanguage}">${languageOptions(a.sourceLanguage, true)}</select></label>
    ${iconButton(C.swapLanguages, "swap-languages", "swap", a.sourceLanguage === "auto" || followsInstructionLanguage(a) ? "disabled" : "")}
    <label class="field"><span class="field-label">${C.targetLanguage}</span><select data-language="targetLanguage" data-search="false" aria-label="${C.targetLanguage}"><option value="interface"${selected(a.targetLanguage, "interface")}>${C.followInterfaceLanguage}</option><option value="instruction"${selected(a.targetLanguage, "instruction")}>${C.followInstructionLanguage}</option>${languageOptions(a.targetLanguage, false)}</select></label></div><p class="field-note translation-hint">${C.translationHint}</p>`;
}
function renderTrialResult() {
  if (state.route !== "editor") return;
  document.querySelector<HTMLElement>("#save-state")!.hidden = !dirty();
  const t = state.trial,
    a = state.editor!,
    result = document.querySelector<HTMLElement>("#test-results")!;
  document.querySelector<HTMLElement>("#test-run")!.innerHTML =
    `${t.busy ? '<span class="spinner"></span>' : icon("play")}${t.busy ? C.stop : t.result ? C.rerun : C.run}`;
  if (t.busy) {
    result.innerHTML = `<div class="test-result result-busy"><span class="spinner"></span>${C.running}</div>`;
    return;
  }
  if (!t.result) {
    result.innerHTML = `<div class="test-result result-empty"><span>${C.emptyResult}</span><p class="test-model">${e(connection(a.model).model)}</p></div>`;
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
  if (requiresInstructions(state.editor) && !state.editor.instruction.trim()) {
    notify(C.required, "error");
    return;
  }
  if (!state.trial.text.trim()) {
    notify(C.real.errors.invalidInput, "error");
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
  if (!a.name.trim() || (requiresInstructions(a) && !a.instruction.trim())) {
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
    <div class="settings-section"><div class="field-label">${C.textColor}</div><div class="swatches">${button(target === "page" ? C.real.pageColor : C.defaultTextColor, "swatch", "", "", `data-color="auto" aria-pressed="${s.color === "auto"}"`)}${button(C.themeColor, "swatch", "", "palette", `data-color="theme" aria-pressed="${s.color === "theme"}"`)}<div class="swatch-colors">${resultColorPresets.map((preset, i) => swatch(preset.id, C.paletteNames[i])).join("")}${(data.customColors ?? []).map((color) => `<span class="custom-swatch">${swatch(color, C.customColor(color))}${iconButton(C.removeColor(color), "remove-color", "close", `data-value="${e(color)}" data-color-remove`, false)}</span>`).join("")}<span class="color-picker"><button type="button" class="color-trigger" id="result-color" data-op="pick-color" aria-label="${e(C.picker.choose)}" data-tooltip="${e(C.picker.choose)}" aria-haspopup="dialog" aria-expanded="false"><span aria-hidden="true"></span></button>${iconButton(C.addColor, "add-color", "plus")}</span></div></div></div>
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
  const target = state.appearanceTarget,
    preview = C.appearanceSample;
  const node = document.querySelector<HTMLElement>("#style-preview-content")!;
  const picker = document.querySelector<HTMLButtonElement>("#result-color")!;
  const color = data.appearance[target].color;
  document
    .querySelectorAll<HTMLElement>('.swatches [data-color^="preset:"]')
    .forEach((swatch) => {
      swatch.style.background = resultColor(
        swatch.dataset.color!,
        document.documentElement.dataset.theme,
      );
    });
  picker.value = (
    color === "auto" || color === "theme"
      ? getComputedStyle(document.documentElement)
          .getPropertyValue("--result-accent")
          .trim()
      : resultColor(color, document.documentElement.dataset.theme)
  ).toLowerCase();
  picker.style.setProperty("--picked-color", picker.value);
  document.querySelector<HTMLButtonElement>('[data-op="add-color"]')!.disabled =
    color.startsWith("preset:") ||
    (data.customColors ?? []).includes(picker.value);
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
      selection: () => preview.original,
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
      preview.result,
    );
    panel.querySelector<HTMLElement>(".selection-result-status")!.textContent =
      C.real.done;
  } else
    node.innerHTML = `<div class="preview-content"><p class="eyebrow" style="margin-bottom:22px">${e(preview.category)}</p><p class="original-text"><span class="preview-source">${e(preview.original)}</span><span class="processed-text ${data.appearance[target].tint ? "tinted" : ""}" style="${styleVariables(target)}">${e(preview.result)}</span></p></div>`;
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
    invalid =
      d.reasoningEffort !== undefined && !levels.includes(d.reasoningEffort);
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
  const duplicate = document.querySelector<HTMLButtonElement>(
    '[data-op="duplicate-connection"]',
  );
  if (duplicate) duplicate.disabled = Boolean(connectionTest);
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
    </div>${
      purpose === "generation"
        ? `<details class="advanced" id="connection-advanced"><summary>${C.real.advancedSettings}</summary><div class="advanced-body connection-form">${
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
          }${d.protocol !== "chat" ? `<label class="field"><span class="field-label">${C.real.maxTokens}</span><input type="number" min="1" data-connection="maxTokens" value="${d.maxTokens}"></label>` : ""}${(
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
    <div class="connection-detail-actions">${!isNew ? button(C.real.removeConnection, "remove-connection", "danger") : ""}${button(connectionTest ? C.testingConnection : C.testConnection, "test-connection", "", "", connectionTest ? "disabled" : "")}${!isNew ? button(C.duplicateConnection, "duplicate-connection", "", "copy", connectionTest ? "disabled" : "") : ""}<span class="grow"></span>${button(C.cancel, "cancel-connection", "ghost")}${button(C.save, "save-connection", "primary", "check", connectionTest || !d.models?.some((model) => model.id === d.model) ? "disabled" : "")}</div>
    <p class="connection-note">${C.connectionNote}</p></section></div>`;
}
function refreshConnections() {
  const root = app.querySelector<HTMLElement>(".workspace")!;
  const list = root.querySelector<HTMLElement>(".connection-items");
  const scroll = { top: list?.scrollTop || 0, left: list?.scrollLeft || 0 };
  tips.hide(true);
  closeMenu();
  root.innerHTML = renderConnections();
  enhanceSelects(root);
  if (connectionDraft.id)
    root.querySelector<HTMLElement>(".connection-items")?.scrollTo(scroll);
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
  refreshConnections();
}
async function duplicateConnection() {
  const source = connectionDraft;
  if (!source.id || connectionTest) return;
  const draft = structuredClone(source);
  const stored = data.connections.find(
    (connection) => connection.id === source.id,
  )!;
  let key = draft.key || "";
  if (!key && new URL(draft.url).origin === new URL(stored.url).origin) {
    const { credentials } = await chrome.storage.local.get<{
      credentials: Record<string, string>;
    }>("credentials");
    key = credentials[source.id] || "";
  }
  if (connectionDraft !== source) return;
  connectionDraft = {
    ...draft,
    id: null,
    name: `${draft.name} · ${C.copiedSuffix}`,
    connected: false,
    hasKey: false,
    key,
  };
  initialConnectionDraft = JSON.stringify(connectionDraft);
  refreshConnections();
  document
    .querySelector<HTMLInputElement>('[data-connection="name"]')!
    .select();
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
    const clicked = event.target as HTMLElement;
    const target = clicked.closest("button");
    if (!target) {
      if (
        state.route === "home" &&
        state.collectionSearchOpen &&
        !dialog.open &&
        app.contains(clicked) &&
        !clicked.closest(
          ".collection-search,a,input,select,textarea,summary,label",
        )
      )
        setCollectionSearchOpen(false);
      return;
    }
    if (target.disabled) return;
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
        `<h2>${C.usage.cacheClearTitle}</h2><p>${C.usage.cacheClearText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close", "ghost")}${button(C.usage.cacheClear, "cache-clear", "danger dialog-delete")}</div>`,
        { showClose: false },
      );
    } else if (op === "cache-clear") {
      await request("cache.clear");
      closeDialog(() => {
        void loadUsage();
        notify(C.usage.cacheCleared);
      });
    } else if (op === "usage-details") {
      await showUsageDetails(target.dataset.id!);
    } else if (op === "usage-more") {
      if (!usageView.loading) await loadUsage("more");
    } else if (op === "usage-reload") {
      await loadUsage();
    } else if (op === "usage-clear-ask") {
      showDialog(
        `<h2>${C.usage.clearTitle}</h2><p>${C.usage.clearText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close", "ghost")}${button(C.usage.clear, "usage-clear", "danger dialog-delete")}</div>`,
        { showClose: false },
      );
    } else if (op === "usage-clear") {
      await request("usage.clear");
      await loadUsage();
      closeDialog(() => {
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
        `<h2>${C.home.removeTitle}</h2><p>${C.home.removeText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close", "ghost")}${button(C.remove, "collection-remove", "danger dialog-delete")}</div>`,
        { showClose: false },
      );
    } else if (op === "collection-remove") {
      await request("collection.remove", { id: openCollectionId });
      await reloadData();
      closeDialog(() => {
        render();
        notify(C.home.removed);
      });
    } else if (op === "daily-hide-ask") {
      showDialog(
        `<h2>${C.home.dailyHideTitle}</h2><p>${C.home.dailyHideText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close", "ghost")}${button(C.home.dailyHide, "daily-hide", "primary")}</div>`,
        { showClose: false },
      );
    } else if (op === "daily-hide") {
      data.preferences.hideDaily = true;
      if (await persist())
        closeDialog(() => {
          render();
          document
            .querySelector<HTMLButtonElement>('[data-op="daily-restore"]')
            ?.focus();
        });
      else data.preferences.hideDaily = false;
    } else if (op === "daily-restore") {
      data.preferences.hideDaily = false;
      if (await persist()) {
        render();
        document
          .querySelector<HTMLButtonElement>('[data-op="daily-settings"]')
          ?.focus();
      } else data.preferences.hideDaily = true;
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
      if (index < 0 || destination < 0 || destination >= data.actions.length)
        return;
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
        `<h2>${C.removeTitle}</h2><p>${C.removeText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close", "ghost")}${button(C.remove, "remove-confirm", "danger dialog-delete")}</div>`,
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
    } else if (op === "pick-color") {
      const trigger = target as HTMLButtonElement;
      showColorPicker(trigger, trigger.value, (color, commit) => {
        data.appearance[state.appearanceTarget].color = color;
        document
          .querySelectorAll<HTMLElement>(".swatches [data-color]")
          .forEach((swatch) => {
            swatch.classList.toggle("active", swatch.dataset.color === color);
            swatch.setAttribute(
              "aria-pressed",
              String(swatch.dataset.color === color),
            );
          });
        renderStylePreview();
        if (commit) void persist();
      });
    } else if (op === "add-color") {
      const color =
        document.querySelector<HTMLButtonElement>("#result-color")!.value;
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
    } else if (op === "duplicate-connection") {
      await duplicateConnection();
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
        `<h2>${C.real.removeConnection}</h2><p>${C.real.removeConnectionText}</p><div class="dialog-actions">${button(C.cancel, "dialog-close", "ghost")}${button(C.remove, "remove-connection-confirm", "danger dialog-delete")}</div>`,
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
      refreshConnections();
      notify(C.defaultChanged);
    } else if (op === "swap-languages") {
      const action = state.editor;
      if (!action || followsInstructionLanguage(action)) return;
      [action.sourceLanguage, action.targetLanguage] = [
        resolveOutputLanguage(action.targetLanguage, locale),
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
  // Renaming keeps the model picker mounted so blur does not swallow its next click.
  if (field !== "model" && field !== "name") syncConnectionControls();
  else if (field === "model") {
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
    refreshConnections();
  } else if (t.dataset.connection) {
    updateConnectionField(t.dataset.connection, t.value);
    if (t.dataset.connection === "protocol") refreshConnections();
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
    await loadUsage("reset");
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
if (state.route === "usage") void loadUsage();
void refreshDailyOnVisit();
