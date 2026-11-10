import {
  actionAvailable,
  translationEngine,
  usesModel,
} from "./translation-engine.js";
import { isFirefox, requiresDirectPermissionRequest } from "./browser.js";
import {
  detectNativeLanguage,
  NativeTranslationSession,
} from "./native-translation.js";
import { trackNativePacks } from "./native-pack-channel.js";
import { TextTranslationPanel } from "./text-translation.js";
import { NativeDownloadNotice } from "./native-download-notice.js";
import { nativeProgressText } from "./native-packs.js";
import contentStyles from "../content-ui.css";
import themeStyles from "../content-themes.css";
import selectionStyles from "../selection-tools.css";
import { resolveLocale } from "./locale.js";
import { escapeHtml as escape } from "./html.js";
import { HoverTips } from "./hover-tips.js";
import { resultColor } from "./theme.js";
import { nextLightsMode, resolveWebsite } from "./website.js";
import brandMark from "../icons/brand-mark.svg";
import {
  request as send,
  processRequest as process,
  completionText,
} from "./client.js";
import {
  SelectionTools,
  bindPanelGeometry,
  dockPanelPosition,
  panelResizeButton,
  selectedPageText,
  selectionResultMarkup,
} from "./selection-tools.js";
import { ModelError, modelError } from "./providers.js";
import { renderMarkdown } from "./result-content.js";
import {
  hasSameLanguages,
  isNumericOnly,
  translationScope,
} from "./translation.js";
import type {
  ProcessJob,
  ProcessPayload,
  ProcessStats,
  ExtractedBlock,
  ResultPart,
  AppearanceTarget,
  TranslationLanguages,
  UiContext,
  Scope,
} from "./types.js";
// Reuse a pending/ready controller; a later entry can retry a failed startup.
globalThis.__pagework =
  globalThis.__pagework?.catch(initializePagework) ?? initializePagework();
