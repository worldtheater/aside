const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const artifacts = path.join(root, "artifacts");

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aside-share-"));
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" }),
    headless: true,
    viewport: { width: 1200, height: 800 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  });
  const errors = [];
  require("./inspect-ui.cjs").watchUI(context, errors);
  try {
    // Observe successful browser clipboard writes without reading the host's
    // existing clipboard. Failure is injected only for the error-state checks.
    await context.addInitScript(() => {
      if (location.protocol !== "chrome-extension:") return;
      window.shareWrites = [];
      window.shareMessages = [];
      window.rejectShare = false;
      const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text) => {
        if (window.rejectShare) throw new Error("Clipboard blocked for test");
        await writeText(text);
        window.shareWrites.push(text);
      };
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (...args) => {
        window.shareMessages.push(args[0].type);
        return send(...args);
      };
      if (location.search === "?no-active-tab")
        chrome.tabs.query = async () => [];
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send("Extensions.loadUnpacked", { path: root });
    const origin = `chrome-extension://${id}/`;
    const app = await context.newPage();
    await app.goto(origin + "index.html");
    await app.locator('[data-route="help"]').click();
    const { messages } = await import("../copy.js");
    const chooseLocale = async (locale) => {
      await app.locator('[data-select-for="ui-locale"]').click();
      await app.locator(`[role="option"][data-value="${locale}"]`).click();
      await app.waitForFunction(
        (locale) => document.documentElement.lang === locale,
        locale,
      );
    };
    const checkShare = async (page, locale, route) => {
      await page.bringToFront();
      const text = messages[locale].share;
      const button = page.getByRole("button", {
        name: text.label,
        exact: true,
      });
      await button.click();
      await page.getByText(text.copied, { exact: true }).waitFor();
      const writes = await page.evaluate(() => window.shareWrites);
      assert.equal(
        writes.at(-1),
        `${text.text}\n\nhttps://worldtheater.github.io/aside/${route}`,
      );
      assert.equal(page.isClosed(), false);
      assert.equal(await button.isEnabled(), true);
      const commands = await page.evaluate(() => window.shareMessages);
      assert(
        !commands.includes("tab.run") && !commands.includes("tab.restore"),
      );
    };
    for (const [locale, route] of [
      ["en", ""],
      ["zh-CN", "zh/"],
      ["zh-TW", "zh-tw/"],
      ["pt-BR", "pt-br/"],
    ]) {
      await chooseLocale(locale);
      await checkShare(app, locale, route);
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 400, height: 600 });
      await popup.goto(origin + "popup.html?no-active-tab");
      await checkShare(popup, locale, route);
      assert.equal(
        await popup.locator('[data-op="run"]').isEnabled(),
        false,
        "Sharing still works without an actionable tab or model connection",
      );
      await popup.evaluate(() => {
        window.rejectShare = true;
      });
      await popup.locator('[data-op="share-product"]').click();
      assert.equal(
        await popup.locator("#share-status").innerText(),
        messages[locale].share.failed,
      );
      assert.equal(
        await popup.locator("#share-status").getAttribute("data-error"),
        "true",
      );
      assert.equal(
        await popup.locator('[data-op="share-product"]').isEnabled(),
        true,
      );
      assert.equal((await popup.evaluate(() => window.shareWrites)).length, 1);
      await popup.close();
    }
    await chooseLocale("zh-CN");
    await app.locator("#toast").waitFor({ state: "hidden" });
    for (const theme of ["light", "dark"]) {
      await app.locator('[data-op="theme-menu"]').click();
      await app
        .locator(`[data-op="theme-mode"][data-value="${theme}"]`)
        .click();
      await app.keyboard.press("Escape");
      await app.screenshot({
        path: path.join(artifacts, `share-about-${theme}.png`),
        animations: "disabled",
      });
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 400, height: 600 });
      await popup.goto(origin + "popup.html");
      await popup.locator('[data-op="share-product"]').waitFor();
      await popup.screenshot({
        path: path.join(artifacts, `share-popup-${theme}.png`),
        animations: "disabled",
      });
      assert.equal(
        await popup.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await checkShare(popup, "zh-CN", "zh/");
      await popup.close();
    }
    await app.evaluate(() => {
      window.rejectShare = true;
    });
    await app.locator('[data-op="share-product"]').click();
    await app
      .getByText(messages["zh-CN"].share.failed, { exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: About and popup share real clipboard writes, localized homepages, missing-tab availability, error feedback, retained popup and light/dark layouts.",
    );
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
