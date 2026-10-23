const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({ page, context, origin, calls, artifacts, nav, op, choose }) => {
  const snapshot = () => page.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: "snapshot" })).value);
  const original = await snapshot();
  const source = await context.newPage();
  const swatch = color => page.locator(`[data-op=swatch][data-color="${color}"]`);
  const preview = () => page.locator("#style-preview-content .processed-text");
  const colorOf = node => node.evaluate(node => getComputedStyle(node).color);
  const waitColor = (node, color, property = "color") => node.evaluate(async (node, {color, property}) => {
    for (let i = 0; i < 120; i++) {
      if (getComputedStyle(node)[property] === color) return;
      await new Promise(requestAnimationFrame);
    }
    throw new Error(`Expected ${color}, got ${getComputedStyle(node)[property]}`);
  }, {color, property});
  const themeColor = () => page.evaluate(() => {
    const sample = document.createElement("span");
    sample.style.color = "var(--result-accent)";
    document.body.append(sample);
    const color = getComputedStyle(sample).color;
    sample.remove();
    return color;
  });
  const setTheme = async (theme, palette) => {
    await op("theme-menu").click();
    await page.locator(`[data-op=theme-mode][data-value=${theme}]`).click();
    await page.locator(`[data-op=theme-palette][data-value=${palette}]`).click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(async ({theme, palette}) => {
      const {settings} = await chrome.storage.local.get("settings");
      return settings.preferences.theme === theme && settings.preferences.palette === palette;
    }, {theme, palette});
  };
  const savedColor = async (target, color) => {
    await page.waitForFunction(async ({target, color}) => {
      const {settings} = await chrome.storage.local.get("settings");
      return settings.appearance[target].color === color;
    }, {target, color});
  };
  try {
    await choose("#ui-locale", "zh-CN");
    await nav("appearance");
    await setTheme("light", "graphite");
    await choose("#style-target", "page");
    await swatch("theme").click();
    await savedColor("page", "theme");
    assert.equal(await swatch("theme").getAttribute("aria-pressed"), "true");
    await waitColor(preview(), await themeColor());
    await choose("#style-target", "selection");
    await swatch("theme").click();
    await savedColor("selection", "theme");
    await waitColor(preview(), await themeColor());
    await page.reload();
    await swatch("theme").waitFor();
    assert.equal(await swatch("theme").getAttribute("aria-pressed"), "true");
    assert.equal((await snapshot()).appearance.selection.color, "theme");

    await source.goto(origin + "/appearance-theme");
    const host = source.locator("[data-pagework=ui]");
    await host.locator("#dock").waitFor();
    const tabId = await page.evaluate(async url =>
      (await chrome.tabs.query({})).find(tab => tab.url === url).id,
      source.url());
    assert((await page.evaluate(tabId => chrome.runtime.sendMessage({
      type: "tab.run", tabId, actionId: "translate", scope: "body",
    }), tabId)).ok);
    await host.locator("#status").filter({hasText: "处理完成"}).waitFor({state: "attached"});
    const inline = source.locator("#first > [data-pagework=result]").locator("span");
    await inline.waitFor();
    await page.evaluate(tabId => chrome.tabs.sendMessage(tabId, {
      type: "selection.process", actionId: "translate", text: "Color follows the selected theme.",
    }), tabId);
    const output = host.locator("#output");
    await host.locator("#result-status").filter({hasText: "处理完成"}).waitFor();
    const requests = calls.length;
    const colors = new Set();
    for (const palette of ["graphite", "paper", "ocean", "dusk", "forest"]) {
      for (const theme of ["light", "dark"]) {
        await setTheme(theme, palette);
        const expected = await themeColor();
        colors.add(expected);
        await waitColor(preview(), expected);
        await waitColor(inline, expected);
        await waitColor(output, expected);
        await choose("#style-target", "selection");
        await waitColor(preview(), expected);
        await choose("#style-target", "page");
        assert.equal((await snapshot()).appearance.page.color, "theme", "Persist a theme choice, not a resolved hex color");
        assert.equal((await snapshot()).appearance.selection.color, "theme");
      }
    }
    assert.equal(colors.size, 10, "Each palette and mode uses its own existing color token");
    await setTheme("system", "ocean");
    for (const colorScheme of ["light", "dark", "light"]) {
      await page.emulateMedia({colorScheme});
      await source.emulateMedia({colorScheme});
      await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, colorScheme);
      await source.waitForFunction(mode => document.querySelector("[data-pagework=ui]").dataset.theme === mode, colorScheme);
      const expected = await themeColor();
      await waitColor(preview(), expected);
      await waitColor(inline, expected);
      await waitColor(output, expected);
      assert.equal(await page.locator("#result-color").inputValue(),
        await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--result-accent").trim().toLowerCase()));
    }
    assert.equal(calls.length, requests, "Changing result colors or themes never calls a model");

    const presets = [
      ["preset:green", "rgb(40, 117, 91)", "rgb(155, 201, 176)"],
      ["preset:graphite", "rgb(48, 59, 55)", "rgb(182, 189, 200)"],
      ["preset:indigo", "rgb(89, 109, 165)", "rgb(169, 188, 232)"],
      ["preset:brown", "rgb(149, 105, 66)", "rgb(213, 185, 138)"],
    ];
    const contrast = async node => node.evaluate(node => {
      const luminance = color => {
        const [r,g,b] = color.match(/[\d.]+/g).slice(0,3).map(value => {
          const channel = Number(value)/255;
          return channel <= .04045 ? channel/12.92 : ((channel+.055)/1.055)**2.4;
        });
        return .2126*r + .7152*g + .0722*b;
      };
      const a = luminance(getComputedStyle(node).color);
      const b = luminance(getComputedStyle(node.closest(".style-preview")).backgroundColor);
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
    for (const [id, light, dark] of presets) {
      await choose("#style-target", "page");
      await swatch(id).click();
      await savedColor("page", id);
      await choose("#style-target", "selection");
      await swatch(id).click();
      await savedColor("selection", id);
      for (const palette of ["graphite", "paper", "ocean", "dusk", "forest"]) {
        for (const mode of ["light", "dark"]) {
          await setTheme(mode, palette);
          const expected = mode === "dark" ? dark : light;
          await waitColor(preview(), expected);
          await waitColor(inline, expected);
          await waitColor(output, expected);
          assert(await contrast(preview()) >= 4.5, `${id} is legible on ${palette}/${mode}`);
          await waitColor(swatch(id), expected, "backgroundColor");
          if (id === "preset:graphite" && palette === "graphite" && mode === "dark")
            await page.screenshot({path:path.join(artifacts,"appearance-readable-preset-dark.png"),animations:"disabled"});
        }
      }
    }
    await setTheme("system", "graphite");
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({colorScheme:mode});
      await source.emulateMedia({colorScheme:mode});
      await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
      await source.waitForFunction(mode => document.querySelector("[data-pagework=ui]").dataset.theme === mode, mode);
      const expected = mode === "dark" ? presets[3][2] : presets[3][1];
      await waitColor(preview(), expected);
      await waitColor(inline, expected);
      await waitColor(output, expected);
    }
    await swatch("theme").click();
    await savedColor("selection", "theme");
    await choose("#style-target", "page");
    await setTheme("dark", "forest");
    await waitColor(output, await themeColor());
    await swatch("theme").click();
    await savedColor("page", "theme");
    await page.locator("#result-color").evaluate(node => {
      node.value = "#83644b";
      node.dispatchEvent(new Event("input", {bubbles: true}));
    });
    await savedColor("page", "#83644b");
    assert.equal(await swatch("theme").getAttribute("aria-pressed"), "false");
    await waitColor(inline, "rgb(131, 100, 75)");
    assert(await op("add-color").isEnabled());
    await op("add-color").click();
    await swatch("#83644b").waitFor();
    assert.deepEqual((await snapshot()).customColors, ["#83644b"]);
    assert(await op("add-color").isDisabled(), "A saved color cannot be added twice");
    await page.reload();
    await swatch("#83644b").waitFor();
    assert.equal(await swatch("#83644b").getAttribute("aria-pressed"), "true");
    await choose("#style-target", "selection");
    await swatch("#83644b").click();
    await savedColor("selection", "#83644b");
    await waitColor(output, "rgb(131, 100, 75)");
    assert.equal(await swatch("#83644b").count(), 1, "Both result surfaces share saved colors");
    await swatch("preset:green").click();
    assert(await op("add-color").isDisabled(), "Preset colors are not duplicated");
    await page.locator("#result-color").evaluate(node => {
      node.value = "#7c4f92";
      node.dispatchEvent(new Event("input", {bubbles: true}));
    });
    await savedColor("selection", "#7c4f92");
    await op("add-color").click();
    await swatch("#7c4f92").waitFor();
    assert.deepEqual((await snapshot()).customColors, ["#83644b", "#7c4f92"]);
    await setTheme("light", "paper");
    await choose("#style-target", "page");
    await swatch("#83644b").hover();
    const removeFirst = page.locator('[data-op="remove-color"][data-value="#83644b"]');
    await removeFirst.evaluate(async node => {
      while (getComputedStyle(node).opacity !== "1") await new Promise(requestAnimationFrame);
    });
    await page.screenshot({path: path.join(artifacts, "appearance-custom-colors.png"), fullPage: true});
    await removeFirst.click();
    await swatch("#83644b").waitFor({state: "detached"});
    assert.deepEqual((await snapshot()).customColors, ["#7c4f92"]);
    assert.equal((await snapshot()).appearance.page.color, "#83644b", "Removing a swatch keeps the currently applied color");
    await waitColor(inline, "rgb(131, 100, 75)");
    await page.reload();
    await swatch("#7c4f92").waitFor();
    assert.equal(await swatch("#83644b").count(), 0, "Removed colors stay removed after reopening");
    await choose("#style-target", "selection");
    await swatch("#7c4f92").hover();
    await page.locator('[data-op="remove-color"][data-value="#7c4f92"]').click();
    await swatch("#7c4f92").waitFor({state: "detached"});
    assert.deepEqual((await snapshot()).customColors, []);
    await savedColor("selection", "#7c4f92");
    await waitColor(output, "rgb(124, 79, 146)");
    assert(await op("add-color").isEnabled(), "A removed color can be saved again");
    await op("add-color").click();
    await swatch("#7c4f92").waitFor();
    await choose("#style-target", "page");
    await op("reset-style").click();
    await savedColor("page", "auto");
    await waitColor(inline, await colorOf(source.locator("#first")));
    await choose("#style-target", "selection");
    await op("reset-style").click();
    await savedColor("selection", "auto");
    const ink = await host.evaluate(node => {
      const sample = document.createElement("span");
      sample.style.color = getComputedStyle(node).getPropertyValue("--ink");
      document.body.append(sample);
      const color = getComputedStyle(sample).color;
      sample.remove();
      return color;
    });
    await waitColor(output, ink);
    assert.equal(await swatch("auto").getAttribute("aria-pressed"), "true");
    assert.deepEqual((await snapshot()).customColors, ["#7c4f92"], "Resetting output styles preserves the shared color palette");

    await swatch("theme").click();
    await savedColor("selection", "theme");
    await choose("#style-target", "page");
    await swatch("theme").click();
    await savedColor("page", "theme");
    await setTheme("light", "paper");
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    await page.screenshot({path: path.join(artifacts, "appearance-theme-light.png"), fullPage: true});
    await choose("#ui-locale", "en");
    assert.equal(await swatch("theme").textContent(), "Follow theme color");
    await setTheme("dark", "ocean");
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    await page.screenshot({path: path.join(artifacts, "appearance-theme-dark.png"), fullPage: true});
    await page.setViewportSize({width: 420, height: 900});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path: path.join(artifacts, "appearance-theme-mobile.png"), fullPage: true});
    assert.equal(calls.length, requests, "Style changes never call a model");
    await page.evaluate(tabId => chrome.runtime.sendMessage({
      type:"tab.run", tabId, actionId:"explain", scope:"body", panel:true,
    }), tabId);
    await host.locator("#result.panel #output[aria-busy=false]").waitFor({state:"attached"});
    const panelCalls = calls.length;
    // A dragged independent window remains reachable after the viewport shrinks.
    const panel = host.locator("#result.panel");
    const header = await panel.locator(".header").boundingBox();
    await source.mouse.move(header.x + 25, header.y + header.height/2);
    await source.mouse.down();
    await source.mouse.move(header.x - 45, header.y - 35, {steps:5});
    await source.mouse.up();
    await source.setViewportSize({width:390,height:640});
    await source.waitForFunction(panel => {
      const r = panel.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    }, await panel.elementHandle());
    await panel.screenshot({path:path.join(artifacts,"result-resized-viewport.png"),animations:"disabled"});
    await source.setViewportSize({width:1440,height:1000});
    await page.setViewportSize({width:390,height:640});
    await page.evaluate(() => scrollTo(0,0));
    assert(await page.locator(".style-preview").evaluate(node => node.getBoundingClientRect().bottom <= innerHeight));
    await page.locator("[data-style=tint]").scrollIntoViewIfNeeded();
    assert(await page.locator(".style-preview").evaluate(node => {
      const r = node.getBoundingClientRect();
      return r.top >= document.querySelector(".topbar").getBoundingClientRect().bottom && r.bottom < innerHeight;
    }), "The compact preview remains visible while editing lower controls");
    await page.locator("[data-style=tint]").click();
    await page.screenshot({path:path.join(artifacts,"appearance-sticky-preview-mobile.png"),animations:"disabled"});
    assert.equal(calls.length, panelCalls, "Moving the window and changing display styles never call a model");
    console.log("PASS: theme color selection persists; preview, inline and floating results follow all 5 palettes, explicit and system light/dark changes; custom swatches add/remove/deduplicate, persist and work across both surfaces; presets remain readable on every theme; custom/original colors stay independent; no extra model calls; sticky mobile preview and dragged panel viewport bounds.");
  } finally {
    await source.close();
    await page.setViewportSize({width: 1440, height: 1000});
    await page.emulateMedia({colorScheme: null});
    await page.evaluate(patch => chrome.runtime.sendMessage({type: "settings.save", patch}), {
      appearance: original.appearance, preferences: original.preferences, customColors: original.customColors ?? [],
    });
    await page.reload();
    await page.locator("h1").waitFor();
  }
};
