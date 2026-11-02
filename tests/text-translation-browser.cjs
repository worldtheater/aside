const assert = require("node:assert/strict");
const path = require("node:path");
module.exports = async ({
  page,
  context,
  origin,
  calls,
  streams,
  artifacts,
}) => {
  const original = (
    await page.evaluate(() => chrome.runtime.sendMessage({ type: "snapshot" }))
  ).value;
  const source = await context.newPage();
  const errors = [];
  source.on("pageerror", (error) => errors.push(error.message));
  const save = async (patch) => {
    const result = await page.evaluate(
      (patch) => chrome.runtime.sendMessage({ type: "settings.save", patch }),
      patch,
    );
    assert.equal(result.ok, true);
  };
  try {
    await save({
      preferences: { ...original.preferences, locale: "zh-CN", theme: "light" },
      actions: original.actions.map((action) =>
        action.id === "translate"
          ? {
              ...action,
              mode: "paragraph",
              targetLanguage: "interface",
              instruction: "",
            }
          : action,
      ),
    });
    await source.goto(origin + "/text-translation");
    const host = source.locator("[data-pagework=ui]"),
      dock = host.locator("#dock"),
      radial = host.locator("#radial");
    const panel = host.locator("#text-translation"),
      input = panel.locator("textarea"),
      run = panel.locator("[data-text-command=run]"),
      output = panel.locator(".output"),
      status = panel.locator(".text-translation-status");
    const open = async () => {
      await dock.focus();
      await source.keyboard.press("Enter");
      await radial.locator("[data-op=text-translate]").click();
      await panel.waitFor();
      await radial.evaluate((node) =>
        Promise.all(
          node
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      const bounds = await panel.boundingBox();
      const anchor = await dock.boundingBox();
      const side = await dock.getAttribute("data-side");
      assert(
        side === "left"
          ? bounds.x > anchor.x + anchor.width
          : bounds.x + bounds.width < anchor.x,
        "The menu opens text translation beside the dock",
      );
      assert(bounds.y >= 0);
      assert(bounds.y + bounds.height <= source.viewportSize().height);
    };
    await source.locator("#first").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    // Sites such as tbench.ai use J/K and arrow keys to navigate and scroll.
    // A closed shadow root retargets textarea events to a DIV at document level.
    await source.evaluate(() => {
      document.body.style.minHeight = "3000px";
      window.pageKeys = [];
      for (const type of ["keydown", "keypress", "keyup"]) {
        document.addEventListener(type, (event) => {
          if (
            event.target.closest("input,textarea,select") ||
            event.target.isContentEditable
          )
            return;
          window.pageKeys.push(type);
          if (
            type === "keydown" &&
            ["j", "k", "ArrowRight", "ArrowLeft"].includes(event.key)
          ) {
            event.preventDefault();
            history.replaceState(null, "", location.pathname + "?view=pareto");
            window.scrollTo(0, 800);
          }
        });
      }
    });
    const before = calls.length;
    await open();
    assert.equal(
      await input.inputValue(),
      "",
      "Opening the translator never copies page selection",
    );
    assert(await run.isDisabled());
    assert.equal(
      await panel.locator("[data-text-language=sourceLanguage]").inputValue(),
      "auto",
    );
    assert.equal(
      await panel.locator("[data-text-language=targetLanguage]").inputValue(),
      "interface",
    );
    assert.equal(
      await input.evaluate((node) => getComputedStyle(node).resize),
      "none",
    );
    await input.fill("    ");
    assert(await run.isDisabled());
    assert.equal(calls.length, before);
    await input.fill("");
    const startUrl = source.url();
    const startScroll = await source.evaluate(() => scrollY);
    await input.press("j");
    await input.press("k");
    await input.press("ArrowLeft");
    await input.press("ArrowRight");
    await input.press("Space");
    await input.press("Enter");
    assert(
      await panel.isVisible(),
      "Typing never triggers page navigation or dismisses the panel",
    );
    assert.equal(await input.inputValue(), "jk \n");
    assert.equal(source.url(), startUrl);
    assert.equal(await source.evaluate(() => scrollY), startScroll);
    assert.deepEqual(
      await source.evaluate(() => window.pageKeys),
      [],
      "Keyboard events stay within extension controls",
    );
    const text =
      "A pasted passage for translation.\n\nAnother paragraph, in the same request.";
    await input.fill(text);
    await input.press("Control+Enter");
    await status.filter({ hasText: "处理完成" }).waitFor();
    assert.equal(calls.length, before + 1);
    const request = calls.at(-1).body;
    const raw = request.input || request.messages.at(-1).content;
    assert.equal(raw, text, "Only typed text is sent, as one whole passage");
    assert.equal(
      await output.textContent(),
      "Processed together: " + text.replace("\n\n", "\n"),
    );
    assert.equal(await source.locator("[data-pagework=result]").count(), 0);
    const usage = (
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: "usage.list" }),
      )
    ).value;
    assert(usage.some((row) => row.source === "text"));
    await source.screenshot({
      path: path.join(artifacts, "text-translation-light.png"),
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin,
    });
    await panel.locator("[data-text-command=copy]").click();
    // The click handler awaits the asynchronous clipboard write.
    await source.waitForFunction(
      async (expected) => (await navigator.clipboard.readText()) === expected,
      "Processed together: " + text,
    );

    await panel
      .locator("[data-text-language=sourceLanguage]")
      .selectOption("en");
    await panel
      .locator("[data-text-language=targetLanguage]")
      .selectOption("en");
    assert(await run.isDisabled());
    assert(
      await output.isHidden(),
      "Changed inputs clear the stale translation",
    );
    await panel
      .locator("[data-text-language=targetLanguage]")
      .selectOption("fr");
    await input.fill("A revised passage.");
    await run.click();
    await status.filter({ hasText: "处理完成" }).waitFor();
    assert.equal(calls.length, before + 2);
    assert(JSON.stringify(calls.at(-1).body).includes("French (fr)"));
    assert((await output.textContent()).includes("A revised passage."));
    await input.fill("STREAM_FIXTURE_WAIT_TEXT_TRANSLATION");
    const streamIndex = streams.length;
    await run.click();
    while (streams.length === streamIndex)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert(await input.isDisabled());
    streams[streamIndex].write("Partial translation");
    await output.filter({ hasText: "Partial translation" }).waitFor();
    await source.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    while (!streams[streamIndex].closed)
      await new Promise((resolve) => setTimeout(resolve, 20));
    await open();
    assert.equal(await input.inputValue(), "");
    assert(await output.isHidden());
    await input.fill("STREAM_FIXTURE_WAIT_TEXT_STOP");
    const stopIndex = streams.length;
    await run.click();
    while (streams.length === stopIndex)
      await new Promise((resolve) => setTimeout(resolve, 20));
    await panel.locator("[data-text-command=stop]").click();
    assert(await input.isEnabled());
    assert(await run.isVisible());
    while (!streams[stopIndex].closed)
      await new Promise((resolve) => setTimeout(resolve, 20));
    await panel.locator("[data-text-command=close]").click();
    await source.locator("#native-button").focus();
    await source.keyboard.press("j");
    assert(
      source.url().endsWith("?view=pareto"),
      "Page shortcuts still work outside extension controls",
    );
    assert.equal(await source.evaluate(() => scrollY), 800);
    await source.evaluate(() => {
      history.replaceState(null, "", location.pathname);
      window.scrollTo(0, 0);
      document.body.style.minHeight = "";
    });

    // A disabled selection toolbar does not disable this separate entry.
    const update = await page.evaluate(() =>
      chrome.runtime.sendMessage({
        type: "website.update",
        patch: { toolbar: false },
      }),
    );
    assert.equal(update.ok, true);
    await save({
      preferences: { ...original.preferences, locale: "zh-CN", theme: "dark" },
    });
    await source.setViewportSize({ width: 390, height: 640 });
    await dock.focus();
    await dock.evaluate(async (node) => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await Promise.all(
        node.getAnimations().map((animation) => animation.finished),
      );
    });
    const dockBounds = await dock.boundingBox();
    await source.mouse.move(
      dockBounds.x + dockBounds.width / 2,
      dockBounds.y + dockBounds.height / 2,
    );
    await source.mouse.down();
    await source.mouse.move(14, 80, { steps: 10 });
    await source.mouse.up();
    assert.equal(await dock.getAttribute("data-side"), "left");
    await open();
    await input.fill("A dark-mode example.");
    await run.click();
    await status.filter({ hasText: "处理完成" }).waitFor();
    const bounds = await panel.boundingBox();
    assert(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 390 &&
        bounds.y + bounds.height <= 640,
    );
    assert(await run.isVisible());
    assert.equal(
      await panel.evaluate((node) => node.scrollWidth > node.clientWidth),
      false,
    );
    await source.screenshot({
      path: path.join(artifacts, "text-translation-dark-narrow.png"),
    });
    await source.goto(origin + "/text-translation-navigation");
    await source.locator("[data-pagework=ui]").waitFor({ state: "attached" });
    assert(
      await source.locator("[data-pagework=ui] #text-translation").isHidden(),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS typed-text translation: one request, language overrides, copy, cancel, toolbar independence, navigation, narrow layout",
    );
  } finally {
    await page.evaluate(
      (toolbar) =>
        chrome.runtime.sendMessage({
          type: "website.update",
          patch: { toolbar },
        }),
      original.website.toolbar ?? true,
    );
    await save({
      preferences: original.preferences,
      actions: original.actions,
    });
    await source.close();
  }
};
