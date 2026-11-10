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
    chrome.permissions.request = async (permissions) => {
      state.requests.push(permissions);
      if (state.useNative) {
        const granted = await request(permissions);
        if (!granted || !state.defer) {
          state.granted = granted;
          return granted;
        }
      }
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

    const host = source.locator("[data-pagework=ui]");
    const selectionResult = host.locator("#result");
    const waiting = selectionResult
      .locator("#result-status")
      .filter({ hasText: "等待授权…" });
    const translateSelection = host.locator(
      "[data-selection-action=translate]",
    );
    const select = async (selector) => {
      await source.locator(selector).dblclick({ position: { x: 14, y: 10 } });
      const text = await source.evaluate(() =>
        getSelection().toString().trim(),
      );
      assert(text);
      await translateSelection.click();
      return text;
    };
    const clearPermission = () =>
      worker.evaluate(() => {
        Object.assign(popupPermissionTest, {
          granted: false,
          resolve: null,
          texts: [],
          requests: [],
        });
      });
    await clearPermission();
    await select("#first");
    await pending();
    await waiting.waitFor();
    assert.equal(await host.locator("[data-op=allow-microsoft]").count(), 0);
    await worker.evaluate(() => popupPermissionTest.resolve(false));
    await selectionResult.waitFor({ state: "hidden" });
    assert(await translateSelection.isEnabled());
    assert.deepEqual(
      await worker.evaluate(() => popupPermissionTest.texts),
      [],
    );

    await worker.evaluate(() => {
      popupPermissionTest.resolve = null;
    });
    await translateSelection.click();
    await pending();
    await source.keyboard.press("Escape");
    await selectionResult.waitFor({ state: "hidden" });
    await worker.evaluate(() => popupPermissionTest.resolve(true));

    // Use the actual permission API for the final click. Chromium checks user
    // activation even when this isolated profile already has the origin grant.
    const manager = context
      .pages()
      .find((p) => /^(chrome|edge):\/\/extensions\/$/.test(p.url()));
    assert(manager, "The browser's extension manager is open");
    await manager.evaluate(
      (id) =>
        chrome.developerPrivate.addHostPermission(
          id,
          "https://edge.microsoft.com/*",
        ),
      new URL(page.url()).hostname,
    );
    assert.deepEqual(
      await worker.evaluate(() => popupPermissionTest.texts),
      [],
    );
    await clearPermission();
    await worker.evaluate(() => {
      popupPermissionTest.useNative = true;
    });
    const selected = await select("#second");
    await pending();
    await waiting.waitFor();
    // The original selection remains the input even after the DOM range clears.
    await source.evaluate(() => getSelection().removeAllRanges());
    await worker.evaluate(() => popupPermissionTest.resolve(true));
    await host
      .locator("#output")
      .filter({ hasText: "微软测试译文：" + selected })
      .waitFor();
    assert.deepEqual(await worker.evaluate(() => popupPermissionTest.texts), [
      selected,
    ]);
    assert.deepEqual(
      await worker.evaluate(() => popupPermissionTest.requests),
      [{ origins: ["https://edge.microsoft.com/*"] }],
    );
    await source.keyboard.press("Escape");
    console.log(
      "PASS: selection authorization can be denied or cancelled, and a trusted click resumes the original selection exactly once.",
    );

    const dock = host.locator("#dock");
    const translate = host.locator("#radial [data-op=page-translate]");
    const first = source.locator("#first");
    const firstResult = first.locator("[data-pagework=result]");
    const setFirst = (text) =>
      first.evaluate((node, text) => {
        node.textContent = text;
      }, text);
    const waitForFirstTranslation = (text) =>
      source.waitForFunction(
        (expected) =>
          document.querySelector("#first [data-pagework=result]")?.shadowRoot
            .textContent ===
          "微软测试译文：" + expected,
        text,
      );
    const initialText = "Translate directly from the floating control.";
    await setFirst(initialText);
    await clearPermission();
    await worker.evaluate(() => {
      popupPermissionTest.useNative = false;
    });
    await dock.click();
    await translate.click();
    await pending();
    await translate.click();
    assert.deepEqual(
      await worker.evaluate(() => popupPermissionTest.requests),
      [{ origins: ["https://edge.microsoft.com/*"] }],
    );
    await worker.evaluate(() => popupPermissionTest.resolve(false));
    await host.locator("#notice").filter({ hasText: "已停止" }).waitFor();
    assert.equal(await firstResult.count(), 0);
    assert.deepEqual(
      await worker.evaluate(() => popupPermissionTest.texts),
      [],
    );

    await clearPermission();
    await worker.evaluate(() => {
      popupPermissionTest.useNative = true;
      popupPermissionTest.defer = false;
    });
    await translate.click();
    await waitForFirstTranslation(initialText);
    assert.deepEqual(
      await worker.evaluate(() => popupPermissionTest.requests),
      [{ origins: ["https://edge.microsoft.com/*"] }],
    );
    assert.equal(
      (await worker.evaluate(() => popupPermissionTest.texts)).filter(
        (text) => text === initialText,
      ).length,
      1,
    );

    await clearPermission();
    const updatedText = "Continue this page after restoring permission.";
    await setFirst(updatedText);
    const recovery = host.locator("#translation-recovery");
    const authorizePage = recovery.getByRole("button", {
      name: "授权并翻译",
    });
    await authorizePage.waitFor();
    assert((await recovery.textContent()).includes("文字会发送到微软"));
    await authorizePage.click();
    await waitForFirstTranslation(updatedText);
    await recovery.waitFor({ state: "hidden" });
    assert.deepEqual(await worker.evaluate(() => popupPermissionTest.texts), [
      updatedText,
    ]);
    console.log(
      "PASS: the floating control requests Microsoft permission on the first click, continues after grant, and reauthorizes a paused session.",
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
