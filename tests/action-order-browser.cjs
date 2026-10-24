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
}) => {
  const snapshot = async () =>
    (
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: "snapshot" }),
      )
    ).value;
  const original = await snapshot();
  const patch = async (actions) => {
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
  const openMenu = async (id) => {
    const button = page.locator(`[data-op="action-menu"][data-id="${id}"]`);
    await button.evaluate((node) =>
      node.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await button.click();
    await page.locator(".action-popover").waitFor();
  };
  const setToolbar = async (id, checked) => {
    const input = page.locator(`[data-quick="${id}"]`);
    const previous = await input.elementHandle();
    await input.setChecked(checked);
    await page.waitForFunction((node) => !node.isConnected, previous);
  };
  let source;
  try {
    const actions = [
      ...original.actions,
      ...Array.from({ length: 6 }, (_, index) => ({
        ...original.actions[0],
        id: "order-" + index,
        kind: "custom",
        builtin: false,
        name: "Extra " + index,
        icon: "spark",
        quick: true,
      })),
    ];
    await patch(actions);
    await page.reload();
    await nav("actions");
    const before = calls.length;
    await setToolbar("summary", true);
    await page.waitForFunction(
      async () =>
        (
          await chrome.runtime.sendMessage({ type: "snapshot" })
        ).value.actions.find((action) => action.id === "summary").quick,
    );
    await setToolbar("summary", false);
    await page.waitForFunction(
      async () =>
        !(
          await chrome.runtime.sendMessage({ type: "snapshot" })
        ).value.actions.find((action) => action.id === "summary").quick,
    );
    assert(
      await page.locator('[data-quick="summary"]').isEnabled(),
      "More than five actions can be enabled",
    );
    const rowIcon = await page
      .locator('[data-op="edit-action"][data-id="explain"] svg')
      .innerHTML();
    assert.notEqual(
      rowIcon,
      await page
        .locator('[data-op="edit-action"][data-id="order-0"] svg')
        .innerHTML(),
    );
    source = await context.newPage();
    await source.goto(origin + "/action-order");
    const host = source.locator("[data-pagework=ui]");
    const bar = host.locator("#selection");
    const select = async () => {
      await host
        .locator("[data-selection-command=home]")
        .waitFor({ state: "attached" });
      await source.keyboard.press("Escape");
      await source.locator("#first").evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
      await source.keyboard.press("Shift");
      await bar.locator("[data-selection-command=expand]").waitFor();
    };
    const ids = () =>
      bar.evaluate((root) =>
        Array.from(
          root.querySelectorAll("[data-selection-action]"),
          (button) => button.dataset.selectionAction,
        ),
      );
    await select();
    assert.deepEqual(await ids(), ["translate", "plain", "explain"]);
    assert.equal(
      await bar
        .locator('[data-selection-action="explain"] svg path')
        .getAttribute("d"),
      await page
        .locator('[data-op="edit-action"][data-id="explain"] svg path')
        .getAttribute("d"),
    );
    await bar.locator('[data-selection-command="expand"]').click();
    assert.deepEqual(
      await ids(),
      actions.filter((action) => action.quick).map((action) => action.id),
    );
    assert.equal(
      await bar.locator('[data-selection-action="summary"]').count(),
      0,
    );
    assert.equal(
      await ids().then((values) => values.length),
      10,
      "Expanded actions are not capped at eight",
    );
    await openMenu("translate");
    assert(await op("move-action-up").isDisabled());
    await page.keyboard.press("Escape");
    await openMenu("order-5");
    assert(await op("move-action-down").isDisabled());
    await page.keyboard.press("Escape");
    await openMenu("order-0");
    await op("move-action-up").click();
    const reordered = [...actions];
    [reordered[4], reordered[5]] = [reordered[5], reordered[4]];
    await page.waitForFunction(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value
          .actions[4].id === "order-0" &&
        document.querySelectorAll('[data-op="edit-action"]')[4]?.dataset.id ===
          "order-0" &&
        document.activeElement?.dataset.op === "action-menu" &&
        document.activeElement?.dataset.id === "order-0",
    );
    assert.deepEqual(
      (await snapshot()).actions,
      reordered,
      "Sorting preserves every action field",
    );
    await openMenu("order-0");
    await op("move-action-down").click();
    await page.waitForFunction(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value
          .actions[5].id === "order-0" &&
        document.querySelectorAll('[data-op="edit-action"]')[5]?.dataset.id ===
          "order-0" &&
        document.activeElement?.dataset.op === "action-menu" &&
        document.activeElement?.dataset.id === "order-0",
    );
    assert.deepEqual((await snapshot()).actions, actions);
    await openMenu("order-0");
    await op("move-action-up").click();
    await page.waitForFunction(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value
          .actions[4].id === "order-0" &&
        document.querySelectorAll('[data-op="edit-action"]')[4]?.dataset.id ===
          "order-0" &&
        document.activeElement?.dataset.op === "action-menu" &&
        document.activeElement?.dataset.id === "order-0",
    );
    await select();
    assert.deepEqual(await ids(), ["translate", "plain", "explain"]);
    await page.reload();
    await nav("actions");
    assert.deepEqual(
      await page
        .locator('[data-op="edit-action"]')
        .evaluateAll((buttons) => buttons.map((button) => button.dataset.id)),
      reordered.map((action) => action.id),
    );
    await page.screenshot({
      path: path.join(artifacts, "actions-order.png"),
      fullPage: true,
    });
    await source.reload();
    await select();
    assert.deepEqual(await ids(), ["translate", "plain", "explain"]);
    await setToolbar("order-0", false);
    await page.waitForFunction(
      async () =>
        !(
          await chrome.runtime.sendMessage({ type: "snapshot" })
        ).value.actions.find((action) => action.id === "order-0").quick,
    );
    await select();
    assert.deepEqual(await ids(), ["translate", "plain", "explain"]);
    await bar.locator('[data-selection-command="expand"]').click();
    assert.equal(
      await bar.locator('[data-selection-action="order-0"]').count(),
      0,
    );
    await source.setViewportSize({ width: 390, height: 720 });
    await bar.screenshot({
      path: path.join(artifacts, "actions-expanded-order.png"),
      animations: "disabled",
    });
    assert(
      await bar
        .locator(".selection-actions")
        .evaluate((strip) => strip.scrollWidth > strip.clientWidth),
    );
    assert(
      await bar.evaluate(
        (root) => root.getBoundingClientRect().right <= innerWidth,
      ),
    );
    assert.equal(
      calls.length,
      before,
      "Reordering and toolbar visibility changes never request a model",
    );
    console.log(
      "PASS: Quick access hides disabled actions in both states; all enabled actions expand in saved order; Move up/down boundaries, live updates/reload persistence, Explain icon and narrow scrolling.",
    );
  } finally {
    await patch(original.actions);
    if (source) await source.close();
  }
};
