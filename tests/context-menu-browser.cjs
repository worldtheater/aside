const assert = require("node:assert/strict");
module.exports = async ({ page, context, origin, calls, coldSource }) => {
  const original = (
    await page.evaluate(() => chrome.runtime.sendMessage({ type: "snapshot" }))
  ).value;
  const custom = {
    id: "menu-note",
    name: "Context menu note",
    instruction: "CONTEXT_MENU_ACTION: Explain this passage.",
    kind: "custom",
    icon: "spark",
    mode: "whole",
    placement: "panel",
    model: "default",
    quick: false,
  };
  const save = async (actions) => {
    const result = await page.evaluate(
      (actions) =>
        chrome.runtime.sendMessage({
          type: "settings.save",
          patch: { actions },
        }),
      actions,
    );
    assert(result.ok, JSON.stringify(result));
  };
  const registered = (id) =>
    page.evaluate(
      (id) =>
        new Promise((resolve) => {
          chrome.contextMenus.update(id, {}, () =>
            resolve(!chrome.runtime.lastError),
          );
        }),
      id,
    );
  // Capture the real compiled menu listener in the extension page. All APIs it
  // calls remain real; only registration is intercepted to avoid duplicate listeners.
  await page.evaluate(async () => {
    const events = [
      chrome.runtime.onInstalled,
      chrome.runtime.onMessage,
      chrome.runtime.onConnect,
      chrome.commands.onCommand,
      chrome.tabs.onActivated,
      chrome.tabs.onRemoved,
      chrome.tabs.onDetached,
      chrome.tabs.onAttached,
      chrome.tabs.onReplaced,
      chrome.contextMenus.onClicked,
    ];
    const original = events.map((event) => event.addListener);
    events.forEach((event) => {
      event.addListener = (listener) => {
        if (event === chrome.contextMenus.onClicked)
          globalThis.menuClick = listener;
      };
    });
    try {
      await import("./background.js?menu-test");
    } finally {
      events.forEach((event, i) => {
        event.addListener = original[i];
      });
    }
  });
  const source = await context.newPage();
  try {
    await save([...original.actions, custom]);
    assert(await registered("selection"));
    assert(await registered(`selection:${custom.id}`));
    assert(await registered("selection:summary"));
    const config = (
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: "settings.public" }),
      )
    ).value;
    await source.goto(origin + "/context-menu-selection");
    const host = source.locator("[data-pagework=ui]");
    await host.waitFor({ state: "attached" });
    const tabId = await page.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      source.url(),
    );
    const run = (actionId, text) =>
      page.evaluate(
        async ({ tabId, actionId, text }) => {
          await globalThis.menuClick(
            {
              menuItemId: `selection:${actionId}`,
              parentMenuItemId: "selection",
              selectionText: text,
            },
            await chrome.tabs.get(tabId),
          );
        },
        { tabId, actionId, text },
      );
    if (coldSource) {
      assert.equal(await coldSource.locator("[data-pagework=ui]").count(), 0);
      const worker = context
        .serviceWorkers()
        .find((worker) => worker.url().endsWith("/background.js"));
      await worker.evaluate(() => {
        globalThis.originalGet = chrome.storage.local.get;
        chrome.storage.local.get = async (...args) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return globalThis.originalGet.apply(chrome.storage.local, args);
        };
      });
      try {
        const tabsBefore = context.pages().length;
        await page.evaluate(async (url) => {
          const tab = (await chrome.tabs.query({})).find(
            (tab) => tab.url === url,
          );
          await globalThis.menuClick(
            {
              menuItemId: "selection:qa",
              parentMenuItemId: "selection",
              selectionText: "Cold page reference",
            },
            tab,
          );
        }, coldSource.url());
        await require("./inspect-ui.cjs").inspectUI(coldSource);
        assert.equal(
          context.pages().length,
          tabsBefore,
          "A page open before installation must not redirect to the homepage",
        );
        await coldSource.locator("[data-pagework=ui] #question").waitFor();
        assert.equal(await coldSource.locator("[data-pagework=ui]").count(), 1);
        assert.equal(
          await coldSource
            .locator("[data-pagework=ui] #question-quote")
            .innerText(),
          "Cold page reference",
        );
      } finally {
        await worker.evaluate(() => {
          chrome.storage.local.get = globalThis.originalGet;
          delete globalThis.originalGet;
        });
        await coldSource.close();
      }
    }
    const instructions = () => calls.at(-1).body.messages[0].content;
    for (const [id, text] of [
      [custom.id, "Menu custom action selection"],
      ["summary", "Menu summary action selection"],
      ["translate", "Menu translation action selection"],
    ]) {
      const before = calls.length;
      await run(id, text);
      await host.locator("#output").filter({ hasText: text }).waitFor();
      await host
        .locator("#result-status")
        .filter({ hasText: config.strings.done })
        .waitFor();
      assert.equal(calls.length, before + 1);
      assert(
        instructions().includes(
          config.actions.find((action) => action.id === id).instruction,
        ),
        instructions(),
      );
    }
    const tabsBefore = context.pages().length;
    const beforeQa = calls.length;
    await run("qa", "Context menu reference quote");
    await host.locator("#selection .selection-result-slot #question").waitFor();
    assert.equal(
      await host.locator("#question-quote").innerText(),
      "Context menu reference quote",
    );
    assert.equal(await host.locator("#question-input").inputValue(), "");
    assert.equal(calls.length, beforeQa);
    assert.equal(
      context.pages().length,
      tabsBefore,
      "Q&A does not open the extension homepage",
    );
    await host
      .locator("#question-input")
      .fill("Explain this context-menu quote");
    await host.locator("#question-input").press("Meta+Enter");
    await host
      .locator("#output")
      .filter({ hasText: "Explain this context-menu quote" })
      .waitFor();
    assert.equal(calls.length, beforeQa + 1);
    assert.equal(context.pages().length, tabsBefore);
    const before = calls.length;
    await save(original.actions);
    assert.equal(await registered(`selection:${custom.id}`), false);
    await run(custom.id, "Deleted action must not run");
    assert.equal(calls.length, before);
    console.log(
      "Context menu: cold-page readiness, in-panel Q&A/quote/shortcut/no redirect, custom/preset routing and deleted-action rejection passed.",
    );
  } finally {
    await source.close();
    await page.evaluate(() => {
      delete globalThis.menuClick;
    });
    await save(original.actions);
  }
};
