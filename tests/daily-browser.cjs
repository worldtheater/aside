const assert = require("node:assert/strict");
const path = require("node:path");
module.exports = async ({
  page,
  origin,
  calls,
  artifacts,
  nav,
  op,
  choose,
}) => {
  const stored = await page.evaluate(async () =>
    (await import("./tests/local-store-fixture.mjs")).localStore.get([
      "settings",
      "daily",
      "credentials",
      "collection",
    ]),
  );
  const snapshot = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value,
    );
  const openSettings = async () => {
    await page.locator(".daily-card").hover();
    await op("daily-settings").click();
  };
  const close = async () => {
    await page.locator("dialog .dialog-actions [data-op=dialog-close]").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
  };
  const save = async () => {
    await op("daily-save").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
  };
  const preview = async () => {
    await op("daily-preview").click();
    await page
      .locator(".daily-preview-text")
      .filter({ hasText: "A thought generated" })
      .waitFor();
  };
  try {
    const models = await page.evaluate(async (origin) => {
      const { settings, credentials } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get(["settings", "credentials"]);
      const fixture = settings.connections.find((c) =>
        c.url.startsWith(origin),
      );
      if (!fixture) throw Error("Fixture connection missing");
      const base = { ...fixture, protocol: "chat", reasoningEffort: undefined };
      const alternate = {
        ...base,
        id: "daily-alternate",
        name: "Reflection model",
        model: "reflection-model",
      };
      const { DAILY_PROMPT } = await import("./prompts.js");
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        settings: {
          ...settings,
          connections: [base, alternate],
          defaultConnection: base.id,
          preferences: {
            ...settings.preferences,
            locale: "zh-CN",
            theme: "light",
            palette: "graphite",
          },
        },
        credentials: { ...credentials, [alternate.id]: credentials[base.id] },
        collection: Array.from({ length: 6 }, (_, i) => ({
          id: `daily-${i}`,
          title: `Passage ${i}`,
          text: `Saved thought ${i}`,
          sourceText: `Original thought ${i}`,
          sourceTitle: "Reading notes",
          url: "",
          actionName: "Translate",
          createdAt: `2026-10-${20 - i}T10:00:00Z`,
        })),
        daily: {
          model: "default",
          prompt: DAILY_PROMPT["zh-CN"],
          outputLanguage: "interface",
          useCollection: false,
          result: "An existing reflection.",
          date: new Date().toLocaleDateString("en-CA"),
        },
      });
      return {
        base: base.id,
        alternate: alternate.id,
        defaultModel: base.model,
      };
    }, origin);
    await page.reload();
    await page.locator("h1").waitFor();
    await nav("home");
    const emptyText = await page
      .locator(".workspace .daily-thought")
      .textContent();
    assert.equal(await page.locator(".daily-caption").count(), 0);
    await openSettings();
    assert.equal(
      await page.locator("[data-op=daily-preset],#daily-template-name").count(),
      0,
    );
    assert(
      /[\u3400-\u9fff]/.test(await page.locator("#daily-prompt").inputValue()),
    );
    assert.equal(await page.locator("#daily-model").inputValue(), "default");
    assert((await op("daily-save").textContent()).includes("保存设置"));
    await page.screenshot({
      path: path.join(artifacts, "daily-reflection-light.png"),
      animations: "disabled",
    });
    const beforeInvalid = calls.length;
    await page.locator("#daily-prompt").fill("");
    await op("daily-preview").click();
    assert(await page.locator("#daily-error").isVisible());
    assert.equal(calls.length, beforeInvalid);
    await close();

    const prompt = "从平常的阅读中写一句具体、平实的随想。";
    await openSettings();
    await page.locator("#daily-prompt").fill(prompt);
    await choose("#daily-model", models.alternate);
    await choose("#daily-output-language", "en");
    await page.locator("#daily-use-collection").check();
    const beforeConfigSave = calls.length;
    await save();
    assert.equal(
      calls.length,
      beforeConfigSave,
      "Saving settings never generates content",
    );
    let config = (await snapshot()).daily;
    assert.equal(config.model, models.alternate);
    assert.equal(config.prompt, prompt);
    assert.equal(config.result, emptyText);
    await page.reload();
    await openSettings();
    assert.equal(
      await page.locator("#daily-model").inputValue(),
      models.alternate,
    );
    assert.equal(await page.locator("#daily-prompt").inputValue(), prompt);
    assert(await page.locator("#daily-use-collection").isChecked());
    await page.locator("#daily-prompt").fill("Discarded instructions");
    await choose("#daily-model", "default");
    await close();
    await openSettings();
    assert.equal(await page.locator("#daily-prompt").inputValue(), prompt);
    assert.equal(
      await page.locator("#daily-model").inputValue(),
      models.alternate,
    );

    const beforePreview = calls.length;
    await preview();
    assert.equal(calls.length, beforePreview + 1);
    const call = calls.at(-1);
    assert.equal(
      call.body.model,
      "reflection-model",
      "Preview uses the selected model",
    );
    const instructions = call.body.messages[0].content;
    assert(instructions.includes(prompt));
    assert(instructions.includes("compact daily card on a reading homepage"));
    assert(instructions.includes("Do not use Markdown formatting"));
    assert(instructions.includes("Output language: English (en)."));
    assert.equal(
      JSON.parse(call.body.messages.at(-1).content).collection.length,
      5,
    );
    assert((await op("daily-save").textContent()).includes("保存并采用"));
    assert.equal(
      (await snapshot()).daily.result,
      emptyText,
      "Preview does not publish before saving",
    );
    const beforeUse = calls.length;
    await save();
    assert.equal(
      calls.length,
      beforeUse,
      "Using a preview does not make another model call",
    );
    config = (await snapshot()).daily;
    assert(config.result);
    const published = { result: config.result, date: config.date };
    assert.equal(
      await page.locator(".workspace .daily-thought").textContent(),
      published.result,
    );

    await openSettings();
    await page.locator("#daily-prompt").fill(prompt + " 再简短一些。");
    await choose("#daily-model", "default");
    await choose("#daily-output-language", "fr");
    const beforeSettingsOnly = calls.length;
    await save();
    assert.equal(calls.length, beforeSettingsOnly);
    config = (await snapshot()).daily;
    assert.equal(
      config.result,
      published.result,
      "Saving revised settings preserves today's thought",
    );
    assert.equal(config.date, published.date);
    await openSettings();
    await preview();
    assert.equal(calls.at(-1).body.model, models.defaultModel);
    await choose("#daily-model", models.alternate);
    assert.equal(await page.locator(".daily-preview-text").count(), 0);
    assert((await op("daily-save").textContent()).includes("保存设置"));
    await save();
    assert.equal((await snapshot()).daily.result, published.result);

    // A saved specific model works even when no global default is selected.
    await page.evaluate(async () => {
      const { settings } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("settings");
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        settings: { ...settings, defaultConnection: null },
      });
    });
    await page.reload();
    await page.locator(".daily-card").hover();
    await op("daily-refresh").click();
    await page
      .locator(".workspace .daily-thought")
      .filter({ hasText: "A thought generated" })
      .waitFor();
    assert.equal(
      calls.at(-1).body.model,
      "reflection-model",
      "Homepage generation reuses the saved model",
    );
    assert(
      calls
        .at(-1)
        .body.messages[0].content.includes("Output language: French (fr)."),
    );
    await openSettings();
    await choose("#daily-model", "default");
    assert(await op("daily-preview").isDisabled());
    assert(
      (await page.locator("#daily-model-hint").textContent()).includes(
        "模型连接",
      ),
    );
    await close();

    // Editing during a pending generation cancels it and cannot apply the stale result.
    await page.evaluate(async () => {
      const { collection } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("collection");
      collection[0].text = "DELAY_FIXTURE saved thought";
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({ collection });
    });
    await openSettings();
    const beforeSlow = calls.length;
    await op("daily-preview").click();
    await page.waitForFunction(
      () => document.querySelector("[data-op=daily-preview]").disabled,
    );
    for (let wait = 0; calls.length === beforeSlow && wait < 150; wait++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert(calls.length > beforeSlow, "Pending request reached the fixture");
    await choose("#daily-output-language", "de");
    await page.waitForTimeout(1400);
    assert.equal(await page.locator(".daily-preview-text").count(), 0);
    assert(await op("daily-preview").isEnabled());
    await close();

    // A provider failure stays an error and cannot replace the saved thought.
    await page.evaluate(async (id) => {
      const { credentials } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("credentials");
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        credentials: { ...credentials, [id]: "invalid-fixture" },
      });
    }, models.alternate);
    await openSettings();
    await op("daily-preview").click();
    await page.locator("#daily-preview-error").waitFor();
    assert.equal(await page.locator(".daily-preview-text").count(), 0);
    await save();
    assert.equal((await snapshot()).daily.result, published.result);

    const beforeReject = (await snapshot()).daily;
    const rejected = await page.evaluate(
      async (daily) =>
        chrome.runtime.sendMessage({
          type: "daily.save",
          daily: { ...daily, model: "missing-model" },
        }),
      beforeReject,
    );
    assert.equal(rejected.error, "noConnection");
    assert.deepEqual((await snapshot()).daily, beforeReject);

    await choose("#ui-locale", "en");
    await openSettings();
    assert(
      (await page.locator("#daily-prompt").inputValue()).startsWith(prompt),
    );
    await close();
    await choose("#ui-locale", "zh-CN");
    await page.evaluate(
      async ({ base, stored }) => {
        const { settings } = await (
          await import("./tests/local-store-fixture.mjs")
        ).localStore.get("settings");
        await (
          await import("./tests/local-store-fixture.mjs")
        ).localStore.set({
          credentials: stored.credentials,
          collection: stored.collection,
          settings: {
            ...settings,
            defaultConnection: base,
            preferences: { ...settings.preferences, theme: "dark" },
          },
        });
      },
      { base: models.base, stored },
    );
    await page.reload();
    await openSettings();
    await choose("#daily-model", "default");
    await preview();
    await page.screenshot({
      path: path.join(artifacts, "daily-reflection-dark.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 700 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const footer = await page.locator(".daily-settings-footer").boundingBox();
    assert(
      footer.y + footer.height <= 700,
      "Save controls remain within the viewport",
    );
    await page.locator(".daily-preview").scrollIntoViewIfNeeded();
    assert(await op("daily-preview").isVisible());
    await page.screenshot({
      path: path.join(artifacts, "daily-reflection-mobile.png"),
      animations: "disabled",
    });
    await close();
    assert(emptyText);
    console.log(
      "PASS: one reflection, localized defaults, model selection/reload/home generation, collection limits, preview reuse, settings-only retention, cancel/stale/error isolation and responsive dialog.",
    );
  } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(
      async (stored) =>
        (await import("./tests/local-store-fixture.mjs")).localStore.set(
          stored,
        ),
      stored,
    );
    await page.reload();
    await page.locator("h1").waitFor();
  }
};
