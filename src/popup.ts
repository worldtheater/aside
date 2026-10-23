import { escapeHtml as escape } from "./html.js";
import brandMark from "../icons/brand-mark.svg";
import { applyTheme, rememberTheme } from "./theme.js";
import { ModelError, modelError } from "./providers.js";
import { C, locale, setLocale, localizeAction } from "./copy.js";
import { request } from "./client.js";
import { enhanceSelects } from "./controls.js";
import { resolveWebsite, websiteHostname } from "./website.js";
import type { WebsitePatch } from "./types.js";

const data = await request("snapshot");
setLocale(data.preferences.locale);
applyTheme(data.preferences);
rememberTheme(data.preferences);
const P = C.popup;
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const supported = /^https?:/.test(tab?.url || "");
const hostname = supported ? websiteHostname(tab.url!) : "";
let featureBusy = false;
const favicon = new URL(chrome.runtime.getURL("/_favicon/"));
favicon.searchParams.set("pageUrl", tab?.url || "");
favicon.searchParams.set("size", "32");
const homeIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/></svg>';
const playIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>';
const root = document.querySelector<HTMLElement>("#popup")!;
root.innerHTML = `<header class="popup-header"><span class="popup-brand">${brandMark}<strong>${C.brand}</strong></span><button class="selection-button" id="home" data-tooltip="${C.real.openHome}" aria-label="${C.real.openHome}">${homeIcon}</button></header>
  <main class="popup-body">
    <section class="popup-page" aria-label="${P.currentPage}">
      <div class="popup-page-site">${supported ? `<img src="${escape(favicon.href)}" alt="" width="18" height="18">` : ""}<span>${P.currentPage}</span>${supported ? `<strong>${escape(hostname)}</strong>` : ""}</div>
      <p class="popup-title">${escape(supported ? tab.title : C.real.unsupportedPage)}</p>
    </section>
    <section class="popup-process selection-settings" aria-label="${P.process}">
      <div class="popup-process-options"><label class="field"><span class="field-label">${C.chooseAction}</span><select id="action">${data.actions
        .map((raw) => {
          const a = localizeAction(raw, locale);
          return `<option value="${a.id}">${escape(a.name)}</option>`;
        })
        .join("")}</select></label>
      <div id="languages"></div></div>
      <div class="popup-process-actions"><button class="btn primary" data-op="run" ${supported ? "" : "disabled"}>${playIcon}${C.start}</button><button class="btn ghost" data-op="restore" ${supported ? "" : "disabled"}>${C.restore}</button></div>
      <p class="popup-status" id="status" role="status">${data.connections.some((c) => c.protocol !== "typesafe") ? C.processingNotice : C.real.noConnection}</p>
    </section>
    <section class="popup-features" aria-label="${P.features}" aria-describedby="feature-scope"><div id="feature-controls"></div><p class="popup-status" id="feature-scope">${P.siteOnly}</p><p class="popup-status" id="feature-status" role="status"></p></section>
  </main>`;
const chosen = () =>
  data.actions.find(
    (action) =>
      action.id === document.querySelector<HTMLSelectElement>("#action")!.value,
  );
function updateRunState() {
  document.querySelector<HTMLButtonElement>('[data-op="run"]')!.disabled =
    !supported || !chosen();
}
function renderLanguages() {
  const action = chosen();
  document.querySelector<HTMLElement>("#languages")!.innerHTML =
    action?.kind === "translate"
      ? `<label class="field"><span class="field-label">${C.outputLanguage}</span><select data-language="targetLanguage" aria-label="${C.outputLanguage}">${Object.entries(
          C.languages,
        )
          .filter(([value]) => value !== "auto")
          .map(
            ([value, label]) =>
              `<option value="${value}" ${action.targetLanguage === value ? "selected" : ""}>${escape(label)}</option>`,
          )
          .join("")}</select></label>`
      : "";
  enhanceSelects(root);
  updateRunState();
}
function renderFeatures() {
  const effective = resolveWebsite(data.website, hostname);
  const disabled = featureBusy || !supported ? "disabled" : "";
  const controls = (["toolbar", "floating"] as const)
    .map(
      (key) => `<label class="popup-feature-row" data-feature-group="${key}">
      <span>${P[key]}</span><input class="switch" type="checkbox" data-feature="${key}" aria-label="${P[key]}" ${effective[key] ? "checked" : ""} ${disabled}>
    </label>`,
    )
    .join("");
  document.querySelector<HTMLElement>("#feature-controls")!.innerHTML = controls;
}
async function saveFeatures(patch: Pick<WebsitePatch, "toolbar" | "floating">) {
  if (featureBusy || !supported) return;
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
    data.website = await request("website.update", {
      tabId: tab.id!,
      patch,
    });
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
renderLanguages();
renderFeatures();
document.addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.dataset.feature) {
    const key = target.dataset.feature as "toolbar" | "floating";
    void saveFeatures({ [key]: target.checked });
  } else if (target.id === "action") renderLanguages();
  else if (target.dataset.language) {
    const action = chosen();
    if (action) action.targetLanguage = target.value;
  }
});
document
  .querySelector<HTMLElement>("#home")!
  .addEventListener("click", () =>
    request("settings.open", { tabId: supported ? tab.id : null }),
  );
document.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("[data-op]");
  if (!button || tab?.id === undefined) return;
  try {
    button.disabled = true;
    if (button.dataset.op === "run") {
      if (!chosen()) throw new ModelError("invalidAction");
      await request("tab.run", {
        tabId: tab.id,
        actionId: chosen()!.id,
        scope: "body",
        panel: true,
        translation:
          chosen()?.kind === "translate"
            ? {
                sourceLanguage: "auto",
                targetLanguage: chosen()!.targetLanguage!,
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
