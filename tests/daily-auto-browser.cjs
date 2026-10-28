const assert = require("node:assert/strict");

module.exports = async ({ page, context, origin, calls, nav, op }) => {
  const stored = await page.evaluate(async () =>
    (await import("./tests/local-store-fixture.mjs")).localStore.get([
      "settings",
      "daily",
      "credentials",
      "collection",
    ]),
  );
  const homeUrl = new URL("index.html#home", page.url()).href;
  const openRoute = async (route) => {
    await page.goto("about:blank");
    await page.goto(homeUrl.replace("#home", "#" + route));
    await page.locator("h1").waitFor();
  };
  const snapshot = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value,
    );
  const settle = () => page.waitForTimeout(200);
  const generated = async (target = page) => {
    await target.waitForFunction(async () => {
      const { daily } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("daily");
      return (
        daily.result && daily.date === new Date().toLocaleDateString("en-CA")
      );
    });
    await target.waitForFunction(
      () =>
        document.querySelector(".daily-thought")?.textContent ===
        "A thought generated from your saved passages.",
    );
    assert.equal(
      (await snapshot()).daily.date,
      await page.evaluate(() => new Date().toLocaleDateString("en-CA")),
    );
  };
  const expire = () =>
    page.evaluate(async () => {
      const { daily } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("daily");
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        daily: { ...daily, result: "Yesterday's thought.", date: "2000-01-01" },
      });
    });
  let other;
  try {
    const modelId = await page.evaluate(async (origin) => {
      const { settings, daily } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get(["settings", "daily"]);
      const model = settings.connections.find((model) =>
        model.url.startsWith(origin),
      );
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        settings: {
          ...settings,
          defaultConnection: model.id,
          preferences: { ...settings.preferences, hideDaily: false },
        },
        daily: {
          ...daily,
          model: "default",
          useCollection: false,
          result: null,
          date: null,
        },
      });
      return model.id;
    }, origin);
    let before = calls.length;
    await openRoute("actions");
    await page.locator("h1").waitFor();
    await settle();
    assert.equal(
      calls.length,
      before,
      "Other settings pages do not generate a reflection",
    );
    await nav("home");
    await generated();
    assert.equal(
      calls.length,
      before + 1,
      "First Collection visit generates today's thought",
    );

    before = calls.length;
    await nav("actions");
    await nav("home");
    await page.reload();
    await generated();
    await settle();
    assert.equal(
      calls.length,
      before,
      "Revisiting and reloading reuse today's stored result",
    );

    await nav("actions");
    await expire();
    await page.goBack();
    await generated();
    assert.equal(
      calls.length,
      before + 1,
      "Returning with browser history refreshes an expired day",
    );

    before = calls.length;
    await page.locator(".daily-card").hover();
    await op("daily-refresh").click();
    await generated();
    assert.equal(
      calls.length,
      before + 1,
      "Manual refresh can generate again on the same day",
    );

    await nav("actions");
    await expire();
    await page.evaluate(async () => {
      const { settings } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("settings");
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        settings: {
          ...settings,
          preferences: { ...settings.preferences, hideDaily: true },
        },
      });
    });
    before = calls.length;
    await openRoute("home");
    await op("daily-restore").waitFor();
    await settle();
    assert.equal(
      calls.length,
      before,
      "Hidden thoughts do not generate automatically",
    );

    await page.evaluate(async () => {
      const { settings } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("settings");
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        settings: {
          ...settings,
          defaultConnection: null,
          preferences: { ...settings.preferences, hideDaily: false },
        },
      });
    });
    await page.reload();
    await page.locator(".daily-card").waitFor();
    await settle();
    assert.equal(
      calls.length,
      before,
      "An unavailable model does not trigger generation",
    );
    await nav("actions");
    await page.evaluate(async (id) => {
      const { daily } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("daily");
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({ daily: { ...daily, model: id } });
    }, modelId);
    await nav("home");
    await generated();
    assert.equal(
      calls.length,
      before + 1,
      "A specific reflection model works without a default model",
    );

    await nav("actions");
    await expire();
    await page.evaluate(async () => {
      const { daily } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("daily");
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        daily: { ...daily, useCollection: true },
        collection: [
          {
            id: "daily-delay",
            title: "Reading",
            text: "DELAY_FIXTURE",
            sourceText: "",
            sourceTitle: "",
            url: "",
            actionName: "",
            createdAt: new Date().toISOString(),
          },
        ],
      });
    });
    before = calls.length;
    other = await context.newPage();
    await page.goto("about:blank");
    await Promise.all([page.goto(homeUrl), other.goto(homeUrl)]);
    await Promise.all([generated(page), generated(other)]);
    await settle();
    assert.equal(
      calls.length,
      before + 1,
      "Concurrent Collection pages share one daily generation",
    );
    await other.close();
    other = null;

    await nav("actions");
    await expire();
    await page.evaluate(async (id) => {
      const { credentials } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("credentials");
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        credentials: { ...credentials, [id]: "invalid-fixture" },
      });
    }, modelId);
    await nav("home");
    await page.locator('#toast[data-kind="error"]').waitFor();
    assert.equal((await snapshot()).daily.result, "Yesterday's thought.");
    assert.equal(
      (await snapshot()).daily.date,
      "2000-01-01",
      "Failures do not mark today as generated",
    );
    await page.evaluate(
      async (credentials) =>
        (await import("./tests/local-store-fixture.mjs")).localStore.set({
          credentials,
        }),
      stored.credentials,
    );
    await page.locator(".daily-card").hover();
    await op("daily-refresh").click();
    await generated();
    console.log(
      "PASS: daily first visit, reuse, date rollover, manual refresh, hidden/unconfigured models, cross-tab generation and failure recovery.",
    );
  } finally {
    if (other) await other.close();
    await openRoute("connections");
    await page.evaluate(
      async (stored) =>
        (await import("./tests/local-store-fixture.mjs")).localStore.set(
          stored,
        ),
      stored,
    );
  }
};
