const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http");
const { chromium } = require("playwright");
const { inspectUI } = require("./inspect-ui.cjs");
const root = path.resolve(__dirname, "..");
(async () => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
      let raw = "";
      for await (const part of req) raw += part;
      const input = JSON.parse(raw).messages.at(-1).content;
      calls.push(input);
      let output = "Recovered: " + input;
      try {
        const data = JSON.parse(input);
        if (data.items)
          output = JSON.stringify({
            items: data.items.map((item) => ({
              id: item.id,
              text: "Recovered: " + item.text,
            })),
          });
        else if (typeof data.text === "string")
          output = "Recovered: " + data.text;
      } catch {}
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        "data: " +
          JSON.stringify({ choices: [{ delta: { content: output } }] }) +
          "\n\ndata: [DONE]\n\n",
      );
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><title>Entry recovery fixture</title><style>body{font:18px/1.6 sans-serif;margin:32px}main{min-height:2000px}input{display:block;margin-bottom:24px}button{margin:16px}</style><input id="draft" value="draft"><button id="fullscreen">Fullscreen</button><main><h1>Reading without a reload</h1><p id="first">A useful note connects a familiar idea with a new question.</p></main><script>window.documentToken='same-document';document.querySelector('#fullscreen').onclick=()=>document.querySelector('main').requestFullscreen();</script>`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiOrigin = "http://127.0.0.1:" + server.address().port;
  // Loopback is a secure context in Chrome; use an ordinary HTTP origin to
  // cover the same Web API availability as LAN and non-HTTPS websites.
  const origin = "http://aside-http.test:" + server.address().port;
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), "pagework-content-recovery-"),
  );
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" }),
    headless: true,
    viewport: { width: 1200, height: 850 },
    locale: "zh-CN",
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--enable-unsafe-extension-debugging",
      "--host-resolver-rules=MAP aside-http.test 127.0.0.1",
      "--no-proxy-server",
    ],
  });
  context.setDefaultTimeout(12000);
  try {
    const browserCDP = await context.browser().newBrowserCDPSession();
    const { id } = await browserCDP.send("Extensions.loadUnpacked", {
      path: root,
    });
    const appURL = `chrome-extension://${id}/index.html`;
    const manager = await context.newPage();
    await manager.goto("chrome://extensions");
    await manager.evaluate(() =>
      chrome.developerPrivate.updateProfileConfiguration({
        inDeveloperMode: true,
      }),
    );
    await manager.evaluate(
      async ({ id, origins }) => {
        for (const origin of origins)
          await chrome.developerPrivate.addHostPermission(id, origin + "/*");
      },
      { id, origins: [origin, apiOrigin] },
    );
    let app = await context.newPage();
    await app.goto(appURL);
    await app.locator("h1").waitFor();
    assert(
      await app.evaluate(
        (origins) =>
          chrome.permissions.request({
            origins: origins.map((origin) => origin + "/*"),
          }),
        [origin, apiOrigin],
      ),
    );
    await app.evaluate(async (origin) => {
      const { request } = await import("./client.js");
      const saved = await request("connection.save", {
        connection: {
          id: null,
          name: "Recovery model",
          url: origin + "/v1",
          model: "fixture",
          models: [{ id: "fixture" }],
          protocol: "chat",
          maxTokens: 4096,
          connected: true,
        },
      });
      await request("settings.save", {
        patch: {
          defaultConnection: saved.id,
          preferences: { locale: "zh-CN", theme: "light", palette: "graphite" },
        },
      });
    }, apiOrigin);
    const appCDP = await context.newCDPSession(app),
      versions = new Map();
    appCDP.on("ServiceWorker.workerVersionUpdated", ({ versions: updated }) =>
      updated.forEach((version) => versions.set(version.versionId, version)),
    );
    await appCDP.send("ServiceWorker.enable");
    const worker = context
      .serviceWorkers()
      .find((worker) => worker.url().endsWith("/background.js"));
    await worker.evaluate(() => {
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      globalThis.heldReads = [];
      chrome.storage.local.get = (keys) =>
        Array.isArray(keys) && keys.includes("credentials")
          ? new Promise((resolve) => globalThis.heldReads.push(resolve))
          : get(keys);
    });
    const source = await context.newPage(),
      errors = [];
    source.on("pageerror", (error) => errors.push(error.message));
    const sourceCDP = await context.newCDPSession(source);
    sourceCDP.on("Runtime.exceptionThrown", ({ exceptionDetails }) =>
      errors.push(
        exceptionDetails.exception?.description || exceptionDetails.text,
      ),
    );
    await sourceCDP.send("Runtime.enable");
    source.on("requestfailed", (request) => {
      if (request.url().startsWith(`chrome-extension://${id}/`))
        errors.push(`${request.url()}: ${request.failure()?.errorText}`);
    });
    await source.goto(origin + "/article");
    assert.deepEqual(
      await source.evaluate(() => ({
        secure: isSecureContext,
        uuid: typeof crypto.randomUUID,
        random: typeof crypto.getRandomValues,
      })),
      { secure: false, uuid: "undefined", random: "function" },
    );
    for (
      let i = 0;
      i < 100 &&
      !(await worker.evaluate(() => globalThis.heldReads.length >= 2));
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert(await worker.evaluate(() => globalThis.heldReads.length >= 2));
    const version = [...versions.values()].find(
      (version) =>
        version.scriptURL === `chrome-extension://${id}/background.js` &&
        version.runningStatus === "running",
    );
    await appCDP.send("ServiceWorker.stopWorker", {
      versionId: version.versionId,
    });
    await source.waitForFunction(
      () => document.querySelectorAll("[data-pagework=ui]").length === 0,
    );
    const tabId = await app.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      source.url(),
    );
    const request = (type, payload) =>
      app.evaluate(
        async ({ type, payload }) =>
          (await import("./client.js")).request(type, payload),
        { type, payload },
      );
    assert.equal(await request("tab.enable", { tabId }), true);
    const host = source.locator("[data-pagework=ui]");
    assert.equal(
      await host.count(),
      1,
      "A failed startup is retried in the same document",
    );
    await inspectUI(source);
    await host.locator("#toolbar").waitFor();
    assert(
      errors.every((error) => /message channel closed/i.test(error)),
      JSON.stringify(errors),
    );
    errors.length = 0; // Only the deliberately interrupted startup may report this native fault.
    await host.locator("#toolbar [data-op=run]").click();
    await source.locator("[data-pagework=result]").first().waitFor();
    await host
      .locator("#status")
      .filter({ hasText: "处理完成" })
      .waitFor({ state: "attached" });
    assert(
      (
        await source
          .locator("[data-pagework=result]")
          .first()
          .evaluate((node) => node.shadowRoot.textContent)
      ).includes("Recovered:"),
    );
    await source.locator("#draft").fill("Unsaved page draft");
    await source.evaluate(() => scrollTo(0, 200));
    const before = await source.evaluate(() => ({
      token: documentToken,
      draft: document.querySelector("#draft").value,
      scroll: scrollY,
    }));
    const oldHost = await host.elementHandle(),
      beforeReload = calls.length;
    await manager.evaluate(
      (id) => chrome.developerPrivate.reload(id, { failQuietly: true }),
      id,
    );
    await manager.waitForFunction(async (id) => {
      const extension = await chrome.developerPrivate.getExtensionInfo(id);
      return (
        extension.state === "ENABLED" && !extension.disableReasons.reloading
      );
    }, id);
    await source.waitForFunction((node) => !node.isConnected, oldHost);
    await host.waitFor({ state: "attached" });
    assert.equal(
      await host.count(),
      1,
      "The update replaces the old controller instead of adding a second one",
    );
    await inspectUI(source);
    assert.equal(
      await source.locator("[data-pagework=result]").count(),
      0,
      "Old translation sessions are restored and disposed",
    );
    assert.deepEqual(
      await source.evaluate(() => ({
        token: documentToken,
        draft: document.querySelector("#draft").value,
        scroll: scrollY,
      })),
      before,
    );
    await source.evaluate(() => {
      const paragraph = document.createElement("p");
      paragraph.textContent = "New content after the extension update";
      document.querySelector("main").append(paragraph);
    });
    await source.waitForTimeout(200);
    assert.equal(
      calls.length,
      beforeReload,
      "Old observers do not start translations after replacement",
    );
    app = await context.newPage();
    await app.goto(appURL);
    await app.locator("h1").waitFor();
    assert.equal(await request("tab.enable", { tabId }), true);
    await host.locator("#toolbar").waitFor();
    const qaCalls = calls.length;
    assert.equal(
      await request("tab.run", {
        tabId,
        actionId: "qa",
        scope: "body",
        panel: true,
      }),
      true,
    );
    await host.locator("#question").waitFor();
    assert(
      (await host.locator("#question-quote").textContent()).includes(
        "A useful note",
      ),
    );
    assert.equal(
      calls.length,
      qaCalls,
      "Opening Q&A only shows its quote and composer",
    );
    await host
      .locator("#question-input")
      .fill("Explain the main idea after recovery.");
    await host.locator("[data-op=question-run]").click();
    await host.locator("#output").filter({ hasText: "Recovered:" }).waitFor();
    await host
      .locator("#result-status")
      .filter({ hasText: "处理完成" })
      .waitFor({ state: "attached" });
    await source.evaluate(() => scrollTo(0, 0));
    await source.bringToFront();
    await source.locator("#fullscreen").click();
    await source.waitForFunction(() => Boolean(document.fullscreenElement));
    assert.equal(
      await host.count(),
      1,
      "Disposed fullscreen listeners cannot resurrect an old floating ball",
    );
    await source.evaluate(() => document.exitFullscreen());
    await source.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await host.count(), 1);
    await source.reload();
    await host.waitFor({ state: "attached" });
    await inspectUI(source);
    assert.equal(await host.count(), 1);
    assert.equal(await host.locator('link[rel="stylesheet"]').count(), 0);
    assert.equal(
      await host
        .locator("#dock")
        .evaluate((node) => getComputedStyle(node).position),
      "fixed",
      "The bundle applies styles on ordinary HTTP without extension resource URLs",
    );
    await source.locator("#first").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    const rect = await source.locator("#first").boundingBox();
    await source.mouse.move(rect.x + 10, rect.y + 10);
    await source.mouse.up();
    const bar = host.locator("#selection");
    await bar.locator("[data-selection-command=expand]").click();
    await bar.locator("[data-selection-command=add]").click();
    await bar.locator("[data-selection-field=name]").fill("HTTP action");
    await bar
      .locator("[data-selection-field=instruction]")
      .fill("Explain the key idea.");
    await bar.locator("[data-selection-command=save]").click();
    await bar.locator("[data-selection-command=expand]").waitFor();
    const custom = (await request("snapshot")).actions.find(
      (action) => action.name === "HTTP action",
    );
    assert(custom, "Creating a persistent action works on HTTP pages");
    assert.match(
      custom.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    await manager.evaluate((id) => chrome.management.setEnabled(id, false), id);
    await source.evaluate(() => {
      const host = document.querySelector("[data-pagework=ui]");
      host.remove();
      document.documentElement.append(host);
    });
    await source.waitForTimeout(200);
    assert.deepEqual(errors, []);
    await source.screenshot({
      path: path.join(root, "artifacts/content-entry-recovery.png"),
    });
    console.log(
      "PASS: ordinary HTTP startup, page reload, custom action UUIDs and styles after context removal; interrupted startup retries in the same page; toolbar and translation work; extension reload disposes old controls/observers and automatically restores one working floating entry; form/scroll/document state stays intact; Q&A quotes, explicit submission and output work; fullscreen cannot resurrect stale controls.",
    );
  } finally {
    await context.close();
    server.closeAllConnections();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
