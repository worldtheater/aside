const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), "pagework-recent-tabs-"),
  );
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" }),
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  });
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send("Extensions.loadUnpacked", { path: root });
    const app = await context.newPage();
    await app.goto(`chrome-extension://${id}/index.html`);
    await app.locator("h1").waitFor();
    const commands = await app.evaluate(() => chrome.commands.getAll());
    const command = commands.find((c) => c.name === "switch-recent-tab");
    assert(command);
    assert.equal(
      command.shortcut,
      process.platform === "darwin" ? "⌥W" : "Alt+W",
    );
    const windows = await app.evaluate(async () => {
      const first = await chrome.windows.create({ url: "about:blank" });
      const second = await chrome.windows.create({ url: "about:blank" });
      return {
        first: first.id,
        a: first.tabs[0].id,
        second: second.id,
        d: second.tabs[0].id,
      };
    });
    const history = () =>
      app.evaluate(() => chrome.storage.session.get("recentTabs"));
    const active = (windowId) =>
      app.evaluate(
        async (windowId) =>
          (await chrome.tabs.query({ windowId, active: true }))[0]?.id,
        windowId,
      );
    const waitCurrent = (windowId, tabId) =>
      app.waitForFunction(
        async ({ windowId, tabId }) =>
          (await chrome.storage.session.get("recentTabs")).recentTabs?.[
            windowId
          ]?.[0] === tabId,
        { windowId, tabId },
      );
    const activate = async (tabId) => {
      const tab = await app.evaluate(
        (id) => chrome.tabs.update(id, { active: true }),
        tabId,
      );
      await waitCurrent(tab.windowId, tabId);
    };
    // Call the same compiled implementation as the command handler. Native tab
    // activation/close/move events are handled by the real MV3 service worker.
    const toggle = async (windowId) => {
      await app.evaluate(
        async (windowId) =>
          (await import("./recent-tabs.js")).switchRecentTab(windowId),
        windowId,
      );
      await waitCurrent(windowId, await active(windowId));
    };
    await waitCurrent(windows.first, windows.a);
    await waitCurrent(windows.second, windows.d);
    const b = await app.evaluate(
      (windowId) =>
        chrome.tabs.create({ windowId, url: "about:blank", active: true }),
      windows.first,
    );
    await waitCurrent(windows.first, b.id);
    const unseen = await app.evaluate(
      (windowId) =>
        chrome.tabs.create({ windowId, url: "about:blank", active: false }),
      windows.first,
    );
    await toggle(windows.first);
    assert.equal(
      await active(windows.first),
      windows.a,
      "Unseen background tab must not steal the toggle",
    );
    assert(!(await history()).recentTabs[windows.first].includes(unseen.id));
    await toggle(windows.first);
    assert.equal(await active(windows.first), b.id);
    await app.evaluate(async (windowId) => {
      const { switchRecentTab } = await import("./recent-tabs.js");
      await Promise.all(
        Array.from({ length: 7 }, () => switchRecentTab(windowId)),
      );
    }, windows.first);
    await waitCurrent(windows.first, windows.a);
    assert.equal(await active(windows.first), windows.a);
    await activate(unseen.id);
    await toggle(windows.first);
    assert.equal(await active(windows.first), windows.a);
    await toggle(windows.first);
    assert.equal(await active(windows.first), unseen.id);
    await app.evaluate((tabId) => chrome.tabs.remove(tabId), windows.a);
    await app.waitForFunction(
      async ({ windowId, tabId }) =>
        !(await chrome.storage.session.get("recentTabs")).recentTabs[
          windowId
        ].includes(tabId),
      { windowId: windows.first, tabId: windows.a },
    );
    await toggle(windows.first);
    assert.equal(await active(windows.first), b.id);
    const e = await app.evaluate(
      (windowId) =>
        chrome.tabs.create({ windowId, url: "chrome://version", active: true }),
      windows.second,
    );
    await waitCurrent(windows.second, e.id);
    await toggle(windows.second);
    assert.equal(await active(windows.second), windows.d);
    assert.equal(await active(windows.first), b.id);
    await toggle(windows.second);
    assert.equal(
      await active(windows.second),
      e.id,
      "Internal pages also participate",
    );
    await app.evaluate(
      ({ tabId, windowId }) => chrome.tabs.move(tabId, { windowId, index: -1 }),
      { tabId: unseen.id, windowId: windows.second },
    );
    await app.waitForFunction(
      async ({ windowId, tabId }) =>
        !(await chrome.storage.session.get("recentTabs")).recentTabs[
          windowId
        ].includes(tabId),
      { windowId: windows.first, tabId: unseen.id },
    );
    await toggle(windows.first);
    assert.equal(
      await active(windows.first),
      b.id,
      "One remaining visited tab is a no-op",
    );
    await activate(unseen.id);
    await toggle(windows.second);
    assert.equal(await active(windows.second), e.id);

    const pageCDP = await context.newCDPSession(app),
      versions = new Map();
    pageCDP.on("ServiceWorker.workerVersionUpdated", ({ versions: updated }) =>
      updated.forEach((v) => versions.set(v.versionId, v)),
    );
    await pageCDP.send("ServiceWorker.enable");
    await app.evaluate(() => chrome.runtime.sendMessage({ type: "snapshot" }));
    const worker = [...versions.values()].find(
      (v) =>
        v.scriptURL === `chrome-extension://${id}/background.js` &&
        v.runningStatus === "running",
    );
    assert(worker);
    const before = (await history()).recentTabs[windows.second];
    await pageCDP.send("ServiceWorker.stopWorker", {
      versionId: worker.versionId,
    });
    await app.reload();
    await app.locator("h1").waitFor();
    assert.deepEqual(
      (await history()).recentTabs[windows.second],
      before,
      "Worker restart preserves the pair",
    );
    await toggle(windows.second);
    assert.equal(await active(windows.second), unseen.id);
    await toggle(windows.second);
    assert.equal(await active(windows.second), e.id);
    await app.evaluate(
      (windowId) => chrome.windows.remove(windowId),
      windows.second,
    );
    await app.waitForFunction(
      async (windowId) =>
        !(await chrome.storage.session.get("recentTabs")).recentTabs[windowId],
      windows.second,
    );
    assert.deepEqual((await history()).recentTabs[windows.first], [b.id]);
    assert.equal(
      await app.evaluate(() =>
        chrome.permissions.contains({ permissions: ["tabs"] }),
      ),
      false,
      "No new tabs permission",
    );
    console.log(
      "PASS: registered Alt+W, real Chrome MRU toggling, background-tab exclusion, rapid commands, internal pages, independent windows, close/move cleanup and cold-worker persistence.",
    );
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
