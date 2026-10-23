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
  const snapshot = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value,
    );
  const original = await snapshot();
  const source = await context.newPage();
  const errors = [];
  source.on("pageerror", (e) => errors.push(e.message));
  const patch = (patch) =>
    page.evaluate(
      (patch) => chrome.runtime.sendMessage({ type: "settings.save", patch }),
      patch,
    );
  // Isolate actions and language so this suite is repeatable after other browser checks.
  await patch({
    actions: original.actions.filter((a) =>
      ["translate", "plain", "explain", "summary", "qa"].includes(a.id),
    ),
    preferences: { ...original.preferences, locale: "en", theme: "light" },
  });
  await source.goto(origin + "/selection-tools");
  const host = source.locator("[data-pagework=ui]"),
    bar = host.locator("#selection");
  const command = (name) => bar.locator(`[data-selection-command=${name}]`);
  const action = (id) =>
    bar.locator(
      `:scope > .selection-toolbar-row > .selection-actions > [data-selection-action="${id}"]`,
    );
  const field = (name) => bar.locator(`[data-selection-field=${name}]`);
  const toggleWithFade = async (name) => {
    await bar.evaluate((root) => {
      const extras = root.querySelector(".selection-extra-controls");
      root.addEventListener(
        "click",
        () => {
          const current = root.querySelector(".selection-extra-controls");
          const fade = current
            .getAnimations()
            .find((animation) => animation.transitionProperty === "opacity");
          let opacity = null;
          if (fade) {
            const timing = fade.effect.getTiming();
            fade.pause();
            fade.currentTime = timing.delay + Number(timing.duration) / 2;
            opacity = Number(getComputedStyle(current).opacity);
            fade.play();
          }
          root.dataset.observedFade = JSON.stringify({
            sameNode: current === extras,
            opacity,
          });
        },
        { once: true },
      );
    });
    await command(name).click();
    const observed = JSON.parse(await bar.getAttribute("data-observed-fade"));
    assert(
      observed.sameNode,
      "The controls remain mounted during a toolbar toggle",
    );
    assert(
      observed.opacity > 0 && observed.opacity < 1,
      `${name} fades the extra controls: ${JSON.stringify(observed)}`,
    );
    await bar.evaluate((root) =>
      Promise.all(
        root
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
  };
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
  const settings = async () => {
    if (await command("expand").isVisible()) await command("expand").click();
    await command("settings").click();
  };
  const select = async () => {
    await source.locator("[data-pagework=ui]").waitFor({ state: "attached" });
    await source.locator("#first").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const rect = await source.locator("#first").boundingBox();
    await source.mouse.move(rect.x + 4, rect.y + 4);
    await source.mouse.up();
    await bar.waitFor();
    await bar.locator("[data-selection-command=expand]").waitFor();
  };
  try {
    await host.waitFor({ state: "attached" });
    // These reach the isolated content listener too, unlike an expando key field.
    await source.evaluate(() => {
      document.dispatchEvent(new Event("keyup", { bubbles: true }));
      document.dispatchEvent(new CustomEvent("keyup", { bubbles: true }));
    });
    assert.deepEqual(errors, [], "Non-keyboard keyup events are ignored");
    assert(await bar.isHidden());
    await select();
    assert(await command("close").isHidden());
    await action("translate").hover();
    await bar.locator(".hover-tip:popover-open").waitFor();
    assert.equal(
      await bar.locator(".hover-tip").evaluate((tip) => getComputedStyle(tip).opacity),
      "1",
      "Available action hints remain opaque",
    );
    const beforeInvalid = calls.length;
    // Clear the selection during click capture, before the async selectionchange event.
    await source.evaluate(() =>
      document.addEventListener(
        "click",
        () => getSelection().removeAllRanges(),
        { capture: true, once: true },
      ),
    );
    await action("translate").click();
    assert(await action("translate").isDisabled());
    await source.mouse.move(1, 1);
    await action("translate").hover();
    assert.equal(await bar.locator(".hover-tip:popover-open").count(), 0,
      "An unavailable action does not show a hover hint");
    assert.equal(
      calls.length,
      beforeInvalid,
      "A selection lost during the click cannot trigger a request",
    );
    // Some sites restore/adjust their DOM selection after mouseup. No cached
    // invalid-selection latch may keep a visibly selected passage disabled.
    await source.locator("#first").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().addRange(range);
    });
    await source.waitForFunction(
      (button) => !button.disabled,
      await action("translate").elementHandle(),
    );
    await select();
    assert(
      await action("translate").isEnabled(),
      "Reselecting webpage text restores actions",
    );
    const selectedText = await source.evaluate(() => getSelection().toString());
    assert.deepEqual(
      await bar.evaluate((root) => {
        const button = root.querySelector(
          '[data-selection-action="translate"]',
        );
        return {
          button: getComputedStyle(button).width,
          icon: getComputedStyle(button.querySelector("svg")).width,
        };
      }),
      { button: "32px", icon: "18px" },
    );
    assert(await command("expand").isVisible());
    assert(await command("settings").isHidden());
    assert(
      await action("summary").isHidden(),
      "Only quick actions appear initially",
    );
    assert(await command("add").isHidden());
    await toggleWithFade("expand");
    assert(await action("summary").isHidden(), "Disabled actions stay hidden after expansion");
    assert.equal(await bar.locator(".selection-menu").count(), 0);
    assert.deepEqual(
      await bar.evaluate((root) =>
        Array.from(root.querySelectorAll(".selection-controls button"))
          .filter((n) => n.checkVisibility())
          .map((n) => n.dataset.selectionCommand),
      ),
      ["add", "settings", "collapse"],
    );
    assert(await command("add").isVisible());
    assert(await command("home").isVisible());
    assert(
      await command("home").evaluate((node) =>
        node.matches("button.selection-brand"),
      ),
    );
    assert.equal(
      await bar
        .locator(".selection-controls [data-selection-command=home]")
        .count(),
      0,
    );
    await toggleWithFade("collapse");
    assert(await command("add").isHidden());
    assert(
      await bar
        .locator(".selection-extra-controls")
        .evaluate((node) => node.inert),
    );
    await toggleWithFade("expand");
    await source.emulateMedia({ reducedMotion: "reduce" });
    await command("collapse").click();
    assert(await command("settings").isHidden());
    assert.equal(
      await bar
        .locator(".selection-extra-controls")
        .evaluate((node) => node.getAnimations().length),
      0,
    );
    await command("expand").click();
    assert(await command("add").isVisible());
    await source.emulateMedia({ reducedMotion: "no-preference" });
    await settings();
    const [home] = await Promise.all([
      context.waitForEvent("page"),
      command("home").click(),
    ]);
    await home.waitForURL(/index\.html.*#home/);
    await home.locator("h1").waitFor();
    await home.close();
    await source.bringToFront();
    assert(await command("close").isHidden());
    assert.equal(
      await source.evaluate(() => getSelection().toString()),
      selectedText,
      "Opening settings preserves the page selection",
    );
    assert.equal(
      await action("explain").count(),
      1,
      "Settings includes the expanded actions",
    );
    await action("explain").click();
    assert.equal(
      await source.evaluate(() => getSelection().toString()),
      selectedText,
      "Switching settings actions preserves the page selection",
    );
    await action("translate").click();
    await source.screenshot({
      path: path.join(artifacts, "selection-preserved-settings.png"),
    });
    assert(await command("home").isVisible());
    assert(await command("add").isHidden());
    assert(await command("collapse").isHidden());
    assert.equal(await command("cancel").textContent(), "Cancel");
    assert.equal(await command("save").textContent(), "Save");
    assert.equal(
      await bar.locator(".selection-settings-footer [data-selection-command]").count(),
      2,
    );
    assert.equal(
      await field("name").count(),
      0,
      "Saved actions have no name editor in the toolbar",
    );
    const noCalls = calls.length;
    const initialPrompt = await field("instruction").inputValue();
    await field("instruction").fill("TRANSLATE_DRAFT");
    await field("sourceLanguage").selectOption("en");
    await field("targetLanguage").selectOption("ja");
    await action("explain").click();
    assert.equal(await field("sourceLanguage").count(), 0);
    await field("instruction").fill("EXPLAIN_DRAFT");
    await action("translate").click();
    assert.equal(await field("instruction").inputValue(), "TRANSLATE_DRAFT");
    assert.equal(await field("targetLanguage").inputValue(), "ja");
    await command("cancel").click();
    assert.equal(await bar.locator(".selection-settings").count(), 0);
    assert(
      await action("translate").isDisabled(),
      "Leaving the prompt editor cannot reuse the old page selection",
    );
    await action("translate").click({ force: true });
    assert(await action("explain").isDisabled());
    await bar.screenshot({
      path: path.join(artifacts, "selection-invalid-actions.png"),
    });
    assert.equal(calls.length, noCalls, "Disabled actions make no requests");
    await settings();
    assert.equal(await field("instruction").inputValue(), initialPrompt);
    assert.equal(
      calls.length,
      noCalls,
      "Editing, switching and cancelling never invoke a model",
    );
    await field("sourceLanguage").selectOption("en");
    await field("targetLanguage").selectOption("en");
    await command("save").click();
    await bar.locator(".selection-error").filter({ hasText: "same" }).waitFor();
    await field("targetLanguage").selectOption("ja");
    await field("instruction").fill("TRANSLATION_SAVED: retain details.");
    await field("model").selectOption(original.defaultConnection);
    await action("explain").click();
    await field("instruction").fill("EXPLANATION_SAVED: explain precisely.");
    await action("translate").click();
    await bar.screenshot({
      path: path.join(artifacts, "selection-settings-light.png"),
    });
    await command("save").click();
    await command("expand").waitFor();
    assert.equal(await bar.locator(".selection-settings").count(), 0);
    assert(
      await command("expand").evaluate(
        (node) => node.getRootNode().activeElement === node,
      ),
    );
    let stored = await snapshot();
    assert.equal(
      stored.actions.find((a) => a.id === "translate").instruction,
      "TRANSLATION_SAVED: retain details.",
      "Leaving the focused prompt field cannot write into another action",
    );
    assert.equal(
      stored.actions.find((a) => a.id === "translate").targetLanguage,
      "ja",
    );
    assert.equal(
      stored.actions.find((a) => a.id === "translate").model,
      original.defaultConnection,
    );
    assert.equal(
      stored.actions.find((a) => a.id === "explain").instruction,
      "EXPLANATION_SAVED: explain precisely.",
    );
    assert.equal(calls.length, noCalls, "Saving does not execute actions");
    // Saving a preset's model, languages or prompt must not freeze its English label.
    await patch({
      preferences: { ...original.preferences, locale: "zh-CN", theme: "light" },
    });
    await select();
    await action("translate").hover();
    await bar.locator(".hover-tip:popover-open").waitFor();
    assert.equal(await bar.locator(".hover-tip").textContent(), "翻译");
    assert.equal(await action("plain").getAttribute("aria-label"), "古文释义");
    assert.equal(
      await action("explain").getAttribute("aria-label"),
      "解释内容",
    );
    await bar.screenshot({
      path: path.join(artifacts, "selection-localized-tip.png"),
    });
    await settings();
    assert.equal(
      await bar.locator(".selection-action-name").textContent(),
      "翻译",
    );
    assert.equal(
      await field("instruction").inputValue(),
      "TRANSLATION_SAVED: retain details.",
    );
    await command("cancel").click();
    await page.reload();
    await nav("actions");
    assert.equal(
      await page
        .locator("[data-op=edit-action][data-id=translate] .action-title")
        .textContent(),
      "翻译",
    );
    const popup = await context.newPage();
    await popup.goto(new URL("popup.html", page.url()).href);
    await popup.locator("#action").waitFor({ state: "attached" });
    assert.equal(
      await popup.locator("#action option[value=translate]").textContent(),
      "翻译",
    );
    assert.equal(
      await popup.locator("#action option[value=explain]").textContent(),
      "解释内容",
    );
    await popup.close();
    await page.locator("[data-op=edit-action][data-id=translate]").click();
    await choose("#ui-locale", "en");
    assert.equal(await page.locator("#action-name").inputValue(), "Translate");
    assert.equal(
      await page.locator("#instruction").inputValue(),
      "TRANSLATION_SAVED: retain details.",
    );
    assert.equal(calls.length, noCalls, "Locale changes do not invoke a model");
    await source.reload();
    await select();
    await settings();
    assert.equal(
      await field("instruction").inputValue(),
      "TRANSLATION_SAVED: retain details.",
    );
    await command("cancel").click();
    await command("add").click();
    assert(await command("expand").isHidden());
    assert.equal(await bar.locator(".selection-menu").count(), 0);
    assert(await bar.locator(".selection-settings").isVisible());
    await command("save").click();
    await bar.locator(".selection-error").waitFor();
    assert(await field("name").isEditable(), "New actions can be named");
    await field("name").fill("Quick custom");
    await field("instruction").fill("QUICK_CUSTOM: extract the key claim.");
    await field("model").selectOption(original.defaultConnection);
    await command("save").click();
    await command("expand").waitFor();
    assert.equal(await bar.locator(".selection-settings").count(), 0);
    assert(
      await command("expand").evaluate(
        (node) => node.getRootNode().activeElement === node,
      ),
    );
    stored = await snapshot();
    const custom = stored.actions.find((a) => a.name === "Quick custom");
    assert(custom);
    assert.equal(custom.quick, false);
    assert.equal(custom.builtin, false);
    assert(
      await action("translate").isDisabled(),
      "Saving settings does not resurrect a lost selection",
    );
    await select();
    assert(await action(custom.id).isHidden());
    await command("expand").click();
    const enabledCustom = await snapshot();
    await patch({actions: enabledCustom.actions.map((item) => item.id === custom.id ? {...item, quick: true} : item)});
    await action(custom.id).click();
    await host
      .locator("#result-status")
      .filter({ hasText: "Complete" })
      .waitFor();
    assert(JSON.stringify(calls.at(-1).body).includes("QUICK_CUSTOM"));
    await select();
    await command("expand").click();
    await command("add").click();
    await field("name").fill("Discard this");
    await command("cancel").click();
    assert(!(await snapshot()).actions.some((a) => a.name === "Discard this"));
    const rename = await page.evaluate(async () => {
      const config = (
        await chrome.runtime.sendMessage({ type: "settings.public" })
      ).value;
      const action = config.actions.find((a) => a.id === "translate");
      return chrome.runtime.sendMessage({
        type: "actions.save",
        changes: [{ ...action, name: "Must stay unchanged" }],
      });
    });
    assert(rename.ok);
    assert.notEqual(
      rename.value.actions.find((a) => a.id === "translate").name,
      "Must stay unchanged",
      "Toolbar saves preserve existing names",
    );
    // Validation is atomic; a rejected batch cannot partially save an earlier action.
    const savedActions = (await snapshot()).actions;
    const invalid = await page.evaluate(
      async (actions) =>
        chrome.runtime.sendMessage({
          type: "actions.save",
          changes: [
            { ...actions[0], instruction: "MUST_NOT_SAVE" },
            { ...actions[1], model: "missing-connection" },
          ],
        }),
      savedActions,
    );
    assert.equal(invalid.error, "noConnection");
    assert.notEqual((await snapshot()).actions[0].instruction, "MUST_NOT_SAVE");
    await patch({
      preferences: { ...original.preferences, locale: "en", theme: "dark" },
    });
    await select();
    await settings();
    await bar.screenshot({
      path: path.join(artifacts, "selection-settings-dark.png"),
    });
    await source.setViewportSize({ width: 360, height: 600 });
    await bar.evaluate((node) => {
      const h = node.getBoundingClientRect();
      if (h.bottom > innerHeight)
        throw new Error("Panel extends below viewport");
    });
    await bar.screenshot({
      path: path.join(artifacts, "selection-settings-mobile.png"),
    });
    await source.keyboard.press("Escape");
    assert.equal(await bar.locator(".selection-settings").count(), 0);
    // Leave room below the expanded toolbar for the shorter editor; the taller
    // editor can scroll, but action switches must keep the toolbar top fixed.
    await source.setViewportSize({ width: 900, height: 600 });
    await source
      .locator("#first")
      .evaluate((node) => (node.style.marginTop = "100px"));
    await select();
    await settings();
    await action("translate").click();
    const tall = await bar.boundingBox();
    // A saved custom action has no language row, unlike the non-translation presets.
    await action(custom.id).click();
    const short = await bar.boundingBox();
    assert(
      Math.abs(tall.y - short.y) < 1,
      "Switching actions keeps the panel top fixed",
    );
    assert(
      short.height < tall.height,
      "The shorter editor moves the bottom edge upward",
    );
    await bar.screenshot({
      path: path.join(artifacts, "selection-panel-anchor-short.png"),
    });
    await action("translate").click();
    const restored = await bar.boundingBox();
    assert(Math.abs(tall.y - restored.y) < 1);
    assert(Math.abs(tall.height - restored.height) < 1);
    await bar.screenshot({
      path: path.join(artifacts, "selection-panel-anchor-tall.png"),
    });
    await command("cancel").click();
    await settings();
    await action("plain").click();
    const anchored = await bar.boundingBox();
    await field("instruction").evaluate(
      (node) => (node.style.height = "240px"),
    );
    await source.waitForFunction(
      (panel) => panel.scrollHeight > panel.clientHeight,
      await bar.locator(".selection-settings").elementHandle(),
    );
    const grown = await bar.boundingBox();
    assert(
      Math.abs(anchored.y - grown.y) < 1,
      "Growing content cannot push the toolbar upward",
    );
    assert(
      grown.y + grown.height <= 600,
      "Overflow scrolls within the available height",
    );
    const footer = bar.locator(".selection-settings-footer");
    const footerBefore = await footer.boundingBox();
    await bar
      .locator(".selection-settings")
      .evaluate((n) => (n.scrollTop = n.scrollHeight));
    assert.deepEqual(
      await footer.boundingBox(),
      footerBefore,
      "Save and Cancel stay fixed when the form scrolls",
    );
    assert(footerBefore.y + footerBefore.height <= grown.y + grown.height);
    assert(
      (await command("cancel").boundingBox()).x <
        (await command("save").boundingBox()).x,
    );
    // Resize the panel itself, preserving the draft, anchor and fixed footer.
    const resizeCalls = calls.length;
    const draftBeforeResize = await field("instruction").inputValue();
    const startPanel = await bar.boundingBox();
    const grip = await bar.locator(".selection-spacer").boundingBox();
    await source.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await source.mouse.down();
    await source.mouse.move(
      grip.x + grip.width / 2 + 40 - startPanel.x,
      grip.y + grip.height / 2 + 20 - startPanel.y,
      { steps: 5 },
    );
    await source.mouse.up();
    const beforeResize = await bar.boundingBox();
    await resize(source, bar, 120, 70);
    const afterResize = await bar.boundingBox();
    assert(Math.abs(afterResize.x - beforeResize.x) < 1);
    assert(Math.abs(afterResize.y - beforeResize.y) < 1);
    assert(Math.abs(afterResize.width - beforeResize.width - 120) < 1);
    assert(Math.abs(afterResize.height - beforeResize.height - 70) < 1);
    assert.equal(await field("instruction").inputValue(), draftBeforeResize);
    await bar.screenshot({
      path: path.join(artifacts, "selection-resized-editor.png"),
    });
    await action("translate").click();
    assert.deepEqual(
      await bar.boundingBox(),
      afterResize,
      "Action switches retain the resized panel",
    );
    await resize(source, bar, -1000, -1000);
    const minimum = await bar.boundingBox();
    assert.equal(minimum.width, 260);
    assert.equal(minimum.height, 180);
    await bar.locator(".selection-resize").focus();
    await bar.locator(".selection-resize").press("ArrowRight");
    assert.equal((await bar.boundingBox()).width, 270);
    await resize(source, bar, 2000, 2000);
    const maximum = await bar.boundingBox();
    assert(
      maximum.x + maximum.width <= 890 && maximum.y + maximum.height <= 590,
    );
    await source.setViewportSize({ width: 360, height: 300 });
    await source.waitForFunction(
      (panel) => {
        const rect = panel.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight
        );
      },
      await bar.elementHandle(),
    );
    const small = await bar.boundingBox();
    assert(small.x >= 0 && small.x + small.width <= 360);
    assert(small.y >= 0 && small.y + small.height <= 300);
    const smallFooter = await footer.boundingBox();
    assert(smallFooter.y + smallFooter.height <= small.y + small.height);
    assert(await command("save").isVisible());
    await source.setViewportSize({ width: 900, height: 600 });
    await command("cancel").click();
    await command("collapse").click();
    assert((await bar.boundingBox()).height < 70);
    assert(await bar.locator(".selection-resize").isHidden());
    await settings();
    assert((await bar.boundingBox()).width > beforeResize.width);
    assert.equal(calls.length, resizeCalls, "Resizing never invokes a model");
    await source.keyboard.press("Escape");
    await source
      .locator("#first")
      .evaluate((node) => (node.style.marginTop = ""));
    await source.setViewportSize({ width: 360, height: 600 });
    // Expansion always provides management controls, even when all actions are quick.
    await patch({
      actions: (await snapshot()).actions.map((a) => ({ ...a, quick: true })),
    });
    await select();
    assert(await command("expand").isVisible());
    await command("expand").click();
    assert(await command("add").isVisible());
    await settings();
    await command("add").waitFor({ state: "hidden" });
    await patch({ actions: savedActions });
    await page.reload();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: selection settings save/cancel/switch, language validation, connection choice, custom action execution, collapsed/expanded controls with enter/exit fades and reduced motion, atomic save, viewport bounds.",
    );
  } finally {
    await patch({
      actions: original.actions,
      preferences: original.preferences,
    });
    await source.close();
    await page.reload();
  }
};