async function initializePagework() {
  let config = await send("settings.public"),
    S = config.strings,
    selectedText = "",
    selectedRect: DOMRect | null = null,
    selectionPanelTop: number | null = null,
    selectionPanelLeft: number | null = null,
    currentAction = config.actions[0]?.id,
    scopeOverride: Scope | undefined,
    translation: TranslationLanguages | undefined,
    dockSide: "left" | "right" = "right",
    dockY = 0.5,
    draggedAt = -Infinity,
    run: ProcessJob | null = null,
    pageAuthorization: Promise<boolean> | null = null,
    pageTranslation: {
      readonly busy: boolean;
      readonly error: ReturnType<typeof modelError> | null;
      retry(): void;
      cancel(): void;
    } | null = null,
    blocks: ExtractedBlock[] = [],
    parts: ResultPart[] = [],
    original = "",
    originalContext: UiContext | undefined,
    resultKind: "page" | "selection" = "page",
    pinned = false,
    resultSource = "",
    resultTitle = "",
    stalePage = false;
  const disposeEvent = `__aside_ui_dispose_${chrome.runtime.id}`;
  document.dispatchEvent(new Event(disposeEvent));
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const host = document.createElement("div");
  host.dataset.pagework = "ui";
  // Keep extension-owned controls out of page theme rewriters such as Dark Reader.
  const shadow = host.attachShadow({ mode: "closed" });
  // Keep styling in the controller's bundle: no page-owned extension resource
  // requests can outlive an extension reload or fail when this host is moved.
  shadow.adoptedStyleSheets = [contentStyles, themeStyles, selectionStyles].map(
    (css) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      return sheet;
    },
  );
  document.documentElement.append(host);
  shadow.innerHTML = `<button id="dock" class="dock" data-op="toggle-tools" aria-controls="toolbar radial selection" aria-expanded="false">${brandMark}</button><div id="toolbar" class="panel tools-panel" hidden></div><div id="selection" class="selection-tools" hidden></div><div id="result" class="panel result" hidden></div><div id="notice" class="notice" hidden></div><div id="translation-recovery" class="notice translation-recovery" hidden></div>`;
  const $ = (id: string) => shadow.getElementById(id)!;
  const paths: Record<string, string> = {
    close: "M6 6l12 12M6 18 18 6",
    check: "m5 12 4 4L19 6",
    expand: "m9 5 7 7-7 7",
    collapse: "m15 5-7 7 7 7",
    settings: "M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6",
    book: "M8 3h8a2 2 0 0 1 2 2v16l-6-4-6 4V5a2 2 0 0 1 2-2Z",
    copy: "M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2ZM16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3",
    pin: "m16 3 5 5-4 3-.5 4.5-2 2-8-8 2-2L13 7l3-4ZM10.5 13.5 4 20",
    refresh: "M20 11a8 8 0 1 0-2.4 6M20 4v7h-7",
    down: "m6 9 6 6 6-6",
    text: "M4 5h16M12 5v14M8 19h8M4 5v3M20 5v3",
    page: "M6 3h9l4 4v14H6ZM14 3v5h5M9 12h7M9 16h5",
    play: "M8 5v14l11-7Z",
    stop: "M9 7h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z",
    undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
    more: "M6 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0M13 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0M20 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0",
    sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42",
    moon: "M20.9 13.2A9 9 0 0 1 10.8 3.1 9 9 0 1 0 20.9 13.2Z",
    contrast:
      "M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM8 21h8M12 17v4",
    translate:
      "M4 5h8M8 3v2M5 11c2-1 4-3 5-6M6 7c1 2 3 4 6 5M13 21l4-9 4 9M14.5 18h5",
    plus: "M12 5v14M5 12h14",
    read: "M4 3h7a3 3 0 0 1 3 3v15a4 4 0 0 0-4-2H4Zm10 3a3 3 0 0 1 3-3h3v16h-3a4 4 0 0 0-3 2",
    spark: "m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z",
    explain:
      "M21 14a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3ZM7 8h10M7 12h6",
    question:
      "M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  };
  let radialOpen = false,
    lightsBusy = false;
  const icon = (id: string) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="${paths[id] || paths.spark}"/></svg>`;
  const button = (
    op: string,
    label: string,
    cls = "",
    glyph = "",
    attrs = "",
  ) =>
    `<button ${attrs} data-op="${op}" class="${cls}" aria-label="${escape(label)}">${glyph ? icon(glyph) : escape(label)}</button>`;
  const action = () => {
    const selected = config.actions.find((a) => a.id === currentAction);
    return selected?.kind === "translate" && translation
      ? { ...selected, ...translation }
      : selected;
  };
  const pageScope = () => scopeOverride ?? translationScope(action());
  const errorText = (caught: unknown) => {
    const e = modelError(caught);
    const label =
      e.code === "lightsPermissionRequired"
        ? S.lightsPermissionNeeded
        : S.errors[e.code as keyof typeof S.errors] || S.failed;
    return e.message !== e.code ? `${label}\n${e.message}` : label;
  };
  const nativeNotice = new NativeDownloadNotice(() => config);
  shadow.append(nativeNotice.element);
  const selectionTools = new SelectionTools($("selection"), {
    config: () => config,
    selected: () => currentAction,
    icon: (name) => icon(name === "book" ? "read" : name),
    home: async () => {
      await send("settings.open", {
        route: config.actions.some((a) => actionAvailable(a, config))
          ? "home"
          : "connections",
      });
    },
    selection: () => selectedPageText(),
    run: async (id, text) => {
      if (currentAction !== id) translation = undefined;
      currentAction = id;
      if (action()?.kind === "qa") openQuestion(text, action());
      else await runSelection(text, { fromControl: true });
    },
    dismissResult: () => closeResult(false),
    pinned: () => pinned,
    togglePin: () => {
      pinned = !pinned;
    },
    move: (left, top) => {
      const panel = $("selection");
      selectionPanelLeft = Math.max(
        10,
        Math.min(left, innerWidth - panel.offsetWidth - 10),
      );
      selectionPanelTop = Math.max(
        10,
        Math.min(top, innerHeight - panel.offsetHeight - 10),
      );
      positionSelection();
    },
    saved: (next, id) => {
      config = next;
      S = config.strings;
      currentAction = id;
      translation = undefined;
      toolbar();
    },
    layout: positionSelection,
    error: errorText,
  });
  document.addEventListener(
    "selectionchange",
    () => selectionTools.updateSelection(),
    { signal },
  );
  const textTranslation = new TextTranslationPanel({
    config: () => config,
    error: errorText,
    notify,
    nativeNotice,
  });
  shadow.append(textTranslation.element);
  const panelResize = new ResizeObserver(() => {
    positionSelection();
    positionTools();
    positionResult();
  });
  panelResize.observe($("selection"));
  panelResize.observe($("result"));
  function positionSelection() {
    if ($("selection").hidden) return;
    const panel = $("selection"),
      expanded = panel.matches(".selection-expanded,.selection-showing-result");
    if (!expanded) selectionPanelTop = selectionPanelLeft = null;
    if (selectionPanelTop === null) {
      panel.style.maxHeight = "";
      const top = Math.max(
        10,
        Math.min(
          selectedRect ? selectedRect.bottom + 7 : 10,
          innerHeight - panel.offsetHeight - 10,
        ),
      );
      panel.style.top = `${top}px`;
      if (expanded) selectionPanelTop = top;
    }
    // Anchor the expanded panel once; content grows down within the viewport.
    if (selectionPanelTop !== null) {
      panel.style.top = `${selectionPanelTop}px`;
      panel.style.maxHeight = `${innerHeight - selectionPanelTop - 10}px`;
    }
    panel.style.left = `${Math.max(10, Math.min(selectionPanelLeft ?? selectedRect?.left ?? 10, innerWidth - panel.offsetWidth - 10))}px`;
    selectionTools.refreshTips();
  }
  function theme() {
    host.dataset.palette = config.preferences.palette;
    host.dataset.theme =
      config.preferences.theme === "system"
        ? matchMedia("(prefers-color-scheme:dark)").matches
          ? "dark"
          : "light"
        : config.preferences.theme;
  }
  function notify(text: string | null) {
    $("notice").textContent = text;
    $("notice").hidden = false;
    setTimeout(() => ($("notice").hidden = true), 2500);
  }
  function resultStyle(node: HTMLElement, target: AppearanceTarget) {
    const style = config.appearance[target];
    node.style.setProperty(
      "--pw-color",
      resultColor(style.color, host.dataset.theme),
    );
    node.style.setProperty("--pw-size", `${style.size}px`);
    node.style.setProperty("--pw-line", String(style.line));
    node.style.background = style.tint ? "var(--panel)" : "transparent";
  }
  function positionTools() {
    const dock = $("dock"),
      panel = $("toolbar");
    const top = Math.max(
      8,
      Math.min(
        innerHeight - dock.offsetHeight - 8,
        innerHeight * dockY - dock.offsetHeight / 2,
      ),
    );
    dock.style.top = `${top}px`;
    dock.style.left = dockSide === "left" ? "-4px" : "auto";
    dock.style.right = dockSide === "right" ? "-4px" : "auto";
    dock.dataset.side = dockSide;
    if (radialOpen) positionRadial();
    if (panel.hidden) return;
    const gap = dock.offsetWidth + 8;
    panel.style.left = dockSide === "left" ? `${gap}px` : "auto";
    panel.style.right = dockSide === "right" ? `${gap}px` : "auto";
    panel.style.top = `${Math.max(8, Math.min(top, innerHeight - panel.offsetHeight - 8))}px`;
  }
  function updateDockExpanded() {
    const open =
      radialOpen ||
      !$("toolbar").hidden ||
      (!$("result").hidden &&
        ($("result").classList.contains("selection-from-dock") ||
          (resultKind === "selection" && !$("selection").hidden)));
    $("dock").setAttribute("aria-expanded", String(open));
    $("dock").setAttribute("aria-label", open ? S.collapseTools : S.openTools);
  }
  function showTools(show: boolean, focus = false) {
    if (show && radialOpen) showRadial(false);
    $("toolbar").hidden = !show;
    updateDockExpanded();
    positionTools();
    if (focus)
      (show
        ? $("toolbar").querySelector<HTMLElement>(
            actionAvailable(action(), config)
              ? "[data-op=choose]"
              : "[data-op=open-settings]",
          )
        : $("dock")
      )?.focus();
  }
  const radialEl = document.createElement("div");
  radialEl.id = "radial";
  radialEl.className = "radial";
  shadow.append(radialEl);
  const radialTips = new HoverTips(radialEl, "button", () => radialOpen);
  const radialRadius = 76,
    radialButtonSize = 40;
  // The dock stays above flying buttons so the launcher retains its hit area.
  const radialSheet = new CSSStyleSheet();
  radialSheet.replaceSync(
    `.radial{position:fixed;z-index:2147483646;width:0;height:0}.radial button{position:absolute;left:${-radialButtonSize / 2}px;top:${-radialButtonSize / 2}px;width:${radialButtonSize}px;height:${radialButtonSize}px;padding:0;display:grid;place-items:center;border-radius:50%;cursor:pointer;opacity:0;pointer-events:none;transform:rotate(var(--a)) translate(0) rotate(calc(-1*var(--a))) scale(.4);transition:transform .12s ease-in,opacity .12s ease-in,background-color .16s,color .16s}.radial.open button{opacity:1;pointer-events:auto;transform:rotate(var(--a)) translate(${radialRadius}px) rotate(calc(-1*var(--a))) scale(1);transition:transform .2s cubic-bezier(.34,1.56,.64,1) calc(var(--i)*25ms),opacity .14s ease-out calc(var(--i)*25ms),background-color .16s,color .16s}.radial button:not(:disabled):is(:hover,:focus-visible){background:var(--hover)}.radial button.on{background:var(--selected)}.radial.open button:disabled{opacity:.4;cursor:default}.radial svg{width:18px;height:18px}.dock.radial-open{z-index:2147483647;background:var(--selected)}@media(prefers-reduced-motion:reduce){.radial button,.radial.open button{transition:opacity .12s!important}}`,
  );
  const dockSheet = new CSSStyleSheet();
  dockSheet.replaceSync(
    `.dock{opacity:.45;transition:transform .22s cubic-bezier(.34,1.56,.64,1),opacity .18s,background-color .16s,color .16s}.dock[data-side=right]{transform:translateX(35%)}.dock[data-side=left]{transform:translateX(-35%)}.dock:hover,.dock:focus-visible,.dock.radial-open,.dock[aria-expanded=true],.dock[data-dragging]{opacity:1;transform:none}.radial .lights-toggle.system>svg{fill:none;stroke-width:1.6}@media(prefers-reduced-motion:reduce){.dock{transition:opacity .18s}}`,
  );
  shadow.adoptedStyleSheets = [
    ...shadow.adoptedStyleSheets,
    radialSheet,
    dockSheet,
  ];
  const translateAction = () =>
    config.actions.find((a) => a.kind === "translate");
  const questionAction = () =>
    config.actions.find((action) => action.kind === "qa");
  async function openTextTranslation(fromDock = false) {
    if (!actionAvailable(translateAction(), config)) {
      await send("settings.open", { route: "connections" });
      return;
    }
    const translate = translateAction();
    if (!translate) return;
    showRadial(false);
    showTools(false);
    closeResult();
    $("selection").hidden = true;
    textTranslation.open(translate, fromDock ? $("dock") : undefined);
  }
  function openQuestion(
    quote = selectedPageText(),
    qa = questionAction(),
    source: "selection" | "dock" | "page" | "shortcut" = "selection",
  ) {
    if (!qa) return;
    const integrated = source === "selection",
      fromDock = source === "dock";
    if (fromDock || source === "shortcut") quote = "";
    textTranslation.close();
    const tools = $("selection");
    const anchor = !tools.hidden ? tools.getBoundingClientRect() : null;
    showRadial(false);
    showTools(false);
    cancelPageTranslation();
    run?.cancel();
    run = null;
    currentAction = qa.id;
    translation = undefined;
    resultKind = "selection";
    parts = [];
    selectionPanelTop = selectionPanelLeft = null;
    tools.style.maxHeight = "";
    const panel = $("result");
    if (fromDock || source === "shortcut") panel.style.cssText = "";
    panel.classList.toggle("selection-from-dock", fromDock);
    panel.innerHTML =
      (integrated ? "" : resultHeader(qa.name, false)) +
      `<div id="question" class="question-panel" data-action-id="${escape(qa.id)}"><div class="selection-settings">${quote ? `<div class="question-reference"><div class="question-reference-heading"><span class="field-label">${escape(S.questionQuote)}</span>${button("question-clear-quote", S.clearQuestionQuote, "selection-button selection-text-button")}</div><blockquote id="question-quote">${escape(quote)}</blockquote></div>` : ""}<label><span class="field-label">${escape(S.questionLabel)}</span><textarea id="question-input" aria-label="${escape(S.questionLabel)}" placeholder="${escape(S.questionPlaceholder)}"></textarea></label></div><div class="${integrated ? "selection-settings-footer" : "selection-result-footer"}">${button("question-close", S.cancel, "selection-button selection-text-button")}${integrated ? "" : '<div class="selection-result-meta"></div>'}${button("question-run", S.answerQuestion, "selection-button selection-text-button", "", 'disabled aria-keyshortcuts="Meta+Enter Control+Enter"')}</div></div>`;
    mountResult(integrated, true);
    if (integrated) {
      const bounds = tools.getBoundingClientRect();
      selectionPanelTop = Math.max(
        10,
        Math.min(anchor?.top ?? bounds.top, innerHeight - bounds.height - 10),
      );
      selectionPanelLeft = anchor?.left ?? bounds.left;
      positionSelection();
    } else {
      const position = fromDock ? dockPanelPosition(panel, $("dock")) : null;
      positionResult(position?.left, position?.top);
    }
    toolbar();
    panel.querySelector<HTMLTextAreaElement>("textarea")!.focus();
  }
  async function submitQuestion() {
    const panel = $("question");
    if (!panel || panel.closest("[hidden]")) return;
    const question = ($("question-input") as HTMLTextAreaElement).value.trim();
    const qa = config.actions.find(
      (action) => action.id === panel.dataset.actionId && action.kind === "qa",
    );
    if (!question || !qa) return;
    const quote = panel.querySelector("#question-quote")?.textContent || "";
    const text = quote
      ? `${S.questionLabel}:\n${question}\n\n${S.questionQuote}:\n${quote
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}`
      : question;
    currentAction = qa.id;
    translation = undefined;
    await runSelection(text, {
      integrated: $("result").classList.contains("selection-result"),
    });
  }
  function useTranslate() {
    const t = translateAction();
    if (!t || currentAction === t.id) return;
    restore();
    currentAction = t.id;
    translation = undefined;
    toolbar();
  }
  function translationState() {
    if (pageTranslation?.error) return "paused";
    if (
      pageTranslation?.busy ||
      (resultKind === "page" && run && action()?.kind === "translate")
    )
      return "processing";
    return pageTranslation ||
      document.querySelector(
        '[data-pagework="result"][data-kind="translate"]',
      ) ||
      (resultKind === "page" &&
        !$("result").hidden &&
        action()?.kind === "translate" &&
        parts.length)
      ? "translated"
      : "original";
  }
  const pageRetryLabel = () =>
    pageTranslation?.error?.code === "translationPermission"
      ? S.translation.microsoftAuthorize
      : S.translation.retryContinue;
  let translationIndicatorState: ReturnType<typeof translationState> =
      "original",
    translationIndicatorTimer: number | undefined;
  const translationSettleMs = 600;
  function updateTranslationButton() {
    const next = translationState();
    if (next === "translated" && translationIndicatorState === "processing") {
      // Adjacent batches share one blue period. Only the completion display
      // waits for quiet time; translation requests still start immediately.
      translationIndicatorTimer ??= window.setTimeout(() => {
        translationIndicatorTimer = undefined;
        translationIndicatorState = translationState();
        renderTranslationButton();
      }, translationSettleMs);
    } else {
      clearTimeout(translationIndicatorTimer);
      translationIndicatorTimer = undefined;
      translationIndicatorState = next;
    }
    renderTranslationButton();
  }
  function renderTranslationButton() {
    const target = radialEl.querySelector<HTMLButtonElement>(
      '[data-op="page-translate"]',
    );
    if (!target) return;
    target.dataset.translationState = translationIndicatorState;
    target.setAttribute(
      "aria-label",
      translationIndicatorState === "paused"
        ? `${S.translation.paused} · ${pageRetryLabel()}`
        : S.translationStates[translationIndicatorState],
    );
    target.setAttribute(
      "aria-pressed",
      String(translationIndicatorState !== "original"),
    );
    target.setAttribute(
      "aria-busy",
      String(translationIndicatorState === "processing"),
    );
    radialTips.refresh();
  }
  function radial() {
    radialTips.hide(true);
    const tr = translateAction(),
      qa = questionAction(),
      configured = config.actions.some((a) => actionAvailable(a, config)),
      lightsMode = websiteFeatures().lights,
      slots = [
        button("open-settings", S.settings, "", "settings"),
        button(
          "page-translate",
          S.translationStates.original,
          "",
          "translate",
          actionAvailable(tr, config) ? "" : "disabled",
        ),
        button(
          "toggle-lights",
          lightsMode === "on"
            ? S.lightsEnabled
            : lightsMode === "system"
              ? S.lightsSystem
              : S.lightsDisabled,
          lightsMode === "system" ? "lights-toggle system" : "lights-toggle",
          lightsMode === "off"
            ? "sun"
            : lightsMode === "system"
              ? "contrast"
              : "moon",
          `aria-pressed="${lightsMode !== "off"}" ${!configured || lightsBusy ? "disabled" : ""}`,
        ),
        button(
          "quick-question",
          qa?.name || S.quickQuestion,
          "",
          "question",
          actionAvailable(qa, config) ? "" : "disabled",
        ),
        button(
          "text-translate",
          S.textTranslation,
          "",
          "text",
          actionAvailable(tr, config) ? "" : "disabled",
        ),
      ];
    radialEl.innerHTML = slots
      .map((markup) =>
        markup.replace(
          "<button ",
          `<button tabindex="${radialOpen ? 0 : -1}" `,
        ),
      )
      .join("");
    radialEl.append(radialTips.element);
    positionRadial();
    updateTranslationButton();
    updateRadialHint();
  }
  function updateRadialHint() {
    radialTips.setHint(
      radialOpen &&
        radialEl.classList.contains("open") &&
        !config.actions.some((a) => actionAvailable(a, config))
        ? radialEl.querySelector<HTMLElement>('[data-op="open-settings"]')
        : null,
      S.configureModelHint,
    );
  }
  function positionRadial() {
    const dock = $("dock"),
      buttons = [
        ...radialEl.querySelectorAll<HTMLButtonElement>(":scope>button"),
      ],
      n = buttons.length,
      spread = Math.min(150, 34 * (n - 1)),
      bias = dockY < 0.2 ? 35 : dockY > 0.8 ? -35 : 0,
      center = dockSide === "right" ? 180 - bias : bias,
      angles = buttons.map(
        (_, i) =>
          center +
          (dockSide === "right" ? 1 : -1) *
            (spread / 2 - (n > 1 ? (spread / (n - 1)) * i : 0)),
      ),
      xs = angles.map(
        (angle) => Math.cos((angle * Math.PI) / 180) * radialRadius,
      ),
      ys = angles.map(
        (angle) => Math.sin((angle * Math.PI) / 180) * radialRadius,
      ),
      inset = radialButtonSize / 2 + 8;
    // Set valid transforms before reading layout so new buttons animate from
    // their collapsed/expanded pose, rather than the default transform: none.
    for (const [index, button] of buttons.entries()) {
      button.style.setProperty("--i", String(index));
      button.style.setProperty("--a", `${angles[index]}deg`);
    }
    // The entire arc stays reachable when the dock is dragged to a corner.
    radialEl.style.left = `${Math.max(inset - Math.min(...xs), Math.min(dock.offsetLeft + dock.offsetWidth / 2, innerWidth - inset - Math.max(...xs)))}px`;
    radialEl.style.top = `${Math.max(inset - Math.min(...ys), Math.min(dock.offsetTop + dock.offsetHeight / 2, innerHeight - inset - Math.max(...ys)))}px`;
    radialEl.dataset.side = dockSide;
    radialTips.refresh();
  }
  function showRadial(open: boolean, focus = false) {
    radialOpen = open;
    if (open) showTools(false);
    radial();
    void radialEl.offsetWidth;
    radialEl.classList.toggle("open", open);
    updateRadialHint();
    $("dock").classList.toggle("radial-open", open);
    updateDockExpanded();
    if (focus)
      (open
        ? radialEl.querySelector<HTMLElement>("button:not([disabled])")
        : $("dock")
      )?.focus();
  }
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (radialOpen && !event.composedPath().includes(host)) showRadial(false);
    },
    { capture: true, signal },
  );
  function languageFields() {
    const selected = action();
    if (selected?.kind !== "translate") return "";
    return `<div class="languages">${(
      ["sourceLanguage", "targetLanguage"] as const
    )
      .map(
        (field) =>
          `<label><span>${escape(S[field])}</span><select data-language="${field}" aria-label="${escape(S[field])}" ${run ? "disabled" : ""}>${field === "targetLanguage" ? `<option value="interface" ${selected[field] === "interface" ? "selected" : ""}>${escape(S.followInterfaceLanguage)}</option>${usesModel(selected) ? `<option value="instruction" ${selected[field] === "instruction" ? "selected" : ""} ${selected.instruction.trim() ? "" : "disabled"}>${escape(S.followInstructionLanguage)}</option>` : ""}` : ""}${Object.entries(
            S.languages,
          )
            .filter(([value]) => field === "sourceLanguage" || value !== "auto")
            .map(
              ([value, label]) =>
                `<option value="${value}" ${selected[field] === value ? "selected" : ""}>${escape(label)}</option>`,
            )
            .join("")}</select></label>`,
      )
      .join("")}</div>`;
  }
  const websiteFeatures = () =>
    resolveWebsite(config.website, location.hostname);
  function applyWebsiteFeatures() {
    const features = websiteFeatures();
    $("dock").hidden = !features.floating;
    if (!features.floating) {
      showRadial(false);
      showTools(false);
    }
    if (!features.toolbar) {
      selectedText = "";
      if (resultKind === "selection" && !$("result").hidden) closeResult();
      $("selection").hidden = true;
    }
  }
  function toolbar(status = "") {
    host.lang = resolveLocale(config.preferences.locale);
    const chosen = action(),
      same = hasSameLanguages(chosen, resolveLocale(config.preferences.locale));
    const dock = $("dock");
    const busy = Boolean(run || pageTranslation?.busy);
    const paused = pageTranslation?.error;
    if (paused)
      status = `${S.translation.paused} · ${pageTranslationError(paused)}`;
    dock.hidden = !websiteFeatures().floating;
    updateDockExpanded();
    $("toolbar").setAttribute("aria-busy", String(busy));
    $("toolbar").innerHTML =
      `<div class="header"><button class="icon tools-brand" data-op="open-settings" aria-label="${escape(S.settings)}">${brandMark}</button><strong>${escape(S.currentPage)}</strong>${button("open-settings", S.settings, "icon", "settings")}${button("hide-toolbar", S.collapseTools, "icon", "close")}</div><div class="body"><button class="choose" data-op="choose">${escape(chosen?.name || S.noConnection)}${icon("down")}</button><div id="actions" class="menu" hidden>${config.actions.map((a: { id: string; name: string }) => `<button data-action="${escape(a.id)}" class="${a.id === currentAction ? "active" : ""}">${escape(a.name)}</button>`).join("")}</div>${languageFields()}<div class="row scope">${button("scope-body", S.body, pageScope() === "body" ? "primary" : "")}${button("scope-all", S.all, pageScope() === "all" ? "primary" : "")}</div><div class="row">${button("run", paused ? pageRetryLabel() : run || pageTranslation ? S.stop : S.start, "primary", "", same && !run && !pageTranslation ? "disabled" : "")}${button("restore", S.restore)}${parts.length && !busy ? button("refresh-page", S.regenerate, "icon", "refresh", same ? "disabled" : "") : ""}${parts.length ? button("bookmark", S.bookmark, "icon", "book") : ""}</div><div id="status" class="status" role="status">${escape(same ? S.errors.sameLanguages : status)}</div></div>`;
    if (!actionAvailable(chosen, config))
      $("toolbar")
        .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
          '[data-op="run"], [data-op="refresh-page"]',
        )
        .forEach((control) => {
          control.disabled = true;
        });
    positionTools();
    updateTranslationButton();
    renderTranslationRecovery();
  }
  function pageTranslationError(error: ModelError) {
    return error.code === "translationPermission"
      ? S.translation.microsoftNotice
      : errorText(error);
  }
  function renderTranslationRecovery() {
    const notice = $("translation-recovery");
    const error = pageTranslation?.error;
    notice.hidden = !error;
    if (!error) return;
    const markup = `<div role="alert"><strong>${escape(S.translation.paused)}</strong><span>${escape(pageTranslationError(error))}</span></div><div class="translation-recovery-actions">${button("restore", S.restore)}${button("retry-page", pageRetryLabel())}</div>`;
    if (notice.innerHTML !== markup) notice.innerHTML = markup;
  }
  function translationAllowed() {
    if (!hasSameLanguages(action(), resolveLocale(config.preferences.locale)))
      return true;
    toolbar(S.errors.sameLanguages);
    showTools(true);
    return false;
  }
  async function pageStatus(done: boolean, error?: string) {
    try {
      await chrome.runtime.sendMessage({
        type: "page.status",
        done,
        error,
        completed: parts.length,
        total: blocks.length,
        parts,
      });
    } catch {
      // A reloaded extension invalidates content scripts in existing documents.
    }
  }
  const pageLayout = new Map<HTMLElement, Map<string, [string, string]>>();
  function adjustPageLayout(
    element: HTMLElement,
    property: string,
    value: string,
  ) {
    let properties = pageLayout.get(element);
    if (!properties) {
      properties = new Map();
      pageLayout.set(element, properties);
    }
    if (!properties.has(property))
      properties.set(property, [
        element.style.getPropertyValue(property),
        element.style.getPropertyPriority(property),
      ]);
    element.style.setProperty(property, value, "important");
  }
  function fitPageResult(result: HTMLElement) {
    for (
      let element = result.parentElement;
      element && element !== document.body;
      element = element.parentElement
    ) {
      const style = getComputedStyle(element);
      if (
        ["fixed", "absolute"].includes(style.position) ||
        ["auto", "scroll"].includes(style.overflowY)
      )
        break;
      if (
        element.clientHeight &&
        result.getBoundingClientRect().bottom >
          element.getBoundingClientRect().bottom -
            parseFloat(style.borderBottomWidth) +
            1 &&
        element.scrollHeight > element.clientHeight
      ) {
        adjustPageLayout(element, "height", "auto");
        adjustPageLayout(element, "max-height", "none");
      }
    }
  }
  function cancelPageTranslation() {
    pageAuthorization = null;
    pageTranslation?.cancel();
  }
  function restore() {
    cancelPageTranslation();
    run?.cancel();
    run = null;
    for (const el of document.querySelectorAll<HTMLElement>(
      '[data-pagework="result"]',
    ))
      el.remove();
    for (const [element, properties] of pageLayout) {
      for (const [property, [value, priority]] of properties) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
      if (!element.getAttribute("style")) element.removeAttribute("style");
    }
    pageLayout.clear();
    parts = [];
    stalePage = false;
    $("result").hidden = true;
    selectionTools.updateResultVisibility();
    toolbar();
    pageStatus(true);
  }
  function resetPageTools() {
    textTranslation.close();
    selectedText = "";
    selectedRect = null;
    selectionPanelTop = selectionPanelLeft = null;
    pinned = false;
    blocks = [];
    original = resultSource = resultTitle = "";
    originalContext = undefined;
    getSelection()?.removeAllRanges();
    restore();
    $("result").replaceChildren();
    $("selection").hidden = true;
    selectionTools.reset();
    showTools(false);
    showRadial(false);
    $("notice").hidden = true;
  }
  function isDocumentFragment(hash: string) {
    const fragment = hash.slice(1).split(":~:")[0];
    const hasTarget = (id: string) =>
      Boolean(document.getElementById(id)) ||
      [...document.getElementsByName(id)].some(
        (element) => element instanceof HTMLAnchorElement,
      );
    if (!fragment || hasTarget(fragment)) return true;
    try {
      const decoded = decodeURIComponent(fragment);
      return decoded.toLowerCase() === "top" || hasTarget(decoded);
    } catch {
      return false;
    }
  }
  // Same-page section links keep the reading session. Unknown fragments can
  // belong to hash routers, so only actual document anchors bypass cleanup.
  window.navigation.addEventListener(
    "currententrychange",
    (event) => {
      const previous = (event as Event & { from: NavigationHistoryEntry }).from;
      if (previous.url === location.href) return;
      const before = previous.url ? new URL(previous.url) : null;
      const after = new URL(location.href);
      if (
        before &&
        before.origin === after.origin &&
        before.pathname === after.pathname &&
        before.search === after.search &&
        isDocumentFragment(before.hash) &&
        isDocumentFragment(after.hash)
      )
        return;
      resetPageTools();
    },
    { signal },
  );
  // Clear before a document is cached so Back cannot restore an old open panel.
  addEventListener("pagehide", resetPageTools, { signal });
  function placeResults(results: ResultPart[]) {
    for (const part of results) {
      const block = blocks.find((b) => b.id === part.id);
      if (
        !block?.element.isConnected ||
        !PageworkExtract.extract(pageScope(), block.element).some(
          (current) => current.id === part.id && current.text === part.source,
        )
      ) {
        stalePage = true;
        continue;
      }
      // Extraction already normalizes source whitespace. Compare before creating
      // a result node so unchanged translations do not alter the page layout.
      if (
        action()?.kind === "translate" &&
        part.text.replace(/\s+/g, " ").trim() === part.source
      )
        continue;
      let result = block.element.querySelector<HTMLElement>(
        `:scope>[data-pagework="result"][data-id="${part.id}"]`,
      );
      if (!result) {
        result = document.createElement("span");
        result.dataset.pagework = "result";
        result.dataset.id = part.id;
        result.dataset.kind = action()?.kind;
        const text = document.createElement("span");
        text.dataset.pagework = "text";
        const line = document.createElement("span");
        line.dataset.pagework = "line";
        line.append(text);
        result.attachShadow({ mode: "open" }).append(line);
        block.element.append(result);
      }
      const text = result.shadowRoot!.querySelector<HTMLElement>(
        '[data-pagework="text"]',
      )!;
      text.textContent = part.text;
      stylePageResult(result);
      fitPageResult(result);
    }
  }
  function controlLabel(element: HTMLElement) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement!;
        return node.textContent?.trim() &&
          !parent.closest("script,style,svg,[data-pagework],[hidden]") &&
          parent.getClientRects().length &&
          getComputedStyle(parent).visibility === "visible"
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    return walker.nextNode();
  }
  function stylePageResult(result: HTMLElement) {
    const style = config.appearance.page,
      source = result.parentElement!,
      sourceStyle = getComputedStyle(source),
      control = source.matches("a,button,[role=button]"),
      flex = ["flex", "inline-flex"].includes(sourceStyle.display),
      horizontal = flex && sourceStyle.flexDirection.startsWith("row"),
      label = control ? controlLabel(source) : null,
      labelStyle = label ? getComputedStyle(label.parentElement!) : sourceStyle,
      color =
        style.color === "auto"
          ? labelStyle.color
          : style.color === "theme"
            ? getComputedStyle(host).getPropertyValue("--result-accent").trim()
            : resultColor(style.color, host.dataset.theme);
    const textAlign = control ? "left" : sourceStyle.textAlign;
    if (horizontal) {
      adjustPageLayout(source, "flex-wrap", "wrap");
      // The existing gap spaces items on the original row, not bilingual rows.
      if (control) adjustPageLayout(source, "row-gap", "0px");
    }
    const typography = control
      ? [
          "font-family",
          "font-size",
          "font-weight",
          "font-style",
          "line-height",
          "letter-spacing",
        ]
          .map(
            (property) =>
              `${property}:${labelStyle.getPropertyValue(property)}!important;`,
          )
          .join("")
      : "";
    result.style.cssText = `display:block!important;box-sizing:border-box!important;font:inherit!important;${typography}text-align:${textAlign}!important;text-indent:0!important;margin:${control ? "0.2em" : "0.45em"} 0 0!important;padding:0!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important;min-width:0!important;max-width:100%!important;${style.customTypography ? `font-size:${style.size}px!important;line-height:${style.line}!important;` : ""}${horizontal ? "flex:0 0 100%!important;width:0!important;" : ""}${sourceStyle.display.includes("grid") ? "grid-column:1 / -1!important;" : ""}`;
    let inset = 0;
    if (label) {
      const range = document.createRange();
      range.selectNodeContents(label);
      // Match the actual text edge, including nested padding and leading icons.
      // Recomputed by the existing resize/style update path for responsive pages.
      inset = Math.max(
        0,
        range.getBoundingClientRect().left -
          result.getBoundingClientRect().left,
      );
    }
    // The inset belongs inside the row; padding on the flex item itself would
    // widen intrinsically sized buttons and move the original label again.
    // Dark Reader and other page tools can prepend their own shadow styles.
    // Only our explicitly marked nodes belong to the translation layout.
    const line = result.shadowRoot!.querySelector<HTMLElement>(
      '[data-pagework="line"]',
    )!;
    line.style.cssText = `font:inherit;color:${color};${control ? `display:block;margin-left:${inset}px;` : ""}`;
    const text = line.querySelector<HTMLElement>('[data-pagework="text"]')!;
    text.style.cssText = `font:inherit;${style.tint ? `background:rgba(128,128,128,.12);padding:4px 7px;border-radius:calc(4px * ${getComputedStyle(host).getPropertyValue("--corner-radius-scale")});corner-shape:${getComputedStyle(host).getPropertyValue("--corner-shape")};` : ""}`;
  }
  function startPageTranslation(refresh: boolean) {
    // Only near-viewport paragraphs enter the existing cache/batch scheduler.
    // This session survives idle periods; finite process jobs do not.
    const preloadPx = 600,
      collectMs = 80;
    type Entry = {
      block: ExtractedBlock;
      state: "waiting" | "pending" | "processing" | "done";
      result?: ResultPart;
    };
    const entries = new Map<HTMLElement, Entry>(),
      jobs = new Set<ProcessJob>(),
      changed = new Set<HTMLElement>(),
      actionId = currentAction,
      chosen = action(),
      languages = translation,
      detection = new AbortController();
    let detectedLanguages: Promise<TranslationLanguages> | undefined;
    let nativeSession =
      translationEngine(chosen) === "browser"
        ? new NativeTranslationSession()
        : undefined;
    let failure: ReturnType<typeof modelError> | null = null;
    function resolveLanguages() {
      if (
        translationEngine(chosen) !== "browser" ||
        (chosen?.sourceLanguage && chosen.sourceLanguage !== "auto")
      )
        return languages;
      // Short labels are unreliable detection samples. Resolve the source once
      // from the page's extracted original text and reuse it across scroll jobs.
      return (detectedLanguages ??= (async () => {
        const download = nativeNotice.track();
        try {
          const sourceLanguage = await trackNativePacks(
            (report) =>
              detectNativeLanguage(
                [...entries.values()]
                  .map((entry) => entry.block.text)
                  .join("\n\n"),
                detection.signal,
                report,
                download.waitForActivation,
              ),
            detection.signal,
            download.report,
          );
          return {
            sourceLanguage,
            targetLanguage: chosen?.targetLanguage || "interface",
          };
        } catch (error) {
          detectedLanguages = undefined;
          throw error;
        } finally {
          download.clear();
        }
      })());
    }
    let flushTimer: number | undefined,
      scanTimer: number | undefined,
      stats: ProcessStats = { total: 0, hits: 0, shared: 0, requests: 0 };
    const session = {
      get error() {
        return failure;
      },
      get busy() {
        return (
          !failure &&
          (jobs.size > 0 ||
            flushTimer !== undefined ||
            [...entries.values()].some(
              (entry) =>
                entry.state === "pending" || entry.state === "processing",
            ))
        );
      },
      retry() {
        if (pageTranslation !== session || !failure) return;
        if (nativeSession) nativeSession = new NativeTranslationSession();
        failure = null;
        scan();
        for (const entry of entries.values()) {
          if (entry.result) continue;
          entry.state = "waiting";
          observer.unobserve(entry.block.element);
          observer.observe(entry.block.element);
        }
        flushTimer = window.setTimeout(flush, collectMs);
        publish();
      },
      cancel() {
        if (pageTranslation === session) {
          pageTranslation = null;
          renderTranslationRecovery();
        }
        detection.abort();
        nativeSession?.destroy();
        observer.disconnect();
        mutations.disconnect();
        clearTimeout(flushTimer);
        clearTimeout(scanTimer);
        for (const job of jobs) job.cancel();
        jobs.clear();
        changed.clear();
      },
    };
    const observer = new IntersectionObserver(
      (intersections) => {
        for (const intersection of intersections) {
          const entry = entries.get(intersection.target as HTMLElement);
          if (!entry || entry.state === "done" || entry.state === "processing")
            continue;
          entry.state = intersection.isIntersecting ? "pending" : "waiting";
        }
        if (!failure && flushTimer === undefined)
          flushTimer = window.setTimeout(flush, collectMs);
      },
      { rootMargin: `${preloadPx}px 0px` },
    );
    function publish() {
      const requested = [...entries.values()]
        .filter((entry) => entry.state !== "waiting")
        .sort((a, b) =>
          a.block.element.compareDocumentPosition(b.block.element) &
          Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1,
        );
      blocks = requested.map((entry) => entry.block);
      parts = requested.flatMap((entry) =>
        entry.result ? [entry.result] : [],
      );
      original = parts.map((part) => part.source).join("\n\n");
      toolbar(
        session.busy
          ? `${parts.length} / ${blocks.length}`
          : completionText(S, stats),
      );
      pageStatus(!session.busy, failure?.code);
    }
    function forget(element: HTMLElement, entry: Entry) {
      observer.unobserve(element);
      entries.delete(element);
      element
        .querySelector(
          `:scope>[data-pagework="result"][data-id="${entry.block.id}"]`,
        )
        ?.remove();
    }
    function scan(within?: HTMLElement) {
      let updated = false;
      const found = new Map(
        PageworkExtract.extract(pageScope(), within)
          .filter((block) => !isNumericOnly(block.text))
          .map((block) => [block.element, block]),
      );
      for (const [element, entry] of entries) {
        if (
          !element.isConnected ||
          ((!within || within.contains(element) || element.contains(within)) &&
            !found.has(element))
        ) {
          forget(element, entry);
          updated = true;
        }
      }
      for (const [element, block] of found) {
        const previous = entries.get(element);
        if (previous?.block.text === block.text) {
          // Page renderers can replace unchanged source markup and remove its
          // result. Re-enter through the cache without another provider request.
          if (
            !previous.result ||
            previous.result.text.replace(/\s+/g, " ").trim() === block.text ||
            element.querySelector(
              `:scope>[data-pagework="result"][data-id="${block.id}"]`,
            )
          )
            continue;
        }
        if (previous) forget(element, previous);
        entries.set(element, { block, state: "waiting" });
        observer.observe(element);
        updated = true;
      }
      return updated;
    }
    function receive(received: ResultPart[], submitted: Map<string, Entry>) {
      const fresh: ResultPart[] = [];
      for (const part of received) {
        const entry = submitted.get(part.id);
        if (
          !entry ||
          entries.get(entry.block.element) !== entry ||
          entry.result
        )
          continue;
        if (
          !PageworkExtract.extract(pageScope(), entry.block.element).some(
            (current) => current.id === part.id && current.text === part.source,
          )
        ) {
          scan(entry.block.element);
          continue;
        }
        entry.result = part;
        entry.state = "done";
        observer.unobserve(entry.block.element);
        fresh.push(part);
      }
      publish();
      placeResults(fresh);
    }
    async function flush() {
      flushTimer = undefined;
      if (pageTranslation !== session || failure) return;
      const pending = [...entries.values()].filter(
        (entry) => entry.state === "pending",
      );
      if (!pending.length) {
        publish();
        return;
      }
      const submitted = new Map(
        pending.map((entry) => [entry.block.id, entry]),
      );
      for (const entry of pending) entry.state = "processing";
      let job: ProcessJob | undefined;
      const download = nativeNotice.track();
      try {
        publish();
        const resolvedLanguages = await resolveLanguages();
        if (pageTranslation !== session || failure) return;
        job = process(
          {
            source: "page",
            actionId,
            translation: resolvedLanguages,
            refresh,
            blocks: pending.map(({ block: { id, text, element } }) => {
              const rect = element.getBoundingClientRect();
              return {
                id,
                text,
                context: PageworkExtract.context(element, text),
                priority:
                  rect.bottom >= 0 && rect.top <= innerHeight
                    ? 0
                    : Math.max(rect.top - innerHeight, -rect.bottom) + 1,
              };
            }),
          },
          (received) => {
            if (pageTranslation === session && !failure)
              receive(received, submitted);
          },
          undefined,
          (event) => {
            if (pageTranslation === session && !failure) download.report(event);
          },
          download.waitForActivation,
          nativeSession?.translate,
        );
        jobs.add(job);
        publish();
        const result = await job.promise;
        if (pageTranslation !== session || failure) return;
        receive(result.parts, submitted);
        if (result.stats) {
          stats = {
            total: stats.total + result.stats.total,
            hits: stats.hits + result.stats.hits,
            shared: stats.shared + result.stats.shared,
            requests: stats.requests + result.stats.requests,
            writeFailed: stats.writeFailed || result.stats.writeFailed,
          };
        }
      } catch (caught) {
        if (pageTranslation !== session || failure) return;
        const error = modelError(caught);
        if (error.code === "cancelled") {
          session.cancel();
          toolbar(errorText(error));
          pageStatus(true, error.code);
          return;
        }
        failure = error;
        nativeSession?.destroy();
        clearTimeout(flushTimer);
        flushTimer = undefined;
        for (const active of jobs) active.cancel();
        jobs.clear();
        // Keep completed results and the document observers. Re-observing
        // unfinished blocks records the current viewport without dispatching.
        for (const entry of entries.values()) {
          if (entry.state !== "processing") continue;
          entry.state = "waiting";
          observer.unobserve(entry.block.element);
          observer.observe(entry.block.element);
        }
        publish();
      } finally {
        download.clear();
        if (job) jobs.delete(job);
        if (pageTranslation === session) publish();
      }
    }
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        const element =
          record.target instanceof HTMLElement
            ? record.target
            : record.target.parentElement;
        if (
          !element ||
          element.closest("[data-pagework],script,style") ||
          (!document.body.contains(element) && !element.contains(document.body))
        )
          continue;
        if (
          record.type === "childList" &&
          [...record.addedNodes, ...record.removedNodes].every(
            (node) =>
              node instanceof Element && node.hasAttribute("data-pagework"),
          )
        )
          continue;
        if (
          record.type === "attributes" &&
          record.oldValue === element.getAttribute(record.attributeName!)
        )
          continue;
        changed.add(element);
      }
      if (!changed.size || scanTimer !== undefined) return;
      scanTimer = window.setTimeout(() => {
        scanTimer = undefined;
        if (pageTranslation !== session) return;
        const roots = [...changed].filter(
          (element, index, all) =>
            !all.some(
              (other, otherIndex) =>
                index !== otherIndex && other.contains(element),
            ),
        );
        changed.clear();
        const updates = roots.map((root) => scan(root));
        if (updates.some(Boolean)) publish();
      }, collectMs);
    });
    pageTranslation = session;
    mutations.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "open"],
    });
    scan();
    if (entries.size) flushTimer = window.setTimeout(flush, collectMs);
    publish();
    if (!entries.size) reportNoPageContent();
  }
  function reportNoPageContent() {
    const describe = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        id: element.id,
        classes: element.className,
        role: element.getAttribute("role"),
        hidden: element.getAttribute("hidden"),
        open: element.getAttribute("open"),
        contenteditable: element.getAttribute("contenteditable"),
        pagework: element.getAttribute("data-pagework"),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        rectangles: element.getClientRects().length,
        textCharacters: element.textContent?.trim().length || 0,
      };
    };
    const ancestors = (element: HTMLElement | null) => {
      const result = [];
      for (; element; element = element.parentElement)
        result.push(describe(element));
      return result;
    };
    const candidates = [
      ...document.querySelectorAll<HTMLElement>("main,[role=main],article"),
    ];
    const root = PageworkExtract.root(pageScope());
    // Capture values at failure time, not live DOM references. Keep page text,
    // form values and URL parameters out of this local diagnostic.
    console.warn("[Aside] No readable page text", {
      extensionId: chrome.runtime.id,
      scope: pageScope(),
      readyState: document.readyState,
      candidates: candidates.map(describe),
      rootAncestors: ancestors(root),
      headingAncestors: ancestors(document.querySelector<HTMLElement>("h1")),
      allScopeBlocks: PageworkExtract.extract("all").length,
    });
    toolbar(S.noContent);
    if ($("toolbar").hidden) notify(S.noContent);
  }
  async function runPageFromControl(refresh = false, inPanel?: boolean) {
    if (pageAuthorization) return;
    const stopping =
      !refresh && !pageTranslation?.error && (run || pageTranslation);
    if (!stopping && translationEngine(action()) === "microsoft") {
      if (!translationAllowed()) return;
      // Send from the click before any await so Chromium can open its prompt.
      const authorization = send("translation.authorize");
      pageAuthorization = authorization;
      try {
        const granted = await authorization;
        if (pageAuthorization !== authorization) return;
        if (!granted) {
          if (!pageTranslation?.error) notify(S.errors.cancelled);
          return;
        }
      } catch (error) {
        if (pageAuthorization !== authorization) return;
        throw error;
      } finally {
        if (pageAuthorization === authorization) pageAuthorization = null;
      }
    }
    await runPage(refresh, inPanel);
  }
  async function runPage(
    refresh = false,
    inPanel = action()?.placement === "panel" || action()?.mode === "whole",
  ) {
    const chosen = action();
    if (!chosen) {
      notify(S.noConnection);
      return;
    }
    if (chosen.kind === "qa") {
      const quote =
        selectedPageText() ||
        PageworkExtract.extract(pageScope())
          .map((block) => block.text)
          .join("\n\n");
      openQuestion(quote, chosen, "page");
      return;
    }
    if (!refresh && pageTranslation?.error) {
      pageTranslation.retry();
      return;
    }
    if (!refresh && (run || pageTranslation)) {
      pageTranslation?.cancel();
      run?.cancel();
      toolbar(S.errors.cancelled);
      pageStatus(true);
      return;
    }
    if (!translationAllowed()) return;
    restore();
    resultKind = "page";
    originalContext = undefined;
    if (
      !inPanel &&
      chosen.kind === "translate" &&
      chosen.mode === "paragraph"
    ) {
      resultSource = location.href;
      resultTitle = document.title;
      startPageTranslation(refresh);
      return;
    }
    blocks = PageworkExtract.extract(pageScope());
    if (
      chosen.kind === "translate" &&
      chosen.mode === "paragraph" &&
      chosen.placement === "inline"
    )
      blocks = blocks.filter(({ text }) => !isNumericOnly(text));
    if (!blocks.length) {
      reportNoPageContent();
      return;
    }
    original = blocks.map((b) => b.text).join("\n\n");
    resultSource = location.href;
    resultTitle = document.title;
    if (inPanel) showResult(true);
    const download = nativeNotice.track();
    const draft = new Map<string, string>();
    const job = process(
      {
        source: "page",
        stream: inPanel,
        refresh,
        actionId: currentAction,
        translation,
        blocks: blocks.map(({ id, text, element }) => {
          const context =
            action()?.kind === "translate"
              ? PageworkExtract.context(element, text)
              : undefined;
          const rect = element.getBoundingClientRect();
          return {
            id,
            text,
            ...(context ? { context } : {}),
            priority:
              rect.bottom >= 0 && rect.top <= innerHeight
                ? 0
                : Math.max(rect.top - innerHeight, -rect.bottom) + 1,
          };
        }),
      },
      (received) => {
        if (run !== job) return;
        parts = received;
        if (!inPanel) placeResults(parts);
        toolbar(
          stalePage ? S.sourceMissing : `${parts.length} / ${blocks.length}`,
        );
        pageStatus(false);
      },
      inPanel
        ? (id, delta) => {
            if (run !== job) return;
            draft.set(id, (draft.get(id) || "") + delta);
            resultText([...draft.values()].join("\n\n"));
          }
        : undefined,
      (event) => {
        if (run !== job) return;
        download.report(event);
        const status = nativeProgressText(
          event,
          S.translation.packs,
          S.languages,
        );
        if (inPanel) resultStatus(true, status);
        toolbar(status);
      },
      download.waitForActivation,
    );
    run = job;
    toolbar();
    try {
      const result = await job.promise;
      if (run !== job) return;
      parts = result.parts;
      if (inPanel) {
        resultText(parts.map((part) => part.text).join("\n\n"));
        resultStatus(false, completionText(S, result.stats));
      }
      toolbar(stalePage ? S.sourceMissing : completionText(S, result.stats));
      pageStatus(true, stalePage ? "sourceChanged" : undefined);
    } catch (caught) {
      if (run !== job) return;
      const error = modelError(caught);
      if (inPanel) resultStatus(false, errorText(error));
      toolbar(errorText(error));
      if (
        !inPanel &&
        error.code !== "cancelled" &&
        $("toolbar").hidden &&
        nativeNotice.element.hidden
      )
        notify(errorText(error));
      pageStatus(true, error.code);
    } finally {
      download.clear();
      if (run === job) {
        run = null;
        toolbar($("status")?.textContent || S.done);
      }
    }
  }
  function resultHeader(title = "", pinnable = true) {
    return `<div class="header"><strong>${escape(title)}</strong>${pinnable ? button("pin", pinned ? S.unpin : S.pin, "selection-button", "pin", `aria-pressed="${pinned}"`) : ""}${button("close-result", S.close, "selection-button", "close")}</div>`;
  }
  function mountResult(integrated: boolean, question = false) {
    const panel = $("result");
    if (integrated || !panel.classList.contains("result"))
      panel.style.cssText = "";
    const fromDock =
      question && panel.classList.contains("selection-from-dock");
    panel.className = integrated
      ? "selection-result"
      : `panel result${question ? " text-input-panel" : ""}${fromDock ? " selection-from-dock" : ""}`;
    panel.hidden = false;
    $("selection").hidden = !integrated;
    if (integrated) selectionTools.setResult(panel);
    else {
      selectionTools.setResult(null);
      shadow.append(panel);
      panel
        .querySelector(".selection-settings-footer,.selection-result-footer")!
        .insertAdjacentHTML("beforeend", panelResizeButton(S.resizePanel));
    }
  }
  function showResult(busy = false, integrated = resultKind === "selection") {
    const panel = $("result");
    panel.innerHTML =
      (integrated
        ? ""
        : resultHeader(action()?.name || S.output, action()?.kind !== "qa")) +
      selectionResultMarkup(
        `${integrated ? "" : `<div class="original">${escape(original)}</div>`}<div class="output" id="output"></div>`,
        `<span class="selection-result-status" id="result-status" role="status"></span>`,
        `<div class="selection-result-actions">${button("stop-result", S.stop, "icon", "stop")}${button("bookmark", S.bookmark, "icon", "book")}${button("copy", S.copy, "icon", "copy")}${button("refresh-result", S.regenerate, "icon", "refresh")}</div>`,
      );
    mountResult(integrated, action()?.kind === "qa");
    renderMarkdown(
      $("output"),
      integrated ? "" : parts.map((p) => p.text).join("\n\n"),
    );
    resultStyle($("output"), "selection");
    resultStatus(busy, busy ? S.processing : "");
  }
  function resultStatus(busy: boolean, status: string | null) {
    $("result-status").textContent = status;
    $("output").setAttribute("aria-busy", String(busy));
    $("result").querySelector<HTMLElement>("[data-op=stop-result]")!.hidden =
      !busy;
    for (const op of ["bookmark", "copy", "refresh-result"])
      $("result").querySelector<HTMLButtonElement>(
        `[data-op=${op}]`,
      )!.disabled = busy || !parts.length;
  }
  function resultText(text: string | null) {
    const body = $("result").querySelector<HTMLElement>(
        ".selection-result-body,.body",
      )!,
      follow = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
    renderMarkdown($("output"), text || "");
    if (follow) body.scrollTop = body.scrollHeight;
  }
  function waitForMicrosoftPermission(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const notice = document.createElement("div");
      const description = document.createElement("p");
      description.textContent = S.translation.microsoftNotice;
      const allow = document.createElement("button");
      allow.type = "button";
      allow.dataset.op = "allow-microsoft";
      allow.className = "primary";
      allow.textContent = S.translation.microsoftAuthorize;
      notice.append(description, allow);
      const cancel = () => {
        notice.remove();
        reject(new ModelError("cancelled"));
      };
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener("abort", cancel, { once: true });
      $("output").after(notice);
      resultStatus(false, null);
      allow.addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
        allow.disabled = true;
        resultStatus(false, S.waitingForPermission);
        try {
          const granted = await send("translation.authorize");
          if (signal.aborted) return;
          if (granted) {
            signal.removeEventListener("abort", cancel);
            notice.remove();
            resolve();
          } else resultStatus(false, S.errors.cancelled);
        } catch (error) {
          if (!signal.aborted) resultStatus(false, errorText(error));
        } finally {
          allow.disabled = false;
        }
      });
    });
  }
  async function runSelection(
    text: string,
    { refresh = false, integrated = true, fromControl = false } = {},
  ) {
    const chosen = action();
    if (!chosen) {
      notify(S.noConnection);
      return;
    }
    if (!translationAllowed()) return;
    cancelPageTranslation();
    run?.cancel();
    const previousContext =
      resultKind === "selection" && original === text
        ? originalContext
        : undefined;
    original = text;
    resultKind = "selection";
    parts = [];
    resultSource = location.href;
    resultTitle = document.title;
    const selection = getSelection();
    if (selection?.rangeCount && !selection.isCollapsed)
      selectedRect = selection.getRangeAt(0).getBoundingClientRect();
    const sourceElement =
      selectedPageText() === text ? selection?.anchorNode?.parentElement : null;
    originalContext = sourceElement
      ? PageworkExtract.context(sourceElement, text)
      : previousContext;
    const context =
      action()?.kind === "translate" ? originalContext : undefined;
    const microsoft = translationEngine(chosen) === "microsoft";
    const authorizeDirectly =
      microsoft &&
      (isFirefox || (fromControl && !requiresDirectPermissionRequest));
    showResult(!authorizeDirectly, integrated);
    const download = nativeNotice.track();
    const draft = new Map<string, string>();
    const payload: ProcessPayload = {
      source: "selection",
      refresh,
      actionId: currentAction,
      translation,
      stream: true,
      blocks: [{ id: "selection", text, context }],
    };
    const controller = new AbortController();
    const start = () =>
      process(
        payload,
        undefined,
        (id, delta) => {
          if (run !== job) return;
          draft.set(id, (draft.get(id) || "") + delta);
          resultText([...draft.values()].join("\n\n"));
        },
        (event) => {
          if (run !== job) return;
          download.report(event);
          resultStatus(
            true,
            nativeProgressText(event, S.translation.packs, S.languages),
          );
        },
        download.waitForActivation,
      );
    let attempt: ProcessJob | undefined;
    const job: ProcessJob = {
      promise: (async () => {
        if (authorizeDirectly) {
          resultStatus(false, S.waitingForPermission);
          // Chromium needs the original click, before awaiting a processing job.
          const granted = await send("translation.authorize");
          if (controller.signal.aborted) throw new ModelError("cancelled");
          if (!granted) {
            closeResult(false);
            throw new ModelError("cancelled");
          }
          resultStatus(true, S.processing);
        }
        attempt = start();
        try {
          return await attempt.promise;
        } catch (error) {
          if (
            authorizeDirectly ||
            controller.signal.aborted ||
            !microsoft ||
            modelError(error).code !== "translationPermission"
          )
            throw error;
          await waitForMicrosoftPermission(controller.signal);
          if (controller.signal.aborted) throw new ModelError("cancelled");
          resultStatus(true, S.processing);
          attempt = start();
          return attempt.promise;
        }
      })(),
      cancel() {
        controller.abort();
        attempt?.cancel();
      },
    };
    run = job;
    toolbar();
    try {
      const result = await job.promise;
      if (run !== job) return;
      parts = result.parts;
      resultText(parts.map((p) => p.text).join("\n\n"));
      resultStatus(false, S.done);
    } catch (caught) {
      const error = modelError(caught);
      if (run === job) resultStatus(false, errorText(error));
    } finally {
      download.clear();
      if (run === job) {
        run = null;
        toolbar();
      }
    }
  }
  function closeResult(hideToolbar = true) {
    if (resultKind === "page") pageAuthorization = null;
    run?.cancel();
    run = null;
    $("result").hidden = true;
    selectionTools.updateResultVisibility();
    if (hideToolbar && resultKind === "selection") $("selection").hidden = true;
    toolbar();
  }
  async function bookmark() {
    await send("collection.add", {
      item: {
        title: resultTitle,
        sourceTitle: resultTitle,
        url: resultSource,
        sourceText: original,
        text: parts.map((p) => p.text).join("\n\n"),
        actionName: action()?.name,
      },
    });
    notify(S.saved);
  }
  // Preserve page selection while opening the floating menu and question composer.
  shadow.addEventListener("mousedown", (event) => {
    if ((event.target as HTMLElement).closest("#dock,#radial>button"))
      event.preventDefault();
  });
  shadow.addEventListener("input", (event) => {
    const input = event.target as HTMLTextAreaElement;
    if (input.id === "question-input")
      $("question").querySelector<HTMLButtonElement>(
        "[data-op=question-run]",
      )!.disabled = !input.value.trim();
  });
  shadow.addEventListener("keydown", (event) => {
    const key = event as KeyboardEvent;
    if (
      key.isTrusted &&
      !key.isComposing &&
      !key.repeat &&
      key.key === "Enter" &&
      (key.metaKey || key.ctrlKey) &&
      !key.shiftKey &&
      !key.altKey &&
      (key.target as HTMLElement).closest("#question")
    ) {
      key.preventDefault();
      key.stopPropagation();
      void submitQuestion().catch((caught) => notify(errorText(caught)));
    }
  });
  shadow.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement).closest("button");
    if (!event.isTrusted || !target || target.disabled) return;
    try {
      if (target.dataset.action) {
        restore();
        if (currentAction !== target.dataset.action) translation = undefined;
        currentAction = target.dataset.action;
        scopeOverride = undefined;
        toolbar();
        return;
      }
      const op = target.dataset.op;
      if (op === "choose") $("actions").hidden = !$("actions").hidden;
      else if (op === "toggle-tools") {
        if (
          (event as MouseEvent).detail > 0 &&
          event.timeStamp - draggedAt < 250
        )
          return;
        const dockPanel = $("result");
        const questionOpen =
          !dockPanel.hidden &&
          dockPanel.classList.contains("selection-from-dock");
        if (!$("toolbar").hidden || questionOpen) {
          if (questionOpen) closeResult();
          showTools(false);
          showRadial(false, (event as MouseEvent).detail === 0);
        } else {
          showRadial(!radialOpen, (event as MouseEvent).detail === 0);
        }
      } else if (op === "retry-page") {
        if (pageTranslation?.error) await runPageFromControl();
      } else if (op === "page-translate") {
        if (pageAuthorization) return;
        if (pageTranslation?.error) await runPageFromControl();
        else if (translationState() !== "original") restore();
        else {
          restore();
          useTranslate();
          scopeOverride = undefined;
          await runPageFromControl();
        }
      } else if (op === "quick-question") {
        openQuestion("", questionAction(), "dock");
      } else if (op === "question-clear-quote") {
        target.closest(".question-reference")?.remove();
        $("question-input").focus();
      } else if (op === "question-close") {
        closeResult();
      } else if (op === "question-run") {
        await submitQuestion();
      } else if (op === "toggle-lights") {
        if (lightsBusy) return;
        const lights = nextLightsMode(websiteFeatures().lights);
        const restoreFocus = shadow.activeElement === target;
        lightsBusy = true;
        radial();
        try {
          config.website = await send("website.update", { patch: { lights } });
        } finally {
          lightsBusy = false;
          if (radialOpen) {
            radial();
            if (restoreFocus)
              radialEl
                .querySelector<HTMLElement>("[data-op=toggle-lights]")
                ?.focus();
          }
        }
      } else if (op === "text-translate") {
        await openTextTranslation(true);
      } else if (op === "hide-toolbar") showTools(false, true);
      else if (op === "open-settings")
        await send("settings.open", { route: "connections" });
      else if (op === "scope-body" || op === "scope-all") {
        restore();
        scopeOverride = op.slice(6) as Scope;
        toolbar();
      } else if (op === "run") await runPageFromControl();
      else if (op === "refresh-page") await runPageFromControl(true);
      else if (op === "refresh-result") {
        if (resultKind === "page") await runPageFromControl(true, true);
        else
          await runSelection(
            action()?.kind === "qa" ? original : selectedPageText() || original,
            {
              refresh: true,
              integrated: $("result").classList.contains("selection-result"),
              fromControl: true,
            },
          );
      } else if (op === "restore") {
        restore();
      } else if (op === "close-result") closeResult();
      else if (op === "stop-result") run?.cancel();
      else if (op === "pin") {
        pinned = !pinned;
        target.setAttribute("aria-pressed", String(pinned));
        target.setAttribute("aria-label", pinned ? S.unpin : S.pin);
      } else if (op === "copy") {
        await navigator.clipboard.writeText(
          parts.map((p) => p.text).join("\n\n"),
        );
        notify(S.copied);
      } else if (op === "bookmark") await bookmark();
    } catch (caught) {
      const error = modelError(caught);
      if (target.dataset.op === "toggle-lights" && error.code === "cancelled")
        return;
      notify(
        target.dataset.op === "toggle-lights" &&
          error.code === "permissionRequired"
          ? S.lightsPermissionNeeded
          : errorText(error),
      );
    }
  });
  shadow.addEventListener("change", (event) => {
    const select = event.target as HTMLSelectElement;
    if (!select.dataset.language) return;
    const chosen = action();
    if (chosen?.kind !== "translate") return;
    if (pageTranslation || pageAuthorization) restore();
    translation = {
      sourceLanguage: chosen.sourceLanguage!,
      targetLanguage: chosen.targetLanguage!,
      [select.dataset.language]: select.value,
    };
    toolbar();
    if (radialOpen) radial();
    $("toolbar")
      .querySelector<HTMLElement>(
        `[data-language="${select.dataset.language}"]`,
      )
      ?.focus();
  });
  async function showSelection(event: MouseEvent | KeyboardEvent) {
    if (!websiteFeatures().toolbar) return;
    if (event.composedPath().includes(host)) return;
    const selection = getSelection(),
      anchor = selection?.anchorNode?.parentElement,
      focus = selection?.focusNode?.parentElement;
    if (
      !selection ||
      selection.isCollapsed ||
      (event.target as HTMLElement).closest?.("input,textarea,select") ||
      (event.target as HTMLElement).isContentEditable ||
      anchor?.isContentEditable ||
      focus?.isContentEditable
    ) {
      selectedText = "";
      if (resultKind !== "selection" || $("result").hidden)
        $("selection").hidden = true;
      selectionTools.updateSelection();
      return;
    }
    selectedText = selection.toString().trim();
    if (!selectedText) {
      if (resultKind !== "selection" || $("result").hidden)
        $("selection").hidden = true;
      selectionTools.updateSelection();
      return;
    }
    selectedRect = selection.getRangeAt(0).getBoundingClientRect();
    const snapshot = selectedText;
    try {
      await refresh();
    } catch {
      return;
    }
    if (
      selectedText !== snapshot ||
      getSelection()?.toString().trim() !== snapshot
    )
      return;
    if (!pinned) {
      if (resultKind === "selection") closeResult(false);
      else $("result").hidden = true;
      selectionPanelTop = selectionPanelLeft = null;
    }
    $("selection").hidden = false;
    selectionTools.reset();
  }
  document.addEventListener("mouseup", showSelection, {
    capture: true,
    signal,
  });
  document.addEventListener(
    "keyup",
    (event) => {
      // Page scripts can dispatch a generic keyup event without KeyboardEvent.key.
      if (typeof event.key !== "string") return;
      if (
        event.key === "Shift" ||
        event.key.startsWith("Arrow") ||
        ["Home", "End", "PageUp", "PageDown"].includes(event.key) ||
        (event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey))
      )
        showSelection(event);
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.composedPath().includes(host)) {
        if (
          !pinned &&
          resultKind === "selection" &&
          $("selection").classList.contains("selection-showing-result")
        )
          closeResult();
        if ($("actions")) $("actions").hidden = true;
        showTools(false);
      }
    },
    { capture: true, signal },
  );
  function dismissWithEscape(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.isComposing) return;
    textTranslation.close();
    if (resultKind === "selection" && !$("result").hidden) closeResult();
    $("selection").hidden = true;
    if (radialOpen) showRadial(false, true);
    if (!$("toolbar").hidden) showTools(false, true);
    if ($("actions")) $("actions").hidden = true;
  }
  // Shadow DOM retargets controls to the host DIV, so site hotkey handlers
  // cannot recognize them as inputs. Keep their keys inside the extension UI,
  // after its own controls run, without suppressing native editing behavior.
  for (const type of ["keydown", "keypress", "keyup"]) {
    shadow.addEventListener(type, (event) => {
      if (type === "keydown") dismissWithEscape(event as KeyboardEvent);
      event.stopPropagation();
    });
  }
  document.addEventListener("keydown", dismissWithEscape, { signal });
  $("dock").addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const dock = $("dock"),
      rect = dock.getBoundingClientRect();
    const startX = event.clientX,
      startY = event.clientY;
    let moved = false;
    dock.setPointerCapture(event.pointerId);
    dock.onpointermove = (move) => {
      if (
        !moved &&
        Math.hypot(move.clientX - startX, move.clientY - startY) < 6
      )
        return;
      moved = true;
      showTools(false);
      dock.dataset.dragging = "true";
      dock.style.left = `${Math.max(0, Math.min(innerWidth - rect.width, rect.left + move.clientX - startX))}px`;
      dock.style.right = "auto";
      dock.style.top = `${Math.max(8, Math.min(innerHeight - rect.height - 8, rect.top + move.clientY - startY))}px`;
      move.preventDefault();
    };
    const finish = (end: PointerEvent) => {
      if (moved) {
        draggedAt = end.timeStamp;
        const finalRect = dock.getBoundingClientRect();
        dockSide =
          finalRect.left + finalRect.width / 2 < innerWidth / 2
            ? "left"
            : "right";
        dockY = (finalRect.top + finalRect.height / 2) / innerHeight;
      }
      dock.onpointermove = dock.onpointerup = dock.onpointercancel = null;
      delete dock.dataset.dragging;
      positionTools();
    };
    dock.onpointerup = dock.onpointercancel = finish;
  });
  window.addEventListener(
    "resize",
    () => {
      if (selectionPanelTop !== null)
        selectionPanelTop = Math.max(
          10,
          Math.min(
            selectionPanelTop,
            innerHeight - $("selection").offsetHeight - 10,
          ),
        );
      positionTools();
      positionSelection();
      positionResult();
      textTranslation.position();
      document
        .querySelectorAll<HTMLElement>('[data-pagework="result"]')
        .forEach((result) => {
          stylePageResult(result);
          fitPageResult(result);
        });
    },
    { signal },
  );
  function positionResult(left?: number, top?: number) {
    const panel = $("result");
    if (panel.hidden || !panel.matches(".panel.result")) return;
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(12, Math.min(innerWidth - rect.width - 12, left ?? rect.left))}px`;
    panel.style.top = `${Math.max(12, Math.min(innerHeight - rect.height - 12, top ?? rect.top))}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }
  bindPanelGeometry($("result"), ".header", positionResult);
  document.addEventListener(
    "fullscreenchange",
    () => {
      const target = document.fullscreenElement;
      if (target && target.tagName !== "VIDEO") target.append(host);
      else document.documentElement.append(host);
    },
    { signal },
  );
  const refresh = async () => {
    const previousConfig = config;
    const previous = JSON.stringify(
      config.actions.find((a) => a.id === currentAction),
    );
    config = await send("settings.public");
    if (
      previous !==
      JSON.stringify(config.actions.find((a) => a.id === currentAction))
    )
      translation = undefined;
    S = config.strings;
    if (!action()) currentAction = config.actions[0]?.id;
    theme();
    toolbar();
    applyWebsiteFeatures();
    if (radialOpen && JSON.stringify(previousConfig) !== JSON.stringify(config))
      radial();
  };
  theme();
  toolbar();
  applyWebsiteFeatures();
  matchMedia("(prefers-color-scheme:dark)").addEventListener(
    "change",
    () => {
      theme();
      if (config.preferences.theme === "system") {
        document
          .querySelectorAll<HTMLElement>('[data-pagework="result"]')
          .forEach(stylePageResult);
        if ($("output")) resultStyle($("output"), "selection");
      }
    },
    { signal },
  );
  const onMessage: Parameters<
    typeof chrome.runtime.onMessage.addListener
  >[0] = (message, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      ![
        "settings.updated",
        "settings.resetting",
        "ui.show",
        "page.run",
        "selection.process",
        "text-translation.open",
        "question.open",
        "page.restore",
      ].includes(message.type)
    )
      return;
    (async () => {
      if (message.type === "settings.resetting") {
        resetPageTools();
        return true;
      }
      if (message.type === "settings.updated") {
        if (message.reset) resetPageTools();
        const selectionChanged =
          JSON.stringify([
            config.actions,
            config.strings,
            config.connections,
            config.defaultConnection,
          ]) !==
          JSON.stringify([
            message.config.actions,
            message.config.strings,
            message.config.connections,
            message.config.defaultConnection,
          ]);
        const oldAction = JSON.stringify(action());
        const oldBase = JSON.stringify(
          config.actions.find((a) => a.id === currentAction),
        );
        config = message.config;
        if (
          oldBase !==
          JSON.stringify(config.actions.find((a) => a.id === currentAction))
        )
          translation = undefined;
        S = config.strings;
        if (!action()) currentAction = config.actions[0]?.id;
        if (oldAction !== JSON.stringify(action())) {
          scopeOverride = undefined;
          restore();
        }
        theme();
        toolbar();
        applyWebsiteFeatures();
        if (radialOpen) radial();
        if (selectionChanged) selectionTools.render();
        document
          .querySelectorAll<HTMLElement>('[data-pagework="result"]')
          .forEach((result) => {
            stylePageResult(result);
            fitPageResult(result);
          });
        if ($("output")) resultStyle($("output"), "selection");
        return true;
      }
      if (
        message.type === "text-translation.open" ||
        message.type === "question.open"
      ) {
        await refresh();
        if (message.type === "question.open")
          openQuestion("", questionAction(), "shortcut");
        else await openTextTranslation();
        return true;
      }
      if (message.type === "ui.show") {
        await refresh();
        showTools(true);
        return true;
      }
      if (message.type === "page.run") {
        await refresh();
        cancelPageTranslation();
        if (message.actionId) {
          run?.cancel();
          run = null;
          if (currentAction !== message.actionId) translation = undefined;
          currentAction = message.actionId;
        }
        if (message.translation) translation = message.translation;
        scopeOverride = message.scope;
        runPage(false, message.panel);
        return true;
      }
      if (message.type === "selection.process") {
        await refresh();
        if (message.actionId) {
          if (!config.actions.some((action) => action.id === message.actionId))
            return false;
          currentAction = message.actionId;
          translation = undefined;
        }
        if (action()?.kind === "qa") openQuestion(message.text, action());
        else runSelection(message.text);
        return true;
      }
      if (message.type === "page.restore") {
        restore();
        return true;
      }
    })().then(
      (value) => respond(value),
      (error) => respond({ error: error.code || error.message }),
    );
    return true;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  document.addEventListener(
    disposeEvent,
    () => {
      lifetime.abort();
      panelResize.disconnect();
      textTranslation.destroy();
      nativeNotice.destroy();
      selectionTools.destroy();
      radialTips.destroy();
      restore();
      host.remove();
      if (chrome.runtime.id) chrome.runtime.onMessage.removeListener(onMessage);
    },
    { once: true },
  );
}
