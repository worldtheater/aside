import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Each import runs in a fresh runtime, as it does in a real extension context.
for (const [scheme, userAgent, browser, account, settings] of [
  [
    "chrome-extension",
    "Chrome/156.0",
    "Chrome",
    "Chrome",
    "chrome://extensions/shortcuts",
  ],
  [
    "chrome-extension",
    "Chrome/156.0 Edg/156.0",
    "Edge",
    "Microsoft",
    "edge://extensions/shortcuts",
  ],
  [
    "chrome-extension",
    "Chrome/156.0 EdgeLike/1.0",
    "Chrome",
    "Chrome",
    "chrome://extensions/shortcuts",
  ],
  [
    "safari-web-extension",
    "Version/26.0 Safari/625.1",
    "Safari",
    "Apple",
    null,
  ],
  [
    "moz-extension",
    "Firefox/147.0 Edg/156.0",
    "Firefox",
    "Mozilla",
    "commands",
  ],
]) {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: ${JSON.stringify(userAgent)} }, configurable: true });
    let settings;
    globalThis.chrome = {
      runtime: { getURL: path => ${JSON.stringify(scheme + "://fixture/")} + path.replace(/^\\//, "") },
      tabs: { create: async ({url}) => { settings = url; } },
      commands: { openShortcutSettings: async () => { settings = "commands"; } }
    };
    const platform = await import("./browser.js");
    const assert = (await import("node:assert/strict")).default;
    const engines = await import("./translation-engine.js");
    const nativeAction = { kind: "translate", translationEngine: "browser" };
    assert.deepEqual(engines.AVAILABLE_TRANSLATION_ENGINES, platform.isFirefox ? ["ai", "microsoft"] : ["ai", "microsoft", "browser"]);
    assert.equal(engines.translationEngineSupported(nativeAction), !platform.isFirefox);
    assert.equal(engines.actionAvailable(nativeAction, { connections: [] }), !platform.isFirefox);
    assert.equal(engines.translationEngine(nativeAction), "browser", "A stored local engine is never silently changed to an online service");
    engines.validateTranslationEngine(nativeAction);
    if (platform.isFirefox) await assert.rejects(engines.authorizeTranslation(nativeAction), error => error.code === "translationUnavailable");
    const safari = platform.isSafari;
    for (const [address, expected] of [
      ["http://192.0.2.27:8317/v1/models", safari ? "http://192.0.2.27/*" : "http://192.0.2.27:8317/*"],
      ["https://models.example:8443/v1/responses", safari ? "https://models.example/*" : "https://models.example:8443/*"],
      ["http://localhost:11434/v1", safari ? "http://localhost/*" : "http://localhost:11434/*"],
      ["http://[::1]:8317/v1", safari ? "http://[::1]/*" : "http://[::1]:8317/*"],
      ["https://api.example.com/v1", "https://api.example.com/*"],
    ]) assert.equal(platform.hostPermissionPattern(address), expected);

    if (platform.supportsConfigurationSync) await platform.openShortcutSettings();
    else {
      const assert = (await import("node:assert/strict")).default;
      await assert.rejects(platform.openShortcutSettings(), /Safari/);
      settings = null;
    }
    console.log(JSON.stringify([platform.BROWSER_NAME, platform.SYNC_ACCOUNT_NAME, settings,
      platform.faviconUrl("https://example.com/"), platform.faviconUrl("https://example.com/", "javascript:alert(1)")]));
  `,
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  const [actualBrowser, actualAccount, actualSettings, icon, unsafeIcon] =
    JSON.parse(output);
  assert.deepEqual(
    [actualBrowser, actualAccount, actualSettings],
    [browser, account, settings],
  );
  if (scheme !== "chrome-extension") {
    assert.equal(icon, null);
    assert.equal(unsafeIcon, null);
  } else {
    const url = new URL(icon);
    assert.equal(url.pathname, "/_favicon/");
    assert.equal(url.searchParams.get("pageUrl"), "https://example.com/");
  }
}
console.log(
  "PASS: Chrome, Edge, Firefox and Safari names, sync accounts, shortcut destinations and host permission patterns.",
);
