const assert = require("node:assert/strict");

module.exports = async ({ page, context, origin, stalledSource }) => {
  const original = (
    await page.evaluate(() => chrome.runtime.sendMessage({ type: "snapshot" }))
  ).value;
  const source = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const versions = new Map();
  cdp.on("ServiceWorker.workerVersionUpdated", ({ versions: updated }) => {
    updated.forEach((version) => versions.set(version.versionId, version));
  });
  await cdp.send("ServiceWorker.enable");
  try {
    assert(
      await page.evaluate(
        (origin) => chrome.permissions.request({ origins: [origin + "/*"] }),
        origin,
      ),
    );
    await source.goto(origin + "/messaging-live");
    const host = source.locator("[data-pagework=ui]");
    await host.waitFor({ state: "attached" });
    assert.equal(await stalledSource.locator("[data-pagework=ui]").count(), 0);
    const tabId = await page.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // A slow page has accepted the notification but has not responded.
          globalThis.heldSettingsResponses = [];
          chrome.runtime.onMessage.addListener((message, sender, respond) => {
            if (message.type !== "settings.updated") return;
            globalThis.heldSettingsResponses.push(respond);
            return true;
          });
        },
      });
      return tab.id;
    }, stalledSource.url());
    const heldCount = () =>
      page.evaluate(async (tabId) => {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => globalThis.heldSettingsResponses.length,
        });
        return result.result;
      }, tabId);
    const preferences = {
      ...original.preferences,
      theme: "dark",
      palette: "forest",
    };
    const saved = await page.evaluate(async (preferences) => {
      const { request } = await import("./client.js");
      let timer;
      try {
        return await Promise.race([
          request("settings.save", { patch: { preferences } }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Save waited for an unrelated page")),
              1500,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }, preferences);
    assert.equal(saved, true);
    assert.equal(
      await heldCount(),
      1,
      "Every page still receives the notification",
    );
    await host.waitFor({ state: "attached" });
    await page.waitForFunction(async () => {
      const { settings } = await chrome.storage.local.get("settings");
      return (
        settings.preferences.theme === "dark" &&
        settings.preferences.palette === "forest"
      );
    });
    await source.waitForFunction(
      (node) =>
        node.dataset.theme === "dark" && node.dataset.palette === "forest",
      await host.elementHandle(),
    );
    const actions = original.actions.map((action) =>
      action.id === "summary" ? { ...action, quick: true } : action,
    );
    const config = await page.evaluate(async (actions) => {
      const { request } = await import("./client.js");
      await request("settings.save", { patch: { actions } });
      return request("actions.save", { changes: [] });
    }, actions);
    assert.equal(
      config.actions.find((action) => action.id === "summary").quick,
      true,
    );
    assert.equal(await heldCount(), 3);

    // A site control still acknowledges its own page. Stop the worker while
    // that page is unresponsive to reproduce the native channel-close error.
    await page.evaluate((tabId) => {
      globalThis.interruptedSave = null;
      import("./client.js").then(async ({ request }) => {
        try {
          await request("website.update", {
            tabId,
            patch: { floating: false },
          });
          globalThis.interruptedSave = { unexpectedSuccess: true };
        } catch (error) {
          const { modelError } = await import("./providers.js");
          const normalized = modelError(error);
          globalThis.interruptedSave = {
            code: normalized.code,
            detail: normalized.message,
          };
        }
      });
    }, tabId);
    await page.waitForFunction(async (tabId) => {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.heldSettingsResponses.length,
      });
      return result.result === 4;
    }, tabId);
    assert.equal(await page.evaluate(() => globalThis.interruptedSave), null);
    const worker = [...versions.values()].find(
      (version) =>
        version.scriptURL ===
          page.url().split("/").slice(0, 3).join("/") + "/background.js" &&
        version.runningStatus === "running",
    );
    assert(worker, "Find the active worker without attaching a debugger to it");
    await cdp.send("ServiceWorker.stopWorker", { versionId: worker.versionId });
    await page.waitForFunction(() => globalThis.interruptedSave !== null);
    const interrupted = await page.evaluate(() => globalThis.interruptedSave);
    assert.equal(
      interrupted.code,
      "extensionDisconnected",
      JSON.stringify(interrupted),
    );
    assert.match(interrupted.detail, /message channel closed/i);
    const snapshot = await page.evaluate(async () => {
      const { request } = await import("./client.js");
      return request("snapshot");
    });
    assert.deepEqual(
      snapshot.preferences,
      preferences,
      "Saved state survives worker shutdown",
    );
    assert(snapshot.actions.find((action) => action.id === "summary").quick);
    assert.equal(await page.locator("#toast:not([hidden])").count(), 0);
    console.log(
      "PASS: settings/action saves remain responsive with a retained page response; live pages receive updates; native channel closure is classified separately from model failure; cold worker restart preserves saved settings.",
    );
  } finally {
    await stalledSource.close();
    const tabId = await page.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
      source.url(),
    );
    if (tabId !== undefined)
      await page.evaluate(
        (tabId) =>
          chrome.runtime.sendMessage({
            type: "website.update",
            tabId,
            patch: null,
          }),
        tabId,
      );
    await page.evaluate(
      (original) =>
        chrome.runtime.sendMessage({
          type: "settings.save",
          patch: {
            preferences: original.preferences,
            actions: original.actions,
          },
        }),
      original,
    );
    await cdp.detach();
    await source.close();
  }
};
