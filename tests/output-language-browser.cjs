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
  const stored = await page.evaluate(() =>
    chrome.storage.local.get(["settings", "daily"]),
  );
  let source;
  const snapshot = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value,
    );
  const language = async (value) => {
    await choose("#ui-locale", value);
    await page.waitForFunction(
      async (value) =>
        (await chrome.storage.local.get("settings")).settings.preferences
          .locale === value,
      value,
    );
  };
  const run = (actionId) =>
    page.evaluate(
      async (actionId) =>
        (await import("./client.js")).processRequest({
          actionId,
          blocks: [
            {
              id: "one",
              text: "OUTPUT_LANGUAGE_FIXTURE: A brief source for language-specific cache checks.",
            },
          ],
          source: "trial",
        }).promise,
      actionId,
    );
  const wire = () => calls.at(-1).body.messages[0].content;
  const noLanguageSearch = async (selector) => {
    const id = await page.locator(selector).getAttribute("id");
    await page.locator(`[data-select-for="${id}"]`).click();
    assert.equal(await page.locator(".option-search").count(), 0);
    await page.keyboard.press("Escape");
  };
  const closeDialog = async () => {
    await page.locator("dialog .dialog-actions [data-op=dialog-close]").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
  };
  try {
    await page.evaluate(async (origin) => {
      const { settings } = await chrome.storage.local.get("settings");
      const fixture = settings.connections.find((c) =>
        c.url.startsWith(origin),
      );
      if (!fixture) throw Error("Fixture connection missing");
      const { setLocale, C } = await import("./copy.js");
      setLocale("zh-CN");
      const { getPresets } = await import("./data.js");
      const actions = getPresets();
      Object.assign(
        actions.find((action) => action.id === "plain"),
        {
          name: "Classical to modern Chinese",
          instruction:
            "Rewrite classical Chinese in clear modern Chinese. Preserve characters, events, and tone. Briefly explain difficult allusions after the relevant paragraph. Return only the rewritten text and necessary notes.",
          builtin: false,
          model: fixture.id,
          outputLanguage: "zh-Hans",
        },
      );
      await chrome.storage.local.set({
        settings: {
          ...settings,
          actions,
          connections: [
            { ...fixture, protocol: "chat", reasoningEffort: undefined },
          ],
          defaultConnection: fixture.id,
          preferences: {
            ...settings.preferences,
            locale: "zh-CN",
            theme: "light",
          },
        },
        daily: {
          prompt: C.home.promptDefault,
          outputLanguage: "interface",
          useCollection: false,
          result: "Existing thought.",
          date: new Date().toLocaleDateString("en-CA"),
        },
      });
      // Simulate initialization of the saved profile before opening its editor.
      await (await import("./store.js")).initialize();
    }, origin);
    await page.reload();
    await page.locator("h1").waitFor();
    await nav("actions");
    await page.locator("[data-op=edit-action][data-id=plain]").click();
    await noLanguageSearch("[data-language=outputLanguage]");
    const currentPlainPrompt = await page.evaluate(
      async () => (await import("./prompts.js")).ACTION_PROMPTS.plain,
    );
    assert.equal(
      await page.locator("#instruction").inputValue(),
      currentPlainPrompt,
    );
    assert.equal(
      await page.locator("[data-language=outputLanguage]").inputValue(),
      "zh-Hans",
    );
    const repairedPlain = (await snapshot()).actions.find(
      (action) => action.id === "plain",
    );
    assert.equal(
      repairedPlain.instruction,
      currentPlainPrompt,
      "Updated text is persisted",
    );
    assert.equal(repairedPlain.builtin, true);
    assert.notEqual(
      repairedPlain.model,
      "default",
      "Keep the saved model selection",
    );
    await page.screenshot({
      path: path.join(artifacts, "plain-upgraded-prompt.png"),
      fullPage: true,
    });
    await choose("[data-language=outputLanguage]", "interface");
    await op("save").click();
    await page.waitForFunction(
      async () =>
        (await chrome.storage.local.get("settings")).settings.actions.find(
          (action) => action.id === "plain",
        ).outputLanguage === "interface",
    );
    assert.equal(
      (await snapshot()).actions.find((action) => action.id === "plain")
        .builtin,
      true,
      "Output-language changes keep the preset linked to default text",
    );
    await nav("actions");
    await page.locator("[data-op=edit-action][data-id=explain]").click();
    const englishPrompt = await page.locator("#instruction").inputValue();
    assert(!/[\u3400-\u9fff]/.test(englishPrompt));
    assert.equal(
      await page.locator("[data-language=outputLanguage]").inputValue(),
      "interface",
    );
    await choose("[data-language=outputLanguage]", "ja");
    await op("save").click();
    await page.waitForFunction(
      async () =>
        (await chrome.storage.local.get("settings")).settings.actions.find(
          (a) => a.id === "explain",
        ).outputLanguage === "ja",
    );
    await run("explain");
    assert(wire().includes("Output language: ja."));
    const fixedCalls = calls.length;
    await nav("actions");
    await page.locator("[data-op=edit-action][data-id=explain]").click();
    await language("en");
    assert.equal(
      await page.locator("#instruction").inputValue(),
      englishPrompt,
    );
    assert.equal(
      await page.locator("[data-language=outputLanguage]").inputValue(),
      "ja",
    );
    assert.equal((await run("explain")).stats.hits, 1);
    assert.equal(calls.length, fixedCalls);
    await choose("[data-language=outputLanguage]", "interface");
    await op("save").click();
    await page.waitForFunction(
      async () =>
        (await chrome.storage.local.get("settings")).settings.actions.find(
          (a) => a.id === "explain",
        ).outputLanguage === "interface",
    );
    await run("explain");
    assert(wire().includes("Output language: en."));
    await language("zh-CN");
    await run("explain");
    assert(wire().includes("Output language: zh-Hans."));
    const interfaceCalls = calls.length;
    await language("en");
    assert.equal((await run("explain")).stats.hits, 1);
    assert.equal(calls.length, interfaceCalls);
    await run("plain");
    assert(
      wire().includes(currentPlainPrompt),
      "The actual model request uses the editor's new prompt",
    );
    assert(!wire().includes("Rewrite classical Chinese"));
    assert(wire().includes("Output language: en."));
    assert(!wire().includes("modern Chinese rendition"));
    await nav("actions");
    await page.locator("[data-op=edit-action][data-id=translate]").click();
    assert.equal(
      await page.locator("[data-language=outputLanguage]").count(),
      0,
    );
    assert.equal(
      await page.locator("[data-language=targetLanguage]").count(),
      1,
    );
    await noLanguageSearch("[data-language=targetLanguage]");
    assert.equal(
      await page.locator("[data-language=targetLanguage]").inputValue(),
      "interface",
    );
    const editTranslation = () =>
      page.locator('[data-op="edit-action"][data-id="translate"]').click();
    await choose("[data-language=targetLanguage]", "ja");
    await op("save").click();
    await editTranslation();
    await choose("[data-language=targetLanguage]", "interface");
    await op("save").click();
    assert.equal(
      (await snapshot()).actions.find((a) => a.id === "translate")
        .targetLanguage,
      "interface",
    );
    await language("en");
    await run("translate");
    assert(wire().includes("into en."));
    const beforeJapanese = calls.length;
    await language("ja");
    await run("translate");
    assert.equal(calls.length, beforeJapanese + 1);
    assert(wire().includes("into ja."));
    await run("translate");
    assert.equal(
      calls.length,
      beforeJapanese + 1,
      "Same resolved translation target reuses cache",
    );
    await editTranslation();
    await choose("[data-language=targetLanguage]", "fr");
    await op("save").click();
    await language("zh-CN");
    await run("translate");
    assert(wire().includes("into fr."));
    await language("en");
    await run("translate");
    assert(wire().includes("into fr."));
    assert.equal(
      (await snapshot()).actions.find((a) => a.id === "translate")
        .targetLanguage,
      "fr",
      "Fixed translation language is unchanged by interface language",
    );
    await editTranslation();
    await choose("[data-language=targetLanguage]", "interface");
    await choose("[data-language=sourceLanguage]", "en");
    await language("zh-CN");
    await op("swap-languages").click();
    assert.equal(
      await page.locator("[data-language=sourceLanguage]").inputValue(),
      "zh-Hans",
    );
    assert.equal(
      await page.locator("[data-language=targetLanguage]").inputValue(),
      "en",
    );

    await language("zh-CN");
    await nav("home");
    await page.locator(".daily-card").hover();
    await op("daily-settings").click();
    const dailyPrompt = await page.locator("#daily-prompt").inputValue();
    assert(dailyPrompt.trim());
    await choose("#daily-output-language", "de");
    await op("daily-preview").click();
    await page
      .locator(".daily-preview-text")
      .filter({ hasText: "A thought generated" })
      .waitFor();
    assert(wire().includes("Output language: de."));
    assert.equal(
      JSON.parse(calls.at(-1).body.messages.at(-1).content).language,
      undefined,
    );
    const beforeSave = calls.length;
    await op("daily-save").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    let saved = (await snapshot()).daily;
    assert.equal(saved.outputLanguage, "de");
    assert(saved.result);
    const previousDaily = { result: saved.result, date: saved.date };
    assert.equal(calls.length, beforeSave);
    await page.locator(".daily-card").hover();
    await op("daily-settings").click();
    await choose("#daily-output-language", "interface");
    assert.equal(await page.locator(".daily-preview-text").count(), 0);
    await op("daily-save").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    saved = (await snapshot()).daily;
    assert.equal(saved.outputLanguage, "interface");
    assert.equal(saved.result, previousDaily.result);
    assert.equal(saved.date, previousDaily.date);
    await language("en");
    await page.locator(".daily-card").hover();
    await op("daily-settings").click();
    const presetPrompt = "Write a grounded reflection on patient reading.";
    await page.locator("#daily-prompt").fill(presetPrompt);
    await op("daily-preview").click();
    await page
      .locator(".daily-preview-text")
      .filter({ hasText: "A thought generated" })
      .waitFor();
    assert(wire().includes("Output language: en."));
    await choose("#daily-output-language", "fr");
    assert.equal(
      await page.locator(".daily-preview-text").count(),
      0,
      "A completed preview is invalidated when output language changes",
    );
    await op("daily-save").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    assert.equal((await snapshot()).daily.result, previousDaily.result);
    await language("zh-CN");
    await page.locator(".daily-card").hover();
    await op("daily-settings").click();
    assert.equal(
      await page.locator("#daily-prompt").inputValue(),
      presetPrompt,
    );
    assert.equal(
      await page.locator("#daily-output-language").inputValue(),
      "fr",
    );
    await page.setViewportSize({ width: 780, height: 720 });
    await page.screenshot({
      path: path.join(artifacts, "daily-output-language.png"),
      animations: "disabled",
    });
    await closeDialog();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.locator(".daily-card").hover();
    await op("daily-refresh").click();
    await page
      .locator(".workspace .daily-thought")
      .filter({ hasText: "A thought generated" })
      .waitFor();
    assert(wire().includes("Output language: fr."));

    await page.evaluate(async () => {
      const { value } = await chrome.runtime.sendMessage({ type: "snapshot" });
      await chrome.runtime.sendMessage({
        type: "settings.save",
        patch: {
          actions: value.actions.map((action) =>
            action.id === "summary" ? { ...action, quick: true } : action,
          ),
        },
      });
    });
    source = await context.newPage();
    await source.goto(origin + "/output-language");
    const host = source.locator("[data-pagework=ui]"),
      bar = host.locator("#selection");
    await host.waitFor({ state: "attached" });
    await source.locator("#first").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const rect = await source.locator("#first").boundingBox();
    await source.mouse.move(rect.x + 4, rect.y + 4);
    await source.mouse.up();
    await bar.waitFor();
    const command = (name) => bar.locator(`[data-selection-command=${name}]`);
    const action = (id) =>
      bar.locator(
        `:scope > .selection-toolbar-row > .selection-actions > [data-selection-action=${id}]`,
      );
    await command("expand").click();
    await command("settings").click();
    await action("summary").click();
    await bar
      .locator("[data-selection-field=outputLanguage]")
      .selectOption("ru");
    await command("save").click();
    await bar.locator(".selection-settings").waitFor({ state: "detached" });
    assert.equal(
      (await snapshot()).actions.find((a) => a.id === "summary").outputLanguage,
      "ru",
    );
    assert.equal(
      (await snapshot()).actions.find((action) => action.id === "summary")
        .builtin,
      true,
      "Native settings changes also keep default text linked",
    );
    // Saving settings collapses the panel; Summary is outside the quick strip.
    await command("expand").click();
    await action("summary").click();
    await host
      .locator("#result-status")
      .filter({ hasText: "处理完成" })
      .waitFor();
    assert(wire().includes("Output language: ru."));
    await command("settings").click();
    await action("summary").click();
    assert.equal(
      await bar.locator("[data-selection-field=outputLanguage]").inputValue(),
      "ru",
    );
    await source.screenshot({
      path: path.join(artifacts, "selection-output-language.png"),
      animations: "disabled",
    });
    const rejected = await page.evaluate(async () => {
      const snapshot = (await chrome.runtime.sendMessage({ type: "snapshot" }))
        .value;
      const action = snapshot.actions.find((a) => a.id === "summary");
      return chrome.runtime.sendMessage({
        type: "actions.save",
        changes: [{ ...action, outputLanguage: "auto" }],
      });
    });
    assert.equal(rejected.ok, false);
    assert.equal(
      (await snapshot()).actions.find((a) => a.id === "summary").outputLanguage,
      "ru",
    );
    console.log(
      "PASS: saved old prompt upgraded in storage/editor/request; default text remains linked after settings saves; output language UI/save/reload, live interface defaults, fixed-language cache reuse, daily preview invalidation, actual provider instructions and native selection settings.",
    );
  } finally {
    if (source) await source.close();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate((stored) => chrome.storage.local.set(stored), stored);
    await page.reload();
    await page.locator("h1").waitFor();
  }
};
