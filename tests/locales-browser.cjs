const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({
  page,
  context,
  origin,
  calls,
  artifacts,
  nav,
  op,
  choose,
}) => {
  const { LOCALES } = await import("../locale.js");
  const { messages } = await import("../copy.js");
  const stored = await page.evaluate(() =>
    chrome.storage.local.get(["settings", "daily"]),
  );
  let source, popup;
  try {
    await page.evaluate(async () => {
      const { settings } = await chrome.storage.local.get("settings");
      const { getPresets } = await import("./data.js");
      const { setLocale } = await import("./copy.js");
      setLocale("en");
      settings.actions = getPresets();
      settings.preferences.theme = "light";
      await chrome.storage.local.set({ settings });
    });
    await page.reload();
    await page.locator("h1").waitFor();
    source = await context.newPage();
    await source.goto(origin + "/locales-page");
    const host = source.locator("[data-pagework=ui]");
    await host.locator("#dock").waitFor();
    const tabId = await page.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      source.url(),
    );
    popup = await context.newPage();
    const popupURL = new URL("popup.html", page.url()).href;
    for (const locale of Object.keys(LOCALES)) {
      const C = messages[locale];
      const beforeSwitch = calls.length;
      await choose("#ui-locale", locale);
      await page.waitForFunction(
        async (language) =>
          (await chrome.storage.local.get("settings")).settings.preferences
            .locale === language,
        locale,
      );
      await page.reload();
      await page.locator("h1").waitFor();
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      assert.equal(await page.locator("#ui-locale").inputValue(), locale);
      assert.equal(
        await page.locator(".language-label").innerText(),
        LOCALES[locale].short,
      );
      assert.equal(
        await page.locator("#ui-locale option").count(),
        Object.keys(LOCALES).length + 1,
      );
      await page.locator('[data-select-for="ui-locale"]').click();
      assert.equal(
        await page.locator(".option-search").count(),
        0,
        "Interface language menu has no search field",
      );
      await page.keyboard.press("Escape");
      await nav("home");
      assert.equal(await page.locator("h1").innerText(), C.home.title);
      await page.locator(".daily-card").hover();
      await op("daily-settings").click();
      assert.equal(
        await page.locator("dialog h2").innerText(),
        C.home.dailySettings,
      );
      await page
        .locator("dialog .dialog-actions [data-op=dialog-close]")
        .click();
      await page.waitForFunction(() => !document.querySelector("dialog").open);
      for (const [route, title] of [
        ["actions", C.libraryTitle],
        ["connections", C.connectionsTitle],
        ["shortcuts", C.nav.shortcuts],
        ["usage", C.usage.title],
      ]) {
        await nav(route);
        assert.equal(await page.locator("h1").innerText(), title);
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${locale}: ${route} fits desktop`,
        );
      }
      const appearanceBefore = await page.evaluate(
        async () =>
          (await chrome.storage.local.get("settings")).settings.appearance,
      );
      await nav("appearance");
      for (const target of ["page", "selection"]) {
        await choose("#style-target", target);
        const other = locale === "en" ? "zh-CN" : "en";
        await choose("#ui-locale", other);
        const result = page.locator("#style-preview-content .processed-text");
        assert.equal(
          (await result.innerText()).trim(),
          messages[other].appearanceSample.result,
        );
        await choose("#ui-locale", locale);
        assert.equal(
          (await result.innerText()).trim(),
          C.appearanceSample.result,
          `${locale}: ${target} preview updates immediately without a reload`,
        );
        if (target === "page") {
          assert.equal(
            await page.locator(".preview-source").innerText(),
            C.appearanceSample.original,
          );
          assert.equal(
            await page.locator(".preview-content .eyebrow").textContent(),
            C.appearanceSample.category,
          );
        }
        if (["pt-BR", "ru", "th", "vi"].includes(locale))
          await page.locator(".style-preview").screenshot({
            path: path.join(
              artifacts,
              `locale-${locale}-preview-${target}.png`,
            ),
          });
      }
      assert.deepEqual(
        await page.evaluate(
          async () =>
            (await chrome.storage.local.get("settings")).settings.appearance,
        ),
        appearanceBefore,
        "Changing preview language preserves appearance settings",
      );
      await nav("actions");
      await page.locator('[data-op="edit-action"][data-id="qa"]').click();
      assert.equal(
        await page.locator("[data-draft=name]").inputValue(),
        C.presets.qa.name,
      );
      assert.equal(
        await page.locator("[data-language=outputLanguage]").inputValue(),
        "interface",
      );
      await op("editor-cancel").click();
      // Existing pages receive the same language from the background worker.
      const opened = await page.evaluate(
        (tabId) =>
          chrome.runtime.sendMessage({
            type: "tab.run",
            tabId,
            actionId: "qa",
            scope: "body",
          }),
        tabId,
      );
      assert(opened.ok, JSON.stringify(opened));
      await host.locator("#question-input").waitFor();
      await host
        .locator("#result .header strong")
        .filter({ hasText: C.presets.qa.name })
        .waitFor();
      assert.equal(
        await host.locator("#question-input").getAttribute("placeholder"),
        C.real.questionPlaceholder,
      );
      assert.equal(await host.getAttribute("lang"), locale);
      assert.equal(
        await host
          .locator('[data-op="question-clear-quote"]')
          .getAttribute("aria-label"),
        C.real.clearQuestionQuote,
      );
      await source.screenshot({
        path: path.join(artifacts, `locale-${locale}-qa.png`),
        animations: "disabled",
      });
      await host.locator('[data-op="close-result"]').click();
      await popup.goto(popupURL);
      await popup.locator("#feature-scope").waitFor();
      assert.equal(await popup.locator("html").getAttribute("lang"), locale);
      assert.equal(
        await popup.locator("#feature-scope").innerText(),
        C.popup.siteOnly,
      );
      assert.equal(await popup.locator('[data-op="run"]').innerText(), C.start);
      assert.equal(
        calls.length,
        beforeSwitch,
        "Changing language or opening a panel must not call a model",
      );
      // Verify actual provider instructions rather than only the selector label.
      await page.evaluate(async (language) => {
        const { processRequest } = await import("./client.js");
        await processRequest({
          source: "trial",
          actionId: "qa",
          blocks: [{ id: "one", text: "I18N_OUTPUT_" + language }],
        }).promise;
      }, locale);
      assert.equal(calls.length, beforeSwitch + 1);
      assert(
        JSON.stringify(calls.at(-1).body).includes(
          `Output language: ${messages.en.languages[LOCALES[locale].output]} (${LOCALES[locale].output}).`,
        ),
        `${locale}: provider output language`,
      );
      await nav("home");
      await page.screenshot({
        path: path.join(artifacts, `locale-${locale}-home.png`),
        animations: "disabled",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await nav("connections");
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${locale}: narrow connections`,
      );
      await op("theme-menu").click();
      await page.locator('[data-op="theme-mode"][data-value="dark"]').click();
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: path.join(artifacts, `locale-${locale}-mobile.png`),
        fullPage: true,
        animations: "disabled",
      });
      await op("theme-menu").click();
      await page.locator('[data-op="theme-mode"][data-value="light"]').click();
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1440, height: 1000 });
      console.log(
        `PASS: ${locale} navigation, saved preference, action editor, live appearance previews, Q&A, popup, output language and narrow layout.`,
      );
    }
    await choose("#ui-locale", "system");
    await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
    await page.reload();
    await page.locator("h1").waitFor();
    assert.equal(await page.locator("#ui-locale").inputValue(), "system");
    assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
    await nav("appearance");
    await choose("#style-target", "page");
    assert.equal(
      await page.locator(".processed-text").textContent(),
      messages["zh-CN"].appearanceSample.result,
      "Preview also follows the resolved system locale after reloading",
    );
  } finally {
    await popup?.close();
    await source?.close();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate((stored) => chrome.storage.local.set(stored), stored);
    await page.reload();
    await page.locator("h1").waitFor();
  }
};
