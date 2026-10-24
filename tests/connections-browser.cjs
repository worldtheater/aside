const assert = require("node:assert/strict"),
  path = require("node:path");
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
  if (
    (await page.locator(".connection-item button").count()) ||
    (await page.locator("button.connection-item").count())
  )
    await op("add-connection").click();
  const field = (name) => page.locator(`[data-connection=${name}]`);
  const advanced = page.locator("#connection-advanced");
  assert.equal(await advanced.getAttribute("open"), null);
  assert.equal(await field("openaiCache").inputValue(), "auto");
  assert(await field("maxTokens").isHidden());
  assert(await field("concurrency").isHidden());
  await page.screenshot({
    path: path.join(artifacts, "connections-advanced-collapsed.png"),
    fullPage: true,
  });
  await advanced.locator("summary").click();
  for (const name of [
    "openaiCache",
    "maxTokens",
    "concurrency",
    "batchChars",
    "batchCount",
  ])
    assert.equal(
      await advanced.locator(`[data-connection=${name}]`).count(),
      1,
    );
  await field("maxTokens").fill("6144");
  await field("concurrency").fill("2");
  await field("batchChars").fill("6000");
  await field("batchCount").fill("4");
  await page.screenshot({
    path: path.join(artifacts, "connections-advanced-expanded.png"),
    fullPage: true,
  });
  await advanced.locator("summary").click();
  const status = page.locator("#connection-status");
  const usage = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "usage.overview" })).value
          .totalRecords,
    );
  const beforeUsage = await usage(),
    beforeCalls = calls.length;
  const test = async () => {
    await op("test-connection").click();
    await status.filter({ hasText: "连接成功" }).waitFor();
  };
  await field("url").fill(origin + "/v1");
  await field("key").fill("fixture-key");
  assert.equal(await field("name").inputValue(), "");
  assert.equal(await field("model").evaluate((n) => n.tagName), "SELECT");
  assert(await field("model").isDisabled());
  assert(await op("save-connection").isDisabled());
  await test();
  assert.equal(calls.length, beforeCalls, "Testing never generates content");
  assert.equal(await usage(), beforeUsage);
  assert.equal(
    await field("model").inputValue(),
    "",
    "Loading a list does not choose a model",
  );
  assert(await op("save-connection").isDisabled());
  const selectId = await field("model").getAttribute("id");
  await page.locator(`[data-select-for="${selectId}"]`).click();
  await page.locator(".option-search").fill("fixture-model");
  assert.equal(await page.locator(".option-list [role=option]").count(), 1);
  await page.locator("[role=option][data-value=fixture-model]").click();
  await field("name").fill("Model catalog fixture");
  await op("save-connection").click();
  await page.locator("#toast").filter({ hasText: "连接已保存" }).waitFor();
  const saved = await page.evaluate(async () =>
    (
      await chrome.runtime.sendMessage({ type: "snapshot" })
    ).value.connections.find((c) => c.name === "Model catalog fixture"),
  );
  assert(saved.models.length > 6);
  assert.equal(saved.model, "fixture-model");
  assert.equal(
    saved.openaiCache,
    "auto",
    "A new connection saves implicit caching without opening the cache selector",
  );
  assert.equal(saved.maxTokens, 6144);
  assert.deepEqual(
    saved.processing,
    { concurrency: 2, batchChars: 6000, batchCount: 4 },
    "Collapsing advanced settings preserves edits when saving",
  );
  const implicit = await page.evaluate(async (connection) => {
    const { requestBody } = await import("./providers.js");
    return requestBody(connection, "Stable instructions", "Source text");
  }, saved);
  assert.equal(implicit.prompt_cache_options, undefined);
  assert.equal(implicit.input[0].content[0].prompt_cache_breakpoint, undefined);
  assert.equal(implicit.max_output_tokens, 6144);
  const count = modelRequests.length;
  await page.reload();
  await page.locator("h1").waitFor();
  // Reload selects the first saved connection; select this test connection explicitly.
  await page
    .locator(`[data-op=select-connection][data-id="${saved.id}"]`)
    .click();
  assert.equal(
    modelRequests.length,
    count,
    "Reopening a connection uses its saved catalog",
  );
  assert.equal(await field("model").inputValue(), "fixture-model");
  assert(await field("model").isEnabled());
  assert.equal(await field("key").inputValue(), "");
  assert.equal(
    await advanced.getAttribute("open"),
    null,
    "Reopening a connection starts with advanced settings collapsed",
  );
  assert.equal(await field("maxTokens").inputValue(), "6144");
  assert.equal(await field("batchCount").inputValue(), "4");
  const snapshot = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value,
    );
  const beforeCopy = await snapshot(),
    beforeCopyRequests = modelRequests.length;
  await op("duplicate-connection").click();
  assert.equal(await field("name").inputValue(), saved.name + " · 副本");
  assert.equal(await field("url").inputValue(), saved.url);
  assert.equal(await field("protocol").inputValue(), saved.protocol);
  assert.equal(await field("model").inputValue(), saved.model);
  assert.equal(await field("key").inputValue(), "fixture-key");
  assert.equal(await field("key").getAttribute("type"), "password");
  assert.equal(await field("maxTokens").inputValue(), "6144");
  assert.equal(await field("batchCount").inputValue(), "4");
  assert.equal(
    modelRequests.length,
    beforeCopyRequests,
    "Duplicating reuses the model catalog without another request",
  );
  assert.deepEqual(
    (await snapshot()).connections,
    beforeCopy.connections,
    "A duplicate remains a draft until saved",
  );
  await field("name").fill("Copied model fixture");
  await choose("[data-connection=model]", "gpt-6-sol");
  await op("save-connection").click();
  await page.waitForFunction(async () =>
    (
      await chrome.runtime.sendMessage({ type: "snapshot" })
    ).value.connections.some((c) => c.name === "Copied model fixture"),
  );
  const afterCopy = await snapshot();
  const copied = afterCopy.connections.find(
    (c) => c.name === "Copied model fixture",
  );
  assert.notEqual(copied.id, saved.id);
  assert.equal(copied.model, "gpt-6-sol");
  assert.deepEqual(copied.models, saved.models);
  assert.deepEqual(copied.processing, saved.processing);
  assert.equal(copied.openaiCache, saved.openaiCache);
  assert.equal(afterCopy.defaultConnection, beforeCopy.defaultConnection);
  assert.deepEqual(
    afterCopy.connections.find((c) => c.id === saved.id),
    beforeCopy.connections.find((c) => c.id === saved.id),
  );
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await chrome.storage.local.get("credentials")).credentials[id],
      copied.id,
    ),
    "fixture-key",
  );
  await test();
  assert.equal(
    modelRequests.at(-1).auth,
    "Bearer fixture-key",
    "The saved duplicate can use the copied credential",
  );
  await op("duplicate-connection").click();
  await op("cancel-connection").click();
  assert.equal(
    (await snapshot()).connections.length,
    afterCopy.connections.length,
    "Cancelling a duplicate creates no connection",
  );
  await page
    .locator(`[data-op=select-connection][data-id="${saved.id}"]`)
    .click();
  await field("url").fill("https://other-provider.test/v1");
  await op("duplicate-connection").click();
  assert.equal(
    await field("key").inputValue(),
    "",
    "A changed service origin does not inherit the saved credential",
  );
  await op("cancel-connection").click();
  await page
    .locator(`[data-op=select-connection][data-id="${saved.id}"]`)
    .click();
  await field("key").fill("edited-fixture-key");
  await op("duplicate-connection").click();
  assert.equal(
    await field("key").inputValue(),
    "edited-fixture-key",
    "Explicit key edits are copied as part of the draft",
  );
  await op("cancel-connection").click();
  await page
    .locator(`[data-op=select-connection][data-id="${saved.id}"]`)
    .click();
  await advanced.locator("summary").click();
  await choose("[data-connection=openaiCache]", "explicit");
  await op("save-connection").click();
  await page.waitForFunction(
    async (id) =>
      (
        await chrome.runtime.sendMessage({ type: "snapshot" })
      ).value.connections.find((c) => c.id === id)?.openaiCache === "explicit",
    saved.id,
  );
  await page.reload();
  await page
    .locator(`[data-op=select-connection][data-id="${saved.id}"]`)
    .click();
  assert.equal(
    await field("openaiCache").inputValue(),
    "explicit",
    "Explicit choices are preserved across reopening",
  );
  await advanced.locator("summary").click();
  await choose("[data-connection=openaiCache]", "auto");
  await field("maxTokens").fill("2048");
  await op("cancel-connection").click();
  assert.equal(await field("openaiCache").inputValue(), "explicit");
  assert.equal(
    await field("maxTokens").inputValue(),
    "6144",
    "Cancel discards advanced edits",
  );
  await test();
  assert.equal(
    modelRequests.at(-1).auth,
    "Bearer fixture-key",
    "Blank key reuses the saved credential",
  );
  assert.equal(await field("model").inputValue(), "fixture-model");
  // The title-adjacent text action still updates the shared default.
  const previousDefault = await page.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "snapshot" })).value
        .defaultConnection,
  );
  await page.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "settings.save",
      patch: { defaultConnection: null },
    }),
  );
  await page.reload();
  await page
    .locator(`[data-op=select-connection][data-id="${saved.id}"]`)
    .click();
  await choose("#ui-locale", "en");
  await page.locator(".connection-detail-header").screenshot({
    path: path.join(artifacts, "connection-title-default-action.png"),
  });
  await page.locator(".connection-heading [data-op=set-default]").click();
  await page.waitForFunction(
    async (id) =>
      (await chrome.runtime.sendMessage({ type: "snapshot" })).value
        .defaultConnection === id,
    saved.id,
  );
  await page.evaluate(
    (defaultConnection) =>
      chrome.runtime.sendMessage({
        type: "settings.save",
        patch: { defaultConnection },
      }),
    previousDefault,
  );
  await page.reload();
  await page
    .locator(`[data-op=select-connection][data-id="${saved.id}"]`)
    .click();
  await op("theme-menu").click();
  await page.locator("[data-op=theme-mode][data-value=dark]").click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await advanced.locator("summary").click();
  await page.screenshot({
    path: path.join(artifacts, "connections-model-list.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 420, height: 900 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await advanced.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(artifacts, "connections-model-list-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await choose("#ui-locale", "zh-CN");
  assert.equal(await advanced.getAttribute("open"), null);
  await field("key").fill("invalid-fixture");
  assert(await field("model").isDisabled());
  assert.equal(await field("model").inputValue(), "");
  await op("test-connection").click();
  await status.filter({ hasText: "认证失败" }).waitFor();
  assert(await field("model").isDisabled());
  assert(await op("save-connection").isDisabled());
  await field("key").fill("");
  await test();
  await choose("[data-connection=model]", "fixture-model");
  for (const protocol of ["anthropic", "gemini", "chat", "responses"]) {
    await choose("[data-connection=protocol]", protocol);
    assert(await field("model").isDisabled());
    const start = modelRequests.length;
    await test();
    const requests = modelRequests.slice(start);
    assert.equal(
      requests.length,
      protocol === "anthropic" || protocol === "gemini" ? 2 : 1,
    );
    assert(
      (await field("model").locator("option").allTextContents()).some((text) =>
        text.includes("last-model"),
      ),
      "All pages populate the selector",
    );
    assert(requests.every((request) => request.method === "GET"));
    await choose("[data-connection=model]", "fixture-model");
  }
  await field("key").fill("slow-fixture");
  await op("test-connection").click();
  await page.waitForFunction(
    () => document.querySelector("[data-op=test-connection]").disabled,
  );
  await field("url").fill(origin + "/empty");
  await page.waitForTimeout(600);
  assert(await field("model").isDisabled());
  assert.equal(
    await field("model").locator("option").count(),
    1,
    "Late response does not populate a changed connection",
  );
  await field("key").fill("fixture-key");
  await test();
  await status.filter({ hasText: "未返回可选模型" }).waitFor();
  assert(await op("save-connection").isDisabled());
  await field("url").fill(origin + "/malformed");
  await op("test-connection").click();
  await status.filter({ hasText: "模型列表格式不正确" }).waitFor();
  assert(await op("save-connection").isDisabled());
  await field("url").fill(origin + "/v1");
  await test();
  await choose("[data-connection=model]", "last-model");
  await op("save-connection").click();
  await page.locator("#toast").filter({ hasText: "连接已保存" }).waitFor();
  const direct = await page.evaluate(
    async (origin) =>
      chrome.runtime.sendMessage({
        type: "connection.test",
        connection: { id: null, url: origin + "/v1", protocol: "responses" },
        key: "fixture-key",
      }),
    origin,
  );
  assert(
    direct.ok && direct.value.some((m) => m.id === "fixture-model"),
    "Background contract needs no model or connection name",
  );
  assert.equal(calls.length, beforeCalls);
  assert.equal(await usage(), beforeUsage);
  assert(!modelRequests.some((r) => r.path.includes("fixture-key")));
  console.log(
    "PASS: implicit caching defaults, advanced settings save/reopen/cancel, URL/key-only model-list testing, searchable model selection, saved catalogs/credentials, four protocols and pagination, empty/invalid lists, stale-response isolation, zero generation calls and unchanged usage.",
  );
};
