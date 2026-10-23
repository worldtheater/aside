const assert = require("node:assert/strict");
const path = require("node:path");
module.exports = async ({ page, context, origin, artifacts }) => {
  const { DECISION_MODELS_ENABLED } = await import("../providers.js");
  context.setDefaultTimeout(10000);
  const send = (message) =>
    page.evaluate(async (message) => {
      const response = await chrome.runtime.sendMessage(message);
      if (!response.ok) throw Error(JSON.stringify(response));
      return response.value;
    }, message);
  const original = await send({ type: "snapshot" });
  assert.equal(
    original.defaultDecisionConnection,
    null,
    "Basic repair test starts without a decision connection",
  );
  assert(!original.connections.some((c) => c.protocol === "typesafe"));
  const worker = context
    .serviceWorkers()
    .find((w) =>
      w.url().startsWith(page.url().split("/").slice(0, 3).join("/")),
    );
  await worker.evaluate(() => {
    globalThis.localRepairMessages = [];
    globalThis.recordLocalRepairMessage = (message) => {
      if (["lights.cached", "lights.enhance"].includes(message.type))
        localRepairMessages.push(message.type);
    };
    chrome.runtime.onMessage.addListener(recordLocalRepairMessage);
  });
  const decisionMessages = [];
  await page.evaluate(
    (origin) => chrome.permissions.request({ origins: [origin + "/*"] }),
    origin,
  );
  const source = await context.newPage();
  const errors = [];
  source.on("pageerror", (e) => errors.push(e.message));
  await source.goto(origin + "/local-repairs");
  await source.locator("[data-pagework=ui]").locator("#dock").waitFor();
  const tabId = await page.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    source.url(),
  );
  const update = (patch) => send({ type: "website.update", tabId, patch });
  const status = () =>
    page.evaluate(
      (id) =>
        chrome.tabs.sendMessage(id, { type: "lights.status" }, { frameId: 0 }),
      tabId,
    );
  try {
    await update({ lights: "on" });
    await source.waitForFunction(
      () => document.documentElement.dataset.darkreaderMode === "dynamic",
    );
    assert.equal((await status()).enhancement.status, "off");
    await source.evaluate(() => {
      const src =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#267cb9"/><circle cx="30" cy="30" r="15" fill="#e4bb46"/></svg>',
        );
      const section = document.createElement("section");
      section.id = "photos";
      section.innerHTML = `<div id="dark-paper">${["multiply", "darken", "color-burn", "screen"].map((blend) => `<img id="photo-${blend}" width="120" height="60" style="mix-blend-mode:${blend}" src="${src}">`).join("")}</div><div id="light-paper"><img id="light-photo" width="120" height="60" style="mix-blend-mode:multiply" src="${src}"></div>`;
      const theme = document.createElement("style");
      theme.className = "darkreader";
      theme.textContent =
        "#dark-paper{background:#181a1b!important}#light-paper{background:#fff!important}";
      document.head.append(theme);
      document.querySelector("main").append(section);
      section.scrollIntoView();
    });
    for (const blend of ["multiply", "darken", "color-burn"])
      await source
        .locator(`#photo-${blend}[data-aside-lights-repair=unblend]`)
        .waitFor();
    assert.equal(
      await source
        .locator(
          "#light-photo[data-aside-lights-repair],#photo-screen[data-aside-lights-repair]",
        )
        .count(),
      0,
    );
    const localSheet = await source
      .locator('style[data-aside-lights="local"]')
      .elementHandle();
    if (DECISION_MODELS_ENABLED) await update({ enhance: true });
    else await assert.rejects(update({ enhance: true }), /notAllowed/);
    assert.equal(
      (await status()).enhancement.status,
      DECISION_MODELS_ENABLED ? "noModel" : "off",
    );
    assert(await localSheet.evaluate((node) => node.isConnected));
    assert.equal(
      await source
        .locator("#photo-darken")
        .evaluate((n) => getComputedStyle(n).mixBlendMode),
      "normal",
    );
    await update({ enhance: false });
    assert(await localSheet.evaluate((node) => node.isConnected));
    // The model switch and availability cannot control the local stylesheet.
    await source
      .locator('style[data-aside-lights="local"]')
      .evaluate((node) => node.remove());
    await source.waitForFunction(
      () =>
        getComputedStyle(document.querySelector("#photo-darken"))
          .mixBlendMode === "normal",
    );
    await update({ lights: "off" });
    assert.equal(await source.locator("[data-aside-lights-repair]").count(), 0);
    assert.equal(
      await source
        .locator("#photo-darken")
        .evaluate((n) => getComputedStyle(n).mixBlendMode),
      "darken",
    );
    await update({ lights: "on" });
    await source
      .locator("#photo-darken[data-aside-lights-repair=unblend]")
      .waitFor();
    // Chart text, clipped geometry and a tooltip are not contrasting data marks.
    await source.evaluate(() => {
      const chart = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      chart.id = "tooltip-chart";
      chart.setAttribute("width", "400");
      chart.setAttribute("height", "220");
      chart.innerHTML =
        '<defs><clipPath id="plot-clip"><rect width="400" height="220" fill="black"/></clipPath></defs><g clip-path="url(#plot-clip)" fill="#7aa2f7"><rect id="data-bar" x="30" y="50" width="50" height="150"/></g><text x="15" y="20" fill="black">Synthetic usage</text><g opacity="0"><circle fill="black" cx="80" cy="80" r="10"/><circle fill="white" cx="110" cy="80" r="10"/></g><g id="chart-tip" visibility="hidden"><rect x="120" y="40" width="120" height="50" fill="white"/><text x="130" y="65" fill="black">Sample 42</text></g>';
      chart.addEventListener("mouseenter", () =>
        chart.querySelector("#chart-tip").setAttribute("visibility", "visible"),
      );
      chart.addEventListener("mouseleave", () =>
        chart.querySelector("#chart-tip").setAttribute("visibility", "hidden"),
      );
      document.querySelector("main").append(chart);
      chart.scrollIntoView();
    });
    await source.waitForTimeout(800);
    const chartBackground = await source
      .locator("#tooltip-chart")
      .evaluate((n) => getComputedStyle(n).backgroundColor);
    assert.equal(chartBackground, "rgba(0, 0, 0, 0)");
    assert.equal(
      await source
        .locator('#tooltip-chart[data-aside-lights-repair="svg"]')
        .count(),
      0,
    );
    await source.locator("#data-bar").hover();
    await source.waitForTimeout(800);
    assert.equal(
      await source.locator("#chart-tip").getAttribute("visibility"),
      "visible",
    );
    assert.equal(
      await source
        .locator('#tooltip-chart[data-aside-lights-repair="svg"]')
        .count(),
      0,
    );
    assert.equal(
      await source
        .locator("#tooltip-chart")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      chartBackground,
    );
    // Text uses the painted surface at its transformed glyphs, not just the
    // outer SVG background. Small diagrams, inherited/default fills and tspans
    // must be covered without recoloring data marks or spending model calls.
    const beforeTextRepair = await worker.evaluate(
      () => localRepairMessages.length,
    );
    await source.evaluate(() => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "svg-text";
      svg.setAttribute("width", "600");
      svg.setAttribute("height", "120");
      svg.setAttribute("viewBox", "0 0 600 120");
      svg.innerHTML = `<defs><linearGradient id="uncertain"><stop stop-color="black"/><stop offset="1" stop-color="white"/></linearGradient></defs>
        <rect class="light" x="0" y="35" width="160" height="70" pointer-events="none"/>
        <text id="dark-label" x="10" y="22">Default fill</text><text id="dim-label" opacity=".6" x="200" y="22">Translucent annotation</text>
        <text id="light-label" x="10" y="75">Light card</text>
        <g transform="translate(180 20)"><text x="0" y="55"><tspan id="color-label">Green series</tspan></text></g>
        <rect x="380" y="40" width="200" height="60" fill="url(#uncertain)"/>
        <text id="complex-label" x="390" y="75">Gradient surface</text>
        <text id="faded-label" opacity=".2" x="200" y="110">Intentionally faded</text>`;
      const theme = document.createElement("style");
      theme.className = "darkreader";
      theme.textContent =
        "#svg-text text,#svg-text tspan{fill:#111!important}#svg-text .light{fill:#fafafa!important}#svg-text #color-label{fill:#145724!important}";
      document.head.append(theme);
      document.querySelector("main").append(svg);
      svg.scrollIntoView();
    });
    await source.locator("#dark-label[data-aside-lights-text]").waitFor();
    await source.locator("#color-label[data-aside-lights-text]").waitFor();
    assert.equal(
      await source.locator("#light-label[data-aside-lights-text]").count(),
      0,
      "Dark lettering on a light painted shape is retained, including pointer-events:none",
    );
    assert.equal(
      await source
        .locator(
          "#complex-label[data-aside-lights-text],#faded-label[data-aside-lights-text]",
        )
        .count(),
      0,
      "Unknown backgrounds and intentionally faded text are left intact",
    );
    await source.locator("#dim-label[data-aside-lights-text]").waitFor();
    assert.equal(
      await source.locator("#dim-label").getAttribute("opacity"),
      ".6",
    );
    assert.equal(
      await source
        .locator("#svg-text")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    const repairedContrast = await source
      .locator("#svg-text")
      .evaluate((svg) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        const surface = getComputedStyle(
          document.documentElement,
        ).backgroundColor;
        const luminance = (value, opacity = 1) => {
          ctx.globalAlpha = 1;
          ctx.fillStyle = surface;
          ctx.fillRect(0, 0, 1, 1);
          ctx.globalAlpha = opacity;
          ctx.fillStyle = value;
          ctx.fillRect(0, 0, 1, 1);
          const rgb = ctx.getImageData(0, 0, 1, 1).data;
          return [0.2126, 0.7152, 0.0722].reduce((sum, k, i) => {
            const c = rgb[i] / 255;
            return (
              sum +
              k * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
            );
          }, 0);
        };
        const bg = luminance(
          getComputedStyle(document.documentElement).backgroundColor,
        );
        return ["dark-label", "color-label", "dim-label"].map((id) => {
          const ink = luminance(
            getComputedStyle(svg.querySelector("#" + id)).fill,
            Number(getComputedStyle(svg.querySelector("#" + id)).opacity),
          );
          return (Math.max(ink, bg) + 0.05) / (Math.min(ink, bg) + 0.05);
        });
      });
    assert(
      repairedContrast.every((r) => r >= 4.5),
      `Rendered contrast must reach 4.5:1, got ${repairedContrast}`,
    );
    const textColor = await source
      .locator("#color-label")
      .evaluate((n) => getComputedStyle(n).fill);
    const rgb = textColor.match(/[\d.]+/g).map(Number);
    assert(
      rgb[1] > rgb[0] && rgb[1] > rgb[2],
      "Series label retains its green hue",
    );
    await source
      .locator("#light-label")
      .evaluate((n) => n.setAttribute("x", "200"));
    await source.locator("#light-label[data-aside-lights-text]").waitFor();
    await source
      .locator("#light-label")
      .evaluate((n) => n.setAttribute("x", "10"));
    await source.waitForFunction(
      () =>
        !document
          .querySelector("#light-label")
          .hasAttribute("data-aside-lights-text"),
    );
    await source.locator("#dark-label").evaluate((n) => {
      const next = n.cloneNode(true);
      next.removeAttribute("data-aside-lights-text");
      next.style.removeProperty("--aside-lights-text-fill");
      n.replaceWith(next);
    });
    await source.locator("#dark-label[data-aside-lights-text]").waitFor();
    await source.screenshot({
      path: path.join(artifacts, "svg-text-contrast.png"),
    });
    if (DECISION_MODELS_ENABLED) await update({ enhance: true });
    else await assert.rejects(update({ enhance: true }), /notAllowed/);
    assert.equal(
      (await status()).enhancement.status,
      DECISION_MODELS_ENABLED ? "noModel" : "off",
    );
    assert(await source.locator("#dark-label[data-aside-lights-text]").count());
    await update({ enhance: false });
    assert(await source.locator("#dark-label[data-aside-lights-text]").count());
    assert.equal(
      await worker.evaluate(() => localRepairMessages.length),
      beforeTextRepair,
      "SVG repair and DOM/scroll updates never use decision messaging",
    );
    await source.locator("#svg-text").evaluate((n) => n.remove());
    // A theme must not merge black and white meaning in an interactive SVG.
    await source.evaluate(() => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "diagram";
      svg.setAttribute("width", "360");
      svg.setAttribute("height", "180");
      const motion = document.createElement("style");
      motion.textContent = "svg circle,svg rect{transition:fill .25s}";
      document.head.append(motion);
      svg.innerHTML =
        '<rect width="360" height="180" fill="white"/><circle id="dark-pearl" cx="100" cy="90" r="30" fill="#111"/><circle id="white-pearl" cx="240" cy="90" r="30" fill="white" stroke="#111"/>';
      const theme = document.createElement("style");
      theme.className = "darkreader";
      theme.textContent =
        "svg circle{fill:#ddd!important;stroke:#ddd!important}";
      document.head.append(theme);
      document.querySelector("main").append(svg);
      svg.scrollIntoView();
      svg.addEventListener("click", () => (svg.dataset.clicked = "yes"));
    });
    await source.locator('#diagram[data-aside-lights-repair="svg"]').waitFor();
    assert.equal(
      await source
        .locator("#dark-pearl")
        .evaluate((n) => getComputedStyle(n).fill),
      "rgb(17, 17, 17)",
    );
    await source.waitForFunction(
      () =>
        getComputedStyle(document.querySelector("#white-pearl")).fill ===
        "rgb(255, 255, 255)",
    );
    assert.equal(
      await source
        .locator("#white-pearl")
        .evaluate((n) => getComputedStyle(n).fill),
      "rgb(255, 255, 255)",
    );
    await source.locator("#dark-pearl").click();
    assert.equal(
      await source.locator("#diagram").getAttribute("data-clicked"),
      "yes",
    );
    // Let the enhancement's own mutations settle before changing a child shape.
    await source.waitForTimeout(800);
    await source
      .locator("#dark-pearl")
      .evaluate((n) => n.setAttribute("fill", "#222"));
    await source.waitForFunction(
      () =>
        getComputedStyle(document.querySelector("#dark-pearl")).fill ===
        "rgb(34, 34, 34)",
    );
    if (DECISION_MODELS_ENABLED) await update({ enhance: true });
    else await assert.rejects(update({ enhance: true }), /notAllowed/);
    await update({ enhance: false });
    assert.notEqual(
      await source
        .locator("#dark-pearl")
        .evaluate((n) => n.style.getPropertyValue("--aside-lights-svg-fill")),
      "",
    );
    assert.equal(
      await source.locator('#diagram[data-aside-lights-repair="svg"]').count(),
      1,
    );
    // Stop all basic repairs when the site switches to its native dark theme.
    await source.evaluate(() => {
      document.documentElement.style.cssText =
        "background:#181a1b!important;color:#eee!important";
      document.body.style.cssText =
        "background:#181a1b!important;color:#eee!important";
    });
    await page.waitForFunction(
      async (id) =>
        (
          await chrome.tabs.sendMessage(
            id,
            { type: "lights.status" },
            { frameId: 0 },
          )
        ).status === "native",
      tabId,
    );
    await source.waitForFunction(
      () => !document.querySelector("[data-aside-lights-repair]"),
    );
    await source.evaluate(() => {
      document.documentElement.removeAttribute("style");
      document.body.removeAttribute("style");
    });
    await source.locator("#photo-darken").scrollIntoViewIfNeeded();
    await source
      .locator("#photo-darken[data-aside-lights-repair=unblend]")
      .waitFor();
    await source.screenshot({
      path: path.join(artifacts, "lights-basic-local.png"),
    });
    await update({ lights: "off" });
    assert.equal(
      await source
        .locator(
          '[data-aside-lights-repair],[data-aside-lights-text],style[data-aside-lights="local"]',
        )
        .count(),
      0,
    );
    decisionMessages.push(
      ...(await worker.evaluate(() => localRepairMessages)),
    );
    assert.deepEqual(
      decisionMessages,
      [],
      "Basic repairs never send decision candidates or query the model cache",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: basic local SVG contrast/text and image blend repairs without any decision connection; dynamic DOM, hover, complete restore, native-theme switching and independent model toggle, zero decision/cache messages.",
    );
  } finally {
    await update(null).catch(() => {});
    await source.close();
    await worker.evaluate(() => {
      chrome.runtime.onMessage.removeListener(recordLocalRepairMessage);
      delete globalThis.recordLocalRepairMessage;
      delete globalThis.localRepairMessages;
    });
    context.setDefaultTimeout(30000);
  }
};
