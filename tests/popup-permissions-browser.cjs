const assert = require("node:assert/strict");

module.exports = async ({ page, context, source, popup, tab }) => {
  const worker = context
    .serviceWorkers()
    .find((item) => item.url().endsWith("/background.js"));
  const sourceURL = source.url();
  let nextPopup;
  await worker.evaluate(() => {
    const request = chrome.permissions.request.bind(chrome.permissions);
    const contains = chrome.permissions.contains.bind(chrome.permissions);
    const send = chrome.tabs.sendMessage.bind(chrome.tabs);
    const fetch = globalThis.fetch;
    globalThis.popupPermissionTest = {
      requests: [],
      texts: [],
      runs: 0,
      defer: false,
      granted: false,
    };
    const state = globalThis.popupPermissionTest;
    state.restore = () => {
      chrome.permissions.request = request;
      chrome.permissions.contains = contains;
      chrome.tabs.sendMessage = send;
      globalThis.fetch = fetch;
    };
    chrome.permissions.request = (permissions) => {
      state.requests.push(permissions);
      if (!state.defer) return Promise.resolve(false);
      return new Promise((resolve) => {
        state.resolve = (granted) => {
          state.granted = granted;
          resolve(granted);
        };
        state.notify?.();
      });
    };
    chrome.permissions.contains = (permissions) =>
      permissions.origins?.length === 1 &&
      permissions.origins[0] === "https://edge.microsoft.com/*"
        ? Promise.resolve(state.granted)
        : contains(permissions);
    chrome.tabs.sendMessage = (id, message, ...args) => {
      if (message.type === "page.run") state.runs++;
      return send(id, message, ...args);
    };
    globalThis.fetch = (url, options) => {
      if (
        String(url).startsWith(
          "https://edge.microsoft.com/translate/translatetext",
        )
      ) {
        const texts = JSON.parse(options.body);
        state.texts.push(...texts);
        return Promise.resolve(
          new Response(
            JSON.stringify(
              texts.map((text) => ({
                translations: [{ text: "微软测试译文：" + text }],
              })),
            ),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }
      return fetch(url, options);
    };
  });
  const pending = () =>
    worker.evaluate(async () => {
      if (!popupPermissionTest.resolve)
        await new Promise((resolve) => {
          popupPermissionTest.notify = resolve;
        });
    });
  try {
    await popup.locator('[data-op="run"]').click();
    await popup.locator("#status").filter({ hasText: "授权" }).waitFor();
    assert.deepEqual(
      await worker.evaluate(() => popupPermissionTest.requests),
      [{ origins: ["https://edge.microsoft.com/*"] }],
    );
    assert(await popup.locator('[data-op="run"]').isEnabled());
    assert.equal(await worker.evaluate(() => popupPermissionTest.runs), 0);
    assert.deepEqual(
      await worker.evaluate(() => popupPermissionTest.texts),
      [],
    );

    // A native permission prompt can close the action popup. Its lifetime must
    // not own the pending translation; grant access after that page is gone.
    await worker.evaluate(() => {
      popupPermissionTest.defer = true;
    });
    await popup.locator('[data-op="run"]').click();
    await pending();
    await popup.close();
    await worker.evaluate(() => {
      popupPermissionTest.resolve(true);
    });
    await source.locator("[data-pagework=result]").first().waitFor();
    await source
      .locator("[data-pagework=ui] #status")
      .filter({ hasText: "处理完成" })
      .waitFor({ state: "attached" });
    assert.equal(await worker.evaluate(() => popupPermissionTest.runs), 1);
    assert((await worker.evaluate(() => popupPermissionTest.texts.length)) > 0);
    await page.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: "tab.restore", tabId }),
      tab.id,
    );

    nextPopup = await context.newPage();
    await nextPopup.addInitScript((tab) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (info) =>
        info.active ? Promise.resolve([tab]) : query(info);
    }, tab);
    await nextPopup.goto(new URL("popup.html", page.url()).href);
    await worker.evaluate(() => {
      popupPermissionTest.resolve = null;
    });
    await nextPopup.locator('[data-op="run"]').click();
    await pending();
    await source.goto(new URL("/permission-navigation", sourceURL).href);
    await worker.evaluate(() => {
      popupPermissionTest.resolve(true);
    });
    await nextPopup.waitForFunction(
      () => !document.querySelector('[data-op="run"]').disabled,
    );
    assert.equal(
      await worker.evaluate(() => popupPermissionTest.runs),
      1,
      "A pending authorization cannot translate a different document",
    );
    assert.equal(await source.locator("[data-pagework=result]").count(), 0);
    await source.goto(sourceURL);
    await source.locator("[data-pagework=ui] #dock").waitFor();
    console.log(
      "PASS: denied Microsoft permission stays retryable; granting after popup closure resumes exactly one page request; navigation cancels the pending request.",
    );
  } catch (error) {
    console.log(
      "Permission continuation state",
      await worker.evaluate(() => ({
        requests: popupPermissionTest.requests,
        runs: popupPermissionTest.runs,
        texts: popupPermissionTest.texts,
      })),
    );
    console.log(
      "Page translation state",
      await source.locator("[data-pagework=ui] #status").textContent(),
      await source
        .locator("[data-pagework=ui] #translation-recovery")
        .textContent(),
    );
    throw error;
  } finally {
    await worker.evaluate(() => {
      popupPermissionTest.resolve?.(false);
      popupPermissionTest.restore();
      delete globalThis.popupPermissionTest;
    });
    await nextPopup?.close();
  }
};
