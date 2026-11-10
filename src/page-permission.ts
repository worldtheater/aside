import { request } from "./client.js";
import { WEBSITE_RESOURCE_ORIGINS } from "./browser.js";
import { messages } from "./copy.js";
import { resolveLocale } from "./locale.js";
import { MICROSOFT_ORIGIN } from "./translation-engine.js";

const popup = location.hash
  ? chrome.runtime.connect({ name: location.hash })
  : null;
const { preferences, strings: S } = await request("settings.public");
const T = S.translation;
const locale = resolveLocale(preferences.locale);
const lights = new URLSearchParams(location.search).get("feature") === "lights";
const title = lights ? messages[locale].about.darkReader : T.engines.microsoft;
const notice = lights ? S.lightsPermissionNotice : T.microsoftNotice;
const allow = lights ? messages[locale].sync.allowAccess : T.microsoftAuthorize;
document.documentElement.lang = locale;
document.title = `${title} · Aside`;
const dialog = document.querySelector("dialog")!;
dialog.querySelector("#permission-title")!.textContent = title;
dialog.querySelector("#permission-notice")!.textContent = notice;
const authorize = dialog.querySelector<HTMLButtonElement>(
  "[data-op=authorize]",
)!;
authorize.textContent = allow;
const cancel = dialog.querySelector<HTMLButtonElement>("[data-op=cancel]")!;
cancel.textContent = S.cancel;
const status = dialog.querySelector("#permission-status")!;
async function close() {
  if (popup) {
    window.close();
    return;
  }
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
}
cancel.addEventListener("click", close);
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  void close();
});
authorize.addEventListener("click", async () => {
  authorize.disabled = true;
  status.textContent = "";
  popup?.postMessage("requesting");
  let granted: boolean;
  try {
    granted = await chrome.permissions.request({
      origins: lights ? WEBSITE_RESOURCE_ORIGINS : [MICROSOFT_ORIGIN],
    });
  } catch {
    status.textContent = S.failed;
    authorize.disabled = false;
    popup?.postMessage("idle");
    return;
  }
  popup?.postMessage(granted);
  await close();
});
if (popup) {
  document.documentElement.dataset.permissionPopup = "";
  dialog.show();
} else dialog.showModal();
