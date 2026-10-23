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
  const resize = async (browserPage, panel, dx, dy) => {
    const handle = await panel.locator(".selection-resize").boundingBox();
    assert(handle, "The panel exposes a resize handle");
    const x = handle.x + handle.width / 2,
      y = handle.y + handle.height / 2;
    await browserPage.mouse.move(x, y);
    await browserPage.mouse.down();
    await browserPage.mouse.move(x + dx, y + dy, { steps: 8 });
    await browserPage.mouse.up();
  };
  const snapshot = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value,
    );
  const original = await snapshot();
  const patch = (patch) =>
    page.evaluate(
      (patch) => chrome.runtime.sendMessage({ type: "settings.save", patch }),
      patch,
    );
  const source = await context.newPage();
  const errors = [];
  source.on("pageerror", (e) => errors.push(e.message));
  const host = source.locator("[data-pagework=ui]");
  const bar = host.locator("#selection");
  const action = (id) =>
    bar.locator(
      `:scope > .selection-toolbar-row > .selection-actions > [data-selection-action="${id}"]`,
    );
  const select = async (text) => {
    await source.locator("#first").evaluate((node, text) => {
      node.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }, text);
    const box = await source.locator("#first").boundingBox();
    await source.mouse.move(box.x + 4, box.y + 4);
    await source.mouse.up();
    await bar.waitFor();
    if (
      (await bar
        .locator("[data-selection-command=pin]")
        .getAttribute("aria-pressed")) !== "true"
    )
      await bar.locator("[data-selection-command=expand]").waitFor();
  };
  const markdown =
    '\n\n## Clear result\n\nA **bold** answer with *emphasis* and `inline code`.\n\n- First point\n- Second point\n\n> A short quotation.\n\n| Item | Value |\n| --- | --- |\n| Alpha | 10 |\n\n```js\nconst example = "' +
    "long-code-".repeat(24) +
    '";\n```\n\n[Safe link](https://example.com/ "Link description") [Unsafe](javascript:alert(1))\n\n<script>window.markdownExecuted = true</script><img src="https://invalid.example/leak" onerror="window.markdownExecuted=true"><button data-selection-command="action">Injected control</button><a href="https://example.com" data-op="close-result" id="output">Safe text</a>';
  const verifyMarkdown = async (output) => {
    assert.equal(await output.locator("[title]").count(), 0, "Rendered Markdown does not introduce native tips");
    assert.equal(await output.locator("h2").textContent(), "Clear result");
    assert.equal(await output.locator("strong").textContent(), "bold");
    assert.equal(await output.locator("ul > li").count(), 2);
    assert.equal(await output.locator("table tbody td").count(), 2);
    assert(
      (await output.locator("pre code").textContent()).includes(
        "const example",
      ),
    );
    assert.equal(
      await output
        .locator(
          "script,img,button,[data-op],[data-selection-command],[id],[style],[onerror],a[href^='javascript:']",
        )
        .count(),
      0,
    );
    assert.equal(
      await output.locator("a[href]").first().getAttribute("rel"),
      "noopener noreferrer",
    );
  };
  try {
    await patch({
      preferences: { ...original.preferences, locale: "en", theme: "light" },
    });
    await source.goto(origin + "/result-tools");
    await host.waitFor({ state: "attached" });
    await source.setViewportSize({ width: 900, height: 500 });
    await select("STREAM_FIXTURE markdown-result");
    await action("translate").hover();
    await bar.locator(".hover-tip:popover-open").waitFor();
    assert.equal(
      await bar.locator(".hover-tip").textContent(),
      "Translate",
    );
    assert.equal(await action("translate").getAttribute("title"), null);
    assert.equal(await bar.locator(".hover-tip kbd").count(), 0);
    await source.screenshot({
      path: path.join(artifacts, "selection-custom-tip.png"),
    });
    assert(await bar.locator("[data-selection-command=close]").isHidden());
    const selectedText = await source.evaluate(() => getSelection().toString());
    await action("translate").click();
    await host.locator("#output").filter({ hasText: "逐步" }).waitFor();
    let exchange = streams.at(-1);
    assert.equal(
      await bar.locator(".selection-actions [data-selection-action]").count(),
      original.actions.filter((action) => action.quick).length,
    );
    assert(
      await action("summary").isHidden(),
      "Executing an action keeps disabled actions hidden",
    );
    assert(await bar.locator("[data-selection-command=expand]").isHidden());
    assert(await bar.locator("[data-selection-command=collapse]").isHidden());
    const close = bar.locator("[data-selection-command=close]");
    assert(await close.isVisible());
    await close.hover();
    assert.equal(await bar.locator(".hover-tip:popover-open").count(), 0);
    assert.equal(await close.getAttribute("aria-label"), "Close");
    assert.equal(await close.getAttribute("title"), null);
    await close.focus();
    assert.equal(await bar.locator(".hover-tip:popover-open").count(), 0);
    const pin = bar.locator(
      ".selection-toolbar-row [data-selection-command=pin]",
    );
    assert.equal(
      await bar.locator(".selection-result-footer [data-op=pin]").count(),
      0,
    );
    assert(
      await pin.evaluate(
        (node) => node.nextElementSibling.dataset.selectionCommand === "close",
      ),
    );
    await pin.click();
    assert.equal(await pin.getAttribute("aria-pressed"), "true");
    await pin.click();
    const beforeDrag = await bar.boundingBox(),
      grip = await bar.locator(".selection-spacer").boundingBox();
    const callsBeforeDrag = calls.length;
    await source.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await source.mouse.down();
    await source.mouse.move(
      grip.x + grip.width / 2 + 60,
      grip.y + grip.height / 2 + 30,
      { steps: 6 },
    );
    await source.mouse.up();
    const afterDrag = await bar.boundingBox();
    assert(Math.abs(afterDrag.x - beforeDrag.x - 60) < 1);
    assert(Math.abs(afterDrag.y - beforeDrag.y - 30) < 1);
    assert.equal(
      await source.evaluate(() => getSelection().toString()),
      selectedText,
      "Dragging preserves the source selection",
    );
    assert.equal(
      calls.length,
      callsBeforeDrag,
      "Dragging does not execute an action",
    );
    const streamingTop = (await bar.boundingBox()).y;
    assert.equal(
      await action("translate").getAttribute("aria-pressed"),
      "true",
    );
    assert(
      await action("plain").isEnabled(),
      "Live page selection remains executable while results stream",
    );
    assert.equal(await bar.locator("[data-op=close-result]").count(), 0);
    exchange.write(markdown);
    await host.locator("#output h2").waitFor();
    await verifyMarkdown(host.locator("#output"));
    const streamedPanel = await bar.boundingBox();
    assert(
      Math.abs(streamedPanel.y - streamingTop) < 1,
      "Streaming growth keeps the toolbar top fixed",
    );
    assert(
      streamedPanel.y + streamedPanel.height <= 500,
      "Growing output stays within the viewport",
    );
    const verticalScrollers = await bar.evaluate((root) =>
      [
        root,
        ...root.querySelectorAll(
          ".selection-result-slot,.selection-result,.selection-result-body",
        ),
      ]
        .filter(
          (node) =>
            /auto|scroll/.test(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight + 1,
        )
        .map((node) => node.className),
    );
    assert.equal(
      verticalScrollers.length,
      1,
      "Only the result body owns vertical scrolling",
    );
    assert(verticalScrollers[0].includes("selection-result-body"));
    const toolbarBefore = await bar
      .locator(".selection-toolbar-row")
      .boundingBox();
    const footerBefore = await bar
      .locator(".selection-result-footer")
      .boundingBox();
    await bar
      .locator(".selection-result-body")
      .evaluate((node) => (node.scrollTop = 0));
    const toolbarAfter = await bar
      .locator(".selection-toolbar-row")
      .boundingBox();
    const footerAfter = await bar
      .locator(".selection-result-footer")
      .boundingBox();
    assert.equal(
      toolbarAfter.y,
      toolbarBefore.y,
      "Reading results cannot scroll away the toolbar",
    );
    assert.equal(
      footerAfter.y,
      footerBefore.y,
      "Result controls stay visible while the body scrolls",
    );
    await source.setViewportSize({ width: 1440, height: 1000 });
    exchange.finish();
    await host
      .locator("#result-status")
      .filter({ hasText: "Complete" })
      .waitFor();
    assert.equal(
      await source.evaluate(() => window.markdownExecuted),
      undefined,
    );
    const completedCalls = calls.length;
    await action("translate").click();
    assert(await host.locator("#result").isHidden());
    assert(await bar.isVisible());
    assert.equal(await action("translate").getAttribute("aria-pressed"), null);
    assert.equal(calls.length, completedCalls);
    await action("translate").click();
    await host
      .locator("#result-status")
      .filter({ hasText: "Complete" })
      .waitFor();
    assert.equal(
      calls.length,
      completedCalls,
      "Reopening a completed result reuses the local cache",
    );
    await verifyMarkdown(host.locator("#output"));
    assert.equal(
      await host.locator("#result-status").textContent(),
      "Complete",
    );
    // Page handlers may stop bubbling; dismissal still works in capture.
    await source.evaluate(() =>
      document.documentElement.addEventListener(
        "pointerdown",
        (event) => {
          window.outsidePointerStopped = true;
          event.stopPropagation();
        },
        { once: true },
      ),
    );
    await source.mouse.click(8, 8);
    assert.equal(
      await source.evaluate(() => window.outsidePointerStopped),
      true,
    );
    assert(
      await bar.isHidden(),
      "Clicking outside dismisses an unpinned result toolbar",
    );
    assert(await host.locator("#result").isHidden());
    await select("STREAM_FIXTURE markdown-result");
    assert(
      await close.isHidden(),
      "A new selection opens only the action toolbar",
    );
    await action("translate").click();
    await host
      .locator("#result-status")
      .filter({ hasText: "Complete" })
      .waitFor();
    assert.equal(
      calls.length,
      completedCalls,
      "Dismissed completed results remain cached",
    );
    await verifyMarkdown(host.locator("#output"));

    assert.equal(
      await bar.locator(".selection-result-footer select").count(),
      0,
    );
    for (const op of ["bookmark", "copy", "refresh-result"]) {
      const control = bar.locator(`[data-op=${op}]`);
      await control.hover();
      await bar.locator(".hover-tip:popover-open").waitFor();
      assert.equal(
        await bar.locator(".hover-tip").textContent(),
        await control.getAttribute("aria-label"),
      );
      assert.equal(await control.getAttribute("title"), null);
    }
    await source.screenshot({
      path: path.join(artifacts, "selection-footer-custom-tip.png"),
    });
    await source.mouse.move(8, 8);
    await bar
      .locator(".hover-tip:popover-open")
      .waitFor({ state: "hidden" });
    await bar
      .locator(".selection-result-body")
      .evaluate((node) => (node.scrollTop = 0));
    await source.screenshot({
      path: path.join(artifacts, "selection-graphite-surface-light.png"),
    });
    await bar.screenshot({
      path: path.join(artifacts, "selection-markdown-light.png"),
    });
    await patch({
      preferences: { ...original.preferences, locale: "en", theme: "dark" },
    });
    await source.waitForFunction(
      () =>
        document.querySelector("[data-pagework=ui]").dataset.theme === "dark",
    );
    await source.screenshot({
      path: path.join(artifacts, "selection-graphite-surface-dark.png"),
    });
    await bar.screenshot({
      path: path.join(artifacts, "selection-markdown-dark.png"),
    });
    await source.setViewportSize({ width: 360, height: 600 });
    await source.waitForFunction(
      (bar) =>
        bar.scrollWidth <= bar.clientWidth &&
        bar.getBoundingClientRect().right <= innerWidth,
      await bar.elementHandle(),
    );
    await bar.screenshot({
      path: path.join(artifacts, "selection-markdown-narrow.png"),
    });
    await source.setViewportSize({ width: 1440, height: 1000 });
    await pin.click();
    await source.mouse.click(8, 8);
    assert(await bar.isVisible(), "Clicking outside preserves a pinned result");
    assert(await host.locator("#output h2").isVisible());
    const pinnedPosition = await bar.boundingBox();
    await select("STREAM_FIXTURE refreshed-selection");
    assert(await host.locator("#output h2").isVisible());
    assert(await action("summary").isHidden());
    assert(
      await bar.locator("[data-selection-command=expand]").isHidden(),
      "Pinned results retain the full toolbar after reselection",
    );
    const refresh = bar.locator("[data-op=refresh-result]");
    for (const selection of ["new", "none", "result"]) {
      if (selection === "none")
        await source.evaluate(() => getSelection().removeAllRanges());
      if (selection === "result")
        await host.locator("#output").evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
        });
      const before = calls.length;
      await refresh.click();
      await host.locator("#output").filter({ hasText: "逐步" }).waitFor();
      assert.equal(
        calls.length,
        before + 1,
        "Explicit refresh requests fresh output",
      );
      const input = JSON.stringify(calls.at(-1).body);
      assert(
        input.includes("STREAM_FIXTURE refreshed-selection"),
        `Refresh uses new page text, or its saved input with ${selection} selection`,
      );
      assert(!input.includes("STREAM_FIXTURE markdown-result"));
      exchange = streams.at(-1);
      exchange.write("Fresh result");
      exchange.finish();
      await host
        .locator("#result-status")
        .filter({ hasText: "Complete" })
        .waitFor();
    }
    assert(Math.abs((await bar.boundingBox()).y - pinnedPosition.y) < 1);
    await pin.click();
    assert(await bar.locator("[data-selection-command=expand]").isHidden());
    const home = bar.locator("[data-selection-command=home]");
    assert(await home.isVisible());
    await bar.locator("[data-selection-command=settings]").click();
    assert(await close.isHidden(), "Settings hides the result close button");
    await home.hover();
    await bar.locator(".hover-tip:popover-open").waitFor();
    assert.equal(
      await bar.locator(".hover-tip").textContent(),
      "Extension home",
    );
    await bar.locator("[data-selection-command=cancel]").click();
    assert(await home.isVisible());
    assert(
      await close.isVisible(),
      "Returning to the result restores its close button",
    );
    await source.evaluate(() => getSelection().removeAllRanges());
    await source.waitForFunction(
      (button) => button.disabled,
      await action("plain").elementHandle(),
    );
    assert(await action("translate").isEnabled());
    await action("translate").click();
    assert(await host.locator("#result").isHidden());
    assert(await action("translate").isDisabled());
    await select("STREAM_FIXTURE toggle-stop");
    await action("translate").click();
    await host.locator("#output").filter({ hasText: "逐步" }).waitFor();
    exchange = streams.at(-1);
    const beforeCancel = calls.length;
    await action("translate").click();
    for (let i = 0; i < 20 && !exchange.closed; i++)
      await source.waitForTimeout(50);
    assert(
      exchange.closed,
      "Toggling off a streaming action aborts its response",
    );
    assert.equal(calls.length, beforeCancel);
    assert(await host.locator("#result").isHidden());
    await select("STREAM_FIXTURE outside-dismiss");
    await action("translate").click();
    await host.locator("#output").filter({ hasText: "逐步" }).waitFor();
    exchange = streams.at(-1);
    await host.locator("#output").click();
    assert(
      await bar.isVisible(),
      "Clicking the result body does not dismiss it",
    );
    assert(
      !exchange.closed,
      "Reading inside the result does not cancel generation",
    );
    const beforeOutside = calls.length;
    await source.mouse.click(8, 8);
    assert(await bar.isHidden());
    for (let i = 0; i < 20 && !exchange.closed; i++)
      await source.waitForTimeout(50);
    assert(exchange.closed, "Outside dismissal cancels an unfinished result");
    assert(await host.locator("#result").isHidden());
    assert.equal(calls.length, beforeOutside);
    // An action launched from the expanded toolbar remains visible as the selected dismiss control.
    const extra = [0, 1].map((i) => ({
      ...original.actions[0],
      id: `result-extra-${i}`,
      name: `Extra ${i}`,
      quick: true,
    }));
    await patch({
      actions: [
        ...original.actions.filter((a) =>
          ["translate", "plain", "explain", "summary", "qa"].includes(a.id),
        ),
        ...extra,
      ],
    });
    await select("STREAM_FIXTURE overflow-result");
    await bar.locator("[data-selection-command=expand]").click();
    await bar.evaluate((root) =>
      Promise.all(
        root
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    const expandedWidth = (await bar.boundingBox()).width;
    await action("result-extra-1").click();
    await host.locator("#output").filter({ hasText: "逐步" }).waitFor();
    exchange = streams.at(-1);
    assert(await action("result-extra-1").isVisible());
    assert(await bar.locator("[data-selection-command=collapse]").isHidden());
    assert(Math.abs((await bar.boundingBox()).width - expandedWidth) < 1);
    assert.equal(
      await action("result-extra-1").getAttribute("aria-pressed"),
      "true",
    );
    const beforeResizeCalls = calls.length;
    const panelBeforeResize = await bar.boundingBox();
    const bodyBeforeResize = await bar
      .locator(".selection-result-body")
      .boundingBox();
    await resize(source, bar, 160, 200);
    const panelAfterResize = await bar.boundingBox();
    assert(Math.abs(panelAfterResize.x - panelBeforeResize.x) < 1);
    assert(Math.abs(panelAfterResize.y - panelBeforeResize.y) < 1);
    assert(panelAfterResize.width > panelBeforeResize.width);
    assert(panelAfterResize.height > panelBeforeResize.height);
    assert(
      (await bar.locator(".selection-result-body").boundingBox()).height >
        bodyBeforeResize.height,
    );
    assert(!exchange.closed, "Resizing keeps streaming active");
    exchange.write("Resize keeps this response alive.");
    await host
      .locator("#output")
      .filter({ hasText: "Resize keeps this response alive." })
      .waitFor();
    assert.equal(calls.length, beforeResizeCalls);
    await bar.screenshot({
      path: path.join(artifacts, "selection-resized-result.png"),
    });
    await pin.click();
    const beforeClose = calls.length;
    await close.click();
    assert(await bar.isHidden());
    assert.equal(calls.length, beforeClose);
    for (let i = 0; i < 20 && !exchange.closed; i++)
      await source.waitForTimeout(50);
    assert(
      exchange.closed,
      "Closing a pinned streaming panel cancels its response",
    );
    await select("STREAM_FIXTURE after-close");
    assert(await close.isHidden());
    assert(await host.locator("#result").isHidden());
    await patch({ actions: original.actions });
    await page.reload();
    const beforeStyle = calls.length;
    await nav("appearance");
    const styleTarget = page.locator("#style-target");
    await styleTarget.evaluate((node) => {
      node.value = "selection";
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const stylePanel = page.locator("#style-selection-tools");
    assert(await stylePanel.locator(".selection-toolbar-row").isVisible());
    assert(await stylePanel.locator(".selection-result-body").isVisible());
    assert.equal(
      await stylePanel.locator(".selection-result-footer select").count(),
      0,
    );
    assert.equal(
      await stylePanel.locator(".original-text,.floating-source").count(),
      0,
    );
    await page.locator("[data-style=size]").evaluate((node) => {
      node.value = "20";
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(
      await page
        .locator("#style-selection-output")
        .evaluate((node) => getComputedStyle(node).fontSize),
      "20px",
    );
    assert.equal(calls.length, beforeStyle);
    await page.screenshot({
      path: path.join(artifacts, "selection-style-preview-real.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: integrated Markdown streaming/sanitization, selected action toggle/cancellation/cache reopen, live source validity, expanded action, pinned refresh source/fallback, custom footer tips, static appearance preview and narrow layout.",
    );
  } finally {
    await patch({
      actions: original.actions,
      preferences: original.preferences,
      appearance: original.appearance,
    });
    await source.close();
    await page.reload();
  }
};
