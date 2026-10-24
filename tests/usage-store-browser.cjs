const assert = require("node:assert/strict");

module.exports = async ({ page, nav, op, choose }) => {
  // Reopen the already populated database without the retired import marker.
  const fixture = await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("aside-usage");
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    const yesterday = new Date(day);
    yesterday.setDate(day.getDate() - 1);
    const records = Array.from({ length: 237 }, (_, i) => ({
      id: "stored-" + String(i).padStart(4, "0"),
      startedAt: i < 150 ? day.getTime() : yesterday.getTime(),
      durationMs: 10,
      connectionId: i % 2 ? "b" : "a",
      connectionName: "Fixture " + (i % 2 ? "B" : "A"),
      model: "model-" + (i % 2),
      protocol: "chat",
      source: "page",
      actionName: "Translate",
      status: "success",
      errorCode: null,
      usageFinal: i % 5 !== 0,
      tokens:
        i % 7 === 0
          ? null
          : {
              inputTokens: 100,
              outputTokens: i,
              cachedTokens: 0,
              cacheWriteTokens: null,
              reasoningTokens: 0,
              totalTokens: 100 + i,
            },
    }));
    const details = {
      instructions: "Original instructions",
      input: "Original input",
      output: "Original output",
    };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("aside-usage", 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("details");
        const records = db.createObjectStore("records", { keyPath: "id" });
        records.createIndex("byTime", ["startedAt", "id"]);
        records.createIndex("byModelTime", ["modelKey", "startedAt", "id"]);
        records.createIndex("modelKey", "modelKey");
        db.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["records", "details", "meta"], "readwrite");
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      tx.objectStore("details").put(details, records[0].id);
      for (const record of records)
        tx.objectStore("records").put({
          ...record,
          modelKey: JSON.stringify([record.connectionId, record.model]),
        });
      tx.objectStore("meta").put(true, "localImported");
    });
    db.close();
    return { records, details };
  });
  const send = (type, args = {}) =>
    page.evaluate(
      async ({ type, args }) => {
        const result = await chrome.runtime.sendMessage({ type, ...args });
        if (!result.ok) throw Error(result.error);
        return result.value;
      },
      { type, args },
    );
  const expected = [...fixture.records].sort(
    (a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id),
  );
  const all = [];
  let before;
  do {
    const records = await send("usage.list", { before });
    assert(records.length <= 50);
    if (!records.length) break;
    all.push(...records);
    const last = records.at(-1);
    before = [last.startedAt, last.id];
  } while (true);
  assert.deepEqual(
    all,
    expected,
    "Cursor pages preserve same-timestamp records without skips or duplicates",
  );
  const schema = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("aside-usage");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = [...db.objectStoreNames];
    db.close();
    return names;
  });
  assert.deepEqual(
    schema,
    ["details", "records"],
    "The import marker store is removed while records and details remain",
  );
  assert.deepEqual(
    await send("usage.details", { id: fixture.records[0].id }),
    fixture.details,
  );
  assert.equal(
    await send("usage.details", { id: fixture.records[1].id }),
    null,
  );
  const overview = await send("usage.overview");
  assert.equal(overview.totalRecords, 237);
  assert.equal(overview.summary.calls, 237);
  assert.equal(
    overview.summary.totalTokens,
    fixture.records.reduce((sum, r) => sum + (r.tokens?.totalTokens ?? 0), 0),
  );
  assert.equal(
    overview.days.reduce((sum, d) => sum + d.calls, 0),
    237,
  );
  assert.equal(overview.models.length, 2);
  const filter = { period: "today", model: JSON.stringify(["a", "model-0"]) };
  const filtered = fixture.records.filter((_, i) => i < 150 && i % 2 === 0);
  assert.equal(
    (await send("usage.overview", { filter })).summary.calls,
    filtered.length,
  );
  const first = await send("usage.list", { filter });
  const next = await send("usage.list", {
    filter,
    before: [first.at(-1).startedAt, first.at(-1).id],
  });
  assert.deepEqual(
    [...first, ...next].map((r) => r.id),
    filtered.reverse().map((r) => r.id),
  );
  const reads = await page.evaluate(async () => {
    const store = await import("./usage-store.js");
    let reads = 0;
    const get = chrome.storage.local.get;
    chrome.storage.local.get = async (...args) => {
      reads++;
      return get(...args);
    };
    try {
      await store.listUsage();
      await store.usageOverview();
    } finally {
      chrome.storage.local.get = get;
    }
    return reads;
  });
  assert.equal(reads, 0, "History queries do not read chrome.storage.local");
  await page.reload();
  await nav("usage");
  await page.waitForFunction(
    () => document.querySelectorAll("[data-usage-id]").length === 50,
  );
  assert(
    (await page.locator("#usage-coverage").textContent()).startsWith("237 "),
  );
  await op("usage-more").click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-usage-id]").length === 100,
  );
  await page.evaluate(
    async (record) =>
      (await import("./usage-store.js")).addUsage({
        ...record,
        id: "live-refresh",
        startedAt: record.startedAt + 1,
        connectionId: "live",
        model: "live-model",
        tokens: null,
      }),
    fixture.records[0],
  );
  await page.waitForFunction(() =>
    document.querySelector('[data-usage-id="live-refresh"]'),
  );
  assert.equal(
    await page.locator("[data-usage-id]").count(),
    100,
    "A live update preserves the expanded history window",
  );
  assert.equal(
    (await send("usage.overview")).summary.totalTokens,
    overview.summary.totalTokens,
  );
  await choose("#usage-model", filter.model);
  await choose("#usage-period", "today");
  await page.waitForFunction(() =>
    document.querySelector("#usage-coverage").textContent.startsWith("75 "),
  );
  assert.equal(await page.locator("[data-usage-id]").count(), 50);
  await op("usage-more").click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-usage-id]").length === 75,
  );
  assert.equal(await op("usage-more").count(), 0);
  await send("usage.clear");
  assert.equal(
    await send("usage.details", { id: fixture.records[0].id }),
    null,
  );
  assert.equal((await send("usage.overview")).totalRecords, 0);
  await page.waitForFunction(() => document.querySelector(".collection-empty"));
  await page.reload();
  assert.equal(
    (await send("usage.overview")).totalRecords,
    0,
    "Cleared history stays empty after reload",
  );
  console.log(
    "PASS: existing IndexedDB records and details preserved, obsolete marker removed, same-time cursor pages, model/date indexes, independent totals, UI pagination and clear.",
  );
};
