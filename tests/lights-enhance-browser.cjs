const assert = require("node:assert/strict"),
  http = require("node:http"),
  path = require("node:path");
module.exports = async ({ page, context, artifacts, nav, op, choose }) => {
  const requests = [];
  const waitForCalls = async (count) => {
    const deadline = Date.now() + 10000;
    while (requests.length < count && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert(
      requests.length >= count,
      `Expected at least ${count} decision calls`,
    );
  };
  let fail = false,
    hold = false,
    pending = [];
  const json = (res, value, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    if (req.url === "/texture.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#f8f8f8"/><path d="M0 0L400 200" stroke="#ddd"/></svg>',
      );
      return;
    }
    if (req.url === "/v1/models")
      return json(res, {
        models: [
          {
            name: "jev-preview",
            description: "Decision fixture",
            release_date: "2026-10-14",
          },
        ],
      });
    if (req.url === "/v1/systemone") {
      let raw = "";
      for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      requests.push({ body, headers: req.headers });
      const finish = () => {
        if (fail)
          return json(res, { error: { message: "Fixture unavailable" } }, 503);
        const answers = Object.fromEntries(
          Object.keys(body.questions).map((id) => {
            const label = body.state[id].label;
            const choice =
              label.startsWith("Decorative") &&
              !body.state[id].context.includes("Data chart")
                ? "decorative_background"
                : label === "Colored mark"
                  ? "content_media"
                  : label === "Monochrome text"
                    ? "monochrome_mark"
                    : label === "Uncertain" || label === "Uncertain text"
                      ? "uncertain"
                      : "content_media";
            return [
              id,
              {
                type: "choice",
                choice,
                confidence: 0.96,
                probabilities: Object.fromEntries(
                  Object.keys(body.questions[id].criteria).map((key) => [
                    key,
                    key === choice ? 0.97 : 0.01,
                  ]),
                ),
              },
            ];
          }),
        );
        json(res, {
          model: "jev-fixture",
          answers,
          usage: { input_tokens: 300, output_tokens: 12 },
        });
      };
      if (hold) pending.push(finish);
      else finish();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><title>Visual classification fixture</title><style>
      html,body{margin:0;background:white;color:#222;font:16px/1.4 sans-serif}main{padding:24px;max-width:920px}.hero{position:relative;height:220px;width:600px;margin-bottom:20px}canvas{width:280px;height:140px}.hero canvas{position:absolute;inset:0;width:600px;height:220px}.hero h1{position:relative;padding:60px 40px;pointer-events:none}.gallery{display:flex;gap:20px}img{width:90px;height:60px}h2{font-size:16px}
      </style></head><body><main><header><img id="wordmark" alt="Monochrome text" style="display:block;width:105px;height:22px" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='50'%3E%3Cpath d='M10 10h130v10H10zM10 30h130v10H10z' fill='%23111'/%3E%3C/svg%3E"><img id="tagline" alt="Monochrome text" style="display:block;width:103px;height:14px" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='50'%3E%3Cpath d='M10 10h130v10H10zM10 30h130v10H10z' fill='%23111'/%3E%3C/svg%3E"></header><section class="hero"><canvas id="decor" width="600" height="220" aria-label="Decorative ambience"></canvas><h1>A calm place to read</h1></section><div class="gallery"><section><h2>Revenue chart</h2><canvas id="chart" width="280" height="140" aria-label="Revenue chart"></canvas></section><section><h2>Unclear image</h2><canvas id="unknown" width="280" height="140" aria-label="Uncertain"></canvas></section></div><img alt="Photo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='60'%3E%3Crect width='90' height='60' fill='red'/%3E%3C/svg%3E"><input type="password" value="DO_NOT_SEND_FORM_VALUE"><p hidden>DO_NOT_SEND_HIDDEN_TEXT</p></main><script>for(const c of document.querySelectorAll('canvas')){const x=c.getContext('2d');x.fillStyle='#f4f6f8';x.fillRect(0,0,c.width,c.height);x.fillStyle='#222';x.fillRect(10,10,3,35);}</script></body></html>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.unref();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (message) =>
    page.evaluate(async (message) => {
      const r = await chrome.runtime.sendMessage(message);
      if (!r?.ok) throw Error(JSON.stringify(r));
      return r.value;
    }, message);
  let source, popup;
  try {
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
    const generation = await send({
      type: "connection.save",
      connection: {
        id: null,
        name: "Generation fixture",
        url: origin + "/v1",
        protocol: "chat",
        model: "writer",
        models: [{ id: "writer", name: "writer" }],
        maxTokens: 8192,
        connected: true,
      },
      key: "writer-fixture",
    });
    await page.reload();
    await page.locator("h1").waitFor();
    await nav("connections");
    await op("add-connection").click();
    await choose("[data-connection-purpose]", "decision");
    assert.equal(
      await page.locator("[data-connection=protocol]").inputValue(),
      "typesafe",
    );
    assert.equal(
      await page.locator("[data-connection=url]").inputValue(),
      "https://api.typesafe.ai/v1",
    );
    assert.equal(await page.locator("[data-connection=maxTokens]").count(), 0);
    assert.equal(
      await page.locator("[data-connection=reasoningEffort]").count(),
      0,
    );
    await page.locator("[data-connection=name]").fill("TypeSafe decision");
    await page.locator("[data-connection=url]").fill(origin + "/v1");
    await page.locator("[data-connection=key]").fill("decision-fixture");
    await op("test-connection").click();
    await page.getByText("连接成功", { exact: true }).waitFor();
    await choose("[data-connection=model]", "jev-preview");
    await op("save-connection").click();
    await page.waitForFunction(
      async () =>
        (await chrome.runtime.sendMessage({ type: "snapshot" })).value
          .defaultDecisionConnection,
    );
    let data = await send({ type: "snapshot" });
    assert.equal(data.defaultConnection, generation.id);
    assert(data.defaultDecisionConnection);
    const decisionId = data.defaultDecisionConnection;
    await page.screenshot({
      path: path.join(artifacts, "connections-decision.png"),
      fullPage: true,
    });
    await nav("actions");
    // Generation selectors must not expose the decision connection.
    await page.locator("[data-op=edit-action]").first().click();
    await page.locator("details.advanced").evaluate((n) => (n.open = true));
    assert.equal(
      await page
        .locator(`[data-draft=model] option[value="${decisionId}"]`)
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator(`[data-draft=model] option[value="${generation.id}"]`)
        .count(),
      1,
    );
    assert.equal(
      (await send({ type: "snapshot" })).website.sites["127.0.0.1"]?.enhance ||
        false,
      false,
    );
    source = await context.newPage();
    await source.goto(origin + "/page");
    const tabId = await page.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((t) => t.url === url).id,
      source.url(),
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
    const update = (patch) => send({ type: "website.update", tabId, patch });
    await update({ lights: "on" });
    await source.waitForFunction(
      () => document.documentElement.dataset.darkreaderMode === "dynamic",
    );
    await source.waitForTimeout(900);
    assert.equal(
      requests.length,
      0,
      "No decision calls while enhancement is off",
    );
    const waitStatus = async (wanted) => {
      const deadline = Date.now() + 10000;
      let observed;
      do {
        observed = (await status()).enhancement.status;
        if (observed === wanted) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      assert.equal(observed, wanted, "Enhancement reached the expected state");
    };
    const analyze = () =>
      page.evaluate(
        (tabId) =>
          chrome.tabs.sendMessage(
            tabId,
            { type: "lights.analyze" },
            { frameId: 0 },
          ),
        tabId,
      );
    // Saved configuration alone never authorizes a model request.
    await update({ enhance: true });
    await waitStatus("ready");
    await source.waitForTimeout(900);
    assert.equal(requests.length, 0);
    await update({ enhance: false });
    popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 600 });
    await source.bringToFront();
    await popup.goto(
      page.url().split("/").slice(0, 3).join("/") + "/popup.html",
    );
    await popup.locator("[data-feature=enhance]").check();
    await source.locator("#decor[data-aside-lights-effect=dim]").waitFor();
    await waitStatus("done");
    assert.equal(requests.length, 1, "Visible candidates are batched");
    await source
      .locator("#wordmark[data-aside-lights-effect=lighten]")
      .waitFor();
    await source
      .locator("#tagline[data-aside-lights-effect=lighten]")
      .waitFor();
    assert(
      Object.values(requests[0].body.state).some(
        (c) => c.width === 103 && c.height === 14,
      ),
      "Short wide text images are included",
    );
    assert.equal(requests[0].headers["typesafe-danger-zone-images"], "true");
    assert.equal(requests[0].headers.authorization, "Bearer decision-fixture");
    assert(!JSON.stringify(requests).includes("DO_NOT_SEND_"));
    assert.equal(
      await source
        .locator(
          "#chart[data-aside-lights-effect],#unknown[data-aside-lights-effect],img[alt=Photo][data-aside-lights-effect]",
        )
        .count(),
      0,
    );
    const usage = await send({ type: "usage.list" });
    assert.equal(usage.filter((r) => r.source === "lightsEnhance").length, 1);
    assert.equal(
      usage.find((r) => r.source === "lightsEnhance").tokens.totalTokens,
      312,
    );
    await source.screenshot({
      path: path.join(artifacts, "lights-enhanced.png"),
    });
    await popup.locator("[data-feature=enhance]").waitFor();
    assert(await popup.locator("[data-feature=enhance]").isChecked());
    await popup
      .locator("#enhance-status")
      .filter({ hasText: "本轮分析已完成" })
      .waitFor();
    assert(await popup.locator("[data-enhance-retry]").isEnabled());
    await popup.locator(".popup-enhance").scrollIntoViewIfNeeded();
    await popup.screenshot({ path: path.join(artifacts, "popup-enhance.png") });
    await popup.close();
    popup = undefined;
    await source.bringToFront();
    await update({ enhance: false });
    assert.equal(await source.locator("[data-aside-lights-effect]").count(), 0);
    assert.equal((await status()).status, "active", "Basic mode stays on");
    await update({ enhance: true });
    await source.locator("#decor[data-aside-lights-effect=dim]").waitFor();
    assert.equal(
      requests.length,
      1,
      "Repeated activation reuses persistent decisions",
    );
    await source.reload();
    await waitStatus("ready");
    await source.waitForTimeout(900);
    assert.equal(requests.length, 1, "Page reload does not start an analysis");
    await source.locator("#decor[data-aside-lights-effect=dim]").waitFor();
    await source
      .locator("#wordmark[data-aside-lights-effect=lighten]")
      .waitFor();
    await source
      .locator("#tagline[data-aside-lights-effect=lighten]")
      .waitFor();
    await source.screenshot({
      path: path.join(artifacts, "lights-cached-wordmark.png"),
    });
    assert.equal(
      requests.length,
      1,
      "Reload reuses decisions without retaining image data in the cache",
    );
    await source
      .locator("h1")
      .evaluate((node) => (node.textContent = "Data chart"));
    await source.waitForFunction(
      () =>
        !document
          .querySelector("#decor")
          .hasAttribute("data-aside-lights-effect"),
    );
    await source.locator("#decor").hover();
    await source.mouse.wheel(0, 100);
    await source.waitForTimeout(900);
    assert.equal(
      requests.length,
      1,
      "Heading, hover and scroll do not reanalyze",
    );
    await analyze();
    await waitForCalls(2);
    await waitStatus("done");
    assert.equal(
      requests.length,
      2,
      "Heading context changes invalidate the previous role",
    );
    await source
      .locator("h1")
      .evaluate((node) => (node.textContent = "A calm place to read"));
    await source.locator("#decor[data-aside-lights-effect=dim]").waitFor();
    assert.equal(
      requests.length,
      2,
      "Restoring the same evidence reuses the earlier classification",
    );
    // Changed semantics invalidate the evidence; disabling while a request is in flight prevents stale effects.
    hold = true;
    await source
      .locator("#decor")
      .evaluate((node) =>
        node.setAttribute("aria-label", "Decorative changed"),
      );
    await source.waitForTimeout(900);
    assert.equal(
      requests.length,
      2,
      "Changed evidence waits for an explicit analysis",
    );
    await analyze();
    await waitForCalls(3);
    assert.equal(
      requests.length,
      3,
      "Label changes must invalidate classifications",
    );
    await update({ enhance: false });
    for (const finish of pending.splice(0)) finish();
    hold = false;
    await page.waitForTimeout(250);
    assert.equal(await source.locator("[data-aside-lights-effect]").count(), 0);
    // Error is visible and never disables the basic engine.
    fail = true;
    await update({ enhance: true });
    await analyze();
    await waitStatus("error");
    const callsAfterError = requests.length;
    await source.mouse.wheel(0, 20);
    await source.waitForTimeout(900);
    assert.equal(
      requests.length,
      callsAfterError,
      "Errors are not retried automatically",
    );
    assert.equal((await status()).status, "active");
    assert.equal(await source.locator("[data-aside-lights-effect]").count(), 0);
    fail = false;
    await analyze();
    await source.locator("#decor[data-aside-lights-effect=dim]").waitFor();
    // Public-site regressions: CSS textures must not dim their children; small
    // transparent text and mixed-color marks must stay legible without touching photos.
    await source.evaluate((origin) => {
      const svg = (color, opaque = false) =>
        "data:image/svg+xml," +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="50">${opaque ? '<rect width="160" height="50" fill="white"/>' : ""}<path d="M10 10h80v12H10zM10 30h80v10H10z" fill="#111"/><rect x="105" y="10" width="25" height="30" fill="${color}"/></svg>`,
        );
      const section = document.createElement("section");
      section.id = "regressions";
      section.innerHTML = `<table style="width:100%"><tr><td id="texture" aria-label="Decorative paper texture" style="height:180px;background-image:url(${origin}/texture.svg)"><font id="texture-text">Keep text readable and leave child colors intact.</font></td></tr></table><div style="background:#181a1b"><img id="mixed" alt="Colored mark" src="${svg("red")}"><img id="mono" alt="Monochrome text" src="${svg("#111")}"><img id="uncertain-text" alt="Uncertain text" src="${svg("#111")}"><img id="opaque" alt="Colored mark" src="${svg("red", true)}"><img id="blended" alt="Product photo" style="mix-blend-mode:darken" src="${svg("blue", true)}"></div>`;
      document.querySelector("main").append(section);
      section.scrollIntoView();
    }, origin);
    await analyze();
    await source.locator("#texture[data-aside-lights-effect=shade]").waitFor();
    await source.locator("#mixed[data-aside-lights-effect=backdrop]").waitFor();
    await source.locator("#mono[data-aside-lights-effect=lighten]").waitFor();
    await source
      .locator("#uncertain-text[data-aside-lights-effect=backdrop]")
      .waitFor();
    await waitStatus("done");
    await source
      .locator('#blended[data-aside-lights-repair="unblend"]')
      .waitFor();
    assert.equal(
      await source
        .locator("#blended")
        .evaluate((n) => getComputedStyle(n).mixBlendMode),
      "normal",
    );
    assert.equal(
      await source.locator("#opaque[data-aside-lights-effect]").count(),
      0,
    );
    assert.equal(
      await source
        .locator("#texture-text")
        .evaluate((n) => getComputedStyle(n).filter),
      "none",
    );
    assert(
      (
        await source
          .locator("#texture")
          .evaluate((n) => getComputedStyle(n).backgroundImage)
      ).startsWith("linear-gradient("),
    );
    assert.equal(
      await source
        .locator("#mixed")
        .evaluate((n) => getComputedStyle(n).filter),
      "none",
    );
    // Theme teardown can remove the ignored sheet while leaving effect attributes.
    // Restoring the owned CSS must not require another model call.
    const callsBeforeSheetRemoval = requests.length;
    await source
      .locator('style[data-aside-lights="enhance"]')
      .evaluate((n) => n.remove());
    await source.waitForFunction(() =>
      getComputedStyle(
        document.querySelector("#texture"),
      ).backgroundImage.startsWith("linear-gradient("),
    );
    await waitStatus("done");
    assert.equal(requests.length, callsBeforeSheetRemoval);
    const sentMarks = requests.flatMap((r) => Object.values(r.body.state));
    assert(
      sentMarks.some(
        (c) => c.label === "Colored mark" && c.transparentFraction > 0.1,
      ),
    );
    assert(
      !sentMarks.some(
        (c) => c.label === "Colored mark" && c.transparentFraction < 0.1,
      ),
    );
    await source.screenshot({
      path: path.join(artifacts, "lights-visual-regressions.png"),
    });
    await update({ enhance: false });
    assert.equal(await source.locator("[data-aside-lights-effect]").count(), 0);
    assert.equal(
      await source
        .locator("#texture")
        .evaluate((n) =>
          n.style.getPropertyValue("--aside-lights-original-background"),
        ),
      "",
    );
    assert.equal(
      await source
        .locator("#blended")
        .evaluate((n) => getComputedStyle(n).mixBlendMode),
      "normal",
      "Disabling Jev keeps the basic blend repair",
    );
    assert.equal(
      await source
        .locator('#blended[data-aside-lights-repair="unblend"]')
        .count(),
      1,
    );
    await update({ enhance: true });
    await analyze();
    await source.locator("#texture[data-aside-lights-effect=shade]").waitFor();
    await source.evaluate(() => {
      const style = document.createElement("style");
      style.className = "darkreader";
      style.textContent =
        "#regressions.light-surface > div{background-color:white!important}";
      document.head.append(style);
      document.querySelector("#regressions").classList.add("light-surface");
    });
    await source.waitForFunction(
      () =>
        !document
          .querySelector("#mono")
          .hasAttribute("data-aside-lights-effect"),
    );
    await source
      .locator("#regressions")
      .evaluate((n) => n.classList.remove("light-surface"));
    await analyze();
    await source.locator("#mono[data-aside-lights-effect=lighten]").waitFor();
    // One explicit pass may use multiple bounded batches, but its snapshot
    // cannot grow due to new DOM, scrolling, hover or repeated button clicks.
    await source.evaluate(() => {
      const main = document.querySelector("main");
      main.innerHTML =
        '<h1>Manual batch fixture</h1><section id="batch" style="display:grid;grid-template-columns:repeat(4,120px);gap:10px"></section>';
      for (let i = 0; i < 8; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = 120;
        canvas.height = 80;
        canvas.style.cssText = "width:120px;height:80px";
        canvas.setAttribute("aria-label", `Batch candidate ${i}`);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 120, 80);
        document.querySelector("#batch").append(canvas);
      }
      scrollTo(0, 0);
    });
    const batchStart = requests.length;
    await source.waitForTimeout(900);
    assert.equal(
      requests.length,
      batchStart,
      "New content alone does not call the model",
    );
    hold = true;
    await analyze();
    await waitForCalls(batchStart + 1);
    assert.equal(
      await analyze(),
      false,
      "A repeated action cannot overlap a running analysis",
    );
    await source.evaluate(() => {
      const canvas = document.querySelector("#batch canvas").cloneNode();
      canvas.setAttribute("aria-label", "Added during analysis");
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 120, 80);
      document.querySelector("#batch").append(canvas);
    });
    hold = false;
    for (const finish of pending.splice(0)) finish();
    await waitStatus("done");
    await source.locator("#batch").hover();
    await source.mouse.wheel(0, 50);
    await source.waitForTimeout(900);
    assert.equal(
      requests.length,
      batchStart + 2,
      "The eight-element pass ends after two batches",
    );
    assert(
      !requests
        .slice(batchStart)
        .some((r) =>
          Object.values(r.body.state).some(
            (c) => c.label === "Added during analysis",
          ),
        ),
    );
    // The existing retry entry is now available after success as well.
    popup = await context.newPage();
    await source.bringToFront();
    await popup.goto(
      page.url().split("/").slice(0, 3).join("/") + "/popup.html",
    );
    await popup.locator("[data-enhance-retry]").click();
    await waitStatus("done");
    assert.equal(
      requests.length,
      batchStart + 3,
      "Only manual reanalysis picks up the new candidate",
    );
    await popup.close();
    popup = undefined;
    await source.bringToFront();
    // Model deletion removes only Jev effects; basic repairs survive intact.
    await source.evaluate(() => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "local-after-model-delete";
      svg.setAttribute("width", "300");
      svg.setAttribute("height", "60");
      svg.innerHTML = '<text x="5" y="25">A basic label</text>';
      const theme = document.createElement("style");
      theme.className = "darkreader";
      theme.textContent = "#local-after-model-delete text{fill:#111!important}";
      document.head.append(theme);
      document.querySelector("main").append(svg);
      svg.scrollIntoView();
    });
    await source
      .locator("#local-after-model-delete [data-aside-lights-text]")
      .waitFor();
    const localSheet = await source
      .locator('style[data-aside-lights="local"]')
      .elementHandle();
    await send({ type: "connection.remove", id: decisionId });
    await waitStatus("noModel");
    data = await send({ type: "snapshot" });
    assert.equal(data.defaultConnection, generation.id);
    assert.equal(data.defaultDecisionConnection, null);
    assert(
      await localSheet.evaluate((node) => node.isConnected),
      "Changing the model does not restart local repairs",
    );
    assert.equal(
      await source
        .locator("#local-after-model-delete [data-aside-lights-text]")
        .count(),
      1,
    );
    assert.equal(await source.locator("[data-aside-lights-effect]").count(), 0);
    console.log(
      "PASS: explicit inference only, cached effects restored after reload, 14px text images, no cache-miss/scroll/hover/DOM/error-driven model calls, safe effects, cache reuse, evidence invalidation, cancellation and model isolation.",
    );
  } finally {
    await source?.close();
    await popup?.close();
    for (const finish of pending) finish();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
};
