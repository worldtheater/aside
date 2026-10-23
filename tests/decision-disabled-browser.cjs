const assert = require("node:assert/strict");
const path = require("node:path");
module.exports = async ({
  page,
  context,
  origin,
  calls,
  modelRequests,
  artifacts,
  nav,
  op,
}) => {
  const original = await page.evaluate(() =>
    chrome.storage.local.get(["settings", "credentials"]),
  );
  const ext = page.url().split("/").slice(0, 3).join("/");
  const decision = {
    id: "paused-decision",
    name: "Paused decision",
    protocol: "typesafe",
    url: origin + "/v1",
    model: "jev-fixture",
    models: [{ id: "jev-fixture", name: "jev-fixture" }],
    connected: true,
    maxTokens: 8192,
  };
  const generation = {
    ...decision,
    id: "generation",
    name: "Generation",
    protocol: "chat",
    model: "fixture-model",
    models: [{ id: "fixture-model", name: "fixture-model" }],
  };
  const beforeCalls = calls.length,
    beforeModels = modelRequests.length;
  let source, popup;
  try {
    await page.evaluate(
      async ({ decision, generation }) => {
        const { settings, credentials } = await chrome.storage.local.get([
          "settings",
          "credentials",
        ]);
        settings.connections = [decision, generation];
        settings.defaultConnection = generation.id;
        settings.defaultDecisionConnection = decision.id;
        settings.website.sites["127.0.0.1"] = { lights: "on", enhance: true };
        credentials[decision.id] = "local-fixture";
        await chrome.storage.local.set({ settings, credentials });
      },
      { decision, generation },
    );
    await page.reload();
    await nav("connections");
    assert.equal(
      await page
        .locator(
          ".connection-item[data-id=paused-decision],[data-connection-purpose]",
        )
        .count(),
      0,
    );
    assert.equal(
      await page.locator(".connection-item[data-id=generation]").count(),
      1,
    );
    assert.equal(
      await page
        .locator("[data-connection=protocol] option[value=typesafe]")
        .count(),
      0,
    );
    await op("add-connection").click();
    assert.equal(
      await page
        .locator("[data-connection=protocol] option[value=typesafe]")
        .count(),
      0,
    );
    const send = (message) =>
      page.evaluate((message) => chrome.runtime.sendMessage(message), message);
    for (const type of ["connection.test", "connection.save"]) {
      const result = await send({
        type,
        connection: decision,
        key: "local-fixture",
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, "notAllowed");
    }
    await page.screenshot({
      path: path.join(artifacts, "decision-suspended-connections.png"),
    });
    await page.evaluate(
      (origin) => chrome.permissions.request({ origins: [origin + "/*"] }),
      origin,
    );
    source = await context.newPage();
    await source.goto(origin + "/paused-enhance");
    const tabId = await page.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      source.url(),
    );
    await page.waitForFunction(async (tabId) => {
      try {
        return (
          (
            await chrome.tabs.sendMessage(
              tabId,
              { type: "lights.status" },
              { frameId: 0 },
            )
          ).status === "active"
        );
      } catch {
        return false;
      }
    }, tabId);
    const status = await page.evaluate(
      (tabId) =>
        chrome.tabs.sendMessage(
          tabId,
          { type: "lights.status" },
          { frameId: 0 },
        ),
      tabId,
    );
    assert.equal(status.enhancement.status, "off");
    assert.equal(
      await page.evaluate(
        (tabId) =>
          chrome.tabs.sendMessage(
            tabId,
            { type: "lights.analyze" },
            { frameId: 0 },
          ),
        tabId,
      ),
      false,
    );
    const denied = await send({
      type: "website.update",
      tabId,
      patch: { enhance: true },
    });
    assert.equal(denied.error, "notAllowed");
    const candidate = {
      id: "logo",
      tag: "img",
      label: "Logo",
      context: "Heading",
      position: "static",
      visualKey: "fixture",
      width: 80,
      height: 40,
      behindText: false,
      brightness: 0.1,
      darkFraction: 0.9,
      lightFraction: 0.1,
      colorfulFraction: 0,
      transparentFraction: 0.5,
      backgroundBrightness: 0.1,
      image: "AA==",
    };
    for (const type of ["lights.cached", "lights.enhance"]) {
      const result = await page.evaluate(
        async ({ tabId, type, candidate }) =>
          (
            await chrome.scripting.executeScript({
              target: { tabId },
              func: (message) => chrome.runtime.sendMessage(message),
              args: [{ type, candidates: [candidate] }],
            })
          )[0].result,
        { tabId, type, candidate },
      );
      assert.equal(result.ok, false);
      assert.equal(result.error, "notAllowed");
    }
    popup = await context.newPage();
    await source.bringToFront();
    await popup.goto(ext + "/popup.html");
    await popup.locator("#feature-controls").waitFor();
    assert.equal(
      await popup
        .locator(
          ".popup-enhance,[data-feature=enhance],[data-enhance-retry],[data-decision-setup]",
        )
        .count(),
      0,
    );
    assert.equal(await popup.locator("[data-feature=lights]").count(), 0);
    await popup.screenshot({
      path: path.join(artifacts, "decision-suspended-popup.png"),
      fullPage: true,
    });
    assert(
      (
        await page.evaluate(
          ({ tabId }) =>
            chrome.runtime.sendMessage({
              type: "website.update",
              tabId,
              patch: { lights: "off" },
            }),
          { tabId },
        )
      ).ok,
    );
    await page.waitForFunction(
      async (tabId) =>
        (
          await chrome.tabs.sendMessage(
            tabId,
            { type: "lights.status" },
            { frameId: 0 },
          )
        ).status === "off",
      tabId,
    );
    const persisted = await page.evaluate(() =>
      chrome.storage.local.get(["settings", "credentials"]),
    );
    assert.deepEqual(
      persisted.settings.connections.find((c) => c.id === decision.id),
      decision,
    );
    assert.equal(persisted.settings.defaultDecisionConnection, decision.id);
    assert.equal(persisted.credentials[decision.id], "local-fixture");
    assert.equal(persisted.settings.website.sites["127.0.0.1"].enhance, true);
    assert.equal(calls.length, beforeCalls);
    assert.equal(modelRequests.length, beforeModels);
    console.log(
      "PASS: decision/Enhance UI suspended; saved configuration preserved; old enabled sites and direct requests cannot analyze; ordinary Lights toggles with zero model requests.",
    );
  } finally {
    await popup?.close();
    await source?.close();
    await page.evaluate((data) => chrome.storage.local.set(data), original);
  }
};
