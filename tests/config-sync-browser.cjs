const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const profiles = [],
  contexts = [],
  errors = [];
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), "aside-sync-ui-"));
const passphrase = "browser fixture passphrase";
async function eventually(predicate) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail("Asynchronous sync condition did not complete");
}
const op = (page, name) => page.locator(`[data-op="${name}"]`);
async function start(name) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aside-sync-profile-"));
  profiles.push(profile);
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" }),
    headless: true,
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  });
  contexts.push(context);
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: root });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/index.html#sync`);
  await op(page, "sync-first-setup").waitFor();
  await page.evaluate(async (name) => {
    const data = await (
      await import("./tests/local-store-fixture.mjs")
    ).localStore.get(["settings", "daily"]);
    data.settings.preferences = {
      ...data.settings.preferences,
      locale: "en",
      hideDaily: true,
      theme: name === "A" ? "light" : "dark",
    };
    data.settings.connections = [
      {
        id: name,
        name,
        url: "https://api.example.com/v1",
        model: "fixture",
        models: [{ id: "fixture", name: "fixture" }],
        protocol: "chat",
        maxTokens: 1024,
        connected: true,
      },
    ];
    data.settings.defaultConnection = name === "B" ? null : name;
    await (
      await import("./tests/local-store-fixture.mjs")
    ).localStore.set({
      ...data,
      credentials: { [name]: "browser-fixture-secret" },
      collection: [
        {
          id: name,
          title: name,
          text: "LOCAL COLLECTION " + name,
          sourceText: "",
          sourceTitle: "",
          url: "",
          actionName: "",
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }, name);
  await page.reload();
  await op(page, "sync-first-setup").waitFor();
  return page;
}
async function transfer(from, to) {
  const encrypted = await from.evaluate(() => chrome.storage.sync.get(null));
  assert(!JSON.stringify(encrypted).includes("browser-fixture-secret"));
  await to.evaluate(async (data) => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(data);
  }, encrypted);
}
async function status(page) {
  return page.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "sync.status" })).value,
  );
}
(async () => {
  try {
    const a = await start("A");
    assert.equal(await a.locator("h1").textContent(), "Sync");
    await a.evaluate(() => {
      window.nativeInvalidEvents = 0;
      document.addEventListener(
        "invalid",
        () => window.nativeInvalidEvents++,
        true,
      );
    });
    assert.equal(await a.locator('input[type="password"]').count(), 0);
    assert.equal(await op(a, "sync-reset-ask").count(), 0);
    await op(a, "sync-check").click();
    assert.deepEqual(await a.evaluate(() => chrome.storage.sync.get(null)), {});
    assert.equal((await status(a)).enabled, false);
    await a.screenshot({
      path: path.join(artifacts, "waiting.png"),
      fullPage: true,
    });
    await op(a, "sync-first-setup").click();
    await a.locator("#sync-confirm").waitFor();
    await op(a, "sync-join-existing").click();
    await op(a, "sync-first-setup").waitFor();
    assert.equal(await a.locator('input[type="password"]').count(), 0);
    assert.deepEqual(await a.evaluate(() => chrome.storage.sync.get(null)), {});
    await op(a, "sync-first-setup").click();
    await a.screenshot({
      path: path.join(artifacts, "setup.png"),
      fullPage: true,
    });
    await a.locator("#sync-passphrase").press("Enter");
    await a
      .locator('#toast[role="alert"]')
      .filter({ hasText: "Enter your sync passphrase." })
      .waitFor();
    await a.locator("#sync-passphrase").fill("   ");
    await op(a, "sync-connect").click();
    assert.equal((await status(a)).enabled, false);
    await a.locator("#sync-passphrase").fill("short");
    await a.locator("#sync-passphrase").press("Enter");
    await a
      .locator('#toast[role="alert"]')
      .filter({ hasText: "at least 12" })
      .waitFor();
    assert.equal(await a.evaluate(() => window.nativeInvalidEvents), 0);
    await a.locator("#sync-passphrase").fill(passphrase);
    await a.locator("#sync-confirm").fill("mismatched confirmation");
    await op(a, "sync-connect").click();
    await a.locator('#toast[role="alert"]').waitFor({ state: "visible" });
    assert.equal((await status(a)).enabled, false);
    await a.locator("#sync-confirm").fill(passphrase);
    await a.locator("#sync-confirm").press("Enter");
    await op(a, "sync-now").waitFor();
    assert.equal((await status(a)).mode, "ready");
    await a.screenshot({
      path: path.join(artifacts, "enabled.png"),
      fullPage: true,
    });
    const b = await start("B");
    await op(b, "sync-check").click();
    assert.equal(await b.locator('input[type="password"]').count(), 0);
    assert.deepEqual(await b.evaluate(() => chrome.storage.sync.get(null)), {});
    assert.equal((await status(b)).enabled, false);
    // One page waits; another has explicitly chosen first setup and is typing.
    // Delayed Chrome delivery must move both to joining without any cloud write.
    const waitingB = await b.context().newPage();
    await waitingB.goto(b.url());
    await op(waitingB, "sync-first-setup").waitFor();
    await op(b, "sync-first-setup").click();
    await b.locator("#sync-passphrase").fill("not the source passphrase");
    await b.locator("#sync-confirm").fill("not the source passphrase");
    const sourceCloud = await a.evaluate(() => chrome.storage.sync.get(null));
    await transfer(a, b);
    await b.locator('[data-op="sync-connect"][data-action="join"]').waitFor();
    await waitingB
      .locator('[data-op="sync-connect"][data-action="join"]')
      .waitFor();
    assert.equal(await b.locator("#sync-confirm").count(), 0);
    assert.equal(await b.locator("#sync-passphrase").inputValue(), "");
    assert.equal(await op(b, "sync-first-setup").count(), 0);
    assert.deepEqual(
      await b.evaluate(() => chrome.storage.sync.get(null)),
      sourceCloud,
    );
    assert.equal((await status(b)).enabled, false);
    await waitingB.close();
    await b.screenshot({
      path: path.join(artifacts, "join.png"),
      fullPage: true,
    });
    const beforeRecovery = await b.evaluate(() =>
      chrome.storage.sync.get(null),
    );
    await op(b, "sync-reset-ask").click();
    await b
      .locator("#dialog .dialog-actions")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await b.locator("#dialog").waitFor({ state: "hidden" });
    assert.deepEqual(
      await b.evaluate(() => chrome.storage.sync.get(null)),
      beforeRecovery,
      "Opening and cancelling recovery does not change synced settings",
    );
    assert.equal((await status(b)).enabled, false);
    await b.locator("#sync-passphrase").fill("wrong but long passphrase");
    await op(b, "sync-connect").first().click();
    await op(b, "sync-confirm-action").click();
    await b.locator('#toast[role="alert"]').waitFor({ state: "visible" });
    await b.locator("#dialog").waitFor({ state: "hidden" });
    assert.equal((await status(b)).enabled, false);
    assert.equal(
      await b.evaluate(
        async () =>
          (
            await (
              await import("./tests/local-store-fixture.mjs")
            ).localStore.get("settings")
          ).settings.connections[0].name,
      ),
      "B",
    );
    await b.locator("#sync-passphrase").fill(passphrase);
    await op(b, "sync-connect").first().click();
    await op(b, "sync-confirm-action").click();
    await op(b, "sync-now").waitFor();
    assert.equal(
      await b.evaluate(
        async () =>
          (
            await (
              await import("./tests/local-store-fixture.mjs")
            ).localStore.get("settings")
          ).settings.connections.find((c) => c.id === "A").name,
      ),
      "A",
    );
    assert.equal(
      await b.evaluate(
        async () =>
          (
            await (
              await import("./tests/local-store-fixture.mjs")
            ).localStore.get("collection")
          ).collection[0].id,
      ),
      "B",
    );
    assert.equal(
      await b.evaluate(
        async () =>
          (
            await (
              await import("./tests/local-store-fixture.mjs")
            ).localStore.get("credentials")
          ).credentials.A,
      ),
      "browser-fixture-secret",
    );
    assert.equal(
      await b.evaluate(
        async () =>
          (
            await (
              await import("./tests/local-store-fixture.mjs")
            ).localStore.get("settings")
          ).settings.defaultConnection,
      ),
      "A",
    );
    // Synced credentials do not grant local host permission. Shared providers appear once.
    await op(b, "sync-authorize").waitFor();
    assert.equal(await b.locator(".sync-service-list li").count(), 1);
    assert.equal(
      await b.locator(".sync-service-list strong").textContent(),
      "https://api.example.com",
    );
    const sharedNames = await b
      .locator(".sync-service-list span")
      .textContent();
    assert(sharedNames.includes("A") && sharedNames.includes("B"));
    const beforeAccess = await b.evaluate(async () => ({
      local: await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get(["settings", "credentials"]),
      cloud: await chrome.storage.sync.get(null),
    }));
    const serviceRequests = [];
    const observeRequest = (request) => {
      if (request.url().startsWith("https://api.example.com/"))
        serviceRequests.push(request.url());
    };
    b.context().on("request", observeRequest);
    await b.screenshot({
      path: path.join(artifacts, "authorization.png"),
      fullPage: true,
    });
    await b.evaluate(() => {
      globalThis.nativePermissionRequest = chrome.permissions.request.bind(
        chrome.permissions,
      );
      globalThis.requestedOrigins = [];
      chrome.permissions.request = async (permissions) => {
        requestedOrigins.push(permissions.origins);
        return false;
      };
    });
    await op(b, "sync-authorize").click();
    await b.locator('#toast[role="alert"]').waitFor({ state: "visible" });
    assert(await op(b, "sync-authorize").isVisible());
    assert.deepEqual(await b.evaluate(() => requestedOrigins), [
      ["https://api.example.com/*"],
    ]);
    // Simulate accepting Chrome's native permission prompt in the isolated test profile.
    // The grant, permission checks and onAdded/onRemoved events use Chrome's real APIs.
    await b.evaluate(() => {
      chrome.permissions.request = (permissions) => {
        requestedOrigins.push(permissions.origins);
        return new Promise((resolve, reject) => {
          globalThis.completePermissionPrompt = () =>
            nativePermissionRequest(permissions).then(resolve, reject);
        });
      };
    });
    await op(b, "sync-authorize").click();
    await b.waitForFunction(
      () => typeof completePermissionPrompt === "function",
    );
    const manager = await b.context().newPage();
    await manager.goto("chrome://extensions");
    await manager.evaluate(async (id) => {
      await chrome.developerPrivate.updateProfileConfiguration({
        inDeveloperMode: true,
      });
      await chrome.developerPrivate.addHostPermission(
        id,
        "https://api.example.com/*",
      );
    }, new URL(b.url()).hostname);
    await b.evaluate(() => completePermissionPrompt());
    await b.locator(".sync-access-ready").waitFor();
    assert.equal(await b.locator('#toast[role="alert"]').isVisible(), false);
    assert.equal(await op(b, "sync-authorize").count(), 0);
    assert(
      await b.evaluate(() =>
        chrome.permissions.contains({ origins: ["https://api.example.com/*"] }),
      ),
    );
    assert.deepEqual(await b.evaluate(() => requestedOrigins), [
      ["https://api.example.com/*"],
      ["https://api.example.com/*"],
    ]);
    assert.deepEqual(
      await b.evaluate(async () => ({
        local: await (
          await import("./tests/local-store-fixture.mjs")
        ).localStore.get(["settings", "credentials"]),
        cloud: await chrome.storage.sync.get(null),
      })),
      beforeAccess,
      "Authorization does not modify local settings or synced data",
    );
    assert.deepEqual(
      serviceRequests,
      [],
      "Authorizing does not call the model service",
    );
    b.context().off("request", observeRequest);
    await b.screenshot({
      path: path.join(artifacts, "authorized.png"),
      fullPage: true,
    });
    await b.evaluate(() => {
      chrome.permissions.request = nativePermissionRequest;
    });
    await manager.evaluate(
      (id) =>
        chrome.developerPrivate.removeHostPermission(
          id,
          "https://api.example.com/*",
        ),
      new URL(b.url()).hostname,
    );
    await op(b, "sync-authorize").waitFor();
    assert.equal(await b.locator(".sync-service-list li").count(), 1);
    await manager.close();

    // A subsequent local choice must survive further incoming updates.
    await b.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({
        type: "settings.save",
        patch: { defaultConnection: "B" },
      });
      if (!response.ok) throw new Error(response.error);
    });
    // Exercise the session lock without signing test profiles into any account.
    await b.evaluate(() =>
      chrome.storage.session.remove("configurationSyncKey"),
    );
    await b.reload();
    await b.locator("#sync-passphrase").waitFor();
    assert.equal((await status(b)).mode, "locked");
    assert(
      await op(b, "sync-reset-ask").isVisible(),
      "Recovery is visible while locked too",
    );
    await b.screenshot({
      path: path.join(artifacts, "locked.png"),
      fullPage: true,
    });
    await b.evaluate(() => {
      window.nativeInvalidEvents = 0;
      document.addEventListener(
        "invalid",
        () => window.nativeInvalidEvents++,
        true,
      );
    });
    await b.locator("#sync-passphrase").press("Enter");
    await b
      .locator('#toast[role="alert"]')
      .filter({ hasText: "Enter your sync passphrase." })
      .waitFor();
    assert.equal(await b.evaluate(() => window.nativeInvalidEvents), 0);
    assert.equal((await status(b)).mode, "locked");
    await b.locator("#sync-passphrase").fill(passphrase);
    await b.locator("#sync-passphrase").press("Enter");
    await op(b, "sync-now").waitFor();
    // Save through the real background transaction, then propagate via onChanged.
    const beforeAutoSync = (await status(a)).revision;
    await a.evaluate(async () => {
      const { settings } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("settings");
      const response = await chrome.runtime.sendMessage({
        type: "connection.save",
        connection: {
          ...settings.connections.find((c) => c.id === "A"),
          name: "A updated",
        },
      });
      if (!response.ok) throw new Error(response.error);
    });
    await eventually(() =>
      a.evaluate(async (previous) => {
        const local = await (
          await import("./tests/local-store-fixture.mjs")
        ).localStore.get("configurationSync");
        const cloud = await chrome.storage.sync.get("aside-config:head");
        return (
          cloud["aside-config:head"].revision !== previous &&
          local.configurationSync.revision ===
            cloud["aside-config:head"].revision
        );
      }, beforeAutoSync),
    );
    await transfer(a, b);
    await eventually(() =>
      b.evaluate(async () =>
        (
          await (
            await import("./tests/local-store-fixture.mjs")
          ).localStore.get("settings")
        ).settings.connections.some(
          (c) => c.id === "A" && c.name === "A updated",
        ),
      ),
    );
    const merged = await b.evaluate(
      async () =>
        (
          await (
            await import("./tests/local-store-fixture.mjs")
          ).localStore.get("settings")
        ).settings,
    );
    assert.equal(merged.connections.length, 2);
    assert.equal(merged.defaultConnection, "B");
    assert.equal(merged.preferences.theme, "dark");
    await b.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    const staleConnection = await b.evaluate(async () =>
      (
        await (
          await import("./tests/local-store-fixture.mjs")
        ).localStore.get("settings")
      ).settings.connections.find((c) => c.id === "A"),
    );
    // A tested editor has a local model catalog, which is intentionally not synced.
    staleConnection.models = [
      { id: staleConnection.model, name: staleConnection.model },
    ];
    // A real deletion reaches the same ID on B without deleting B's independent record.
    await a.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({
        type: "connection.remove",
        id: "A",
      });
      if (!response.ok) throw new Error(response.error);
      await chrome.runtime.sendMessage({ type: "sync.run" });
    });
    await transfer(a, b);
    await eventually(() =>
      b.evaluate(
        async () =>
          !(
            await (
              await import("./tests/local-store-fixture.mjs")
            ).localStore.get("settings")
          ).settings.connections.some((c) => c.id === "A"),
      ),
    );
    assert.equal(
      await b.evaluate(
        async () =>
          (
            await (
              await import("./tests/local-store-fixture.mjs")
            ).localStore.get("settings")
          ).settings.connections[0].id,
      ),
      "B",
    );
    const beforeStaleSave = await b.evaluate(async () =>
      (await import("./tests/local-store-fixture.mjs")).localStore.get([
        "settings",
        "credentials",
        "configurationRecords",
      ]),
    );
    const staleSave = await b.evaluate(
      (connection) =>
        chrome.runtime.sendMessage({
          type: "connection.save",
          connection,
          key: "stale-key",
        }),
      staleConnection,
    );
    assert.equal(staleSave.ok, false);
    assert.equal(staleSave.error, "recordDeleted");
    assert.deepEqual(
      await b.evaluate(async () =>
        (await import("./tests/local-store-fixture.mjs")).localStore.get([
          "settings",
          "credentials",
          "configurationRecords",
        ]),
      ),
      beforeStaleSave,
    );
    await b.screenshot({
      path: path.join(artifacts, "dark.png"),
      fullPage: true,
    });
    await b.setViewportSize({ width: 520, height: 900 });
    await b.screenshot({
      path: path.join(artifacts, "narrow.png"),
      fullPage: true,
    });
    assert(
      await b.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await b.locator(".sync-details > summary").click();
    await op(b, "sync-stop-ask").click();
    await op(b, "sync-confirm-action").click();
    await b.locator("#sync-passphrase").waitFor();
    assert.equal((await status(b)).enabled, false);
    const beforeReset = await b.evaluate(async () =>
      (await import("./tests/local-store-fixture.mjs")).localStore.get([
        "settings",
        "credentials",
        "collection",
      ]),
    );
    await op(b, "sync-reset-ask").click();
    await b.screenshot({
      path: path.join(artifacts, "reset.png"),
      fullPage: true,
    });
    assert.equal(
      (await status(b)).remote,
      true,
      "Reset requires explicit confirmation",
    );
    await op(b, "sync-confirm-action").click();
    await op(b, "sync-first-setup").waitFor();
    assert.equal(await b.locator('input[type="password"]').count(), 0);
    assert.deepEqual(await b.evaluate(() => chrome.storage.sync.get(null)), {});
    assert.equal(
      await b.evaluate(
        async () =>
          (
            await (
              await import("./tests/local-store-fixture.mjs")
            ).localStore.get("collection")
          ).collection[0].id,
      ),
      "B",
    );
    assert.deepEqual(
      await b.evaluate(async () =>
        (await import("./tests/local-store-fixture.mjs")).localStore.get([
          "settings",
          "credentials",
          "collection",
        ]),
      ),
      beforeReset,
      "Recovery preserves local settings, API keys and collection",
    );
    assert.equal(await op(b, "sync-reset-ask").count(), 0);
    const newPassphrase = "replacement browser passphrase";
    await op(b, "sync-first-setup").click();
    await b.locator("#sync-passphrase").fill(newPassphrase);
    await b.locator("#sync-confirm").fill(newPassphrase);
    await op(b, "sync-connect").click();
    await op(b, "sync-now").waitFor();
    assert.equal((await status(b)).mode, "ready");
    assert.equal(await op(b, "sync-reset-ask").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: isolated Chrome profiles, read-only waiting, explicit first setup/back, delayed delivery during passphrase entry, automatic join transition, setup/confirmation, grouped service authorization, denial/retry, native permission events, no model calls, wrong passphrase, record merge, default adoption/preservation, local preferences and collection retention, session unlock, automatic updates and deletions, dark/narrow layout, recovery cancellation, confirmed reset without the old passphrase, local data retention and setup with a new passphrase.",
    );
    console.log("Screenshots: " + artifacts);
  } finally {
    for (const context of contexts) await context.close();
    for (const profile of profiles)
      fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
