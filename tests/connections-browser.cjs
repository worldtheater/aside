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
  const status = page.locator("#connection-status");
  const usage = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "usage.list" })).value.length,
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
  await page
    .locator(".connection-detail-header")
    .screenshot({
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
  await page.screenshot({
    path: path.join(artifacts, "connections-model-list-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await choose("#ui-locale", "zh-CN");
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
    "PASS: URL/key-only model-list testing, searchable model selection, saved catalogs/credentials, four protocols and pagination, empty/invalid lists, stale-response isolation, zero generation calls and unchanged usage.",
  );
};
