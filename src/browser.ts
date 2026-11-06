// Extension origins identify Firefox and Safari in both background and page
// contexts. Edge shares Chromium's scheme; its UA is used for display only.
export const isFirefox =
  globalThis.chrome?.runtime?.getURL?.("").startsWith("moz-extension://") ??
  false;
export const isSafari =
  globalThis.chrome?.runtime
    ?.getURL?.("")
    .startsWith("safari-web-extension://") ?? false;
export const supportsConfigurationSync = !isSafari;
export const supportsNativeLanguagePacks = !isFirefox;
export const usesPrivateSettingsStore = isFirefox || isSafari;
export const requiresDirectPermissionRequest = isFirefox || isSafari;
export const isEdge =
  !isFirefox &&
  !isSafari &&
  /\bEdg\//.test(globalThis.navigator?.userAgent ?? "");
export const BROWSER_NAME = isSafari
  ? "Safari"
  : isFirefox
    ? "Firefox"
    : isEdge
      ? "Edge"
      : "Chrome";
export const SYNC_ACCOUNT_NAME = isSafari
  ? "Apple"
  : isFirefox
    ? "Mozilla"
    : isEdge
      ? "Microsoft"
      : "Chrome";

export const WEBSITE_RESOURCE_ORIGINS = ["http://*/*", "https://*/*"];

// Safari match patterns cover a host across ports and reject explicit ports.
// Keep the full endpoint URL (including its port) for the network request.
export function hostPermissionPattern(address: string): string {
  const url = new URL(address);
  return (isSafari ? `${url.protocol}//${url.hostname}` : url.origin) + "/*";
}

export function faviconUrl(pageUrl: string, tabIcon?: string): string | null {
  if (usesPrivateSettingsStore) {
    // Firefox and Safari have no /_favicon endpoint. Only use a favicon already provided by
    // the browser; saved items use the local page icon instead of fetching sites.
    return tabIcon && /^(https?:|data:image\/)/i.test(tabIcon) ? tabIcon : null;
  }
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
  return url.href;
}

export async function openShortcutSettings(): Promise<void> {
  if (isSafari)
    throw new Error("Open Safari extension settings to change shortcuts.");
  if (isFirefox) {
    // Firefox 137+ opens this privileged page through the Commands API.
    const commands = chrome.commands as typeof chrome.commands & {
      openShortcutSettings(): Promise<void>;
    };
    await commands.openShortcutSettings();
  } else {
    await chrome.tabs.create({
      url: `${isEdge ? "edge" : "chrome"}://extensions/shortcuts`,
    });
  }
}
