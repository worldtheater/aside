const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

module.exports = async ({ page, context, origin, calls, artifacts }) => {
  const original = await page.evaluate(
    async () => (await chrome.runtime.sendMessage({ type: "snapshot" })).value,
  );
  const request = async (message) => {
    const result = await page.evaluate(
      (message) => chrome.runtime.sendMessage(message),
      message,
    );
    assert(!result.error, JSON.stringify(result));
    return result.value;
  };
  assert.equal(
    original.connections.length,
    0,
    "This suite starts with a fresh install",
  );
  const before = calls.length;
  const hint = "点击这里配置模型";
  const source = await context.newPage();
  let popup, connection;
  const settle = (locator) =>
    locator.evaluate((node) =>
      Promise.all(
        node
          .getAnimations({ subtree: true })
          .filter(
            (animation) => animation.effect.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
  const verifyHint = async (scope, target, outline = false) => {
    const tip = scope.locator(".hover-tip:popover-open");
    await tip.filter({ hasText: hint }).waitFor();
    await settle(tip);
    const rect = await target.boundingBox(),
      bounds = await tip.boundingBox();
    const viewport = await target.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    assert(bounds.x >= 8 && bounds.x + bounds.width <= viewport.width - 7);
    assert(bounds.y >= 8 && bounds.y + bounds.height <= viewport.height - 7);
    assert(
      bounds.y + bounds.height <= rect.y || bounds.y >= rect.y + rect.height,
      `Guidance avoids its button: ${JSON.stringify({ rect, bounds })}`,
    );
    assert.equal(
      await target.getAttribute("aria-describedby"),
      await tip.getAttribute("id"),
    );
    assert.equal(await target.getAttribute("title"), null);
    assert.equal(
      await target.evaluate(
        (node) => getComputedStyle(node, "::before").animationName,
      ),
      "none",
      "The setup outline is steady",
    );
    if (outline) {
      assert(
        await target.evaluate((node) => {
          const style = getComputedStyle(node, "::before");
          return (
            Math.abs(parseFloat(style.width) - node.offsetWidth) < 1 &&
            Math.abs(parseFloat(style.height) - node.offsetHeight) < 1
          );
        }),
        "The browser popup retains its existing setup outline",
      );
    } else {
      assert.equal(
        await target.evaluate(
          (node) => getComputedStyle(node, "::before").content,
        ),
        "none",
        "In-page setup buttons have no glow outline",
      );
    }
    assert.equal(
      await target
        .locator("svg")
        .evaluate((node) => getComputedStyle(node).opacity),
      "1",
      "The icon stays fully visible while its guidance tip floats",
    );
    assert.equal(
      await tip.evaluate((node) => getComputedStyle(node).animationName),
      "model-setup-float",
    );
  };
  const openConnections = async (click) => {
    const opened = context.waitForEvent("page");
    await click();
    const settings = await opened;
    await settings.waitForURL(/index\.html.*#connections/);
    await settings.locator("[data-connection=name]").waitFor();
    const tabId = Number(new URL(settings.url()).searchParams.get("tab"));
    await settings.close();
    return tabId;
  };
  try {
    await request({
      type: "settings.save",
      patch: {
        preferences: {
          ...original.preferences,
          locale: "zh-CN",
          theme: "light",
        },
      },
    });
    await source.goto(origin + "/setup-guidance");
    const host = source.locator("[data-pagework=ui]");
    const bar = host.locator("#selection"),
      brand = bar.locator(".selection-brand");
    const dock = host.locator("#dock"),
      radial = host.locator("#radial");
    const settings = radial.locator("[data-op=open-settings]");
    await dock.waitFor();
    const select = async () => {
      await source.locator("#first").dblclick({ position: { x: 14, y: 10 } });
      await bar.waitFor();
      await verifyHint(bar, brand);
    };
    const verifyLocked = async (scope, selector, available) => {
      const buttons = scope.locator(selector);
      assert.equal(await scope.locator(`${selector}:enabled`).count(), 1);
      assert(await available.isEnabled());
      for (const button of await buttons.all()) {
        if (await button.isEnabled()) continue;
        if (!(await button.isVisible())) continue;
        const background = await button.evaluate(
          (node) => getComputedStyle(node).backgroundColor,
        );
        const bounds = await button.boundingBox();
        await source.mouse.move(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        );
        await settle(button);
        assert.equal(
          await button.evaluate(
            (node) => getComputedStyle(node).backgroundColor,
          ),
          background,
          "Disabled buttons do not change on hover",
        );
        assert.equal(
          await button.getAttribute("aria-describedby"),
          null,
          "Disabled buttons do not show tips",
        );
        await source.mouse.click(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        );
      }
      await verifyHint(scope, available);
      assert.equal(
        calls.length,
        before,
        "Disabled buttons never issue model calls",
      );
    };
    await select();
    await verifyLocked(bar, ".selection-toolbar-row button", brand);
    assert.equal(await bar.locator(".selection-settings").count(), 0);
    const motion = await bar.locator(".hover-tip").evaluate((node) => {
      const animation = node
        .getAnimations()
        .find((a) => a.animationName === "model-setup-float");
      animation.pause();
      animation.currentTime = 0;
      const bottom = node.getBoundingClientRect().top;
      animation.currentTime = 2000;
      const top = node.getBoundingClientRect().top;
      animation.play();
      return { top, bottom, timing: animation.effect.getTiming() };
    });
    assert.equal(motion.timing.duration, 4000);
    assert(
      Math.abs(motion.bottom - motion.top - 4) < 0.1 && motion.top >= 8,
      "Only the tip drifts gently, staying inside the viewport",
    );
    assert.equal(
      await dock
        .locator("svg")
        .evaluate((node) => getComputedStyle(node).animationName),
      "none",
      "Collapsed launcher does not pulse",
    );
    await source.screenshot({
      path: path.join(artifacts, "onboarding-selection.png"),
    });
    const sourceTabId = await openConnections(() =>
      brand.click({ position: { x: 3, y: 3 } }),
    );
    await source.bringToFront();
    await select();
    await openConnections(() => brand.click());
    await source.bringToFront();
    await select();
    await brand.focus();
    await openConnections(() => source.keyboard.press("Enter"));
    await source.bringToFront();
    await source.keyboard.press("Escape");
    await bar.waitFor({ state: "hidden" });
    await bar.locator(".hover-tip:popover-open").waitFor({ state: "hidden" });
    await select(); // Hiding and showing the same toolbar restores automatic guidance.
    await source.keyboard.press("Escape");
    await page.evaluate(async (tabId) => {
      await chrome.tabs.sendMessage(tabId, { type: "ui.show" });
    }, sourceTabId);
    const tools = host.locator("#toolbar");
    await tools.waitFor();
    assert.equal(
      await tools
        .locator('button:enabled:not([data-op="open-settings"])')
        .count(),
      0,
    );
    assert.equal(await tools.locator("select:enabled").count(), 0);
    await openConnections(() => tools.locator(".tools-brand").click());
    await source.bringToFront();
    await source.keyboard.press("Escape");
    await tools.waitFor({ state: "hidden" });
    await dock.click();
    await verifyHint(radial, settings);
    await verifyLocked(radial, ":scope > button", settings);
    assert.equal(await settings.getAttribute("aria-label"), "设置");
    await source.screenshot({
      path: path.join(artifacts, "onboarding-radial.png"),
    });
    await openConnections(() => settings.click());
    await source.bringToFront();
    await source.keyboard.press("Escape");
    await radial
      .locator(".hover-tip:popover-open")
      .waitFor({ state: "hidden" });
    assert.equal(await radial.locator(".model-setup-needed").count(), 0);
    await source.setViewportSize({ width: 390, height: 720 });
    await request({
      type: "settings.save",
      patch: {
        preferences: {
          ...original.preferences,
          locale: "zh-CN",
          theme: "dark",
        },
      },
    });
    await dock.click();
    await verifyHint(radial, settings);
    await source.screenshot({
      path: path.join(artifacts, "onboarding-radial-dark-narrow.png"),
    });
    await source.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await radial
        .locator(".hover-tip")
        .evaluate((node) => getComputedStyle(node).animationName),
      "none",
    );
    assert.equal(
      await radial.locator(".hover-tip:popover-open").textContent(),
      hint,
      "Reduced motion keeps the static guidance",
    );
    await source.emulateMedia({ reducedMotion: "no-preference" });
    await source.keyboard.press("Escape");
    await source.setViewportSize({ width: 1440, height: 1000 });
    await request({
      type: "settings.save",
      patch: {
        preferences: {
          ...original.preferences,
          locale: "zh-CN",
          theme: "light",
        },
      },
    });

    // Use the native extension popup: its small viewport differs from a tab.
    const cdp = await context.browser().newBrowserCDPSession();
    let sessionId,
      target,
      nextId = 0;
    const pending = new Map();
    const receive = (event) => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message),
        result = pending.get(message.id);
      if (!result) return;
      pending.delete(message.id);
      if (message.error) result.reject(new Error(message.error.message));
      else result.resolve(message.result);
    };
    cdp.on("Target.receivedMessageFromTarget", receive);
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        cdp
          .send("Target.sendMessageToTarget", {
            sessionId,
            message: JSON.stringify({ id, method, params }),
          })
          .catch(reject);
      });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    try {
      await source.bringToFront();
      await page.evaluate(() => chrome.action.openPopup());
      const { targetInfos } = await cdp.send("Target.getTargets");
      target = targetInfos.find(
        (info) => info.url === new URL("popup.html", page.url()).href,
      );
      assert(target);
      ({ sessionId } = await cdp.send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: false,
      }));
      await evaluate(
        `new Promise(resolve=>{const ready=()=>document.querySelector('.hover-tip:popover-open')?resolve(true):requestAnimationFrame(ready);ready();})`,
      );
      await evaluate(
        `Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`,
      );
      const view = await evaluate(`(()=>{
        const button=document.querySelector('#settings'),tip=document.querySelector('.hover-tip');
        return {button:button.getBoundingClientRect().toJSON(),tip:tip.getBoundingClientRect().toJSON(),text:tip.textContent,
          width:innerWidth,height:innerHeight,label:button.getAttribute('aria-label'),outlineAnimation:getComputedStyle(button,'::before').animationName,tipAnimation:getComputedStyle(tip).animationName,iconOpacity:getComputedStyle(button.querySelector('svg')).opacity};
      })()`);
      assert.equal(view.text, hint);
      assert.equal(view.label, "设置");
      assert.equal(view.outlineAnimation, "none");
      assert.equal(view.tipAnimation, "model-setup-float");
      assert.equal(view.iconOpacity, "1");
      assert(
        view.tip.x >= 8 &&
          view.tip.right <= view.width - 7 &&
          view.tip.bottom <= view.height - 7,
      );
      assert(
        view.tip.top >= view.button.bottom,
        "At the viewport top, the tip appears below the Settings button",
      );
      const capture = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(artifacts, "onboarding-native-popup.png"),
        Buffer.from(capture.data, "base64"),
      );
      const opened = context.waitForEvent("page");
      const x = view.button.x + view.button.width / 2,
        y = view.button.y + view.button.height / 2;
      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      const destination = await opened;
      await destination.waitForURL(/index\.html.*#connections/);
      await destination.close();
    } finally {
      if (target)
        await cdp
          .send("Target.closeTarget", { targetId: target.targetId })
          .catch(() => {});
      cdp.off("Target.receivedMessageFromTarget", receive);
      await cdp.detach();
    }

    // Keep a popup document open while saving, to exercise its storage subscription.
    popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(new URL("popup.html", page.url()).href);
    await verifyHint(popup.locator("#popup"), popup.locator("#settings"), true);
    await select();
    connection = await request({
      type: "connection.save",
      key: "fixture-key",
      connection: {
        name: "Setup fixture",
        url: origin + "/v1",
        protocol: "chat",
        model: "fixture-model",
        models: [{ id: "fixture-model", name: "Fixture" }],
        maxTokens: 2048,
      },
    });
    await bar.locator(".model-setup-needed").waitFor({ state: "hidden" });
    await bar.locator(".hover-tip:popover-open").waitFor({ state: "hidden" });
    assert(
      await bar.locator("[data-selection-command=expand]").isEnabled(),
      "Toolbar unlocks after setup",
    );
    assert(
      await bar.locator("[data-selection-command=action]").first().isEnabled(),
    );
    await popup
      .locator("#settings.model-setup-needed")
      .waitFor({ state: "hidden" });
    await popup.locator(".hover-tip:popover-open").waitFor({ state: "hidden" });
    await popup.locator("#settings").hover();
    await popup
      .locator(".hover-tip:popover-open")
      .filter({ hasText: "设置" })
      .waitFor();
    assert.equal(await popup.locator(".hover-tip").textContent(), "设置");
    await source.keyboard.press("Escape");
    await dock.click();
    await settle(radial);
    assert.equal(
      await radial.locator(":scope > button:disabled").count(),
      0,
      "Floating menu unlocks after setup",
    );
    assert.equal(await radial.locator(".model-setup-needed").count(), 0);
    assert.equal(
      await radial.locator(".hover-tip:popover-open").count(),
      0,
      "No automatic guidance after setup",
    );
    await settings.hover();
    await radial
      .locator(".hover-tip:popover-open")
      .filter({ hasText: "设置" })
      .waitFor();
    await source.mouse.move(0, 0);
    await request({ type: "connection.remove", id: connection.id });
    connection = null;
    await verifyHint(radial, settings);
    await verifyLocked(radial, ":scope > button", settings);
    await source.keyboard.press("Escape");
    await select();
    await verifyLocked(bar, ".selection-toolbar-row button", brand);
    await verifyHint(popup.locator("#popup"), popup.locator("#settings"), true);
    assert.equal(calls.length, before, "Setup guidance never calls a model");
    console.log(
      "PASS: unconfigured toolbar and floating menu expose only Settings; disabled buttons ignore hover/click, no in-page glow, logo mouse/keyboard routes work, popup guidance remains intact, and setup/removal updates controls live.",
    );
  } finally {
    if (connection)
      await request({ type: "connection.remove", id: connection.id });
    await popup?.close();
    await source.close();
    await request({
      type: "settings.save",
      patch: { preferences: original.preferences },
    });
    await page.reload();
    await page.locator("h1").waitFor();
  }
};
