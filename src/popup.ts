import {
  translationEngine,
  usesModel,
  actionAvailable,
  authorizeTranslation,
  AVAILABLE_TRANSLATION_ENGINES,
  translationEngineSupported,
} from "./translation-engine.js";
import {
  faviconUrl,
  requiresDirectPermissionRequest,
  WEBSITE_RESOURCE_ORIGINS,
} from "./browser.js";
import { storageChanges } from "./extension-storage.js";
import { button, icon, languageControl } from "./ui.js";
import { productShareText } from "./product.js";
import { HoverTips } from "./hover-tips.js";
import { escapeHtml as escape } from "./html.js";
import brandMark from "../icons/brand-mark.svg";
import { applyTheme, rememberTheme } from "./theme.js";
import { ModelError, modelError } from "./providers.js";
import { C, locale, setLocale, localizeAction } from "./copy.js";
import { request } from "./client.js";
import { closeMenu, enhanceSelects } from "./controls.js";
import { nextLightsMode, resolveWebsite, websiteHostname } from "./website.js";
import type {
  WebsitePatch,
  PublicSettings,
  LocalePreference,
} from "./types.js";

const data: PublicSettings = await request("snapshot");
setLocale(data.preferences.locale);
applyTheme(data.preferences);
rememberTheme(data.preferences);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const supported = /^https?:/.test(tab?.url || "");
const hostname = supported ? websiteHostname(tab.url!) : "";
let featureBusy = false,
  lightsBusy = false;
