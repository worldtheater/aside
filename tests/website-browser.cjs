const assert = require("node:assert/strict"),
  path = require("node:path"),
  http = require("node:http");
module.exports = async ({ page, context, origin, artifacts }) => {
  const { DECISION_MODELS_ENABLED } = await import("../providers.js");
  const snapshot = () =>
    page.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value,
    );
  context.setDefaultTimeout(10000);
  const original = await snapshot();
  const { collection, daily, ...originalSettings } = original;
  const ext = page.url().split("/").slice(0, 3).join("/");
  let assetReads = 0;
  const assets = http.createServer((req, res) => {
    if (req.url.startsWith("/blocked.css")) {
      res.writeHead(418, { "content-type": "text/html" });
      res.end("Resource unavailable");
      return;
    }
    if (req.url.startsWith("/not-css.css")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>Sign in</html>");
      return;
    }
    if (req.url.startsWith("/website-")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "script-src 'self'; object-src 'none'",
      });
      res.end(html(req.url.includes("native")));
      return;
    }
    res.writeHead(200, { "content-type": "text/css" });
    res.end(
      ".external { background:#fff5cc; color:#17210d; border:1px solid #c8c8c8; padding:12px }",
    );
  });
  await new Promise((r) => assets.listen(0, "127.0.0.1", r));
  assets.unref();
  const assetURL = "https://styles.example.com/site.css";
  await context.route(assetURL, (route) => {
    assetReads++;
    return route.fulfill({
      contentType: "text/css",
      body: ".external { background:#fff5cc; color:#17210d; border:1px solid #c8c8c8; padding:12px }",
    });
  });
  const unavailableURL =
    "https://styles.example.com/unavailable.css?token=private-value";
  let unavailableReads = 0;
  await context.route(unavailableURL, (route) => {
    if (route.request().resourceType() === "stylesheet")
      return route.fulfill({
        contentType: "text/css",
        body: ".optional-style{font-weight:400}",
      });
    unavailableReads++;
    return route.fulfill({
      status: 418,
      contentType: "text/html",
      body: "Resource unavailable",
    });
  });
  const html = (native = false) =>
    `<!doctype html><html${native ? ' class="native-dark"' : ""}><head><meta charset="utf-8"><title>A quieter page — Reading notes</title><link rel="stylesheet" href="${assetURL}"><link rel="stylesheet" href="${unavailableURL}"><style>html,body{background:#fff;color:#222;margin:0}body{padding:40px;font:18px/1.6 sans-serif}h1{font-size:32px}.native-dark,.native-dark body,[data-appearance=night],[data-appearance=night] body{background:#17191c;color:#e7e7e7}main{max-width:680px}p{margin:18px 0}img{width:80px;height:60px}button{padding:8px}#dynamic{min-height:40px}</style></head><body><main><h1>Read with a little more room</h1><p id="first">A thoughtful note helps us see familiar words in a new light.</p><p class="external">External styles should be readable too.</p><img alt="red photograph fixture" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='60'%3E%3Crect width='80' height='60' fill='%23db412d'/%3E%3C/svg%3E"><div id="dynamic"></div></main></body></html>`;
  const websiteOrigin = `http://127.0.0.1:${assets.address().port}`;
  const source = await context.newPage();
  await source.goto(websiteOrigin + "/website-light");
  const host = source.locator("[data-pagework=ui]"),
    dock = host.locator("#dock"),
    bar = host.locator("#selection");
  await dock.waitFor();
  const manager = await context.newPage();
  await manager.goto("chrome://extensions");
  for (const host of ["http://*/*", "https://*/*"])
    await manager.evaluate(
      ({ id, host }) => chrome.developerPrivate.addHostPermission(id, host),
      { id: new URL(page.url()).hostname, host },
    );
  await manager.close();
  // Grant actual optional origins (runtime site access alone is not an API grant).
  assert(
    await page.evaluate(() =>
      chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }),
    ),
  );
  await source.bringToFront();
  const tabId = await page.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    source.url(),
  );
  const update = (patch) =>
    page.evaluate(
      async ({ patch, tabId }) => {
        const result = await chrome.runtime.sendMessage({
          type: "website.update",
          patch,
          tabId,
        });
        if (!result.ok) throw Error(JSON.stringify(result));
        return result.value;
      },
      { patch, tabId },
    );
  const colors = () =>
    source.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      photo: getComputedStyle(document.querySelector("img")).filter,
    }));
  const waitDark = () =>
    source.waitForFunction(
      () =>
        document.documentElement.dataset.darkreaderMode === "dynamic" &&
        getComputedStyle(document.body).backgroundColor !==
          "rgb(255, 255, 255)",
    );
  const status = () =>
    page.evaluate(
      (tabId) =>
        chrome.tabs.sendMessage(
          tabId,
          { type: "lights.status" },
          { frameId: 0 },
        ),
      tabId,
    );
  let popup;
  try {
    assert.equal(await source.locator(".darkreader").count(), 0);
    assert.equal(
      await source
        .locator(".external")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(255, 245, 204)",
      "Fixture CSS loads before the engine",
    );
    popup = await context.newPage();
    await source.bringToFront();
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(ext + "/popup.html");
    await popup.locator("#feature-controls").waitFor();
    assert(
      (await popup.locator(".popup-page-site").textContent()).includes(
        "127.0.0.1",
      ),
    );
    assert.equal(
      await popup.locator("[data-feature-scope],[data-feature-reset]").count(),
      0,
    );
    assert.equal(await popup.locator("[data-feature-group]").count(), 2);
    assert.equal(
      await popup.locator("[data-feature-group] input[type=checkbox]").count(),
      2,
    );
    assert(await popup.locator("[data-feature=toolbar]").isChecked());
    assert(await popup.locator("[data-feature=floating]").isChecked());
    assert.equal(
      await popup.locator("[data-feature=lights],.popup-enhance").count(),
      0,
    );
    await popup.locator("[data-feature=toolbar]").uncheck();
    await page.waitForFunction(async () => {
      const r = await chrome.runtime.sendMessage({ type: "snapshot" });
      return r.value.website.sites["127.0.0.1"]?.toolbar === false;
    });
    await source.locator("#first").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await source.mouse.move(45, 150);
    await source.mouse.up();
    assert(await bar.isHidden());
    await popup.locator("[data-feature=floating]").uncheck();
    await dock.waitFor({ state: "hidden" });
    // Both reopening the popup and navigating within this site remember the switches.
    await source.reload();
    await dock.waitFor({ state: "attached" });
    assert(await dock.isHidden());
    await source.bringToFront();
    await popup.reload();
    await popup.locator("[data-feature=toolbar]").waitFor();
    assert(!(await popup.locator("[data-feature=toolbar]").isChecked()));
    assert(!(await popup.locator("[data-feature=floating]").isChecked()));
    await popup.locator("[data-feature=toolbar]").check();
    assert(
      !(await popup.locator("[data-feature=floating]").isChecked()),
      "The tools have independent switches",
    );
    await popup.locator("[data-feature=floating]").check();
    await dock.waitFor();
    await page.waitForFunction(async () => {
      const r = await chrome.runtime.sendMessage({ type: "snapshot" });
      return !r.value.website.sites["127.0.0.1"];
    });
    // A chart's fill attributes can use variables that no HTML style consumes.
    await source.evaluate(() => {
      const palette = document.createElement("style");
      palette.id = "chart-palette";
      palette.textContent = ":root{--series-a:#7aa2f7;--series-b:#9ece6a}";
      document.head.append(palette);
      const chart = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      chart.id = "variable-chart";
      chart.setAttribute("width", "400");
      chart.setAttribute("height", "200");
      chart.innerHTML =
        '<g fill="var(--series-a)"><rect id="series-a" x="20" y="50" width="50" height="150"/></g><g fill="var(--series-b)"><rect id="series-b" x="20" y="30" width="50" height="20"/></g>';
      document.querySelector("main").append(chart);
    });
    const unavailableLog = source.waitForEvent("console", {
      predicate: (message) =>
        message.text().includes("Lights resource HTTP 418"),
    });
    await setLights("on");
    const loggedResource = await unavailableLog;
    assert.equal(
      loggedResource.type(),
      "info",
      "Handled resource failures are diagnostics, not extension errors",
    );
    assert(
      loggedResource
        .text()
        .includes("https://styles.example.com/unavailable.css"),
    );
    assert(!loggedResource.text().includes("private-value"));
    assert.equal(unavailableReads, 1);
    await waitDark();
    await source.evaluate(() => {
      scrollBy(0, 10);
      document.querySelector("#dynamic").textContent =
        "Updated without retrying unavailable resources.";
    });
    await source.waitForTimeout(350);
    assert.equal(
      unavailableReads,
      1,
      "Scrolling and DOM updates do not retry the failed resource",
    );
    assert.equal(
      await popup
        .locator(".popup-enhance,[data-decision-setup],[data-enhance-retry]")
        .count(),
      0,
    );
    if (!DECISION_MODELS_ENABLED)
      await assert.rejects(update({ enhance: true }), /notAllowed/);
    await source.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".external"))
          .backgroundColor !== "rgb(255, 245, 204)",
    );
    assert(assetReads > 1, "Cross-origin CSS is fetched by the background");
    // Resource failures keep their real cause; never parse an HTML denial/login
    // response as CSS or confuse it with the sender permission boundary.
    for (const [file, code, detail] of [
      ["blocked.css", "networkError", "HTTP 418"],
      ["not-css.css", "invalidInput", "Content-Type text/html"],
    ]) {
      const url = `${websiteOrigin}/${file}?token=private-value`;
      const [entry] = await page.evaluate(
        ({ tabId, url }) =>
          chrome.scripting.executeScript({
            target: { tabId },
            func: (url) =>
              chrome.runtime.sendMessage({ type: "lights.fetch", url }),
            args: [url],
          }),
        { tabId, url },
      );
      assert.equal(entry.result.ok, false);
      assert.equal(entry.result.error, code);
      assert(entry.result.detail.includes(detail));
      assert(entry.result.detail.includes(`${websiteOrigin}/${file}`));
      assert(!entry.result.detail.includes("private-value"));
    }
    const denied = await page.evaluate(
      (url) => chrome.runtime.sendMessage({ type: "lights.fetch", url }),
      assetURL,
    );
    assert.equal(
      denied.error,
      "notAllowed",
      "Internal pages still cannot use the resource bridge",
    );
    assert.equal(
      (await colors()).photo,
      "none",
      "Photographs are not inverted",
    );
    const external = await source
      .locator(".external")
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    assert.notEqual(external, "rgb(255, 245, 204)");
    assert.equal((await status()).status, "active");
    await source.waitForFunction(() => {
      const color = getComputedStyle(document.querySelector("#series-a")).fill;
      return color !== "rgb(24, 26, 27)" && color !== "rgb(0, 0, 0)";
    });
    const initialPaints = await source
      .locator("#variable-chart")
      .evaluate((n) =>
        [...n.querySelectorAll("rect")].map((e) => getComputedStyle(e).fill),
      );
    assert.notEqual(
      initialPaints[0],
      initialPaints[1],
      "Both series resolve on initial enable",
    );
    await source.locator("#series-a").hover();
    await source
      .locator("#series-a")
      .evaluate((n) => n.parentElement.setAttribute("fill", "var(--series-a)"));
    await source.waitForTimeout(150);
    assert.deepEqual(
      await source
        .locator("#variable-chart")
        .evaluate((n) =>
          [...n.querySelectorAll("rect")].map((e) => getComputedStyle(e).fill),
        ),
      initialPaints,
      "Hover or redraw must not repair missing initial colors",
    );
    // Variable changes must continue to propagate after the first render.
    await source.evaluate(() => {
      document.querySelector("#chart-palette").textContent =
        ":root{--series-a:#b85a4b;--series-b:#9ece6a}";
    });
    await source.waitForFunction(
      (before) =>
        getComputedStyle(document.querySelector("#series-a")).fill !== before,
      initialPaints[0],
    );

    // The isolated API shim must leave the extension's native Promise messaging intact.
    await source.locator("#first").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await source.mouse.move(45, 150);
    await source.mouse.up();
    await bar.waitFor();
    const markColor = await bar
      .locator(".aside-brand-mark path")
      .evaluate((node) => getComputedStyle(node).fill);
    assert.equal(
      markColor,
      "rgb(216, 163, 106)",
      "The extension UI retains its brand color",
    );
    await source.evaluate(() => {
      const p = document.createElement("p");
      p.id = "late";
      p.style.cssText = "background:#fff;color:#111";
      p.textContent = "Dynamically inserted content";
      document.querySelector("#dynamic").append(p);
    });
    await source.waitForFunction(
      () =>
        getComputedStyle(document.querySelector("#late")).backgroundColor !==
        "rgb(255, 255, 255)",
    );
    await source.evaluate(() => {
      const style = document.createElement("style");
      document.head.append(style);
      style.sheet.insertRule(
        "#dynamic{background:rgb(252,252,250);color:rgb(10,10,10)}",
      );
    });
    await source.waitForFunction(() => {
      const c = getComputedStyle(
        document.querySelector("#dynamic"),
      ).backgroundColor;
      return c !== "rgba(0, 0, 0, 0)" && c !== "rgb(252, 252, 250)";
    });
    const iframe = await source.evaluateHandle(
      (url) => {
        const frame = document.createElement("iframe");
        frame.src = url;
        document.body.append(frame);
        return frame;
      },
      origin.replace("127.0.0.1", "localhost") + "/frame",
    );
    await source
      .frameLocator("iframe")
      .locator("html[data-darkreader-mode=dynamic]")
      .waitFor();
    await iframe.evaluate((node) => node.remove());
    // Related frames have no HTTP URL of their own, but retain the parent site's
    // policy, stylesheet fetch bridge and CSSOM proxy.
    const relatedURLs = await source.evaluate((assetURL) => {
      const html = `<html><head><link rel="stylesheet" href="${assetURL}"><style>body{background:white;color:black}</style></head><body><p class="external">Embedded reading</p></body></html>`;
      const urls = [];
      for (const kind of ["blank", "srcdoc", "blob", "data"]) {
        const frame = document.createElement("iframe");
        frame.id = `related-${kind}`;
        if (kind === "srcdoc") frame.srcdoc = html;
        else if (kind === "blob") {
          frame.src = URL.createObjectURL(
            new Blob([html], { type: "text/html" }),
          );
          urls.push(frame.src);
        } else if (kind === "data")
          frame.src = "data:text/html," + encodeURIComponent(html);
        document.body.append(frame);
        if (kind === "blank") {
          frame.contentDocument.open();
          frame.contentDocument.write(html);
          frame.contentDocument.close();
        }
      }
      return urls;
    }, assetURL);
    for (const kind of ["blank", "srcdoc", "blob", "data"]) {
      const child = await (
        await source.locator(`#related-${kind}`).elementHandle()
      ).contentFrame();
      await child.waitForFunction(
        () => document.documentElement.dataset.darkreaderMode === "dynamic",
      );
      await child.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".external"))
            .backgroundColor !== "rgb(255, 245, 204)" &&
          getComputedStyle(document.querySelector(".external"))
            .backgroundColor !== "rgba(0, 0, 0, 0)",
      );
      await child.evaluate(() => {
        const sheet = document.createElement("style");
        document.head.append(sheet);
        sheet.sheet.insertRule("body{background:#f4f4f4;color:#121212}");
      });
      await child.waitForFunction(
        () =>
          getComputedStyle(document.body).backgroundColor !==
          "rgb(244, 244, 244)",
      );
    }
    await update({ lights: "off" });
    for (const kind of ["blank", "srcdoc", "blob", "data"]) {
      const child = await (
        await source.locator(`#related-${kind}`).elementHandle()
      ).contentFrame();
      await child.waitForFunction(
        () => !document.documentElement.dataset.darkreaderMode,
      );
    }
    await update({ lights: "on" });
    await source.evaluate((urls) => {
      document
        .querySelectorAll('iframe[id^="related-"]')
        .forEach((node) => node.remove());
      urls.forEach((url) => URL.revokeObjectURL(url));
    }, relatedURLs);
    await source.screenshot({
      path: path.join(artifacts, "lights-dynamic.png"),
    });
    await source.evaluate(() =>
      document.documentElement.classList.add("native-dark"),
    );
    await source.waitForFunction(
      () => !document.documentElement.dataset.darkreaderMode,
    );
    assert.equal((await status()).status, "native");
    await source.evaluate(() =>
      document.documentElement.classList.remove("native-dark"),
    );
    await waitDark();
    // Theme selectors are site-defined; do not require a known attribute name.
    await source.evaluate(() =>
      document.documentElement.setAttribute("data-appearance", "night"),
    );
    await source.waitForFunction(
      () => !document.documentElement.dataset.darkreaderMode,
      null,
      { timeout: 4000 },
    );
    assert.equal((await status()).status, "native");
    await source.evaluate(() =>
      document.documentElement.removeAttribute("data-appearance"),
    );
    await waitDark();
    await setLights("off");
    await source.waitForFunction(
      () => !document.documentElement.dataset.darkreaderMode,
    );
    assert.equal((await colors()).bg, "rgb(255, 255, 255)");
    await setLights("on");
    await source.emulateMedia({ colorScheme: "light" });
    await waitDark();
    await source.goto(websiteOrigin + "/website-native");
    await source.locator("body").waitFor();
    await source.waitForFunction(
      () => !document.documentElement.dataset.darkreaderMode,
    );
    await page.waitForFunction(
      async (tabId) =>
        (
          await chrome.tabs.sendMessage(
            tabId,
            { type: "lights.status" },
            { frameId: 0 },
          )
        )?.status === "native",
      tabId,
    );
    assert.equal((await colors()).bg, "rgb(23, 25, 28)");
    await update({ lights: "off" });
    await source.goto(websiteOrigin + "/website-external");
    await source.evaluate(() => {
      const meta = document.createElement("meta");
      meta.name = "darkreader";
      meta.content = "test-owner";
      document.head.append(meta);
    });
    await update({ lights: "on" });
    assert.equal((await status()).status, "external");
    await update({ lights: "off" });
    assert.equal(
      await source.locator("meta[name=darkreader]").getAttribute("content"),
      "test-owner",
    );
    assert.equal(await source.locator("style.darkreader").count(), 0);
    // A different hostname keeps the default tools when this site disables them.
    await update({ toolbar: false, floating: false, lights: "off" });
    const other = await context.newPage();
    await other.goto(origin.replace("127.0.0.1", "localhost") + "/other-site");
    await other.locator("[data-pagework=ui]").waitFor({ state: "attached" });
    await other.locator("[data-pagework=ui]").locator("#dock").waitFor();
    assert.equal(await other.locator(".darkreader").count(), 0);
    await other.close();
    await source
      .locator('meta[name="darkreader"]')
      .evaluate((node) => node.remove());
    await update({ toolbar: true });
    await source.bringToFront();
    await popup.reload();
    await popup.locator("[data-feature=toolbar]").waitFor();
    // Saving still keeps the clicked state until acknowledgement, then restores
    // the saved state on failure. Removed lights/status UI is not polled.
    await popup.evaluate(() => {
      const runtimeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      const tabSend = chrome.tabs.sendMessage.bind(chrome.tabs);
      window.featureTest = { reply: null, rejectSave: false, statusQueries: 0 };
      chrome.runtime.sendMessage = (message, ...args) => {
        if (message.type !== "website.update")
          return runtimeSend(message, ...args);
        if (featureTest.rejectSave)
          return Promise.resolve({ ok: false, error: "notAllowed" });
        return runtimeSend(message, ...args).then(
          (value) =>
            new Promise((resolve) => {
              featureTest.reply = () => {
                featureTest.reply = null;
                resolve(value);
              };
            }),
        );
      };
      chrome.tabs.sendMessage = (tabId, message, ...args) => {
        if (message.type === "lights.status") featureTest.statusQueries++;
        return tabSend(tabId, message, ...args);
      };
      featureTest.restore = () => {
        featureTest.reply?.();
        chrome.runtime.sendMessage = runtimeSend;
        chrome.tabs.sendMessage = tabSend;
      };
    });
    try {
      for (const on of [false, true]) {
        await popup.locator("[data-feature=toolbar]").click();
        await popup.waitForFunction(() => Boolean(featureTest.reply));
        assert.equal(
          (await snapshot()).website.sites["127.0.0.1"]?.toolbar ?? true,
          on,
        );
        assert.equal(
          await popup.locator("[data-feature=toolbar]").isChecked(),
          on,
          "Keep the clicked state while the saved change is syncing to pages",
        );
        await popup.evaluate(() => featureTest.reply());
        await popup.waitForFunction(
          () => !document.querySelector("[data-feature=toolbar]").disabled,
        );
        assert.equal(
          await popup.locator("[data-feature=toolbar]").isChecked(),
          on,
        );
      }
      await popup.waitForTimeout(1300);
      assert.equal(
        await popup.evaluate(() => featureTest.statusQueries),
        0,
        "The popup does not poll removed Lights controls",
      );
      await popup.evaluate(() => (featureTest.rejectSave = true));
      await popup.locator("[data-feature=toolbar]").click();
      await popup.waitForFunction(
        () => !document.querySelector("[data-feature=toolbar]").disabled,
      );
      assert(
        await popup.locator("[data-feature=toolbar]").isChecked(),
        "Failed saves restore the last saved state",
      );
      assert.equal(
        (await snapshot()).website.sites["127.0.0.1"]?.toolbar ?? true,
        true,
      );
      assert(
        (await popup.locator("#feature-status").textContent()).trim(),
        "Save errors remain visible",
      );
    } finally {
      await popup.evaluate(() => featureTest.restore());
    }
    await update({ toolbar: true, floating: true, lights: "on" });
    for (const [theme, locale] of [
      ["light", "zh-CN"],
      ["dark", "zh-CN"],
      ["dark", "en"],
    ]) {
      await page.evaluate(
        async ({ theme, locale, preferences }) =>
          chrome.runtime.sendMessage({
            type: "settings.save",
            patch: { preferences: { ...preferences, locale, theme } },
          }),
        { theme, locale, preferences: original.preferences },
      );
      await source.bringToFront();
      await popup.reload();
      await popup.locator(".popup-page").waitFor();
      const switchBounds = await popup
        .locator("[data-feature=floating]")
        .boundingBox();
      assert(
        switchBounds.y + switchBounds.height <= 600,
        "Both quick-tool switches are visible without scrolling",
      );
      await popup.screenshot({
        path: path.join(artifacts, `popup-websites-${theme}-${locale}.png`),
      });
      assert.equal(
        await popup
          .locator("[data-feature=lights],[data-decision-setup]")
          .count(),
        0,
      );
    }
    await update(null);
    assert.equal((await snapshot()).website.sites["127.0.0.1"], undefined);
    const internal = await context.newPage();
    await internal.goto("chrome://extensions");
    await internal.bringToFront();
    await popup.reload();
    await popup.locator("[data-feature=toolbar]").waitFor();
    for (const key of ["toolbar", "floating"])
      assert(await popup.locator(`[data-feature=${key}]`).isDisabled());
    await internal.close();
    console.log(
      "PASS: popup hierarchy, live toolbar/dock toggles, remembered independent site switches, local dark engine, cross-origin CSS, strict CSP/CSSOM, native dark detection, parent-site iframe policy, external-engine coexistence, dynamic DOM, image preservation and restore.",
    );
  } catch (error) {
    console.log(
      "Website diagnostic",
      await source.evaluate(() => ({
        hidden: document.hidden,
        styles: [...document.querySelectorAll("style.darkreader")].map((s) => ({
          class: s.className,
          text: [...s.sheet.cssRules]
            .map((r) => r.cssText)
            .join("\n")
            .slice(0, 500),
        })),
        external: getComputedStyle(document.querySelector(".external"))
          .backgroundColor,
        mode: document.documentElement.dataset.darkreaderMode,
      })),
    );
    throw error;
  } finally {
    context.setDefaultTimeout(30000);
    await context.unroute(assetURL);
    await context.unroute(unavailableURL);
    await popup?.close();
    await source.close();
    await page.evaluate(
      async (settings) => chrome.storage.local.set({ settings }),
      originalSettings,
    );
    assets.close();
    await page.reload();
  }
  async function setLights(value) {
    await update({ lights: value });
    await page.waitForFunction(
      async ({ value }) => {
        const r = await chrome.runtime.sendMessage({ type: "snapshot" });
        return (r.value.website.sites["127.0.0.1"]?.lights || "off") === value;
      },
      { value },
    );
    await source.bringToFront();
  }
};
