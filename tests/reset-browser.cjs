const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({ page, context, origin, streams, artifacts }) => {
  const send = async (type, payload = {}) => {
    const response = await page.evaluate(
      (message) => chrome.runtime.sendMessage(message),
      { type, ...payload },
    );
    assert(response.ok, JSON.stringify(response));
    return response.value;
  };
  const original = await send("snapshot");
  await send("settings.save", {
    patch: {
      preferences: { ...original.preferences, locale: "zh-CN", theme: "dark" },
    },
  });
  await send("collection.add", {
    item: {
      title: "Reset fixture",
      text: "Saved reset fixture",
      sourceText: "Original",
      sourceTitle: "Fixture",
      url: origin,
      actionName: "Translate",
    },
  });
  await page.evaluate(async () => {
    const { localStore } = await import("./extension-storage.js");
    await localStore.set({
      "native-language-packs": [
        {
          pack: {
            kind: "translator",
            sourceLanguage: "en",
            targetLanguage: "ja",
          },
          readyAt: 1,
        },
      ],
    });
    const { IndexedResultCache } = await import("./cache.js");
    const cache = new IndexedResultCache();
    await cache.putMany(
      [{ key: "reset-fixture", text: "Cached output" }],
      cache.generation,
    );
    const { addUsage } = await import("./usage-store.js");
    await addUsage(
      {
        id: "reset-fixture",
        startedAt: Date.now(),
        durationMs: 1,
        connectionId: "fixture",
        connectionName: "Fixture",
        model: "fixture",
        protocol: "chat",
        source: "trial",
        actionName: "Translate",
        status: "success",
        errorCode: null,
        tokens: null,
        usageFinal: false,
      },
      {
        input: "reset input",
        output: "reset output",
        instructions: "reset instructions",
      },
    );
  });
  await send("sync.connect", {
    passphrase: "reset-fixture-passphrase",
    action: "create",
    revision: null,
  });
  const cloud = await page.evaluate(() => chrome.storage.sync.get(null));
  assert(Object.keys(cloud).length > 0);
  const permissions = await page.evaluate(() => chrome.permissions.getAll());
  await page.reload();
  await page.locator('.sidebar [data-route="help"]').click();
  await page.locator('.help-footer [data-op="reset-ask"]').waitFor();
  await page.screenshot({
    path: path.join(artifacts, "about-reset-entry.png"),
    animations: "disabled",
  });
  await page.locator('[data-op="reset-ask"]').click();
  const dialog = page.locator("dialog");
  await dialog.locator(".reset-details").waitFor();
  assert((await dialog.textContent()).includes("API Key"));
  assert((await dialog.textContent()).includes("云端"));
  assert((await dialog.textContent()).includes("无法撤销"));
  await dialog.screenshot({
    path: path.join(artifacts, "reset-confirmation.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 620 });
  const bounds = await dialog.boundingBox();
  assert(
    bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= 391 &&
      bounds.y + bounds.height <= 621,
  );
  await dialog.locator('[data-op="dialog-close"]').click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    (await send("snapshot")).collection.length,
    1,
    "Cancel preserves saved data",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const source = await context.newPage();
  const other = await context.newPage();
  try {
    await source.goto(origin + "/reset");
    const tabId = await page.evaluate(async (origin) => {
      await chrome.permissions.request({ origins: [origin + "/*"] });
      return (await chrome.tabs.query({})).find(
        (tab) => tab.url === origin + "/reset",
      ).id;
    }, origin);
    const denied = await page.evaluate(
      async (tabId) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => chrome.runtime.sendMessage({ type: "settings.reset" }),
          })
        )[0].result,
      tabId,
    );
    assert.equal(denied.error, "notAllowed");
    await other.goto(new URL("index.html#connections", page.url()).href);
    await other.locator("h1").waitFor();
    await page.evaluate(async () => {
      const { processRequest } = await import("./client.js");
      globalThis.resetBeforeReload = true;
      globalThis.resetTestJob = processRequest({
        actionId: "translate",
        source: "selection",
        stream: true,
        blocks: [{ id: "reset", text: "STREAM_FIXTURE_WAIT_RESET" }],
      });
      resetTestJob.promise.catch(() => {});
    });
    const deadline = Date.now() + 15000;
    while (
      Date.now() < deadline &&
      !streams.some((stream) => stream.input === "STREAM_FIXTURE_WAIT_RESET")
    )
      await page.waitForTimeout(25);
    assert(
      streams.some((stream) => stream.input === "STREAM_FIXTURE_WAIT_RESET"),
      "The provider stream starts before reset",
    );
    await page.locator('[data-op="reset-ask"]').click();
    await dialog.locator('[data-op="reset-confirm"]').click();
    await page.waitForFunction(() => !globalThis.resetBeforeReload);
    await page.locator("h1").waitFor();
    await other.waitForURL((url) => url.hash === "#home");
    await other.locator("h1").waitFor();
    const fresh = await send("snapshot");
    assert.deepEqual(fresh.connections, []);
    assert.deepEqual(fresh.collection, []);
    assert.equal(fresh.daily.result, null);
    assert.equal(fresh.preferences.locale, "system");
    assert.equal(
      fresh.actions.find((action) => action.id === "translate")
        .translationEngine,
      "microsoft",
    );
    assert.equal((await send("cache.stats")).entries, 0);
    assert.equal(
      (await send("usage.list", { filter: { period: "all", model: "all" } }))
        .length,
      0,
    );
    assert.deepEqual(
      await page.evaluate(() => chrome.storage.sync.get(null)),
      cloud,
      "Remote sync data is preserved",
    );
    assert.equal((await send("sync.status")).enabled, false);
    const raw = await page.evaluate(() => chrome.storage.local.get(null));
    assert.equal(raw.protectedConfiguration, undefined);
    assert.equal(raw["native-language-packs"], undefined);
    assert.equal(
      await page
        .evaluate(() => chrome.storage.session.get("configurationSyncKey"))
        .then((value) => value.configurationSyncKey),
      undefined,
    );
    for (const granted of permissions.origins || [])
      assert(
        (
          await page.evaluate(() => chrome.permissions.getAll())
        ).origins.includes(granted),
      );
    assert(
      streams.find((stream) => stream.input === "STREAM_FIXTURE_WAIT_RESET")
        .closed,
      "Reset cancels the active provider stream",
    );
    await source.locator('[data-pagework="ui"] #dock').waitFor();
    await source.locator("#first").dblclick({ position: { x: 14, y: 10 } });
    await source.locator('[data-pagework="ui"] #selection').waitFor();
    assert(
      await source
        .locator('[data-pagework="ui"] [data-selection-action="translate"]')
        .isEnabled(),
    );
    await page.reload();
    await page.locator("h1").waitFor();
    assert.deepEqual((await send("snapshot")).connections, []);
    console.log(
      "PASS: reset confirmation/cancel, protected sender, task cancellation, local data erasure, cloud and permissions preserved, open pages refreshed, and defaults survive reload.",
    );
  } finally {
    await source.close();
    await other.close();
  }
};