const favicon = faviconUrl(tab?.url || "", tab?.favIconUrl);
const settingsIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6"/></svg>';
const playIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>';
const root = document.querySelector<HTMLElement>("#popup")!;
const targets = new Map<string, string>();
let settingsButton: HTMLElement, lightsButton: HTMLButtonElement;
let shareNoticeTimer: ReturnType<typeof setTimeout> | undefined;
const popupTips = new HoverTips(root, "#website-lights");
function render() {
  clearTimeout(shareNoticeTimer);
  const actionId = root.querySelector<HTMLSelectElement>("#action")?.value;
  const P = C.popup;
  closeMenu();
  root.innerHTML = `<header class="popup-header"><span class="popup-brand">${brandMark}<strong>${C.brand}</strong></span><div class="popup-header-actions">${languageControl(data.preferences.locale)}<button class="selection-button" id="settings" aria-label="${C.settings}">${settingsIcon}</button></div></header>
  <main class="popup-body">
    <section class="popup-page" aria-label="${P.currentPage}">
      <div class="popup-page-summary"><div class="popup-page-site">${supported ? (favicon ? `<img src="${escape(favicon)}" alt="" width="18" height="18">` : icon("page")) : ""}<span>${P.currentPage}</span>${supported ? `<strong>${escape(hostname)}</strong>` : ""}</div>
      <p class="popup-title">${escape(supported ? tab.title : C.real.unsupportedPage)}</p></div>
      <button type="button" class="selection-button" id="website-lights"></button>
      <p class="popup-status" id="lights-status" role="status"></p>
    </section>
    <section class="popup-process selection-settings" aria-label="${P.process}">
      <div class="popup-process-options"><label class="field"><span class="field-label">${C.chooseAction}</span><select id="action">${data.actions
        .map((raw) => {
          const a = localizeAction(raw, locale);
          return `<option value="${a.id}">${escape(a.name)}</option>`;
        })
        .join("")}</select></label>
      <div id="languages"></div></div>
      <div id="translation-engine-field"></div>
      <div class="popup-process-actions"><button class="btn primary" data-op="run" ${supported ? "" : "disabled"}>${playIcon}${C.start}</button><button class="btn ghost" data-op="restore" ${supported ? "" : "disabled"}>${C.restore}</button></div>
      <p class="popup-status" id="status" role="status">${data.connections.some((c) => c.protocol !== "typesafe") ? C.processingNotice : C.real.noConnection}</p>
    </section>
    <section class="popup-features" aria-label="${P.features}" aria-describedby="feature-scope"><div id="feature-controls"></div><p class="popup-status" id="feature-scope">${P.allSites}</p><p class="popup-status" id="feature-status" role="status"></p></section>
    <footer class="popup-share">${button(C.share.label, "share-product", "ghost", "share")}<span class="popup-status" id="share-status" role="status"></span></footer>
  </main>`;
  root.append(popupTips.element);
  settingsButton = root.querySelector<HTMLElement>("#settings")!;
  lightsButton = root.querySelector<HTMLButtonElement>("#website-lights")!;
  if (data.actions.some((action) => action.id === actionId))
    root.querySelector<HTMLSelectElement>("#action")!.value = actionId!;
  settingsButton.addEventListener("click", async () => {
    await request("settings.open", {
      tabId: supported ? tab.id : null,
      route: "connections",
    });
    window.close();
  });
  lightsButton.addEventListener("click", () => void cycleLights());
  updateSetupState(data);
  renderLanguages();
  renderFeatures();
  renderLights();
}
function updateSetupState(settings: PublicSettings) {
  const needsSetup = !settings.actions.some((action) =>
    actionAvailable(action, settings),
  );
  settingsButton.classList.toggle("model-setup-needed", needsSetup);
}
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "settings.reset-complete") {
    localStorage.clear();
    window.close();
  }
});
storageChanges.addListener((changes, area) => {
  if (area === "local" && changes.settings?.newValue) {
    const settings = changes.settings.newValue as PublicSettings;
    const localeChanged =
      settings.preferences.locale !== data.preferences.locale;
    data.preferences = settings.preferences;
    data.website = settings.website;
    data.actions = settings.actions;
    data.connections = settings.connections;
    data.defaultConnection = settings.defaultConnection;
    if (localeChanged) {
      setLocale(data.preferences.locale);
      render();
      return;
    }
    updateSetupState(settings);
    renderLanguages();
    if (!featureBusy) renderFeatures();
    renderLights();
  }
});
const chosen = () => {
  const action = data.actions.find(
    (action) =>
      action.id === document.querySelector<HTMLSelectElement>("#action")!.value,
  );
  return action?.kind === "translate" && targets.has(action.id)
    ? { ...action, targetLanguage: targets.get(action.id) }
    : action;
};
function updateRunState() {
  document.querySelector<HTMLButtonElement>('[data-op="run"]')!.disabled =
    !supported || !actionAvailable(chosen(), data);
}
function renderLanguages() {
  const action = chosen();
  document.querySelector<HTMLElement>("#languages")!.innerHTML =
    action?.kind === "translate"
      ? `<label class="field"><span class="field-label">${C.outputLanguage}</span><select data-language="targetLanguage" data-search="false" aria-label="${C.outputLanguage}"><option value="interface" ${action.targetLanguage === "interface" ? "selected" : ""}>${escape(C.followInterfaceLanguage)}</option>${usesModel(action) ? `<option value="instruction" ${action.targetLanguage === "instruction" ? "selected" : ""} ${action.instruction.trim() ? "" : "disabled"}>${escape(C.followInstructionLanguage)}</option>` : ""}${Object.entries(
          C.languages,
        )
          .filter(([value]) => value !== "auto")
          .map(
            ([value, label]) =>
              `<option value="${value}" ${action.targetLanguage === value ? "selected" : ""}>${escape(label)}</option>`,
          )
          .join("")}</select></label>`
      : "";
  const T = C.real.translation;
  root.querySelector<HTMLElement>("#translation-engine-field")!.innerHTML =
    action?.kind === "translate"
      ? `<label class="field"><span class="field-label">${T.engine}</span><select id="translation-engine" data-search="false">${translationEngineSupported(action) ? "" : `<option value="" disabled selected>${escape(T.chooseEngine)}</option>`}${AVAILABLE_TRANSLATION_ENGINES.map((engine) => `<option value="${engine}" ${translationEngine(action) === engine ? "selected" : ""}>${T.engines[engine]}</option>`).join("")}</select></label>`
      : "";
  const engine = translationEngine(action);
  root.querySelector<HTMLElement>("#status")!.textContent =
    !translationEngineSupported(action)
      ? T.engineUnavailable
      : engine === "microsoft"
        ? T.microsoftNotice
        : engine === "browser"
          ? T.browserNotice
          : actionAvailable(action, data)
            ? C.processingNotice
            : C.real.noConnection;
  enhanceSelects(root);
  updateRunState();
}
function renderLights() {
  const P = C.popup;
  const mode = resolveWebsite(data.website, hostname).lights;
  const hint = P.lightsHint(
    P.lightsModes[mode],
    P.lightsModes[nextLightsMode(mode)],
  );
  lightsButton.disabled = !supported || lightsBusy;
  lightsButton.dataset.mode = mode;
  lightsButton.setAttribute("aria-label", hint);
  lightsButton.setAttribute("aria-pressed", String(mode !== "off"));
  lightsButton.setAttribute("aria-busy", String(lightsBusy));
  lightsButton.innerHTML = icon(
    mode === "off" ? "sun" : mode === "on" ? "moon" : "system",
  );
  popupTips.refresh();
}
async function cycleLights() {
  if (!supported || lightsBusy || tab?.id === undefined) return;
  const lights = nextLightsMode(resolveWebsite(data.website, hostname).lights);
  const field = root.querySelector<HTMLElement>("#lights-status")!;
  field.textContent = "";
  lightsBusy = true;
  renderLights();
  try {
    if (
      requiresDirectPermissionRequest &&
      lights !== "off" &&
      !(await chrome.permissions.request({ origins: WEBSITE_RESOURCE_ORIGINS }))
    )
      throw new ModelError("lightsPermissionRequired");
    data.website = await request("website.update", {
      tabId: tab.id,
      patch: { lights },
    });
  } catch (caught) {
    const error = modelError(caught);
    field.textContent = [
      "permissionRequired",
      "lightsPermissionRequired",
    ].includes(error.code)
      ? C.real.lightsPermissionNeeded
      : C.real.errors[error.code as keyof typeof C.real.errors] ||
        error.message;
  } finally {
    lightsBusy = false;
    renderLights();
  }
}
function renderFeatures() {
  const P = C.popup;
  const effective = resolveWebsite(data.website, hostname);
  const disabled = featureBusy ? "disabled" : "";
  const controls = (["toolbar", "floating"] as const)
    .map(
      (key) => `<label class="popup-feature-row" data-feature-group="${key}">
      <span>${P[key]}</span><input class="switch" type="checkbox" data-feature="${key}" aria-label="${P[key]}" ${effective[key] ? "checked" : ""} ${disabled}>
    </label>`,
    )
    .join("");
  document.querySelector<HTMLElement>("#feature-controls")!.innerHTML =
    controls;
}
async function saveFeatures(patch: Pick<WebsitePatch, "toolbar" | "floating">) {
  if (featureBusy) return;
  featureBusy = true;
  // Preserve the checkbox's new state while saving instead of rebuilding it
  // from the previous snapshot. Failed saves render that saved snapshot again.
  root
    .querySelectorAll<HTMLInputElement | HTMLButtonElement>("[data-feature]")
    .forEach((control) => {
      control.disabled = true;
    });
  const field = document.querySelector<HTMLElement>("#feature-status")!;
  field.textContent = "";
  try {
    data.website = await request("website.update", { patch });
  } catch (caught) {
    const error = modelError(caught);
    field.textContent =
      C.real.errors[error.code as keyof typeof C.real.errors] || error.message;
    return;
  } finally {
    featureBusy = false;
    renderFeatures();
  }
}
render();
document.addEventListener("change", async (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === "ui-locale") {
    target.disabled = true;
    enhanceSelects(root);
    try {
      await request("settings.save", {
        patch: {
          preferences: {
            ...data.preferences,
            locale: target.value as LocalePreference,
          },
        },
      });
    } catch (caught) {
      render();
      const error = modelError(caught);
      root.querySelector<HTMLElement>("#status")!.textContent =
        C.real.errors[error.code as keyof typeof C.real.errors] ||
        error.message;
    } finally {
      target.disabled = false;
      enhanceSelects(root);
    }
  } else if (target.dataset.feature) {
    const key = target.dataset.feature as "toolbar" | "floating";
    void saveFeatures({ [key]: target.checked });
  } else if (target.id === "translation-engine") {
    const action = chosen();
    if (!action) return;
    const engine = AVAILABLE_TRANSLATION_ENGINES.find(
      (value) => value === target.value,
    );
    if (!engine) return;
    const next = {
      ...action,
      translationEngine: engine,
      targetLanguage:
        engine !== "ai" && action.targetLanguage === "instruction"
          ? "interface"
          : action.targetLanguage,
    };
    target.disabled = true;
    try {
      await authorizeTranslation(next);
      const config = await request("actions.save", { changes: [next] });
      targets.delete(action.id);
      data.actions = config.actions;
      updateSetupState(data);
      renderLanguages();
    } catch (caught) {
      renderLanguages();
      const error = modelError(caught);
      root.querySelector<HTMLElement>("#status")!.textContent =
        C.real.errors[error.code as keyof typeof C.real.errors] ||
        C.real.failed;
    }
  } else if (target.id === "action") renderLanguages();
  else if (target.dataset.language) {
    const action = chosen();
    if (action) targets.set(action.id, target.value);
  }
});
document.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("[data-op]");
  if (!button) return;
  if (button.dataset.op === "share-product") {
    const status = root.querySelector<HTMLElement>("#share-status")!;
    clearTimeout(shareNoticeTimer);
    status.textContent = "";
    status.removeAttribute("data-error");
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(productShareText(locale));
      status.textContent = C.share.copied;
      shareNoticeTimer = setTimeout(() => {
        status.textContent = "";
      }, 3000);
    } catch {
      status.dataset.error = "true";
      status.textContent = C.share.failed;
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (tab?.id === undefined) return;
  try {
    button.disabled = true;
    if (button.dataset.op === "run") {
      const action = chosen();
      if (!action) throw new ModelError("invalidAction");
      const requestMicrosoftPermission =
        !requiresDirectPermissionRequest &&
        translationEngine(action) === "microsoft";
      if (!requestMicrosoftPermission) await authorizeTranslation(action);
      await request("tab.run", {
        tabId: tab.id,
        actionId: action.id,
        requestMicrosoftPermission,
        translation:
          action.kind === "translate"
            ? {
                sourceLanguage: "auto",
                targetLanguage: action.targetLanguage!,
              }
            : undefined,
      });
    } else await request("tab.restore", { tabId: tab.id });
    window.close();
  } catch (caught) {
    const error = modelError(caught);
    document.querySelector<HTMLElement>("#status")!.textContent =
      C.real.errors[error.code as keyof typeof C.real.errors] || error.message;
  } finally {
    button.disabled = false;
    updateRunState();
  }
});
