const assert = require("node:assert/strict");
const path = require("node:path");
module.exports = async ({ page, artifacts, nav, op, choose }) => {
  const stored = await page.evaluate(async () => {
    const data = await chrome.storage.local.get(null);
    return {
      settings: data.settings,
      usage: Object.fromEntries(
        Object.entries(data).filter(([key]) => key.startsWith("usage:")),
      ),
    };
  });
  const fixture = await page.evaluate(() => {
    const day = (ago, hour = 0) => {
      const d = new Date();
      d.setHours(hour, 0, 0, 0);
      d.setDate(d.getDate() - ago);
      return d.getTime();
    };
    const entries = [
      [9, 12000],
      [7, 28000],
      [6, 18000],
      [4, null],
      [3, 41000],
      [2, 0],
      [1, 21500],
      [0, 30000],
      [0, 7000, "b"],
      [0, 1000, "a", false],
      [0, null],
    ];
    return {
      dates: Array.from({ length: 10 }, (_, ago) => day(ago)),
      records: entries.map(
        ([ago, total, connection = "a", final = true], index) => ({
          id: "chart-" + index,
          startedAt: day(ago, 12),
          durationMs: 30,
          connectionId: connection,
          connectionName: "Fixture " + connection,
          model: "chart-model",
          protocol: "chat",
          source: "selection",
          actionName: "Translate",
          status: "success",
          errorCode: null,
          usageFinal: final,
          tokens:
            total === null
              ? null
              : {
                  inputTokens: Math.max(0, total - 100),
                  outputTokens: Math.min(100, total),
                  cachedTokens: null,
                  cacheWriteTokens: null,
                  reasoningTokens: null,
                  totalTokens: total,
                },
        }),
      ),
    };
  });
  const day = (ago) => page.locator(`[data-usage-day="${fixture.dates[ago]}"]`);
  const total = (records) =>
    new Intl.NumberFormat("zh-CN").format(
      records.reduce((sum, r) => sum + (r.tokens?.totalTokens ?? 0), 0),
    );
  const settle = () =>
    page.evaluate(() =>
      Promise.all(
        document.getAnimations().map((a) => a.finished.catch(() => {})),
      ),
    );
  const tip = page.locator("#usage-chart-tip");
  const checkTip = async (ago) => {
    await settle();
    assert.equal(
      await tip.textContent(),
      await day(ago).getAttribute("aria-label"),
    );
    assert(await tip.isVisible());
    const bounds = await tip.boundingBox();
    const viewport = page.viewportSize();
    assert(
      bounds.x >= 8 && bounds.x + bounds.width <= viewport.width - 8,
      "The tooltip stays inside the viewport, including edge bars",
    );
    assert(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
  };
  try {
    await page.evaluate(async (records) => {
      await chrome.runtime.sendMessage({ type: "usage.clear" });
      const { settings } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({
        settings: {
          ...settings,
          preferences: {
            ...settings.preferences,
            locale: "zh-CN",
            theme: "light",
          },
        },
        ...Object.fromEntries(records.map((r) => ["usage:" + r.id, r])),
      });
    }, fixture.records);
    await page.reload();
    await page.locator("h1").waitFor();
    await nav("usage");
    await page.waitForFunction(
      () => document.querySelectorAll("[data-usage-day]").length === 10,
    );
    assert.equal(
      await page.locator("[data-usage-total=totalTokens]").textContent(),
      total(fixture.records),
    );
    assert((await day(0).getAttribute("aria-label")).includes("38,000 token"));
    assert((await day(0).getAttribute("aria-label")).includes("部分上报"));
    assert.equal(await day(4).locator(".usage-chart-missing").count(), 1);
    assert(
      (await day(5).getAttribute("aria-label")).includes("0 token · 0 次调用"),
    );
    assert(
      (await day(2).getAttribute("aria-label")).includes("0 token · 1 次调用"),
    );
    assert.equal(await page.locator("#usage-chart-detail").count(), 0);
    assert(await tip.isHidden());
    await day(3).locator(".usage-chart-bar").hover();
    await checkTip(3);
    assert.equal(
      await day(3).evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
      "Hovering a bar does not highlight the entire date column",
    );
    await day(9).locator(".usage-chart-bar").hover();
    await checkTip(9);
    await day(0).locator(".usage-chart-bar").hover();
    await checkTip(0);
    await page.mouse.move(0, 0);
    await settle();
    assert(await tip.isHidden());
    await day(4).focus();
    await checkTip(4);
    await page.keyboard.press("Escape");
    await settle();
    assert(await tip.isHidden());
    await day(3).focus();
    await checkTip(3);
    await page
      .locator(".usage-chart")
      .screenshot({ path: path.join(artifacts, "usage-chart-light.png") });
    await choose("#usage-period", "7");
    assert(await tip.isHidden(), "Changing filters dismisses the old tooltip");
    assert.equal(await page.locator("[data-usage-day]").count(), 7);
    const week = fixture.records.filter((r) => r.startedAt >= fixture.dates[6]);
    assert.equal(
      await page.locator("[data-usage-total=totalTokens]").textContent(),
      total(week),
    );
    await choose("#usage-model", JSON.stringify(["a", "chart-model"]));
    assert((await day(0).getAttribute("aria-label")).includes("31,000 token"));
    assert.equal(
      await page.locator("[data-usage-total=totalTokens]").textContent(),
      total(week.filter((r) => r.connectionId === "a")),
    );
    await choose("#usage-period", "today");
    assert.equal(await page.locator("[data-usage-day]").count(), 1);
    await choose("#usage-period", "30");
    assert.equal(await page.locator("[data-usage-day]").count(), 30);
    await choose("#usage-model", "all");
    await choose("#ui-locale", "en");
    await op("theme-menu").click();
    await page.locator("[data-op=theme-mode][data-value=dark]").click();
    await page.keyboard.press("Escape");
    assert(
      (await day(0).getAttribute("aria-label")).includes("Partially reported"),
    );
    await day(0).locator(".usage-chart-bar").hover();
    await checkTip(0);
    await page
      .locator(".usage-chart")
      .screenshot({ path: path.join(artifacts, "usage-chart-dark.png") });
    await page.setViewportSize({ width: 360, height: 900 });
    await page.waitForFunction(() => document.querySelector(".sidebar").inert);
    await settle();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    // Re-render in the narrow viewport, as on an initial mobile visit or filter change.
    await choose("#usage-period", "7");
    await choose("#usage-period", "30");
    assert(
      await page
        .locator(".usage-chart-scroll")
        .evaluate((el) => el.scrollWidth > el.clientWidth && el.scrollLeft > 0),
    );
    await day(0).focus();
    await checkTip(0);
    await page
      .locator(".usage-chart")
      .screenshot({ path: path.join(artifacts, "usage-chart-mobile.png") });
    await page.locator(".usage-chart-scroll").evaluate((el) => {
      el.scrollLeft = 0;
    });
    await tip.waitFor({ state: "hidden" });
    const extra = {
      ...fixture.records.find((r) => r.tokens?.totalTokens === 1000),
      id: "chart-live",
      tokens: {
        inputTokens: 1900,
        outputTokens: 100,
        cachedTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
        totalTokens: 2000,
      },
      usageFinal: true,
    };
    await page.evaluate(
      (r) => chrome.storage.local.set({ ["usage:" + r.id]: r }),
      extra,
    );
    await page.waitForFunction(
      (date) =>
        document
          .querySelector(`[data-usage-day="${date}"]`)
          ?.getAttribute("aria-label")
          .includes("40,000 tokens"),
      fixture.dates[0],
    );
    assert.equal(
      await page.locator("[data-usage-total=totalTokens]").textContent(),
      total([...fixture.records, extra]),
    );
    await op("usage-clear-ask").click();
    assert.equal(await page.locator("dialog > .dialog-close").count(), 0);
    const cancelClear = await page.locator("dialog [data-op=dialog-close]").boundingBox();
    const confirmClear = await op("usage-clear").boundingBox();
    assert(cancelClear.x + cancelClear.width < confirmClear.x);
    await op("usage-clear").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("dialog").open &&
        document.querySelector(".usage-chart-empty"),
    );
    assert.equal(await page.locator("[data-usage-day]").count(), 0);
    assert.equal(await tip.count(), 0);
    assert.equal(
      await page.locator("[data-usage-total=totalTokens]").textContent(),
      "—",
    );
    console.log(
      "PASS: daily chart values, missing/zero/partial distinctions, filter synchronization, hover/focus tooltips, edge positioning and dismissal, live updates, clear, localization and responsive scrolling.",
    );
  } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(async (stored) => {
      await chrome.runtime.sendMessage({ type: "usage.clear" });
      await chrome.storage.local.set({
        settings: stored.settings,
        ...stored.usage,
      });
    }, stored);
    await page.reload();
    await page.locator("h1").waitFor();
    await nav("home");
  }
};
