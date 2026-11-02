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
    await platform.openShortcutSettings();
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
  if (scheme === "moz-extension") {
    assert.equal(icon, null);
    assert.equal(unsafeIcon, null);
  } else {
    const url = new URL(icon);
    assert.equal(url.pathname, "/_favicon/");
    assert.equal(url.searchParams.get("pageUrl"), "https://example.com/");
  }
}
console.log(
  "PASS: Chrome, Edge and Firefox names, sync accounts and shortcut destinations.",
);
