const assert = require("node:assert/strict"),
  path = require("node:path");
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
  await nav("appearance");
  await choose("#style-target", "page");
  await op("reset-style").click();
  assert(!(await page.locator("[data-style=customTypography]").isChecked()));
  assert(await page.locator("#typography-controls").isHidden());
  const source = await context.newPage();
  await source.goto(origin + "/radial-page");
  await source.locator("#first").evaluate((node) => {
    node.textContent = "A unique page paragraph for radial translation.";
  });
  await source.addStyleTag({
    content: `
    h1{font-family:Georgia,serif;font-size:clamp(26px,3vw,42px);line-height:1.2}
    p{font-family:Georgia,serif;font-size:18px;line-height:1.65}
    #second{display:flex;align-items:baseline;font-family:Arial,sans-serif;font-size:20px;line-height:1.4}
    @media(max-width:600px){p{font-size:15px}}
  `,
  });
  const assertTypography = async (manual = false) => {
    for (const selector of ["h1", "#first", "#second"]) {
      const styles = await source.locator(selector).evaluate((node) => {
        const source = getComputedStyle(node);
        const result = getComputedStyle(
          node.querySelector("[data-pagework=result]").shadowRoot
            .firstElementChild,
        );
        const pick = (style) =>
          Object.fromEntries(
            [
              "fontFamily",
              "fontSize",
              "lineHeight",
              "fontWeight",
              "fontStyle",
            ].map((key) => [key, style[key]]),
          );
        return { source: pick(source), result: pick(result) };
      });
      assert.deepEqual(
        styles.result,
        manual
          ? { ...styles.source, fontSize: "21px", lineHeight: "31.5px" }
          : styles.source,
        selector,
      );
    }
  };
  const assertPreviewTypography = async () => {
    assert(
      await page
        .locator(".preview-content .processed-text")
        .evaluate((node) => {
          const original = getComputedStyle(node.parentElement),
            result = getComputedStyle(node);
          return ["fontFamily", "fontSize", "lineHeight"].every(
            (key) => original[key] === result[key],
          );
        }),
    );
  };
  await assertPreviewTypography();
  const host = source.locator("[data-pagework=ui]"),
    dock = host.locator("#dock"),
    radial = host.locator("#radial");
  await dock.waitFor();
  await source.emulateMedia({ colorScheme: "light" });
  await dock.click();
  await radial.locator("button").first().waitFor();
  assert.deepEqual(
    await radial.evaluate((root) =>
      Array.from(root.querySelectorAll("button"), (n) => n.dataset.op),
    ),
    ["home", "page-translate", "toggle-lights", "quick-question", "dock-pin"],
  );
  const tabId = await page.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    source.url(),
  );
  const lights = radial.locator("[data-op=toggle-lights]");
  const waitLights = async (on, mode = on ? "on" : "off") => {
    await source.waitForFunction(
      (on) =>
        (document.documentElement.dataset.darkreaderMode === "dynamic") === on,
      on,
    );
    await radial.locator("[data-op=toggle-lights]:not(:disabled)").waitFor();
    assert.equal(
      await lights.getAttribute("aria-pressed"),
      String(mode !== "off"),
    );
    assert.equal(
      await lights.getAttribute("aria-label"),
      {
        on: "暗色模式-开",
        off: "暗色模式-关",
        system: "暗色模式-跟随系统",
      }[mode],
    );
  };
  await source.mouse.move(0, 0);
  await radial.evaluate((root) =>
    Promise.all(
      root
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  await source.screenshot({
    path: path.join(artifacts, "radial-lights-off-detail.png"),
    clip: { x: 1220, y: 380, width: 220, height: 240 },
  });
  const lightIcon = await lights.locator("path").getAttribute("d");
  assert.equal(await lights.getAttribute("aria-pressed"), "false");
  assert.equal(await lights.getAttribute("aria-label"), "暗色模式-关");
  assert.equal(await radial.locator("[data-op=lang],.lang").count(), 0);
  // Refusing the permission request keeps both the saved setting and icon off.
  const worker = context
    .serviceWorkers()
    .find((worker) => worker.url().endsWith("/background.js"));
  await worker.evaluate(() => {
    globalThis.originalPermissionsRequest = chrome.permissions.request;
    chrome.permissions.request = async () => false;
  });
  try {
    await lights.click();
    await host
      .locator("#notice")
      .filter({ hasText: "开启暗色模式需要读取网页样式" })
      .waitFor();
    await waitLights(false);
    assert.equal(await lights.locator("path").getAttribute("d"), lightIcon);
  } finally {
    await worker.evaluate(() => {
      chrome.permissions.request = globalThis.originalPermissionsRequest;
      delete globalThis.originalPermissionsRequest;
    });
  }
  await host.locator("#notice").waitFor({ state: "hidden" });
  const manager = await context.newPage();
  await manager.goto("chrome://extensions");
  for (const host of ["http://*/*", "https://*/*"])
    await manager.evaluate(
      ({ id, host }) => chrome.developerPrivate.addHostPermission(id, host),
      { id: new URL(page.url()).hostname, host },
    );
  await manager.close();
  assert(
    await page.evaluate(() =>
      chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }),
    ),
  );
  const companion = await context.newPage();
  await companion.goto(origin + "/radial-companion");
  await companion.locator("[data-pagework=ui]").waitFor({ state: "attached" });
  const beforeLights = calls.length;
  const companionId = await page.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
    companion.url(),
  );
  // A background tab can receive a setting but keep its acknowledgement pending.
  // Its controller recovery must not hold the active tab's lights switch either.
  await source.bringToFront();
  for (const pendingType of ["settings.updated", "lights.status"]) {
    await worker.evaluate(
      ({ tabId, pendingType }) => {
        globalThis.originalTabSendMessage = chrome.tabs.sendMessage;
        const waiting = new Promise((resolve) => {
          globalThis.releaseTabSync = resolve;
        });
        chrome.tabs.sendMessage = async (id, message, ...args) => {
          const response = await globalThis.originalTabSendMessage(
            id,
            message,
            ...args,
          );
          if (id === tabId && message.type === pendingType) await waiting;
          return response;
        };
      },
      { tabId: companionId, pendingType },
    );
    try {
      await lights.click();
      await waitLights(true);
      await lights.click();
      await waitLights(false, "system");
      await lights.click();
      await waitLights(false);
    } finally {
      await worker.evaluate(() => {
        chrome.tabs.sendMessage = globalThis.originalTabSendMessage;
        globalThis.releaseTabSync();
        delete globalThis.originalTabSendMessage;
        delete globalThis.releaseTabSync;
      });
    }
  }
  await companion.waitForFunction(
    () => !document.documentElement.dataset.darkreaderMode,
  );
  await lights.click();
  await waitLights(true);
  assert.equal(await lights.getAttribute("aria-label"), "暗色模式-开");
  const darkIcon = await lights.locator("path").getAttribute("d");
  assert.notEqual(darkIcon, lightIcon);
  await companion.waitForFunction(
    () => document.documentElement.dataset.darkreaderMode === "dynamic",
  );
  await source.mouse.move(0, 0);
  await source.waitForFunction(
    (button) => {
      const home = button.parentElement.querySelector('[data-op="home"]');
      return (
        getComputedStyle(button).backgroundColor ===
        getComputedStyle(home).backgroundColor
      );
    },
    await lights.elementHandle(),
  );
  await source.screenshot({
    path: path.join(artifacts, "radial-lights-on.png"),
  });
  await source.screenshot({
    path: path.join(artifacts, "radial-lights-on-detail.png"),
    clip: { x: 1220, y: 380, width: 220, height: 240 },
  });
  await companion.reload();
  await companion.waitForFunction(
    () => document.documentElement.dataset.darkreaderMode === "dynamic",
  );
  await companion.locator("[data-pagework=ui] #dock").click();
  assert.equal(
    await companion
      .locator("[data-pagework=ui] [data-op=toggle-lights]")
      .getAttribute("aria-pressed"),
    "true",
  );
  // The popup contains quick-tool switches only. Lights remains in the dock.
  const popup = await context.newPage();
  await source.bringToFront();
  await popup.goto(page.url().split("/").slice(0, 3).join("/") + "/popup.html");
  await popup.locator("#feature-controls").waitFor();
  assert.equal(await popup.locator("[data-feature=lights]").count(), 0);
  assert.equal(await popup.locator("[data-feature-group]").count(), 2);
  await popup.close();
  await source.bringToFront();
  await lights.click();
  await waitLights(false, "system");
  await source.emulateMedia({ colorScheme: "dark" });
  await waitLights(true, "system");
  await source.emulateMedia({ colorScheme: "light" });
  await waitLights(false, "system");
  await companion.waitForFunction(
    () => !document.documentElement.dataset.darkreaderMode,
  );
  await lights.click();
  await waitLights(false);
  assert.equal(await lights.locator("path").getAttribute("d"), lightIcon);
  await lights.click();
  await waitLights(true);
  await lights.click();
  await waitLights(false, "system");
  await lights.click();
  await waitLights(false);
  assert.equal(calls.length, beforeLights, "Lights toggles never call a model");
  const snapshot = (
    await page.evaluate(() => chrome.runtime.sendMessage({ type: "snapshot" }))
  ).value;
  assert(
    !snapshot.website.sites["127.0.0.1"]?.lights,
    "Turning off clears the site's lights override",
  );
  // A content control cannot use this endpoint to edit other features or tabs.
  for (const payload of [
    { patch: { toolbar: false } },
    { patch: { lights: "on", enhance: true } },
    { patch: { lights: "off" }, tabId },
  ]) {
    const [{ result }] = await page.evaluate(
      ({ tabId, payload }) =>
        chrome.scripting.executeScript({
          target: { tabId },
          func: (payload) =>
            chrome.runtime.sendMessage({ type: "website.update", ...payload }),
          args: [payload],
        }),
      { tabId, payload },
    );
    assert.equal(result.error, "notAllowed");
  }
  await companion.close();
  await source.setViewportSize({ width: 390, height: 640 });
  await source.screenshot({
    path: path.join(artifacts, "radial-lights-off-mobile.png"),
  });
  // Pinned radial controls remain expanded when clicking ordinary page content.
  await radial.locator("[data-op=dock-pin]").click();
  await source.mouse.click(15, 500);
  assert(await radial.evaluate((n) => n.classList.contains("open")));
  assert.equal(await dock.getAttribute("aria-expanded"), "true");
  await radial.locator("[data-op=dock-pin]").click();
  await source.keyboard.press("Escape");
  // Keep every radial action reachable near viewport corners.
  for (const [x, y] of [
    [15, 320],
    [15, 620],
    [375, 20],
    [375, 320],
  ]) {
    const box = await dock.boundingBox();
    await source.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await source.mouse.down();
    await source.mouse.move(x, y, { steps: 10 });
    await source.mouse.up();
    await dock.focus();
    await source.keyboard.press("Enter");
    // Check final bounds after the original centre-to-arc flight, rather than
    // sampling the first animation frame at the partially tucked-away dock.
    await radial.evaluate((node) =>
      Promise.all(
        node
          .getAnimations({ subtree: true })
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    for (const entry of await radial.locator("button").all()) {
      const rect = await entry.boundingBox();
      assert(
        rect.x >= 0 &&
          rect.y >= 0 &&
          rect.x + rect.width <= 390 &&
          rect.y + rect.height <= 640,
        JSON.stringify(rect),
      );
    }
    await source.keyboard.press("Escape");
  }
  await source.setViewportSize({ width: 1440, height: 1000 });

  await page.evaluate(
    (tabId) =>
      chrome.tabs.sendMessage(tabId, {
        type: "selection.process",
        text: "A selected excerpt before page translation.",
      }),
    tabId,
  );
  await host
    .locator("#result-status")
    .filter({ hasText: "处理完成" })
    .waitFor();
  // The preceding drag intentionally suppresses pointer clicks for 250 ms.
  await dock.focus();
  await source.keyboard.press("Enter");
  assert(await radial.evaluate((node) => node.classList.contains("open")));
  assert.equal(
    await radial
      .locator("[data-op=page-translate]")
      .getAttribute("aria-pressed"),
    "false",
    "Selection output is not a translated page",
  );
  assert(!(await dock.evaluate((n) => n.classList.contains("translated"))));
  const count = calls.length;
  await radial.locator("[data-op=page-translate]").click();
  await host
    .locator("#status")
    .filter({ hasText: "处理完成" })
    .waitFor({ state: "attached" });
  assert((await source.locator("[data-pagework=result]").count()) > 0);
  assert(
    calls.length > count,
    "The first page-translate click processes the page after a selection result",
  );
  assert.equal(
    await radial
      .locator("[data-op=page-translate]")
      .getAttribute("aria-pressed"),
    "true",
  );
  assert(
    !(await dock.evaluate((n) => n.classList.contains("translated"))),
    "Translation never changes the dock appearance",
  );
  assert.equal(await dock.locator(".translation-badge").count(), 0);
  assert.equal(
    await radial.locator("[data-op=page-translate] .translation-badge").count(),
    0,
    "The status indicator has no check badge",
  );
  await radial
    .locator("[data-op=page-translate][data-translation-state=translated]")
    .waitFor();
  await dock.click();
  assert.equal(await dock.getAttribute("aria-expanded"), "false");
  assert.equal(
    await dock.locator(".translation-badge").count(),
    0,
    "The collapsed dock keeps only the brand icon after translation",
  );
  await dock.click();
  assert.equal(await dock.locator(".translation-badge").count(), 0);
  assert(
    await radial
      .locator("[data-op=page-translate]")
      .evaluate((n) => n.dataset.translationState === "translated"),
  );
  await assertTypography();
  const afterTranslation = calls.length;
  await source.setViewportSize({ width: 560, height: 900 });
  await assertTypography();
  await source.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("[data-style=customTypography]").check();
  for (const [key, value] of [
    ["size", "21"],
    ["line", "1.5"],
  ])
    await page.locator(`[data-style=${key}]`).evaluate((node, value) => {
      node.value = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await source.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector("#first [data-pagework=result]").shadowRoot
          .firstElementChild,
      ).lineHeight === "31.5px",
  );
  await assertTypography(true);
  await page.reload();
  await page.locator("[data-style=customTypography]").waitFor();
  assert(
    await page.locator("[data-style=customTypography]").isChecked(),
    "Manual typography persists",
  );
  assert.equal(await page.locator("[data-style=size]").inputValue(), "21");
  await page.locator("[data-style=customTypography]").uncheck();
  await source.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector("#first [data-pagework=result]").shadowRoot
          .firstElementChild,
      ).fontSize === "18px",
  );
  await assertTypography();
  await assertPreviewTypography();
  assert.equal(
    calls.length,
    afterTranslation,
    "Responsive and manual typography changes do not call the model",
  );
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished)),
  );
  await page.screenshot({
    path: path.join(artifacts, "inline-typography-settings.png"),
    fullPage: true,
  });
  for (const mode of ["light", "dark"]) {
    await op("theme-menu").click();
    await page.locator(`[data-op=theme-mode][data-value=${mode}]`).click();
    await page.keyboard.press("Escape");
    await source.waitForFunction(
      (mode) =>
        document.querySelector("[data-pagework=ui]").dataset.theme === mode,
      mode,
    );
    await dock.evaluate((node) =>
      Promise.all(
        node
          .getRootNode()
          .getAnimations()
          .map((a) => a.finished),
      ),
    );
    await source.screenshot({
      path: path.join(artifacts, `inline-typography-${mode}.png`),
    });
    await dock.click();
    await source.mouse.move(700, 800);
    await dock.evaluate((node) =>
      Promise.all(
        node
          .getRootNode()
          .getAnimations()
          .map((a) => a.finished),
      ),
    );
    await source.screenshot({
      path: path.join(artifacts, `translated-dock-collapsed-${mode}.png`),
    });
    await dock.click();
  }
  // Selection results do not erase the active state of inline page translations.
  await page.evaluate(
    (tabId) =>
      chrome.tabs.sendMessage(tabId, {
        type: "selection.process",
        text: "Another selected excerpt with page translations visible.",
      }),
    tabId,
  );
  await host
    .locator("#result-status")
    .filter({ hasText: "处理完成" })
    .waitFor();
  assert(
    !(await dock.evaluate((n) => n.classList.contains("translated"))),
    "Translation never changes the dock appearance",
  );
  await page.locator("[data-style=customTypography]").check();
  await source.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector("#first [data-pagework=result]").shadowRoot
          .firstElementChild,
      ).fontSize === "21px",
  );
  await assertTypography(true);
  await page.locator("[data-style=customTypography]").uncheck();
  await source.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector("#first [data-pagework=result]").shadowRoot
          .firstElementChild,
      ).fontSize === "18px",
  );
  await assertTypography();
  await radial.locator("[data-op=page-translate]").click();
  assert.equal(await source.locator("[data-pagework=result]").count(), 0);
  assert(!(await dock.evaluate((n) => n.classList.contains("translated"))));
  assert.equal(
    await radial
      .locator("[data-op=page-translate]")
      .getAttribute("aria-pressed"),
    "false",
  );
  const completedCalls = calls.length;
  await radial.locator("[data-op=page-translate]").click();
  await host
    .locator("#status")
    .filter({ hasText: "处理完成" })
    .waitFor({ state: "attached" });
  assert((await source.locator("[data-pagework=result]").count()) > 0);
  assert.equal(
    calls.length,
    completedCalls,
    "Repeated page translation uses the local cache",
  );
  await source.close();
  console.log(
    "PASS: radial layout, three-state lights icons/site persistence/two-control popup/no model calls, translated-state toggles, inherited/responsive typography, persistent manual overrides and live preview without extra model calls.",
  );
};
