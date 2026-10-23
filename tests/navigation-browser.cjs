const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({ page, context, origin, calls, streams, artifacts }) => {
  const source = await context.newPage();
  const errors = [];
  source.on("pageerror", (error) => errors.push(error.message));
  try {
    await source.goto(origin + "/navigation-start");
    const host = source.locator("[data-pagework=ui]");
    const selection = host.locator("#selection");
    await host.waitFor({ state: "attached" });
    const select = async () => {
      await source.locator("#first").evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
      await source.keyboard.press("Shift");
      await selection.waitFor({ state: "visible" });
    };
    const assertClosed = async () => {
      await selection.waitFor({ state: "hidden", timeout: 2000 });
      assert(await host.locator("#result").isHidden());
      assert(await host.locator("#toolbar").isHidden());
      assert.equal(await host.locator("#radial.open").count(), 0);
      assert.equal(await host.locator("#dock").getAttribute("aria-expanded"), "false");
      assert.equal(await source.evaluate(() => getSelection().toString()), "");
    };
    const before = calls.length;
    // Keep selected content mounted, as SPA shells often do during navigation.
    await source.evaluate(() => {
      const link = document.createElement("a");
      link.id = "route-link";
      link.href = "/navigation-next";
      link.textContent = "Next article";
      link.addEventListener("mousedown", (event) => event.preventDefault());
      link.addEventListener("click", (event) => {
        event.preventDefault();
        history.pushState({}, "", link.href);
      });
      document.querySelector("nav").append(link);
    });
    await select();
    await source.locator("#route-link").click();
    await source.waitForURL("**/navigation-next");
    await assertClosed();

    await select();
    await source.evaluate(() => history.replaceState({ scroll: 100 }, ""));
    assert(await selection.isVisible(), "State-only updates keep the current panel");
    await source.evaluate(() => history.replaceState({}, "", "/navigation-replaced"));
    await assertClosed();
    await select();
    await source.evaluate(() => location.hash = "/another-article");
    await assertClosed();
    await select();
    await source.goBack();
    await assertClosed();
    await select();
    await source.goForward();
    await assertClosed();
    assert.equal(calls.length, before, "Navigation and selecting text never call a model");

    // A pinned, streaming result must not survive a route change or repaint later.
    await source.locator("#first").evaluate((node) => node.textContent = "STREAM_FIXTURE navigation cleanup");
    await select();
    await selection.locator("[data-selection-action=translate]").click();
    await host.locator("#output").filter({ hasText: "逐步" }).waitFor();
    await selection.locator("[data-selection-command=pin]").click();
    const exchange = streams.find((item) => item.input === "STREAM_FIXTURE navigation cleanup");
    assert(exchange);
    const afterRequest = calls.length;
    await source.evaluate(() => history.pushState({}, "", "/navigation-during-request"));
    await assertClosed();
    for (let i = 0; i < 40 && !exchange.closed; i++) await source.waitForTimeout(25);
    assert(exchange.closed, "Navigation aborts the old model request");
    await select();
    assert.equal(await selection.locator("[data-selection-command=pin][aria-pressed=true]").count(), 0);
    assert(await host.locator("#result").isHidden(), "Old output does not reopen with a new selection");
    assert.equal(calls.length, afterRequest);

    await source.goto(origin + "/navigation-document");
    await host.waitFor({ state: "attached" });
    assert(await selection.isHidden());
    await source.goBack();
    await host.waitFor({ state: "attached" });
    await assertClosed();
    await select();
    await source.screenshot({ path: path.join(artifacts, "navigation-new-selection.png") });
    assert.equal(await host.count(), 1, "Navigation does not duplicate the toolbar");
    assert.deepEqual(errors, []);
    console.log("PASS: SPA link, push/replace/hash/back/forward and document navigation clear old tools; state-only updates keep them; pinned streaming work is cancelled; new selection works without automatic requests.");
  } finally {
    await source.close();
  }
};
