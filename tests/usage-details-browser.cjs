const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({
  page,
  context,
  origin,
  calls,
  streams,
  artifacts,
  nav,
  op,
  choose,
}) => {
  const stored = await page.evaluate(async () =>
    (await import("./tests/local-store-fixture.mjs")).localStore.get([
      "settings",
      "credentials",
      "daily",
    ]),
  );
  const callStart = calls.length,
    streamStart = streams.length;
  const list = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "usage.list" })).value,
    );
  const detail = (id) =>
    page.evaluate(
      async (id) =>
        (await chrome.runtime.sendMessage({ type: "usage.details", id })).value,
      id,
    );
  const protocol = (value) =>
    page.evaluate(async (value) => {
      const { settings } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get("settings");
      settings.connections[0].protocol = value;
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({ settings });
    }, value);
  const run = (text, overrides = {}) =>
    page.evaluate(
      async ({ text, overrides }) => {
        const { processRequest } = await import("./client.js");
        return processRequest({
          source: "trial",
          refresh: true,
          stream: true,
          action: {
            kind: "custom",
            mode: "whole",
            model: "default",
            name: "Details fixture",
            instruction: "DETAILS_INSTRUCTION: Keep all source text.",
          },
          blocks: [{ id: "one", text }],
          ...overrides,
        }).promise;
      },
      { text, overrides },
    );
  const open = async (id) => {
    const row = page.locator(`[data-usage-id="${id}"]`);
    await row.hover();
    await row.locator("[data-op=usage-details]").click();
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog").open);
  };
  let source;
  try {
    await page.evaluate(
      (origin) => chrome.permissions.request({ origins: [origin + "/*"] }),
      origin,
    );
    await page.evaluate(async (origin) => {
      const { settings, daily } = await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.get(["settings", "daily"]);
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        settings: {
          ...settings,
          preferences: {
            ...settings.preferences,
            locale: "zh-CN",
            theme: "light",
          },
          connections: [
            {
              id: "usage-fixture",
              name: "Usage fixture",
              protocol: "chat",
              model: "fixture-model",
              url: origin + "/v1",
              connected: true,
            },
          ],
          defaultConnection: "usage-fixture",
        },
        credentials: { "usage-fixture": "usage-fixture-secret" },
        daily: { ...daily, hidden: true },
      });
    }, origin);
    await page.reload();
    await nav("usage");
    // Each provider uses the same tracking contract, including streamed text.
    for (const value of ["chat", "responses", "anthropic", "gemini"]) {
      await protocol(value);
      const input = `Details ${value}: <script>window.detailInjected=true</script> & text`;
      await run(input);
      const record = (await list())[0],
        body = await detail(record.id);
      assert.equal(record.protocol, value);
      assert.equal(body.input, input);
      assert(body.instructions.startsWith("DETAILS_INSTRUCTION:"));
      assert.equal(body.output, "Processed together: " + input);
      assert(!JSON.stringify(body).includes("usage-fixture-secret"));
      assert(
        !JSON.stringify(record).includes("DETAILS_INSTRUCTION"),
        "List payloads contain metadata only",
      );
    }
    // Input, instructions, returned text and persisted records must not retain any saved key.
    const known = ["usage-fixture-secret", "other-connection-fixture-secret"];
    await page.evaluate(async (known) => {
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set({
        credentials: { "usage-fixture": known[0], "other-fixture": known[1] },
      });
    }, known);
    for (const value of ["chat", "responses", "anthropic", "gemini"]) {
      await protocol(value);
      const input = "Credential fixture " + known.join(" / ");
      const result = await run(input, {
        action: {
          kind: "custom",
          mode: "whole",
          model: "default",
          name: "Action " + known[1],
          instruction: "Explain " + known[0],
        },
      });
      const record = (await list())[0];
      const body = await detail(record.id);
      for (const secret of known) {
        assert(!JSON.stringify([result, record, body]).includes(secret));
      }
      assert(body.input.includes("[redacted] / [redacted]"));
      assert.equal(body.instructions.startsWith("Explain [redacted]"), true);
      assert.equal(body.output, result.parts[0].text);
    }
    const persisted = await page.evaluate(async () => {
      const read = async (name, store) => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const values = await new Promise((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return values;
      };
      return [
        await read("aside-usage", "details"),
        await read("aside-usage", "records"),
        await read("pagework-results", "entries"),
      ];
    });
    for (const secret of known)
      assert(!JSON.stringify(persisted).includes(secret));
    await protocol("chat");
    const worker = context.serviceWorkers()[0];
    const beforeWriteFailure = (await list()).length;
    await worker.evaluate(() => {
      globalThis.savedUsagePut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "records")
          throw new DOMException("History storage full", "QuotaExceededError");
        return globalThis.savedUsagePut.apply(this, args);
      };
    });
    try {
      const result = await run("History write failure fixture");
      assert(
        result.parts[0].text.includes("History write failure fixture"),
        "History failures keep successful model output",
      );
      await page.evaluate(async () =>
        (await import("./tests/local-store-fixture.mjs")).localStore.set({
          credentials: { "usage-fixture": "invalid-fixture" },
        }),
      );
      const code = await page.evaluate(async () => {
        const { processRequest } = await import("./client.js");
        try {
          await processRequest({
            source: "trial",
            refresh: true,
            action: {
              kind: "custom",
              mode: "whole",
              model: "default",
              instruction: "Test",
            },
            blocks: [{ id: "one", text: "Auth and history write failure" }],
          }).promise;
        } catch (error) {
          return error.code;
        }
      });
      assert.equal(
        code,
        "authError",
        "History failures do not replace the original provider error",
      );
      assert.equal((await list()).length, beforeWriteFailure);
    } finally {
      await worker.evaluate(() => {
        IDBObjectStore.prototype.put = globalThis.savedUsagePut;
        delete globalThis.savedUsagePut;
      });
      await page.evaluate(async () =>
        (await import("./tests/local-store-fixture.mjs")).localStore.set({
          credentials: { "usage-fixture": "usage-fixture-secret" },
        }),
      );
    }
    const beforeBatch = calls.length;
    await run("", {
      stream: false,
      action: {
        kind: "translate",
        mode: "paragraph",
        model: "default",
        instruction: "Translate labels.",
        sourceLanguage: "auto",
        targetLanguage: "zh-Hans",
      },
      blocks: [
        {
          id: "a",
          text: "Context window",
          context: { pageTitle: "Models", sectionTitle: "First model" },
        },
        {
          id: "b",
          text: "Max output",
          context: { pageTitle: "Models", sectionTitle: "First model" },
        },
      ],
    });
    const batch = (await list())[0],
      batchDetail = await detail(batch.id);
    assert.equal(calls.length, beforeBatch + 1);
    assert.equal(batchDetail.input, calls.at(-1).body.messages.at(-1).content);
    assert.equal(
      batchDetail.instructions,
      calls.at(-1).body.messages[0].content,
    );
    assert.equal(JSON.parse(batchDetail.input).items.length, 2);
    assert(batchDetail.input.includes("First model"));
    assert.equal(JSON.parse(batchDetail.output).items.length, 2);

    // Preserve received text on both disconnect and a truncated response.
    for (const interrupted of [false, true]) {
      const count = streams.length,
        before = (await list()).length;
      const text = `STREAM_FIXTURE details ${interrupted}`;
      await page.evaluate(async (text) => {
        const { processRequest } = await import("./client.js");
        window.detailChunks = "";
        window.detailJob = processRequest(
          {
            source: "trial",
            refresh: true,
            stream: true,
            action: {
              kind: "custom",
              mode: "whole",
              model: "default",
              instruction: "Stream",
            },
            blocks: [{ id: "one", text }],
          },
          undefined,
          (_id, text) => {
            window.detailChunks += text;
          },
        );
        window.detailJob.promise.catch(() => {});
      }, text);
      for (let i = 0; i < 100 && streams.length === count; i++)
        await new Promise((r) => setTimeout(r, 30));
      assert.equal(streams.length, count + 1);
      // An acknowledged delta ensures abort does not precede text delivery.
      await page.waitForFunction(() => window.detailChunks === "逐步");
      if (interrupted) streams.at(-1).interrupt();
      else await page.evaluate(() => window.detailJob.cancel());
      await page.waitForFunction(
        async (before) =>
          (await chrome.runtime.sendMessage({ type: "usage.list" })).value
            .length > before,
        before,
      );
      const record = (await list())[0];
      assert.equal(record.status, interrupted ? "error" : "cancelled");
      assert.equal((await detail(record.id)).output, "逐步");
    }
    await page.evaluate(async () =>
      (await import("./tests/local-store-fixture.mjs")).localStore.set({
        credentials: { "usage-fixture": "invalid-fixture" },
      }),
    );
    await assert.rejects(() => run("Failure input"));
    const failed = (await list())[0];
    assert.equal(failed.errorCode, "authError");
    assert.equal((await detail(failed.id)).input, "Failure input");
    assert.equal((await detail(failed.id)).output, "");
    await page.evaluate(async () =>
      (await import("./tests/local-store-fixture.mjs")).localStore.set({
        credentials: { "usage-fixture": "usage-fixture-secret" },
      }),
    );
    await Promise.all([run("Concurrent one"), run("Concurrent two")]);
    const concurrent = (await list()).slice(0, 2);
    assert.deepEqual(
      new Set(
        await Promise.all(
          concurrent.map(async (r) => (await detail(r.id)).input),
        ),
      ),
      new Set(["Concurrent one", "Concurrent two"]),
    );

    const records = await list();
    await page.reload();
    await open(batch.id);
    assert.equal(await page.locator(".usage-detail-pane").count(), 2);
    assert.equal(
      await page
        .locator(".usage-detail-pane")
        .first()
        .locator("pre")
        .first()
        .textContent(),
      JSON.stringify(JSON.parse(batchDetail.input), null, 2),
    );
    assert.equal(
      await page
        .locator(".usage-detail-pane")
        .last()
        .locator("pre")
        .textContent(),
      JSON.stringify(JSON.parse(batchDetail.output), null, 2),
    );
    await page.evaluate(() =>
      Promise.all(
        document.getAnimations().map((a) => a.finished.catch(() => {})),
      ),
    );
    await page
      .locator("dialog")
      .screenshot({ path: path.join(artifacts, "usage-details-light.png") });
    const scrollBefore = await page.evaluate(() => scrollY);
    const inputPane = page.locator(".usage-detail-content").first();
    await inputPane.hover();
    await page.mouse.wheel(0, 10000);
    await page.waitForFunction(
      () => document.querySelector(".usage-detail-content").scrollTop > 0,
    );
    await page.mouse.move(10, 500);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() => scrollY),
      scrollBefore,
      "Modal and backdrop scrolling never move the page",
    );
    await close();
    await page.mouse.move(1400, 500);
    await page.mouse.wheel(0, -300);
    await page.waitForFunction((before) => scrollY < before, scrollBefore);

    const htmlRecord = records.find(
      (r) => r.protocol === "gemini" && r.actionName === "Details fixture",
    );
    await open(htmlRecord.id);
    assert.equal(await page.locator("dialog script").count(), 0);
    assert.equal(await page.evaluate(() => window.detailInjected), undefined);
    assert((await page.locator("dialog").textContent()).includes("<script>"));
    await close();
    await open(failed.id);
    assert(
      (await page.locator(".usage-detail-error").textContent()).includes(
        "认证失败",
      ),
    );
    assert.equal(
      await page.locator(".usage-detail-empty").textContent(),
      "未收到输出。",
    );
    await close();
    // Existing records remain inspectable but do not invent content.
    await page.evaluate(
      async (record) =>
        (await import("./usage-store.js")).addUsage({
          ...record,
          id: "old-record",
        }),
      records[0],
    );
    await open("old-record");
    assert.equal(
      await page.locator(".usage-detail-empty").textContent(),
      "此次请求未记录详情。",
    );
    await close();
    await choose("#ui-locale", "en");
    await op("theme-menu").click();
    await page.locator("[data-op=theme-mode][data-value=dark]").click();
    await page.keyboard.press("Escape");
    await open(batch.id);
    assert.equal(
      await page.locator("#usage-detail-title").textContent(),
      "Request details",
    );
    await page.evaluate(() =>
      Promise.all(
        document.getAnimations().map((a) => a.finished.catch(() => {})),
      ),
    );
    await page
      .locator("dialog")
      .screenshot({ path: path.join(artifacts, "usage-details-dark.png") });
    await page.setViewportSize({ width: 420, height: 900 });
    assert(
      await page
        .locator("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    );
    await page.locator("dialog .dialog-close").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    await page.setViewportSize({ width: 1440, height: 1000 });

    source = await context.newPage();
    await source.goto(origin + "/usage-access");
    const denied = await page.evaluate(
      async ({ origin, id }) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => t.url === origin + "/usage-access");
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          args: [id],
          func: (id) =>
            chrome.runtime.sendMessage({ type: "usage.details", id }),
        });
        return result.result;
      },
      { origin, id: batch.id },
    );
    assert.equal(denied.error, "notAllowed");
    await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: "cache.clear" }),
    );
    assert.deepEqual(
      await detail(batch.id),
      batchDetail,
      "Clearing the result cache keeps request history",
    );
    await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: "usage.clear" }),
    );
    assert.deepEqual(await list(), []);
    assert.equal(await detail(batch.id), null);
    const remaining = await page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const request = indexedDB.open("aside-usage");
        request.onsuccess = () => resolve(request.result);
      });
      const count = await new Promise((resolve) => {
        const request = db
          .transaction("details")
          .objectStore("details")
          .count();
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return count;
    });
    assert.equal(
      remaining,
      0,
      "Clearing history removes all stored request bodies",
    );
  } finally {
    await source?.close();
    for (const stream of streams.slice(streamStart))
      if (!stream.closed) stream.interrupt();
    await page.evaluate(async (stored) => {
      await chrome.runtime.sendMessage({ type: "usage.clear" });
      await (
        await import("./tests/local-store-fixture.mjs")
      ).localStore.set(stored);
    }, stored);
    calls.splice(callStart);
    streams.splice(streamStart);
    await page.reload();
  }
  console.log(
    "PASS: usage details for four providers, context/batches, partial/cancelled/failed calls, concurrent persistence, safe modal display, local-only access and history deletion.",
  );
};
