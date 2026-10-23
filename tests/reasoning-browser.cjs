const assert = require("node:assert/strict");
module.exports = async ({
  page,
  origin,
  calls,
  modelRequests,
  artifacts,
  nav,
  op,
  choose,
}) => {
  await nav("connections");
  const field = (name) => page.locator(`[data-connection=${name}]`);
  const connectionId = await page
    .locator(".connection-item.selected")
    .getAttribute("data-id");
  const saved = async () =>
    page.evaluate(
      async (id) =>
        (
          await chrome.runtime.sendMessage({ type: "snapshot" })
        ).value.connections.find((c) => c.id === id),
      connectionId,
    );
  const save = async (effort) => {
    await op("save-connection").click();
    await page.waitForFunction(
      async ({ id, effort }) =>
        (
          await chrome.runtime.sendMessage({ type: "snapshot" })
        ).value.connections.find((c) => c.id === id)?.reasoningEffort ===
        effort,
      { id: connectionId, effort },
    );
    await page.reload();
    await page.locator("h1").waitFor();
    await page
      .locator(`[data-op=select-connection][data-id="${connectionId}"]`)
      .click();
    assert.equal(await field("reasoningEffort").inputValue(), effort || "");
  };
  const process = async (protocol) =>
    page.evaluate(
      async ({ id, protocol }) => {
        const { processRequest } = await import("./client.js");
        return processRequest({
          source: "trial",
          action: {
            kind: "custom",
            mode: "paragraph",
            model: id,
            instruction: "Reasoning settings browser fixture",
          },
          blocks: [
            { id: "reasoning", text: "Reuse this content for " + protocol },
          ],
        }).promise;
      },
      { id: connectionId, protocol },
    );
  for (const protocol of ["responses", "anthropic", "gemini", "chat"]) {
    const model =
      protocol === "anthropic"
        ? "fixture-model"
        : protocol === "gemini"
          ? "gemini-3.8-flash"
          : "gpt-6-sol";
    await choose("[data-connection=protocol]", protocol);
    assert.equal(await field("reasoningEffort").inputValue(), "");
    await op("test-connection").click();
    await page
      .locator("#connection-status")
      .filter({ hasText: "连接成功" })
      .waitFor();
    await choose("[data-connection=model]", model);
    const values = await field("reasoningEffort")
      .locator("option")
      .evaluateAll((nodes) => nodes.map((n) => n.value));
    if (protocol === "anthropic")
      assert.deepEqual(values, ["", "low", "high", "max"]);
    if (protocol === "gemini")
      assert.deepEqual(values, ["", "low", "medium", "high"]);
    if (protocol === "gemini") {
      await choose("[data-connection=model]", "gemini-3.6-flash");
      assert.deepEqual(
        await field("reasoningEffort")
          .locator("option")
          .evaluateAll((nodes) => nodes.map((n) => n.value)),
        ["", "minimal", "low", "medium", "high"],
      );
      await choose("[data-connection=reasoningEffort]", "minimal");
      await choose("[data-connection=model]", model);
      assert.equal(await field("reasoningEffort").inputValue(), "");
    }
    await choose("[data-connection=reasoningEffort]", "high");
    await save("high");
    const before = calls.length;
    await process(protocol);
    assert.equal(calls.length, before + 1);
    const body = calls.at(-1).body;
    if (protocol === "responses")
      assert.deepEqual(body.reasoning, { effort: "high" });
    if (protocol === "chat") assert.equal(body.reasoning_effort, "high");
    if (protocol === "anthropic") {
      assert.deepEqual(body.output_config, { effort: "high" });
      assert.deepEqual(body.thinking, { type: "adaptive" });
      assert.deepEqual(
        (await saved()).models.find((m) => m.id === "fixture-model")
          .reasoningEfforts,
        ["low", "high", "max"],
      );
    }
    if (protocol === "gemini") {
      assert.equal(body.generation_config.thinking_level, "high");
      assert.equal(
        body.generation_config.max_output_tokens,
        (await saved()).maxTokens,
      );
    }
    assert.equal((await process(protocol)).stats.hits, 1);
    assert.equal(calls.length, before + 1);
    await choose("[data-connection=reasoningEffort]", "low");
    await save("low");
    await process(protocol);
    assert.equal(
      calls.length,
      before + 2,
      "Changing effort requests a different result",
    );
    await choose("[data-connection=reasoningEffort]", "high");
    await save("high");
    assert.equal((await process(protocol)).stats.hits, 1);
    assert.equal(
      calls.length,
      before + 2,
      "Returning to the previous effort reuses its cached result",
    );
    const tested = modelRequests.length;
    await op("test-connection").click();
    await page
      .locator("#connection-status")
      .filter({ hasText: "连接成功" })
      .waitFor();
    assert(modelRequests.length > tested);
    assert.equal(calls.length, before + 2);
    assert.equal(await field("reasoningEffort").inputValue(), "high");
    if (protocol === "anthropic") {
      await choose("[data-connection=model]", "model-0");
      assert(await field("reasoningEffort").isDisabled());
      assert.equal(await field("reasoningEffort").inputValue(), "");
      await choose("[data-connection=model]", model);
      const invalid = await page.evaluate(
        async (connection) =>
          chrome.runtime.sendMessage({
            type: "connection.save",
            connection: { ...connection, reasoningEffort: "none" },
          }),
        await saved(),
      );
      assert.equal(invalid.error, "invalidReasoning");
    }
    await choose("[data-connection=model]", "model-2");
    assert.equal(
      await field("reasoningEffort").inputValue(),
      "",
      "Changing models resets reasoning",
    );
    assert(
      await field("reasoningEffort").isDisabled(),
      "Unknown models only use service defaults",
    );
    await choose("[data-connection=model]", model);
    await save(undefined);
    const defaultStart = calls.length;
    await process(protocol);
    assert.equal(calls.length, defaultStart + 1);
    const ordinary = calls.at(-1).body;
    assert.equal(ordinary.reasoning, undefined);
    assert.equal(ordinary.reasoning_effort, undefined);
    assert.equal(ordinary.output_config, undefined);
    assert.equal(ordinary.thinking, undefined);
    assert.equal(ordinary.generation_config?.thinking_level, undefined);
  }
  // Reproduce the persisted Gemini minimal setting from the reported failure.
  await page.evaluate(async (id) => {
    const { settings } = await chrome.storage.local.get("settings");
    const c = settings.connections.find((c) => c.id === id);
    Object.assign(c, {
      protocol: "gemini",
      model: "gemini-3.8-flash",
      reasoningEffort: "minimal",
    });
    await chrome.storage.local.set({ settings });
  }, connectionId);
  await page.reload();
  await page.locator("h1").waitFor();
  await nav("connections");
  await page
    .locator(`[data-op=select-connection][data-id="${connectionId}"]`)
    .click();
  assert.equal(await field("reasoningEffort").inputValue(), "minimal");
  assert.match(
    await page.locator("#connection-reasoning").textContent(),
    /不再支持/,
  );
  const failed = await page.evaluate(
    async (connection) =>
      chrome.runtime.sendMessage({ type: "connection.save", connection }),
    await saved(),
  );
  assert.equal(failed.error, "invalidReasoning");
  const requestCount = calls.length;
  const error = await process("stale-gemini").then(
    () => null,
    (e) => e.message,
  );
  assert.match(error, /invalidReasoning/);
  assert.equal(
    calls.length,
    requestCount,
    "Reject unsupported stored effort before the network",
  );
  await page.screenshot({
    path: artifacts + "/reasoning-invalid-setting.png",
    fullPage: true,
  });
  await nav("home");
  await op("daily-settings").click();
  await choose("#daily-model", connectionId);
  await op("daily-preview").click();
  await page.locator("#daily-preview-error").waitFor();
  assert.match(
    await page.locator("#daily-preview-error").textContent(),
    /模型连接/,
  );
  assert.equal(calls.length, requestCount);
  await page.locator("dialog .dialog-actions [data-op=dialog-close]").click();
  await nav("connections");
  await page
    .locator(`[data-op=select-connection][data-id="${connectionId}"]`)
    .click();
  await op("test-connection").click();
  await page
    .locator("#connection-status")
    .filter({ hasText: "连接成功" })
    .waitFor();
  assert.equal(
    await field("reasoningEffort").inputValue(),
    "minimal",
    "Refreshing metadata must not silently replace the saved effort",
  );
  await choose("[data-connection=reasoningEffort]", "low");
  await save("low");
  await process("fixed-gemini");
  assert.equal(calls.at(-1).body.generation_config.thinking_level, "low");
  await nav("home");
  await op("daily-settings").click();
  await choose("#daily-model", connectionId);
  await op("daily-preview").click();
  await page
    .locator(".daily-preview-text")
    .filter({ hasText: "A thought generated" })
    .waitFor();
  assert.equal(calls.at(-1).body.generation_config.thinking_level, "low");
  assert.equal(await page.locator("#daily-preview-error").count(), 0);
  await page.screenshot({ path: artifacts + "/reasoning-daily-preview.png" });
  await page.locator("dialog .dialog-actions [data-op=dialog-close]").click();
  await nav("connections");
  await page
    .locator(`[data-op=select-connection][data-id="${connectionId}"]`)
    .click();
  await choose("#ui-locale", "en");
  await op("theme-menu").click();
  await page.locator("[data-op=theme-mode][data-value=dark]").click();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: artifacts + "/connections-reasoning.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 420, height: 900 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: artifacts + "/connections-reasoning-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  console.log(
    "PASS: model-specific reasoning, four actual wire formats, saved-invalid Gemini rejection and repair, daily preview recovery, catalog filtering, defaults and isolated cache reuse.",
  );
};
