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
      const { settings, daily } = await chrome.storage.local.get([
        "settings",
        "daily",
      ]);
      const { getPresets } = await import("./data.js");
      const { setLocale } = await import("./copy.js");
      setLocale("en");
      settings.actions = getPresets();
      settings.actions.find(
        (action) => action.id === "translate",
      ).translationEngine = "ai";
      settings.preferences.theme = "light";
      // Keep automatic first-visit generation out of the locale interaction check.
      await chrome.storage.local.set({
        settings,
        daily: {
          ...daily,
          result: "Today's saved reflection.",
          date: new Date().toLocaleDateString("en-CA"),
        },
      });
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
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(popupURL);
    const choosePopup = async (id, value) => {
      await popup.locator(`[data-select-for="${id}"]`).click();
      assert.equal(await popup.locator(".option-search").count(), 0);
      await popup.locator(`[role=option][data-value="${value}"]`).click();
    };
    const beforePopup = calls.length;
    await choosePopup("action", "explain");
    await choosePopup("ui-locale", "en");
    await popup.waitForFunction(() => document.documentElement.lang === "en");
    await page.waitForFunction(() => document.documentElement.lang === "en");
    assert.equal(await popup.locator("#action").inputValue(), "explain");
    assert.equal(
      await popup.locator("#settings").getAttribute("aria-label"),
      "Settings",
    );
    await choosePopup("action", "translate");
    const targetId = await popup
      .locator("[data-language=targetLanguage]")
      .getAttribute("id");
    await choosePopup(targetId, "de");
    await choosePopup("ui-locale", "ja");
    await popup.waitForFunction(() => document.documentElement.lang === "ja");
    await page.waitForFunction(() => document.documentElement.lang === "ja");
    assert.equal(
      await popup.locator("[data-language=targetLanguage]").inputValue(),
      "de",
    );
    const preference = await page.evaluate(async () => {
      const { value } = await chrome.runtime.sendMessage({ type: "snapshot" });
      return {
        locale: value.preferences.locale,
        target: value.actions.find((a) => a.id === "translate").targetLanguage,
      };
    });
    assert.deepEqual(preference, { locale: "ja", target: "interface" });
    await choose("#ui-locale", "zh-CN");
    await popup.waitForFunction(
      () => document.documentElement.lang === "zh-CN",
    );
    assert.equal(
      await popup.locator("[data-language=targetLanguage]").inputValue(),
      "de",
    );
    const languageBox = await popup.locator(".language-control").boundingBox();
    const settingsBox = await popup.locator("#settings").boundingBox();
    assert(languageBox.x + languageBox.width <= settingsBox.x);
    assert(
      Math.abs(
        languageBox.y +
          languageBox.height / 2 -
          settingsBox.y -
          settingsBox.height / 2,
      ) < 1,
    );
    await popup.screenshot({
      path: path.join(artifacts, "popup-language.png"),
    });
    await popup.locator('[data-select-for="ui-locale"]').click();
    assert.equal(
      await popup.locator("[role=option]").count(),
      Object.keys(LOCALES).length + 1,
    );
    await popup.screenshot({
      path: path.join(artifacts, "popup-language-menu.png"),
    });
    await popup.keyboard.press("Escape");
    await choosePopup("ui-locale", "system");
    await page.waitForFunction(
      async () =>
        (await chrome.storage.local.get("settings")).settings.preferences
          .locale === "system",
    );
    await popup.reload();
    assert.equal(await popup.locator("#ui-locale").inputValue(), "system");
    assert.equal(await popup.locator("html").getAttribute("lang"), "zh-CN");
    assert.equal(
      calls.length,
      beforePopup,
      "Popup language changes never invoke a model",
    );
    console.log(
      "PASS: shared popup language control, live two-way locale updates, preserved action/output drafts, persistence and compact menu layout.",
    );
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
        C.popup.allSites,
      );
      assert.equal(await popup.locator('[data-op="run"]').innerText(), C.start);
      assert.equal(
        await popup.locator("#website-lights").getAttribute("aria-label"),
        C.popup.lightsHint(C.popup.lightsModes.off, C.popup.lightsModes.on),
      );
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
