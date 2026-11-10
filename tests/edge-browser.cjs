const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const extension = fs.mkdtempSync(
  path.join(os.tmpdir(), "aside-edge-extension-"),
);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aside-edge-profile-"));

(async () => {
  let context;
  try {
    fs.cpSync(path.join(root, "dist/edge"), extension, { recursive: true });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(extension, "manifest.json")),
    );
    assert.equal(
      manifest.version,
      JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version,
    );
    for (const key of ["key", "update_url", "browser_specific_settings"])
      assert(!(key in manifest));
    assert.equal(manifest.background.service_worker, "background.js");
    const launch = process.env.EDGE_PATH
      ? { executablePath: process.env.EDGE_PATH }
      : { channel: "msedge" };
    context = await chromium.launchPersistentContext(profile, {
      ...launch,
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: ["--enable-unsafe-extension-debugging"],
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send("Extensions.loadUnpacked", {
      path: extension,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/index.html#sync`);
    await page.locator('[data-op="sync-first-setup"]').waitFor();
    const platform = await page.evaluate(async () => {
      const browser = await import("./browser.js");
      const icon = new Image();
      icon.src = browser.faviconUrl("http://127.0.0.1/");
      await icon.decode();
      return {
        name: browser.BROWSER_NAME,
        account: browser.SYNC_ACCOUNT_NAME,
        iconWidth: icon.naturalWidth,
        commands: (await chrome.commands.getAll()).map((item) => item.name),
        trustedLocal: typeof chrome.storage.local.setAccessLevel,
        trustedSession: typeof chrome.storage.session.setAccessLevel,
      };
    });
    assert.equal(platform.name, "Edge");
    assert.equal(platform.account, "Microsoft");
    assert(platform.iconWidth > 0);
    assert.equal(platform.trustedLocal, "function");
    assert.equal(platform.trustedSession, "function");
    for (const command of Object.keys(manifest.commands))
      assert(platform.commands.includes(command));
    assert.deepEqual(errors, []);
    console.log(
      "PASS: actual Edge runtime, favicon, commands and trusted storage APIs.",
    );
    await context.close();
    context = null;

    // The production build stays untouched; privileged fixtures exist only here.
    fs.mkdirSync(path.join(extension, "tests"));
    fs.copyFileSync(
      path.join(root, "tests/local-store-fixture.mjs"),
      path.join(extension, "tests/local-store-fixture.mjs"),
    );
    const env = {
      ...process.env,
      BROWSER_CHANNEL: "msedge",
      CHROME_PATH: process.env.EDGE_PATH || "",
      EXTENSION_PATH: extension,
    };
    for (const args of [
      ["tests/credentials-browser.cjs"],
      ["tests/browser.cjs", "--onboarding-only"],
      ["tests/browser.cjs", "--page-translation-only"],
      ["tests/browser.cjs", "--translation-engines-only"],
      ["tests/browser.cjs", "--qa-only"],
      ["tests/browser.cjs", "--text-translation-only"],
      ["tests/browser.cjs", "--shortcuts-only"],
      ["tests/browser.cjs", "--website-only"],
      ["tests/config-sync-browser.cjs"],
    ]) {
      console.log("Edge regression:", args.join(" "));
      const result = spawnSync(process.execPath, args, {
        cwd: root,
        env,
        stdio: "inherit",
        timeout: 300000,
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, args.join(" "));
    }
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(extension, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
