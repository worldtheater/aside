const assert = require("node:assert/strict");
const path = require("node:path");
module.exports = async ({
  page,
  nav,
  op,
  artifacts,
}) => {
  const message = (type, payload = {}) =>
    page.evaluate(
      ({ type, payload }) => chrome.runtime.sendMessage({ type, ...payload }),
      { type, payload },
    );
  const snapshot = async () => (await message("snapshot")).value;
  const original = await snapshot();
  const patch = async (actions) => {
    const result = await message("settings.save", { patch: { actions } });
    assert(result.ok, JSON.stringify(result));
  };
  const seeded = Array.from({ length: 20 }, (_, index) => ({
    id: "limit-" + index,
    name: "Action " + (index + 1),
    instruction: "Action instruction " + index,
    icon: "spark",
    kind: "custom",
    mode: "whole",
    placement: "panel",
    model: "default",
    quick: index < 8,
    builtin: false,
  }));

  try {
    const presetIds = await page.evaluate(async () => [
      ...(await import("./action-policy.js")).PRESET_ACTION_IDS,
    ]);
    await nav("actions");
    await op("new").click();
    assert.equal(await page.locator("[data-op=template]").count(), 0);
    assert.equal(await page.locator("#action-name").inputValue(), "");
    assert.equal(await page.locator("[data-draft=quick]").count(), 0);
    await op("save").click();
    assert(await page.locator("#editor-error").isVisible(), "Validation keeps the editor open");
    await op("editor-cancel").click();
    await page.waitForURL(/#actions$/);
    assert.equal(await page.locator("#action-name").count(), 0);
    await op("new").click();
    await page.locator("#action-name").fill("List-managed quick access");
    await page.locator("#instruction").fill("Explain this passage clearly.");
    await op("save").click();
    await page.waitForFunction(async () =>
      (
        await chrome.runtime.sendMessage({ type: "snapshot" })
      ).value.actions.some((a) => a.name === "List-managed quick access"),
    );
    await page.waitForURL(/#actions$/);
    assert.equal(await page.locator("#action-name").count(), 0, "Successful save exits the editor");
    const managed = (await snapshot()).actions.find(
      (a) => a.name === "List-managed quick access",
    );
    assert.equal(
      managed.quick,
      false,
      "Creating an action does not add it to the toolbar",
    );
    await page.locator(`[data-op=edit-action][data-id="${managed.id}"]`).click();
    await page.locator("#action-name").fill("Discard this edit");
    await op("editor-cancel").click();
    await page.waitForURL(/#actions$/);
    assert.equal((await snapshot()).actions.find(a => a.id === managed.id).name, managed.name);
    await page.locator(`[data-op=edit-action][data-id="${managed.id}"]`).click();
    assert.equal(await page.locator("#action-name").inputValue(), managed.name);
    await page.locator("#action-name").fill("Keep this failed save draft");
    await page.evaluate(() => {
      window.sendBeforeSaveFailure = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async message => message.type === "settings.save"
        ? {ok:false, error:"storageFailed"} : window.sendBeforeSaveFailure(message);
    });
    await op("save").click();
    await page.locator('#toast[data-kind=error]:popover-open').waitFor();
    assert.equal(await page.locator("#action-name").inputValue(), "Keep this failed save draft");
    assert.equal((await snapshot()).actions.find(a => a.id === managed.id).name, managed.name);
    await page.evaluate(() => { chrome.runtime.sendMessage = window.sendBeforeSaveFailure; });
    await op("editor-cancel").click();
    await page.waitForURL(/#actions$/);
    assert(await page.locator("#toast").isHidden());
    // Reopening the editor must not overwrite the list's newer toolbar setting.
    for (const quick of [true, false]) {
      await nav("actions");
      await page.locator(`[data-quick="${managed.id}"]`).setChecked(quick);
      await page.waitForFunction(
        async ({ id, quick }) =>
          (
            await chrome.runtime.sendMessage({ type: "snapshot" })
          ).value.actions.find((a) => a.id === id).quick === quick,
        { id: managed.id, quick },
      );
      await page
        .locator(`[data-op=edit-action][data-id="${managed.id}"]`)
        .click();
      assert.equal(await page.locator("[data-draft=quick]").count(), 0);
      const name = `Preserve list state ${quick}`;
      await page.locator("#action-name").fill(name);
      await op("save").click();
      await page.waitForFunction(
        async ({ id, name }) =>
          (
            await chrome.runtime.sendMessage({ type: "snapshot" })
          ).value.actions.find((a) => a.id === id).name === name,
        { id: managed.id, name },
      );
      assert.equal(
        (await snapshot()).actions.find((a) => a.id === managed.id).quick,
        quick,
      );
    }
    await patch(original.actions);
    await page.reload();
    await nav("actions");
    console.log(
      "PASS: quick access is managed by the list; new actions start outside the toolbar and editor saves preserve list changes.",
    );
    for (const id of presetIds) {
      await page.locator(`[data-op=action-menu][data-id="${id}"]`).click();
      assert.equal(
        await page.locator(".action-popover [data-op=remove-ask]").count(),
        0,
      );
      assert(
        await page.locator(".action-popover [data-op=menu-edit]").isEnabled(),
      );
      assert(
        await page.locator(".action-popover [data-op=duplicate]").isEnabled(),
      );
      await page.keyboard.press("Escape");
    }
    // Editing a preset cannot make its factory ID deletable.
    await page.locator("[data-op=edit-action][data-id=plain]").click();
    assert.equal(await page.locator("[data-op=template]").count(), 0);
    await page.locator("#action-name").fill("Edited preset");
    await page
      .locator("#instruction")
      .fill("Keep my edited preset instructions.");
    await op("save").click();
    await page.waitForFunction(
      async () =>
        (
          await chrome.runtime.sendMessage({ type: "snapshot" })
        ).value.actions.find((a) => a.id === "plain").name === "Edited preset",
    );
    const edited = (await snapshot()).actions.find((a) => a.id === "plain");
    assert.equal(edited.builtin, false);
    assert.equal(edited.kind, "plain");
    await nav("actions");
    await page.locator("[data-op=action-menu][data-id=plain]").click();
    assert.equal(
      await page.locator(".action-popover [data-op=remove-ask]").count(),
      0,
    );
    await page.keyboard.press("Escape");
    const protectedState = await snapshot();
    for (const id of presetIds) {
      const result = await message("settings.save", {
        patch: {
          preferences: {
            ...protectedState.preferences,
            theme:
              protectedState.preferences.theme === "dark" ? "light" : "dark",
          },
          actions: protectedState.actions.filter((a) => a.id !== id),
        },
      });
      assert.equal(result.error, "presetActionProtected");
      const after = await snapshot();
      assert.deepEqual(after.actions, protectedState.actions);
      assert.deepEqual(
        after.preferences,
        protectedState.preferences,
        "A rejected deletion does not partially apply other settings",
      );
    }
    await page.locator("[data-op=action-menu][data-id=summary]").click();
    await op("duplicate").click();
    await page.waitForFunction(
      async (count) =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value.actions
          .length ===
        count + 1,
      protectedState.actions.length,
    );
    const duplicate = (await snapshot()).actions.find(
      (a) => !protectedState.actions.some((before) => before.id === a.id),
    );
    assert(duplicate);
    assert.equal(duplicate.kind, "summary");
    await nav("actions");
    await page
      .locator(`[data-op=action-menu][data-id="${duplicate.id}"]`)
      .click();
    await page.locator(".action-popover [data-op=remove-ask]").click();
    assert((await snapshot()).actions.some((a) => a.id === duplicate.id));
    const confirmation = page.locator("dialog");
    assert.equal(await confirmation.locator(":scope > .dialog-close").count(), 0);
    const cancel = confirmation.locator("[data-op=dialog-close]");
    const remove = confirmation.locator("[data-op=remove-confirm]");
    assert.equal(await confirmation.locator("button").count(), 2);
    assert(await cancel.evaluate((node) => node === document.activeElement),
      "Cancel receives initial focus");
    const left = await cancel.boundingBox(), right = await remove.boundingBox();
    assert(left.x + left.width < right.x && Math.abs(left.y - right.y) < 1);
    await confirmation.screenshot({ path: path.join(artifacts, "delete-action-confirmation.png"), animations: "disabled" });
    await page.locator("dialog .dialog-actions [data-op=dialog-close]").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    assert(
      (await snapshot()).actions.some((a) => a.id === duplicate.id),
      "Cancelling deletion keeps the copy",
    );
    await page
      .locator(`[data-op=action-menu][data-id="${duplicate.id}"]`)
      .click();
    await page.locator(".action-popover [data-op=remove-ask]").click();
    await op("remove-confirm").click();
    await page.waitForFunction(
      async (id) =>
        !document.querySelector("dialog").open &&
        !(
          await chrome.runtime.sendMessage({ type: "snapshot" })
        ).value.actions.some((a) => a.id === id),
      duplicate.id,
    );
    assert(
      (await snapshot()).actions.some((a) => a.id === "summary"),
      "Deleting a copy keeps the original preset",
    );
    console.log(
      "PASS: preset deletion protection after editing, atomic backend rejection, and cancellable deletion of preset copies.",
    );
    // Install capacity/empty-toolbar fixtures directly in the isolated profile;
    // the product settings API correctly rejects replacing its preset actions.
    await page.evaluate(async (actions) => {
      const { settings } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: { ...settings, actions } });
    }, seeded);
    await page.reload();
    await nav("actions");
    assert(await op("new").isDisabled());
    await page.locator("[data-op=action-menu][data-id=limit-0]").click();
    assert(await op("duplicate").isDisabled());
    await page.keyboard.press("Escape");
    const toggle = (id) => page.locator(`[data-quick="${id}"]`);
    assert(await toggle("limit-8").isEnabled());
    await toggle("limit-0").uncheck();
    await toggle("limit-8").check();
    assert(await toggle("limit-0").isEnabled());
    assert.equal((await snapshot()).actions.filter((a) => a.quick).length, 8);
    await page.locator("[data-op=edit-action][data-id=limit-6]").click();
    await page.locator("#action-name").fill("Updated at capacity");
    await op("save").click();
    await page.waitForFunction(
      async () =>
        (
          await chrome.runtime.sendMessage({ type: "snapshot" })
        ).value.actions.find((a) => a.id === "limit-6").name ===
        "Updated at capacity",
    );
    assert.equal((await snapshot()).actions.length, 20);
    const twenty = (await snapshot()).actions;
    const extra = { ...seeded[0], id: "extra", quick: false };
    assert.equal(
      (
        await message("settings.save", {
          patch: { actions: [...twenty, extra] },
        })
      ).error,
      "actionLimit",
    );
    assert.equal(
      (
        await message("settings.save", {
          patch: {
            actions: twenty.map((a) =>
              a.id === "limit-0" ? { ...a, quick: true } : a,
            ),
          },
        })
      ).ok,
      true,
    );
    assert.equal(
      (await message("actions.save", { changes: [{ ...extra, create: true }] }))
        .error,
      "actionLimit",
    );
    assert.equal((await snapshot()).actions.length, 20);
    await patch(twenty.slice(0, 19));
    await page.reload();
    await nav("actions");
    await op("new").click();
    await page.locator("#action-name").fill("Twentieth action");
    await page.locator("#instruction").fill("Process the passage clearly.");
    assert.equal(await page.locator("[data-draft=quick]").count(), 0);
    await op("save").click();
    await page.waitForFunction(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value.actions
          .length === 20,
    );
    assert.equal((await snapshot()).actions.filter((a) => a.quick).length, 8);
    // Duplicating at 19 preserves the enabled state without a shortcut quota.
    await patch(twenty.slice(0, 19));
    await page.reload();
    await nav("actions");
    await page.locator("[data-op=action-menu][data-id=limit-1]").click();
    await op("duplicate").click();
    await page.waitForFunction(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value.actions
          .length === 20,
    );
    assert.equal((await snapshot()).actions.filter((a) => a.quick).length, 9);
    console.log("PASS: 20-action capacity, unlimited toolbar enablement, create/duplicate/save and backend limit validation.");
  } finally {
    await patch(original.actions);
    await page.reload();
  }
};
