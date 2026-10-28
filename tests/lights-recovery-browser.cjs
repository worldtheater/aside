const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

module.exports = async ({ page, context, artifacts }) => {
  const extensionURL = page.url().split("/").slice(0, 3).join("/");
  const id = new URL(extensionURL).hostname;
  let control = page;
  let modelCalls = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/systemone") {
      modelCalls++;
      res.writeHead(503, { "content-type": "application/json" });
      res.end('{"error":{"message":"Unexpected automatic analysis"}}');
      return;
    }
    const native = req.url === "/native";
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><title>Lights recovery fixture</title><style>
      html,body{background:${native ? "#17191c" : "#fff"};color:${native ? "#e7e7e7" : "#222"};margin:0}
      body{font:18px sans-serif;padding:32px}main{height:1600px}input{display:block;margin:24px 0}iframe{width:600px;height:240px}
      </style></head><body><h1>Keep this page open</h1><input value="draft"><canvas width="200" height="100" style="position:fixed;right:20px;top:100px" aria-label="Recovery canvas"></canvas><script>const c=document.querySelector('canvas');const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,200,100);</script><main>${req.url === "/source" ? `<iframe src="http://localhost:${server.address().port}/frame"></iframe>` : "Reading without losing page state."}</main></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const manager = await context.newPage();
  await manager.goto("chrome://extensions");
  await manager.evaluate(() =>
    chrome.developerPrivate.updateProfileConfiguration({
      inDeveloperMode: true,
    }),
  );
  for (const host of ["http://*/*", "https://*/*"])
    await manager.evaluate(
      ({ id, host }) => chrome.developerPrivate.addHostPermission(id, host),
      { id, host },
    );
  await control.evaluate(() =>
    chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }),
  );
  await control.evaluate(async (origin) => {
    const { settings, credentials } = await (
      await import("./tests/local-store-fixture.mjs")
    ).localStore.get(["settings", "credentials"]);
    settings.connections.push({
      id: "recovery-decision",
      name: "Recovery decision fixture",
      url: origin + "/v1",
      model: "jev-fixture",
      models: [{ id: "jev-fixture", name: "jev-fixture" }],
      protocol: "typesafe",
      maxTokens: 8192,
      connected: true,
    });
    settings.defaultDecisionConnection = "recovery-decision";
    settings.website.sites["127.0.0.1"] = { enhance: true };
    credentials["recovery-decision"] = "local-fixture";
    await (
      await import("./tests/local-store-fixture.mjs")
    ).localStore.set({ settings, credentials });
  }, origin);
  const source = await context.newPage();
  const others = [];
  try {
    await source.goto(origin + "/source");
    await source.locator("[data-pagework=ui]").waitFor({ state: "attached" });
    const tabId = await tabFor(source);
    const { DECISION_MODELS_ENABLED } = await import("../providers.js");
    const child = source.frames().find((f) => f.url().endsWith("/frame"));
    assert(child, "Cross-origin child is loaded");
    await source.evaluate(() => {
      const related = document.createElement("iframe");
      related.id = "related-recovery";
      related.srcdoc =
        "<html><head><style>body{background:white;color:black}</style></head><body>Related frame survives reload</body></html>";
      document.body.append(related);
    });
    const related = await (
      await source.locator("#related-recovery").elementHandle()
    ).contentFrame();
    await related.waitForLoadState("load");
    await source.locator("input").fill("Unsaved local draft");
    await source.evaluate(() => {
      window.recoveryState = "keep this document";
      scrollTo(0, 300);
    });
    const before = await documentState();
    await reloadExtension();
    assert.equal(
      await status(tabId),
      null,
      "Reload invalidates the old receiver",
    );

    // The popup no longer controls Lights. Exercise controller recovery through
    // the site-settings endpoint without navigating or refreshing the document.
    await update({ lights: "on" }, tabId);
    await dark(source);
    await dark(child);
    await dark(related);
    await source.waitForTimeout(900);
    assert.equal(
      modelCalls,
      0,
      "Restoring enabled enhancement never authorizes Jev requests",
    );
    assert.equal(
      (await status(tabId)).enhancement.status,
      DECISION_MODELS_ENABLED ? "ready" : "off",
    );
    assert.deepEqual(
      await documentState(),
      before,
      "Recovery preserves document, draft and scroll",
    );
    const firstMarker = await marker();
    await update({ lights: "on" }, tabId);
    assert.equal(await marker(), firstMarker, "A live controller is reused");

    const native = await context.newPage();
    others.push(native);
    await native.goto(origin.replace("127.0.0.1", "localhost") + "/native");
    const nativeId = await tabFor(native);
    const external = await context.newPage();
    others.push(external);
    await external.goto(origin.replace("127.0.0.1", "localhost") + "/external");
    const externalId = await tabFor(external);
    await external.evaluate(() => {
      const owner = document.createElement("meta");
      owner.name = "darkreader";
      owner.content = "external-owner";
      const sheet = document.createElement("style");
      sheet.className = "darkreader";
      sheet.textContent = "body{background:#202225;color:#eee}";
      document.head.append(owner, sheet);
    });
    await reloadExtension();
    assert.equal(await status(tabId), null);
    assert.equal(
      await marker(),
      firstMarker,
      "Reload leaves old engine styles in the document",
    );
    await update({ lights: "on" }, tabId);
    await update({ lights: "on" }, nativeId);
    await dark(source);
    await dark(child);
    await dark(related);
    assert.equal(
      (await status(tabId)).status,
      "active",
      "Old theme is not mistaken for an external engine",
    );
    assert.notEqual(
      await marker(),
      firstMarker,
      "The old engine is disposed before replacement",
    );
    assert.equal(await source.locator("meta[name=darkreader]").count(), 1);
    await source.waitForTimeout(900);
    assert.equal(
      modelCalls,
      0,
      "Site recovery does not call Jev in any frame or tab",
    );
    assert.deepEqual(await documentState(), before);
    assert.equal((await status(nativeId)).status, "native");
    assert.equal((await status(externalId)).status, "external");
    assert.equal(
      await external.locator("meta[name=darkreader]").getAttribute("content"),
      "external-owner",
    );
    assert.equal(await external.locator("style.darkreader").count(), 1);

    await update({ lights: "off" }, nativeId);
    assert.equal(
      (await status(tabId)).status,
      "active",
      "Changing another site leaves the recovered site active",
    );
    await update({ lights: null, enhance: null }, tabId);
    await source.waitForFunction(
      () => !document.documentElement.dataset.darkreaderMode,
    );
    await child.waitForFunction(
      () => !document.documentElement.dataset.darkreaderMode,
    );
    await related.waitForFunction(
      () => !document.documentElement.dataset.darkreaderMode,
    );
    assert.equal(await source.locator(".darkreader").count(), 0);
    // Old observers must not recreate their theme after the replacement stops.
    await source.evaluate(() => {
      document.body.classList.add("changed-after-recovery");
      const sheet = document.createElement("style");
      sheet.textContent = "p{color:#153252}";
      document.head.append(sheet);
    });
    await source.waitForTimeout(800);
    assert.equal(await source.locator(".darkreader").count(), 0);
    assert.equal(
      await source.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
      "rgb(255, 255, 255)",
    );
    assert.equal(
      await external.locator("meta[name=darkreader]").getAttribute("content"),
      "external-owner",
    );
    assert.deepEqual(await documentState(), before);
    await update({ lights: "on" }, tabId);
    await source.screenshot({
      path: path.join(artifacts, "lights-recovery.png"),
    });
    console.log(
      "PASS: real extension reload with Lights off/on, site-settings recovery, no navigation or form/scroll loss, live-instance reuse, iframe/site recovery, native/external themes preserved, clean shutdown without orphan observers.",
    );
  } finally {
    await source.close();
    for (const other of others) await other.close();
    await manager.close();
    if (!control.isClosed()) await control.close();
    server.close();
  }
  async function reloadExtension() {
    await manager.evaluate(
      (id) => chrome.developerPrivate.reload(id, { failQuietly: true }),
      id,
    );
    const deadline = Date.now() + 10000;
    let ready = false;
    do {
      ready = await manager.evaluate(async (id) => {
        const extension = await chrome.developerPrivate.getExtensionInfo(id);
        return (
          extension.state === "ENABLED" && !extension.disableReasons.reloading
        );
      }, id);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert(ready, "Extension reload finished");
    control = await context.newPage();
    await control.goto(extensionURL + "/index.html");
    await control.locator("h1").waitFor();
  }
  function tabFor(target) {
    return control.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      target.url(),
    );
  }
  function update(patch, tabId) {
    return control.evaluate(
      async (args) => {
        const result = await chrome.runtime.sendMessage({
          type: "website.update",
          ...args,
        });
        assertResult(result);
        function assertResult(value) {
          if (!value.ok) throw Error(JSON.stringify(value));
        }
      },
      { patch, tabId },
    );
  }
  function status(tabId) {
    return control.evaluate(
      (tabId) =>
        chrome.tabs
          .sendMessage(tabId, { type: "lights.status" }, { frameId: 0 })
          .then(
            (status) => status ?? null,
            () => null,
          ),
      tabId,
    );
  }
  function dark(target) {
    return target.waitForFunction(
      () =>
        document.documentElement.dataset.darkreaderMode === "dynamic" &&
        getComputedStyle(document.body).backgroundColor !==
          "rgb(255, 255, 255)",
    );
  }
  function marker() {
    return source.locator("meta[name=darkreader]").getAttribute("content");
  }
  function documentState() {
    return source.evaluate(() => ({
      origin: performance.timeOrigin,
      marker: window.recoveryState,
      value: document.querySelector("input").value,
      scroll: scrollY,
    }));
  }
};
