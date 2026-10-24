const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({
  page,
  context,
  origin,
  calls,
  artifacts,
  nav,
  op,
  choose,
  coldSource,
}) => {
  const extensionId = new URL(page.url()).hostname;
  const stored = await page.evaluate(() =>
    chrome.storage.local.get("settings"),
  );
  const binding = (name) => page.locator(`[data-command-binding="${name}"]`);
  const actualShortcut = (name) =>
    page.evaluate(
      async (name) =>
        (await chrome.commands.getAll()).find(
          (command) => command.name === name,
        ).shortcut,
      name,
    );
  let source, shortcutSettings, focusSession, settingsFocusSession;
  try {
    await nav("home");
    assert.equal(await page.locator(".home-shortcut").count(), 0);
    await nav("shortcuts");
    await page.waitForURL(/#shortcuts$/);
    assert.equal(
      await page
        .locator(".sidebar [aria-current=page]")
        .getAttribute("data-route"),
      "shortcuts",
    );
    const commands = await page.evaluate(() => chrome.commands.getAll());
    const listedCommands = ["switch-recent-tab", "quick-question"];
    assert.deepEqual(
      await page
        .locator("[data-command-binding]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.dataset.commandBinding),
        ),
      listedCommands,
    );
    assert(!commands.some((command) => command.name === "process-page"));
    // Chrome may return its built-in popup command; the plugin does not list it.
    for (const name of listedCommands) {
      const command = commands.find((command) => command.name === name);
      assert(command);
      assert.equal(
        await binding(name).innerText(),
        command.shortcut || "未设置",
      );
    }
    assert.equal(
      await actualShortcut("quick-question"),
      process.platform === "darwin" ? "⌥Q" : "Alt+Q",
    );
    await page.reload();
    await binding("quick-question").waitFor();
    await page.screenshot({
      path: path.join(artifacts, "shortcuts-light.png"),
      animations: "disabled",
    });

    // Disable Playwright's forced focus on both pages to exercise real return events.
    focusSession = await context.newCDPSession(page);
    const settingsOpened = context.waitForEvent("page");
    await op("shortcut-settings").click();
    shortcutSettings = await settingsOpened;
    await shortcutSettings.waitForURL("chrome://extensions/shortcuts");
    settingsFocusSession = await context.newCDPSession(shortcutSettings);
    const setShortcut = async (commandName, keybinding) => {
      await focusSession.send("Emulation.setFocusEmulationEnabled", {
        enabled: false,
      });
      await settingsFocusSession.send("Emulation.setFocusEmulationEnabled", {
        enabled: false,
      });
      await shortcutSettings.bringToFront();
      await shortcutSettings.evaluate(
        (update) => chrome.developerPrivate.updateExtensionCommand(update),
        { extensionId, commandName, keybinding },
      );
      await page.bringToFront();
      const actual = await actualShortcut(commandName);
      await page.waitForFunction(
        ({ name, expected }) =>
          document.querySelector(`[data-command-binding="${name}"]`)
            .textContent === expected,
        { name: commandName, expected: actual || "未设置" },
      );
    };
    await setShortcut("quick-question", "");
    await setShortcut("switch-recent-tab", "");
    await page.reload();
    await binding("quick-question").waitFor();
    assert.equal(await binding("quick-question").innerText(), "未设置");
    assert.equal(await binding("switch-recent-tab").innerText(), "未设置");
    const row = await binding("quick-question").elementHandle();
    await setShortcut("quick-question", "Alt+Shift+Y");
    assert(
      await row.evaluate(
        (node) =>
          node ===
          document.querySelector('[data-command-binding="quick-question"]'),
      ),
      "Returning from settings updates bindings in place",
    );
    await setShortcut("quick-question", "Alt+Q");
    await setShortcut("switch-recent-tab", "Alt+W");
    await settingsFocusSession.detach();
    settingsFocusSession = null;
    await shortcutSettings.close();
    shortcutSettings = null;
    await focusSession.send("Emulation.setFocusEmulationEnabled", {
      enabled: true,
    });
    await focusSession.detach();
    focusSession = null;

    await op("theme-menu").click();
    await page.locator('[data-op="theme-mode"][data-value="dark"]').click();
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: path.join(artifacts, "shortcuts-dark.png"),
      animations: "disabled",
    });
    await choose("#ui-locale", "en");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(artifacts, "shortcuts-mobile-en.png"),
      fullPage: true,
      animations: "disabled",
    });
    for (const width of [320, 768, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `Shortcuts fit ${width}px`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await choose("#ui-locale", "zh-CN");

    // Exercise the compiled command handler with real Chrome APIs. This does not synthesize an OS shortcut.
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
      const originals = events.map((event) => event.addListener);
      events.forEach((event) => {
        event.addListener = (listener) => {
          if (event === chrome.commands.onCommand)
            globalThis.shortcutCommand = listener;
        };
      });
      try {
        await import("./background.js?shortcut-test");
      } finally {
        events.forEach((event, i) => (event.addListener = originals[i]));
      }
    });
    const beforeBlocked = calls.length;
    const pagesBeforeBlocked = (
      await page.evaluate(() => chrome.tabs.query({}))
    ).length;
    await page.evaluate(async () =>
      globalThis.shortcutCommand(
        "quick-question",
        await chrome.tabs.getCurrent(),
      ),
    );
    assert.equal(
      (await page.evaluate(() => chrome.tabs.query({}))).length,
      pagesBeforeBlocked,
      "Q&A on the extension page does not open another tab",
    );
    assert.equal(await page.locator("[data-pagework=ui]").count(), 0);
    for (const url of [
      "about:blank",
      "chrome://newtab/",
      "chrome://extensions/",
    ]) {
      const tab = await page.evaluate(
        (url) => chrome.tabs.create({ url, active: false }),
        url,
      );
      const count = (await page.evaluate(() => chrome.tabs.query({}))).length;
      try {
        await page.evaluate(
          async (id) =>
            globalThis.shortcutCommand(
              "quick-question",
              await chrome.tabs.get(id),
            ),
          tab.id,
        );
        assert.equal(
          (await page.evaluate(() => chrome.tabs.query({}))).length,
          count,
          `${url} must not open settings`,
        );
        assert.equal(calls.length, beforeBlocked);
      } finally {
        await page.evaluate((id) => chrome.tabs.remove(id), tab.id);
      }
    }
    assert.equal(
      calls.length,
      beforeBlocked,
      "Non-web shortcuts never call a model",
    );
    source = coldSource || (await context.newPage());
    if (!coldSource) await source.goto(origin + "/shortcut-question");
    else assert.equal(await source.locator("[data-pagework=ui]").count(), 0);
    const tabId = await page.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      source.url(),
    );
    const trigger = () =>
      page.evaluate(
        async (id) =>
          globalThis.shortcutCommand(
            "quick-question",
            await chrome.tabs.get(id),
          ),
        tabId,
      );
    const selected = await source.locator("#first").innerText();
    await source.locator("#first").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    const before = calls.length;
    await trigger();
    if (coldSource) await require("./inspect-ui.cjs").inspectUI(source);
    const host = source.locator("[data-pagework=ui]");
    await host.locator("#result #question").waitFor();
    assert.equal(await host.locator("#question-quote").innerText(), selected);
    assert.equal(
      await host.locator("#result .header strong").innerText(),
      "快问快答",
    );
    assert(await host.locator("#selection").isHidden());
    assert(
      await host
        .locator("#question-input")
        .evaluate((node) => node.getRootNode().activeElement === node),
    );
    assert.equal(
      calls.length,
      before,
      "Opening Q&A waits for a question before calling the model",
    );
    await source.screenshot({
      path: path.join(artifacts, "shortcut-qa-selected.png"),
      animations: "disabled",
    });
    await host
      .locator("#question-input")
      .fill("Explain this selected passage. SHORTCUT_SELECTION");
    await host.locator("#question-input").press("Control+Enter");
    await host
      .locator("#output")
      .filter({ hasText: "SHORTCUT_SELECTION" })
      .waitFor();
    assert.equal(calls.length, before + 1);

    await host.locator('[data-op="close-result"]').click();
    await source.evaluate(() => {
      getSelection().removeAllRanges();
      const paragraph = document.createElement("p");
      paragraph.textContent =
        "OFFSCREEN_SHORTCUT_REFERENCE: include the whole page.";
      paragraph.style.marginTop = "1600px";
      document.querySelector("main").append(paragraph);
    });
    await trigger();
    await host.locator("#result #question").waitFor();
    const quote = await host.locator("#question-quote").innerText();
    assert(quote.includes(selected));
    assert(quote.includes(await source.locator("#second").innerText()));
    assert(
      quote.includes("OFFSCREEN_SHORTCUT_REFERENCE"),
      "Whole-page Q&A includes content below the viewport",
    );
    assert.equal(await host.locator("#question-input").inputValue(), "");
    assert.equal(calls.length, before + 1);
    await host
      .locator("#question-input")
      .fill("Summarize the quoted page. SHORTCUT_PAGE");
    await host.locator('[data-op="question-run"]').click();
    await host
      .locator("#output")
      .filter({ hasText: "SHORTCUT_PAGE" })
      .waitFor();
    assert.equal(calls.length, before + 2);
    assert(
      JSON.stringify(calls.at(-1).body).includes(
        "OFFSCREEN_SHORTCUT_REFERENCE",
      ),
    );
    await host.locator('[data-op="close-result"]').click();
    await trigger();
    await host.locator("#result #question").waitFor();
    await host.locator('[data-op="question-clear-quote"]').press("Enter");
    assert.equal(await host.locator("#question-quote").count(), 0);
    assert(await host.locator('[data-op="question-run"]').isDisabled());
    assert(
      await host
        .locator("#question-input")
        .evaluate((node) => node.getRootNode().activeElement === node),
    );
    assert.equal(calls.length, before + 2);
    await host
      .locator("#question-input")
      .fill("An independent question. SHORTCUT_CLEARED");
    await host.locator('[data-op="question-run"]').click();
    await host
      .locator("#output")
      .filter({ hasText: "SHORTCUT_CLEARED" })
      .waitFor();
    assert.equal(calls.length, before + 3);
    const clearedRequest = JSON.stringify(calls.at(-1).body);
    assert(!clearedRequest.includes("OFFSCREEN_SHORTCUT_REFERENCE"));
    assert(
      !clearedRequest.includes(selected),
      "Whole-page content stays cleared when the question is submitted",
    );
    console.log(
      "PASS: shortcuts navigation/deep link, actual bindings and settings refresh, responsive themes; Q&A command cold-page entry, selection-first/full-page quotes, focused composer and explicit submission.",
    );
  } finally {
    if (settingsFocusSession) await settingsFocusSession.detach();
    if (shortcutSettings) await shortcutSettings.close();
    if (focusSession) {
      await focusSession.send("Emulation.setFocusEmulationEnabled", {
        enabled: true,
      });
      await focusSession.detach();
    }
    if (source) await source.close();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate((stored) => chrome.storage.local.set(stored), stored);
    await nav("connections");
    // Reload so the next suite reads the restored settings, not this suite's draft.
    await page.reload();
    await op("test-connection").waitFor();
  }
};
