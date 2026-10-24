const assert = require("node:assert/strict"),
  path = require("node:path");
module.exports = async ({
  page,
  context,
  manager,
  extensionId,
  origin,
  calls,
  setFailure,
  artifacts,
  nav,
  op,
  choose,
}) => {
  await choose("#ui-locale", "zh-CN");
  await nav("connections");
  await page.locator("details.advanced summary").click();
  await page.locator("[data-connection=concurrency]").fill("2");
  await page.locator("[data-connection=batchCount]").fill("3");
  await page.locator("[data-connection=batchChars]").fill("4000");
  await op("save-connection").click();
  await page.reload();
  await page.locator("h1").waitFor();
  const saved = await page.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "snapshot" })).value
        .connections[0].processing,
  );
  assert.deepEqual(saved, { concurrency: 2, batchCount: 3, batchChars: 4000 });
  await page.locator("details.advanced summary").click();
  await page.screenshot({
    path: path.join(artifacts, "connection-batching.png"),
    fullPage: true,
  });
  const cacheStats = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "cache.stats" })).value,
    );
  await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "cache.clear" }),
  );
  const source = await context.newPage();
  await source.goto(origin + "/cache-page");
  const tabId = await page.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
    origin + "/cache-page",
  );
  const host = source.locator("[data-pagework=ui]");
  await host.waitFor({ state: "attached" });
  const run = async () => {
    await page.evaluate(
      (tabId) =>
        chrome.runtime.sendMessage({
          type: "tab.run",
          tabId,
          actionId: "translate",
          scope: "body",
        }),
      tabId,
    );
    await host
      .locator("#status")
      .filter({ hasText: "处理完成" })
      .waitFor({ state: "attached" });
  };
  const before = calls.length;
  await run();
  const first = calls.length - before;
  assert(first >= 2);
  assert((await cacheStats()).entries > 0);
  // Full page reload destroys nodes and the content script, while IndexedDB keeps the results.
  await source.reload();
  await host.waitFor({ state: "attached" });
  const count = calls.length;
  await run();
  assert.equal(calls.length, count);
  assert((await host.locator("#status").textContent()).includes("本地缓存"));
  setFailure(true);
  try {
    await run();
    assert.equal(
      calls.length,
      count,
      "Cache hits work without a reachable provider",
    );
  } finally {
    setFailure(false);
  }
  await source
    .locator("#second")
    .evaluate((n) => (n.textContent = "Only this paragraph was updated."));
  await run();
  assert.equal(calls.length, count + 1);
  assert.deepEqual(
    JSON.parse(calls.at(-1).body.messages.at(-1).content).items.map(
      (i) => i.text,
    ),
    ["Only this paragraph was updated."],
  );
  // Different page URL and different DOM IDs share the same logical text results.
  const second = await context.newPage();
  await second.goto(origin + "/another-cache-page");
  const secondId = await page.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
    origin + "/another-cache-page",
  );
  const crossCount = calls.length;
  await page.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({
        type: "tab.run",
        tabId,
        actionId: "translate",
        scope: "body",
      }),
    secondId,
  );
  await second
    .locator("[data-pagework=ui]")
    .locator("#status")
    .filter({ hasText: "处理完成" })
    .waitFor({ state: "attached" });
  assert.equal(calls.length, crossCount);
  await page.evaluate(
    (tabId) => chrome.runtime.sendMessage({ type: "tab.enable", tabId }),
    tabId,
  );
  const fresh = calls.length;
  await host.locator("[data-op=refresh-page]").click();
  await host
    .locator("#status")
    .filter({ hasText: "处理完成" })
    .waitFor({ state: "attached" });
  assert(calls.length > fresh, "Manual regeneration bypasses the cache");
  setFailure(true);
  try {
    await host.locator("[data-op=refresh-page]").click();
    await host.locator("#status").filter({ hasText: "认证失败" }).waitFor();
  } finally {
    setFailure(false);
  }
  const afterFailure = calls.length;
  await run();
  assert.equal(
    calls.length,
    afterFailure,
    "Failed refresh does not destroy previously valid cache",
  );
  await source.screenshot({
    path: path.join(artifacts, "cache-page-reused.png"),
  });
  // Cache storage and control are inaccessible to ordinary content-script messages.
  const denied = await page.evaluate(async (tabId) => {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => chrome.runtime.sendMessage({ type: "cache.clear" }),
    });
    return r.result;
  }, tabId);
  assert.equal(denied.error, "notAllowed");
  const persistent = await page.evaluate(async () => {
    const { IndexedResultCache } = await import("./cache.js");
    const name = "pagework-lru-test-" + crypto.randomUUID();
    const cache = new IndexedResultCache(name, 110);
    await cache.putMany([{ key: "a", text: "1234567890" }], 0);
    await new Promise((r) => setTimeout(r, 10));
    await cache.putMany([{ key: "b", text: "abcdefghij" }], 0);
    await new Promise((r) => setTimeout(r, 10));
    await cache.touch(["a"]);
    await new Promise((r) => setTimeout(r, 10));
    await cache.putMany([{ key: "c", text: "klmnopqrst" }], 0);
    const reopened = new IndexedResultCache(name, 110),
      entries = [...(await reopened.getMany(["a", "b", "c"])).keys()],
      stats = await reopened.stats();
    const generation = cache.generation;
    await cache.clear();
    await cache.putMany([{ key: "late", text: "old request" }], generation);
    return { entries, stats, afterClear: await cache.stats() };
  });
  assert.deepEqual(persistent.entries, ["a", "c"]);
  assert.equal(persistent.stats.entries, 2);
  assert(persistent.stats.bytes <= 110);
  assert.equal(persistent.afterClear.entries, 0);
  await nav("usage");
  await page.locator("#cache-info").filter({ hasText: "块内容" }).waitFor();
  assert(!(await page.locator("#cache-info").textContent()).startsWith("0 块"));
  const recordsBefore = await page.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "usage.overview" })).value
        .totalRecords,
  );
  await op("cache-clear-ask").click();
  await page.locator("dialog [data-op=cache-clear]").click();
  await page.waitForFunction(() => !document.querySelector("dialog").open);
  await page.locator("#cache-info").filter({ hasText: "0 块内容" }).waitFor();
  assert.equal((await cacheStats()).entries, 0);
  assert.equal(
    await page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "usage.overview" })).value
          .totalRecords,
    ),
    recordsBefore,
  );
  await source.keyboard.press("Escape");
  await source
    .locator("#first")
    .evaluate(
      (n) =>
        (n.textContent =
          "A new paragraph to verify unobtrusive failure feedback."),
    );
  setFailure(true);
  try {
    await page.evaluate(
      (tabId) =>
        chrome.runtime.sendMessage({
          type: "tab.run",
          tabId,
          actionId: "translate",
          scope: "body",
        }),
      tabId,
    );
    await host.locator("#notice").filter({ hasText: "认证失败" }).waitFor();
    assert(
      await host.locator("#toolbar").isHidden(),
      "Provider failures use a notice without opening page controls",
    );
  } finally {
    setFailure(false);
  }
  await source.close();
  await second.close();
  console.log(
    `PASS: real IndexedDB LRU/reopen/clear, shared page/selection cache, ${first} first-page requests → 0 after reload → 1 for an edited paragraph, cross-URL reuse, explicit regeneration, failed-refresh preservation, cache controls and saved scheduling policy.`,
  );
};
