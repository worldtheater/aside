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
}) => {
  const original = (
    await page.evaluate(() => chrome.runtime.sendMessage({ type: "snapshot" }))
  ).value;
  const { OUTPUT_LENGTH_PROMPTS } = await import("../prompts.js");
  const saved = async () =>
    (
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: "snapshot" }),
      )
    ).value.actions.find((action) => action.id === "qa");
  const wire = () => calls.at(-1).body.messages[0].content;
  let source;
  try {
    await choose("#ui-locale", "zh-CN");
    await page.evaluate(async (actions) => {
      const { getPresets } = await import("./data.js");
      const qa = getPresets().find((action) => action.id === "qa");
      const result = await chrome.runtime.sendMessage({
        type: "settings.save",
        patch: {
          actions: actions.map((action) => (action.id === "qa" ? qa : action)),
        },
      });
      if (!result.ok) throw Error(JSON.stringify(result));
    }, original.actions);
    await page.reload();
    await page.locator("h1").waitFor();
    await nav("actions");
    await page.locator("[data-op=edit-action][data-id=qa]").click();
    assert.equal(
      await page.locator("[data-draft=outputLength]").inputValue(),
      "brief",
    );
    assert.equal(
      await page.locator("[data-language=outputLanguage]").inputValue(),
      "interface",
    );
    await choose("[data-draft=outputLength]", "detailed");
    await choose("[data-language=outputLanguage]", "en");
    await page.locator("#test-input").fill("Why does ice float? QA_TRIAL");
    await op("test-run").click();
    await page.locator(".result-paper").waitFor();
    assert(wire().includes(OUTPUT_LENGTH_PROMPTS.detailed));
    assert(wire().includes("Output language: en."));
    await op("save").click();
    await page.waitForFunction(
      async () =>
        (
          await chrome.runtime.sendMessage({ type: "snapshot" })
        ).value.actions.find((a) => a.id === "qa").outputLength === "detailed",
    );
    await page.screenshot({
      path: path.join(artifacts, "qa-editor-light.png"),
      fullPage: true,
    });
    await page.reload();
    await nav("actions");
    await page.locator("[data-op=edit-action][data-id=qa]").click();
    assert.equal(
      await page.locator("[data-draft=outputLength]").inputValue(),
      "detailed",
    );
    assert.equal(
      await page.locator("[data-language=outputLanguage]").inputValue(),
      "en",
    );
    await choose("[data-draft=outputLength]", "balanced");
    await op("save").click();
    await page.waitForFunction(
      async () =>
        (
          await chrome.runtime.sendMessage({ type: "snapshot" })
        ).value.actions.find((a) => a.id === "qa").outputLength === "balanced",
    );
    source = await context.newPage();
    await source.goto(origin + "/qa-selection");
    const host = source.locator("[data-pagework=ui]"),
      bar = host.locator("#selection"),
      question = host.locator("#question");
    await host.waitFor({ state: "attached" });
    const assertComposerFits = async () => {
      const layout = await question.evaluate((panel) => {
        const body = panel.querySelector(".selection-settings");
        const input = panel.querySelector("textarea");
        const footer = panel.querySelector(".selection-settings-footer");
        const quote = panel.querySelector("blockquote");
        const box = (node) => node.getBoundingClientRect().toJSON();
        const lineFits = (node) => {
          const style = getComputedStyle(node);
          return (
            node.clientHeight -
              parseFloat(style.paddingTop) -
              parseFloat(style.paddingBottom) >=
            parseFloat(style.lineHeight) - 1
          );
        };
        return {
          body: box(body),
          input: box(input),
          footer: box(footer),
          paddingBottom: parseFloat(getComputedStyle(body).paddingBottom),
          inputLineFits: lineFits(input),
          quote: quote ? box(quote) : null,
          quoteLineFits: !quote || lineFits(quote),
        };
      });
      assert(layout.input.top >= layout.body.top, JSON.stringify(layout));
      assert(
        layout.input.bottom <= layout.body.bottom - layout.paddingBottom + 1,
        "The complete input border stays inside the form, above the footer: " +
          JSON.stringify(layout),
      );
      assert(
        layout.body.bottom <= layout.footer.top + 1,
        JSON.stringify(layout),
      );
      assert(layout.inputLineFits, "The input retains a readable line");
      assert(layout.quoteLineFits, "The quote retains a readable line");
      if (layout.quote)
        assert(layout.quote.bottom < layout.input.top, JSON.stringify(layout));
    };
    const select = async () => {
      await source.keyboard.press("Escape");
      await source.locator("#first").evaluate((node) => {
        node.textContent = "Why do leaves change color? QA_SELECTION";
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
      const box = await source.locator("#first").boundingBox();
      await source.mouse.move(box.x + 4, box.y + 4);
      await source.mouse.up();
      await bar.waitFor();
      assert(
        await bar.locator("[data-selection-action=qa]").isHidden(),
        "Q&A follows the first three enabled actions",
      );
      await bar.locator("[data-selection-command=expand]").click();
      assert(await bar.locator("[data-selection-action=qa]").isVisible());
    };
    await select();
    const beforeSelectionQuestion = calls.length;
    const toolbarPosition = await bar.boundingBox();
    await bar.locator("[data-selection-action=qa]").click();
    await question.waitFor();
    assert.equal(
      await bar.locator(".selection-result-slot #question").count(),
      1,
    );
    assert(await bar.locator(".selection-toolbar-row").isVisible());
    assert.equal(await host.locator(".panel.question-panel").count(), 0);
    const openedPosition = await bar.boundingBox();
    assert(Math.abs(openedPosition.x - toolbarPosition.x) < 1);
    assert(
      Math.abs(openedPosition.y - toolbarPosition.y) < 1,
      "Toolbar Q&A expands in place",
    );
    await assertComposerFits();
    const input = question.locator("textarea");
    assert.equal(await input.evaluate((node) => getComputedStyle(node).resize), "none");
    const minimumInput = await input.boundingBox();
    assert(minimumInput.height >= 96);
    await input.fill(Array.from({ length: 10 }, (_, i) => `Question line ${i + 1}`).join("\n"));
    assert((await input.boundingBox()).height > minimumInput.height + 80);
    await input.fill("");
    assert(Math.abs((await input.boundingBox()).height - minimumInput.height) < 1);
    const beforeKeyboardResize = await bar.boundingBox();
    await bar.locator(".selection-resize").press("Shift+ArrowRight");
    assert(Math.abs((await bar.boundingBox()).width - beforeKeyboardResize.width - 40) < 1,
      "A resize handle nested in the result changes its enclosing toolbar window");
    await bar.locator(".selection-resize").press("Shift+ArrowLeft");
    // A short height can be inherited from another result, or set by resizing.
    for (let i = 0; i < 6; i++) {
      await bar.locator(".selection-resize").press("Shift+ArrowUp");
    }
    await question.locator("textarea").focus();
    await assertComposerFits();
    await bar.screenshot({
      path: path.join(artifacts, "qa-compact-quote-light.png"),
    });
    const resizeHandle = await bar.locator(".selection-resize").boundingBox();
    await source.mouse.move(
      resizeHandle.x + resizeHandle.width / 2,
      resizeHandle.y + resizeHandle.height / 2,
    );
    await source.mouse.down();
    await source.mouse.move(
      resizeHandle.x + resizeHandle.width / 2 + 120,
      resizeHandle.y + resizeHandle.height / 2 + 70,
      { steps: 6 },
    );
    await source.mouse.up();
    assert((await bar.boundingBox()).width > openedPosition.width + 100);
    const grip = await bar.locator(".selection-spacer").boundingBox();
    const beforeDrag = await bar.boundingBox();
    await source.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await source.mouse.down();
    await source.mouse.move(
      grip.x + grip.width / 2 + 35,
      grip.y + grip.height / 2 + 25,
      { steps: 6 },
    );
    await source.mouse.up();
    const composedPosition = await bar.boundingBox();
    assert(Math.abs(composedPosition.x - beforeDrag.x - 35) < 2);
    assert(Math.abs(composedPosition.y - beforeDrag.y - 25) < 2);
    assert.equal(await question.locator("textarea").inputValue(), "");
    assert.equal(
      await question.locator("#question-quote").textContent(),
      "Why do leaves change color? QA_SELECTION",
    );
    assert(await question.locator("[data-op=question-run]").isDisabled());
    assert.equal(
      calls.length,
      beforeSelectionQuestion,
      "Selecting Q&A opens a composer without sending the quote",
    );
    await question
      .locator("textarea")
      .fill("Explain the mechanism. QA_TOOLBAR_QUESTION");
    await question.locator("[data-op=question-run]").click();
    await host
      .locator("#result-status")
      .filter({ hasText: "处理完成" })
      .waitFor();
    const answerPosition = await bar.boundingBox();
    assert(Math.abs(answerPosition.x - composedPosition.x) < 1);
    assert(
      Math.abs(answerPosition.y - composedPosition.y) < 1,
      "Answer stays in the same panel",
    );
    assert(Math.abs(answerPosition.width - composedPosition.width) < 1);
    assert(wire().includes(OUTPUT_LENGTH_PROMPTS.balanced));
    assert(wire().includes("Output language: en."));
    await select();
    await bar.locator("[data-selection-action=qa]").click();
    await question.waitFor();
    const withoutQuote = "Answer this alone. QA_CLEAR_QUOTE";
    await input.fill(withoutQuote);
    const beforeClear = calls.length;
    await question.locator("[data-op=question-clear-quote]").click();
    assert.equal(await question.locator(".question-reference").count(), 0);
    assert.equal(await input.inputValue(), withoutQuote);
    assert(await input.evaluate(node => node.getRootNode().activeElement === node));
    assert(await question.locator("[data-op=question-run]").isEnabled());
    assert.equal(calls.length, beforeClear, "Clearing a quote does not call the model");
    await assertComposerFits();
    await bar.screenshot({path:path.join(artifacts,"qa-cleared-quote-light.png"),animations:"disabled"});
    await input.press("Control+Enter");
    await host.locator("#result-status").filter({hasText:"处理完成"}).waitFor();
    assert.equal(calls.length, beforeClear + 1);
    assert(JSON.stringify(calls.at(-1).body).includes(withoutQuote));
    assert(!JSON.stringify(calls.at(-1).body).includes("Why do leaves change color? QA_SELECTION"), "Cleared page selection is not sent as reference or restored during submission");
    await select();
    await bar.locator("[data-selection-command=settings]").click();
    const length = bar.locator("[data-selection-field=outputLength]");
    assert.equal(await length.inputValue(), "balanced");
    const beforeSave = calls.length;
    await length.selectOption("brief");
    await bar
      .locator("[data-selection-field=outputLanguage]")
      .selectOption("ja");
    await bar.screenshot({
      path: path.join(artifacts, "qa-selection-settings.png"),
    });
    await bar.locator("[data-selection-command=save]").click();
    await bar.locator(".selection-settings").waitFor({ state: "hidden" });
    assert.equal((await saved()).outputLength, "brief");
    assert.equal((await saved()).outputLanguage, "ja");
    assert.equal(calls.length, beforeSave);
    const tabId = await page.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((t) => t.url === url).id,
      source.url(),
    );
    await page.evaluate(
      (tabId) =>
        chrome.tabs.sendMessage(tabId, {
          type: "selection.process",
          actionId: "qa",
          text: "Why is the sky blue? QA_MENU",
        }),
      tabId,
    );
    await question.waitFor();
    assert.equal(
      await question.locator("#question-quote").textContent(),
      "Why is the sky blue? QA_MENU",
    );
    assert.equal(await question.locator("textarea").inputValue(), "");
    await question
      .locator("textarea")
      .fill("Give the physical reason. QA_MENU_QUESTION");
    await source.keyboard.press("Control+Enter");
    await host
      .locator("#result-status")
      .filter({ hasText: "处理完成" })
      .waitFor();
    assert(wire().includes(OUTPUT_LENGTH_PROMPTS.brief));
    assert(wire().includes("Output language: ja."));
    const malformed = { ...(await saved()), outputLength: "invalid" };
    for (const request of [
      { type: "actions.save", changes: [malformed] },
      {
        type: "settings.save",
        patch: {
          actions: original.actions.map((a) => (a.id === "qa" ? malformed : a)),
        },
      },
    ]) {
      const result = await page.evaluate(
        (request) => chrome.runtime.sendMessage(request),
        request,
      );
      assert.equal(result.error, "invalidAction");
    }
    assert.equal((await saved()).outputLength, "brief");
    const dock = host.locator("#dock"),
      radial = host.locator("#radial");
    const openQuestion = async () => {
      await dock.click();
      await radial.locator("[data-op=quick-question]").click();
      await question.waitFor();
      assert.equal(
        await bar.locator(".selection-result-slot #question").count(),
        1,
      );
      assert(await bar.locator(".selection-toolbar-row").isVisible());
      const box = await bar.boundingBox(),
        dockBox = await dock.boundingBox();
      assert(
        box.x + box.width <= dockBox.x - 6,
        "Floating Q&A opens beside the dock",
      );
    };
    const assertDockCollapsed = async () => {
      assert(await bar.isHidden(), "The dock's Q&A panel is closed");
      assert(await host.locator("#result").isHidden());
      assert(await host.locator("#toolbar").isHidden());
      assert.equal(await dock.getAttribute("aria-expanded"), "false");
      assert.equal(
        await radial.evaluate((node) => node.classList.contains("open")),
        false,
      );
      assert.equal(
        await dock.evaluate((node) => node.classList.contains("radial-open")),
        false,
      );
    };
    await source.keyboard.press("Escape");
    await source.evaluate(() => getSelection().removeAllRanges());
    let beforeQuestion = calls.length;
    await openQuestion();
    assert.equal(await question.locator("textarea").inputValue(), "");
    assert(await question.locator("[data-op=question-run]").isDisabled());
    assert.equal(calls.length, beforeQuestion);
    assert.equal(await question.locator("#question-quote").count(), 0);
    assert.equal(await question.locator("[data-op=question-clear-quote]").count(), 0);
    await source.keyboard.press("Meta+Enter");
    assert(await question.isVisible());
    assert.equal(
      calls.length,
      beforeQuestion,
      "Empty questions cannot submit by keyboard",
    );
    await question.locator("textarea").fill("   ");
    assert(await question.locator("[data-op=question-run]").isDisabled());
    await source.keyboard.press("Meta+Enter");
    assert.equal(calls.length, beforeQuestion);
    await question.locator("textarea").fill("A cancelled question");
    await question.locator("[data-op=question-close]").last().click();
    assert(await question.isHidden());
    assert.equal(calls.length, beforeQuestion);
    await openQuestion();
    await question
      .locator("textarea")
      .fill("Close this draft with the floating button");
    assert.equal(await dock.getAttribute("aria-expanded"), "true");
    await dock.click();
    await assertDockCollapsed();
    assert.equal(
      calls.length,
      beforeQuestion,
      "Closing a draft never sends it",
    );
    // The next click opens only the shortcut menu; it does not revive the panel.
    await dock.click();
    assert(await question.isHidden());
    assert.equal(
      await radial.evaluate((node) => node.classList.contains("open")),
      true,
    );
    await dock.click();
    await assertDockCollapsed();
    await openQuestion();
    await question.locator("textarea").fill("First line");
    await source.keyboard.press("Enter");
    assert.equal(
      await question.locator("textarea").inputValue(),
      "First line\n",
    );
    assert.equal(
      calls.length,
      beforeQuestion,
      "Plain Enter inserts a newline without sending",
    );
    await question
      .locator("textarea")
      .fill("Why do stars twinkle? QA_DOCK_TYPED");
    await assertComposerFits();
    await bar.screenshot({
      path: path.join(artifacts, "qa-dock-question-light.png"),
      animations: "disabled",
    });
    await source.keyboard.press("Meta+Enter");
    assert(await question.isHidden());
    await host
      .locator("#output")
      .filter({ hasText: "QA_DOCK_TYPED" })
      .waitFor();
    await host
      .locator("#result-status")
      .filter({ hasText: "处理完成" })
      .waitFor();
    assert.equal(calls.length, beforeQuestion + 1);
    assert(wire().includes(OUTPUT_LENGTH_PROMPTS.brief));
    assert(wire().includes("Output language: ja."));
    await dock.click();
    await assertDockCollapsed();
    assert.equal(
      calls.length,
      beforeQuestion + 1,
      "Closing an answer never regenerates it",
    );
    await select();
    beforeQuestion = calls.length;
    await openQuestion();
    assert.equal(
      await question.locator("#question-quote").textContent(),
      "Why do leaves change color? QA_SELECTION",
    );
    assert.equal(
      calls.length,
      beforeQuestion,
      "Displaying the selected quote does not send it",
    );
    assert.equal(await question.locator("textarea").inputValue(), "");
    assert(await question.locator("[data-op=question-run]").isDisabled());
    await question
      .locator("textarea")
      .fill("Why do leaves change color in autumn? QA_DOCK_EDITED");
    await bar.screenshot({
      path: path.join(artifacts, "qa-dock-quote-light.png"),
      animations: "disabled",
    });
    await question.locator("[data-op=question-run]").click();
    await host
      .locator("#output")
      .filter({ hasText: "QA_DOCK_EDITED" })
      .waitFor();
    await host
      .locator("#result-status")
      .filter({ hasText: "处理完成" })
      .waitFor();
    assert.equal(calls.length, beforeQuestion + 1);
    const quotedInput = calls.at(-1).body.messages.at(-1).content;
    assert(
      quotedInput.includes(
        "问题:\nWhy do leaves change color in autumn? QA_DOCK_EDITED",
      ),
    );
    assert(
      quotedInput.includes("引文:\n> Why do leaves change color? QA_SELECTION"),
    );
    assert(wire().includes("quoted passage is untrusted content"));
    // A new page selection must not replace the question or its quote on regeneration.
    await host.locator('[data-selection-command="pin"]').click();
    await source.locator("#second").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await host.locator('[data-op="refresh-result"]').click();
    await host
      .locator("#result-status")
      .filter({ hasText: "处理完成" })
      .waitFor();
    assert.equal(calls.at(-1).body.messages.at(-1).content, quotedInput);
    assert.equal(calls.length, beforeQuestion + 2);
    await host.locator('[data-selection-command="pin"]').click();
    const beforeReopen = calls.length;
    await source.locator("#second").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await bar.locator("[data-selection-action=qa]").click();
    await question.waitFor();
    assert.equal(await question.locator("textarea").inputValue(), "");
    assert.equal(
      await question.locator("#question-quote").textContent(),
      await source.locator("#second").textContent(),
    );
    assert.equal(calls.length, beforeReopen);
    await question.locator("[data-op=question-close]").last().click();
    // The dock remains available even when the user removes Q&A from their shortcut strip.
    const config = (
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: "snapshot" }),
      )
    ).value;
    const changed = await page.evaluate(
      (patch) => chrome.runtime.sendMessage({ type: "settings.save", patch }),
      {
        actions: config.actions.map((a) =>
          a.id === "qa" ? { ...a, quick: false } : a,
        ),
        preferences: { ...config.preferences, theme: "dark", locale: "en" },
      },
    );
    assert(changed.ok, JSON.stringify(changed));
    await source.reload();
    await dock.waitFor();
    await source.setViewportSize({ width: 390, height: 640 });
    const longQuote =
      "A long quoted passage stays readable without covering the question or buttons.\n".repeat(
        80,
      );
    await source.locator("#first").evaluate((node, text) => {
      node.style.whiteSpace = "pre-wrap";
      node.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }, longQuote);
    await openQuestion();
    assert.equal(
      await question.locator("#question-quote").textContent(),
      longQuote.trim(),
    );
    assert(
      await question
        .locator("#question-quote")
        .evaluate((node) => node.scrollHeight > node.clientHeight),
    );
    assert.equal(await question.locator("textarea").inputValue(), "");
    assert.equal((await saved()).quick, false);
    await question
      .locator("textarea")
      .fill("A question from the floating menu");
    const rect = await bar.boundingBox();
    assert(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= 390 &&
        rect.y + rect.height <= 640,
      JSON.stringify(rect),
    );
    for (let i = 0; i < 6; i++) {
      await bar.locator(".selection-resize").press("Shift+ArrowUp");
    }
    await question.locator("textarea").focus();
    await assertComposerFits();
    await bar.screenshot({
      path: path.join(artifacts, "qa-dock-question-dark-mobile.png"),
      animations: "disabled",
    });
    beforeQuestion = calls.length;
    await dock.click();
    await assertDockCollapsed();
    await source.mouse.move(0, 0);
    await source.screenshot({
      path: path.join(artifacts, "qa-dock-collapsed-dark-mobile.png"),
      animations: "disabled",
    });
    assert.equal(calls.length, beforeQuestion);
    console.log(
      "PASS: Dock click closes Q&A drafts/answers and collapses the menu; reopening works; Q&A reuses the toolbar panel in place or beside the dock; shared drag/resize and stable answer position; quotes stay separate from questions; Cmd/Ctrl+Enter submission, empty/newline guards, no automatic request, regeneration preserves the source, shared settings and long-quote mobile/dark layout.",
    );
  } finally {
    await source?.close();
    await page.evaluate(
      (patch) => chrome.runtime.sendMessage({ type: "settings.save", patch }),
      { actions: original.actions, preferences: original.preferences },
    );
  }
};
