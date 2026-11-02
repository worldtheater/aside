// Firefox has a distinct extension scheme. Edge shares Chromium's scheme,
// so use its desktop UA token for names and browser settings links only.
export const isFirefox =
  globalThis.chrome?.runtime?.getURL?.("").startsWith("moz-extension://") ??
  false;
export const isEdge =
  !isFirefox && /\bEdg\//.test(globalThis.navigator?.userAgent ?? "");
export const BROWSER_NAME = isFirefox ? "Firefox" : isEdge ? "Edge" : "Chrome";
export const SYNC_ACCOUNT_NAME = isFirefox
  ? "Mozilla"
  : isEdge
    ? "Microsoft"
    : "Chrome";

export const WEBSITE_RESOURCE_ORIGINS = ["http://*/*", "https://*/*"];

export function faviconUrl(pageUrl: string, tabIcon?: string): string | null {
  if (isFirefox) {
    // Firefox has no /_favicon endpoint. Only use a favicon already provided by
    // the browser; saved items use the local page icon instead of fetching sites.
    return tabIcon && /^(https?:|data:image\/)/i.test(tabIcon) ? tabIcon : null;
  }
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
  return url.href;
}

export async function openShortcutSettings(): Promise<void> {
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
