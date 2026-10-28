const { chromium } = require("playwright"),
  fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  artifacts = path.join(root, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
(async () => {
  const streams = [];
  let cacheFailure = false;
  const defaultResultText = (text) => "Processed: " + text;
  let resultText = defaultResultText;
  const setResultText = (fn) => {
    resultText = fn || defaultResultText;
  };
  const emit = (res, value) =>
    res.write("data: " + JSON.stringify(value) + "\n\n");
  const startUsage = (res, url) => {
    if (url.endsWith("/messages"))
      emit(res, {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 20,
            output_tokens: 1,
            cache_read_input_tokens: 60,
            cache_creation_input_tokens: 20,
          },
        },
      });
  };
  const finishUsage = (res, url) => {
    if (url.endsWith("/responses"))
      emit(res, {
        type: "response.completed",
        response: {
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 },
          },
        },
      });
    else if (url.endsWith("/interactions"))
      emit(res, {
        event_type: "interaction.completed",
        interaction: {
          status: "completed",
          usage: {
            total_input_tokens: 100,
            total_output_tokens: 20,
            total_cached_tokens: 60,
            total_thought_tokens: 7,
            total_tokens: 127,
          },
        },
      });
    else if (url.endsWith("/messages")) {
      emit(res, {
        type: "message_delta",
        delta: {},
        usage: { output_tokens: 5 },
      });
      emit(res, {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 20 },
      });
      emit(res, { type: "message_stop" });
    } else {
      emit(res, {
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_cache_hit_tokens: 60,
        },
      });
      res.write("data: [DONE]\n\n");
    }
    res.end();
  };
  const modelRequests = [],
    calls = [],
    fixture = `<!doctype html><html><head><title>Reading fixture</title><style>body{font:16px sans-serif;margin:40px;max-width:800px}p{line-height:1.8}.hidden{display:none}</style></head><body><nav><a href="#article">Navigation</a><button id="native-button">Native button</button></nav><main id="article"><h1>Read carefully</h1><p id="first">Reading is <em>active</em> thinking.</p><p id="second">Connect this idea to your experience.</p><ul><li>Keep the original structure.</li></ul><table><tr><th>Limit</th><td>200 pages</td></tr></table><p class="hidden">HIDDEN_SECRET</p><div contenteditable="true">EDITABLE_SECRET</div><input value="FORM_SECRET"><pre>CODE_SECRET</pre></main><script>window.nativeClicks=0;document.querySelector('#native-button').addEventListener('click',()=>window.nativeClicks++);</script></body></html>`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    if (req.method === "GET" && url.pathname.endsWith("/models")) {
      const key =
        req.headers["x-api-key"] ||
        req.headers["x-goog-api-key"] ||
        req.headers.authorization?.replace(/^Bearer /, "");
      modelRequests.push({
        method: req.method,
        path: req.url,
        auth: req.headers.authorization,
        key,
      });
      if (key === "slow-fixture")
        await new Promise((resolve) => setTimeout(resolve, 400));
      res.setHeader("content-type", "application/json");
      if (key === "invalid-fixture") {
        res.writeHead(401);
        res.end(JSON.stringify({ error: { message: "Invalid fixture key" } }));
        return;
      }
      if (url.pathname.startsWith("/malformed")) {
        res.end(JSON.stringify({ wrong: [] }));
        return;
      }
      const gemini = Boolean(req.headers["x-goog-api-key"]),
        anthropic = Boolean(req.headers["x-api-key"]);
      const empty = url.pathname.startsWith("/empty"),
        next =
          url.searchParams.has("pageToken") || url.searchParams.has("after_id");
      const ids = empty
        ? []
        : next
          ? ["last-model"]
          : [
              "fixture-model",
              "gpt-6-sol",
              "gemini-3.8-flash",
              "gemini-3.6-flash",
              ...Array.from({ length: 7 }, (_, i) => "model-" + i),
              ...(!gemini && !anthropic ? ["last-model"] : []),
            ];
      const result = gemini
        ? {
            models: ids.map((id) => ({
              name: "models/" + id,
              displayName: id,
            })),
            ...(!empty && !next ? { nextPageToken: "second" } : {}),
          }
        : {
            data: ids.map((id) => ({
              id,
              display_name: id,
              ...(anthropic && ["fixture-model", "model-0"].includes(id)
                ? {
                    capabilities: {
                      effort: {
                        supported: id === "fixture-model",
                        low: { supported: true },
                        high: { supported: true },
                        max: { supported: true },
                      },
                      thinking: {
                        types: {
                          adaptive: { supported: id === "fixture-model" },
                        },
                      },
                    },
                  }
                : {}),
            })),
            ...(anthropic
              ? { has_more: !empty && !next, last_id: ids.at(-1) }
              : {}),
          };
      res.end(JSON.stringify(result));
      return;
    }
    if (req.method === "POST") {
      let raw = "";
      for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      if (
        cacheFailure ||
        req.headers.authorization === "Bearer invalid-fixture"
      ) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid fixture key" } }));
        return;
      }
      calls.push({
        path: req.url,
        body,
        auth: req.headers.authorization,
        key: req.headers["x-api-key"] || req.headers["x-goog-api-key"],
      });
      const input =
        typeof body.input === "string"
          ? body.input
          : body.input?.at(-1)?.content?.[0]?.text ||
            body.messages?.at(-1).content;
      let output;
      let sourceInput = input;
      try {
        const parsed = JSON.parse(input);
        if (typeof parsed.text === "string" && parsed.context)
          sourceInput = parsed.text;
      } catch {}
      if (sourceInput.startsWith("STREAM_FIXTURE")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        startUsage(res, req.url);
        const responseProtocol = req.url.endsWith("/responses"),
          anthropicProtocol = req.url.endsWith("/messages"),
          geminiProtocol = req.url.endsWith("/interactions");
        const exchange = {
          input: sourceInput,
          closed: false,
          write(text) {
            const delta = geminiProtocol
              ? { event_type: "step.delta", delta: { type: "text", text } }
              : responseProtocol
                ? { type: "response.output_text.delta", delta: text }
                : anthropicProtocol
                  ? {
                      type: "content_block_delta",
                      delta: { type: "text_delta", text },
                    }
                  : { choices: [{ delta: { content: text } }] };
            res.write("data: " + JSON.stringify(delta) + "\n\n");
          },
          finish() {
            finishUsage(res, req.url);
          },
          interrupt() {
            res.end();
          },
        };
        res.on("close", () => (exchange.closed = true));
        streams.push(exchange);
        if (!sourceInput.startsWith("STREAM_FIXTURE_WAIT"))
          exchange.write("逐步");
        return;
      }
      if (input === "Connection test.") output = "OK";
      else {
        try {
          const data = JSON.parse(input);
          output = data.items
            ? JSON.stringify({
                items: data.items.map((i) => ({
                  id: i.id,
                  text: resultText(i.text),
                })),
              })
            : typeof data.text === "string"
              ? resultText(data.text)
              : "A thought generated from your saved passages.";
        } catch {
          output = "Processed together: " + input;
        }
      }
      if (input.includes("DELAY_FIXTURE"))
        await new Promise((resolve) => setTimeout(resolve, 1200));
      res.writeHead(200, { "content-type": "text/event-stream" });
      startUsage(res, req.url);
      if (req.url.endsWith("/interactions"))
        emit(res, {
          event_type: "step.delta",
          delta: { type: "text", text: output },
        });
      else if (req.url.endsWith("/responses"))
        emit(res, { type: "response.output_text.delta", delta: output });
      else if (req.url.endsWith("/messages"))
        emit(res, {
          type: "content_block_delta",
          delta: { type: "text_delta", text: output },
        });
      else emit(res, { choices: [{ delta: { content: output } }] });
      if (input === "NO_USAGE_FIXTURE") {
        res.end("data: [DONE]\n\n");
        return;
      }
      finishUsage(res, req.url);
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(fixture);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pagework-browser-"));
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" }),
    headless: true,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  });
  const errors = [];
  let page;
  const coldSource =
    process.argv.includes("--context-menu-only") ||
    process.argv.includes("--shortcuts-only")
      ? await context.newPage()
      : null;
  if (coldSource) await coldSource.goto(origin + "/before-extension-install");
  const runMessaging =
    process.argv.includes("--messaging-only") ||
    !process.argv.some((arg) => arg.endsWith("-only"));
  const stalledSource = runMessaging ? await context.newPage() : null;
  if (stalledSource)
    await stalledSource.goto(origin + "/before-messaging-install");
  require("./inspect-ui.cjs").watchUI(context, errors);
  try {
    const cdp = await context.browser().newBrowserCDPSession(),
      { id } = await cdp.send("Extensions.loadUnpacked", { path: root });
    const manager = await context.newPage();
    await manager.goto("chrome://extensions");
    console.log(
      "Grant fixture origin:",
      await manager.evaluate(
        async ({ id, origin }) => {
          try {
            await chrome.developerPrivate.addHostPermission(id, origin + "/*");
            return "granted";
          } catch (e) {
            return e.message;
          }
        },
        { id, origin },
      ),
    );
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/index.html`);
    await page.locator("h1").waitFor();
    const op = (name) => page.locator(`[data-op="${name}"]`),
      nav = async (route) => {
        if (await op("navigation-open").isVisible())
          await op("navigation-open").click();
        await page.locator(`.sidebar [data-route="${route}"]`).click();
      };
    const choose = async (selector, value) => {
      const selectId = await page.locator(selector).getAttribute("id");
      const trigger = page.locator(`[data-select-for="${selectId}"]`);
      await page.evaluate(() =>
        Promise.all(
          document.getAnimations().map((a) => a.finished.catch(() => {})),
        ),
      );
      await trigger.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await trigger.click();
      await page
        .locator(`[role=option][data-value=${JSON.stringify(value)}]`)
        .click();
      if (selector.startsWith("#usage-"))
        await page.waitForFunction(
          () =>
            document.querySelector(".workspace")?.getAttribute("aria-busy") !==
            "true",
        );
    };
    const loadModels = async () => {
      await op("test-connection").click();
      await page.getByText("连接成功", { exact: true }).waitFor();
      await choose("[data-connection=model]", "fixture-model");
    };
    await choose("#ui-locale", "zh-CN");
    assert.equal(await page.locator(".collection-card").count(), 0);
    if (
      process.argv.includes("--onboarding-only") ||
      !process.argv.some((arg) => arg.endsWith("-only"))
    ) {
      await require("./onboarding-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
      });
      assert.deepEqual(errors, []);
      if (process.argv.includes("--onboarding-only")) return;
    }
    if (runMessaging) {
      await require("./messaging-browser.cjs")({
        page,
        context,
        origin,
        stalledSource,
      });
      assert.deepEqual(errors, []);
      if (process.argv.includes("--messaging-only")) return;
    }
    if (
      process.argv.includes("--home-only") ||
      !process.argv.some((arg) => arg.endsWith("-only"))
    ) {
      await require("./home-browser.cjs")({
        page,
        context,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      if (process.argv.includes("--home-only")) return;
    }
    if (
      process.argv.includes("--usage-only") ||
      !process.argv.some((arg) => arg.endsWith("-only"))
    ) {
      await require("./usage-store-browser.cjs")({ page, nav, op, choose });
      await require("./usage-details-browser.cjs")({
        page,
        context,
        origin,
        calls,
        streams,
        artifacts,
        nav,
        op,
        choose,
      });
      await require("./usage-chart-browser.cjs")({
        page,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      if (process.argv.includes("--usage-only")) return;
    }
    if (
      process.argv.includes("--website-only") ||
      !process.argv.some((arg) => arg.endsWith("-only"))
    ) {
      await require("./website-browser.cjs")({
        page,
        context,
        origin,
        artifacts,
        choose,
      });
      assert.deepEqual(errors, []);
      if (process.argv.includes("--website-only")) return;
    }
    if (
      process.argv.includes("--lights-local-only") ||
      !process.argv.some((arg) => arg.endsWith("-only"))
    ) {
      await require("./lights-local-browser.cjs")({
        page,
        context,
        origin,
        artifacts,
      });
      assert.deepEqual(errors, []);
      if (process.argv.includes("--lights-local-only")) return;
    }
    if (process.argv.includes("--enhance-only")) {
      const { DECISION_MODELS_ENABLED } = await import("../providers.js");
      await require(
        DECISION_MODELS_ENABLED
          ? "./lights-enhance-browser.cjs"
          : "./decision-disabled-browser.cjs",
      )({
        page,
        context,
        origin,
        calls,
        modelRequests,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--lights-recovery-only")) {
      await require("./lights-recovery-browser.cjs")({
        page,
        context,
        artifacts,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--lights-boundaries-only")) {
      await require("./lights-boundaries-browser.cjs")({
        page,
        context,
        origin,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--connections-only")) {
      await require("./connections-browser.cjs")({
        page,
        origin,
        calls,
        modelRequests,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      return;
    }
    await context.route("https://selection.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: fixture }),
    );
    const automatic = await context.newPage();
    automatic.on("pageerror", (e) => errors.push(e.message));
    await automatic.goto("https://selection.example/article");
    const automaticHost = automatic.locator("[data-pagework=ui]");
    await automaticHost.waitFor({ state: "attached" });
    assert(await automaticHost.locator("#toolbar").isHidden());
    // A first-visit site needs no toolbar click, per-site registration, or API call.
    await automatic.evaluate(() => {
      document.body.addEventListener("mouseup", (e) => e.stopPropagation());
      document.querySelector("main").contentEditable = "false";
    });
    const start = await automatic.locator("#first").boundingBox(),
      end = await automatic.locator("#second").boundingBox();
    await automatic.mouse.move(start.x + 2, start.y + 5);
    await automatic.mouse.down();
    await automatic.mouse.move(end.x + end.width - 2, end.y + end.height - 5, {
      steps: 8,
    });
    await automatic.mouse.up();
    await automaticHost.locator("#selection").waitFor();
    assert(
      (await automatic.evaluate(() => getSelection().toString())).includes(
        "Reading",
      ),
    );
    assert.equal(calls.length, 0, "Selecting text never sends it to a model");
    await automatic.screenshot({
      path: path.join(artifacts, "selection-auto.png"),
    });
    await automatic.keyboard.press("Escape");
    assert(await automaticHost.locator("#selection").isHidden());
    await automatic.keyboard.press("Shift+ArrowLeft");
    await automaticHost.locator("#selection").waitFor();
    await automatic.locator("[contenteditable=true]").click();
    await automatic.keyboard.press("Meta+A");
    assert(
      await automaticHost.locator("#selection").isHidden(),
      "Editable text does not trigger the selection toolbar",
    );
    await automatic.reload();
    await automaticHost.waitFor({ state: "attached" });
    await automatic.locator("#first").dblclick({ position: { x: 12, y: 12 } });
    await automaticHost.locator("#selection").waitFor();
    assert.equal(await automaticHost.count(), 1);
    await automatic.goto("https://selection.example/next");
    await automaticHost.waitFor({ state: "attached" });
    await automatic.locator("#second").dblclick({ position: { x: 12, y: 12 } });
    await automaticHost.locator("#selection").waitFor();
    assert.equal(calls.length, 0);
    await automatic.close();
    await nav("usage");
    await page.getByText("暂无调用记录", { exact: true }).waitFor();
    assert.equal(
      await page.locator("[data-usage-total=inputTokens]").textContent(),
      "—",
    );
    assert.equal(await page.locator('[data-route="web"]').count(), 0);
    await page.goto(`chrome-extension://${id}/index.html#web`);
    await page.waitForURL(/#home$/);
    await page.locator("h1").waitFor();
    assert.equal(
      calls.length,
      0,
      "An obsolete page URL returns home without a model request",
    );
    await nav("connections");
    assert.equal(
      await page.locator("[data-connection=protocol]").inputValue(),
      "responses",
    );
    assert.equal(
      await page.locator("[data-connection=openaiCache]").inputValue(),
      "auto",
    );
    for (const [protocol, url] of [
      ["anthropic", "https://api.anthropic.com/v1"],
      ["gemini", "https://generativelanguage.googleapis.com/v1beta"],
      ["responses", "https://api.openai.com/v1"],
    ]) {
      await choose("[data-connection=protocol]", protocol);
      assert.equal(
        await page.locator("[data-connection=url]").inputValue(),
        url,
      );
    }
    await choose("[data-connection=protocol]", "chat");
    await page.locator("[data-connection=name]").fill("Local contract fixture");
    await page.locator("[data-connection=url]").fill(origin + "/v1");
    await page.locator("[data-connection=key]").fill("fixture-key");
    await op("test-connection").click();
    await page.getByText("连接成功", { exact: true }).waitFor();
    await choose("[data-connection=model]", "fixture-model");
    await op("save-connection").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".connection-item.selected strong")
          ?.textContent === "Local contract fixture",
      null,
      { timeout: 8000 },
    );
    if (
      process.argv.includes("--shortcuts-only") ||
      !process.argv.some((arg) => arg.endsWith("-only"))
    ) {
      await require("./shortcuts-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
        choose,
        coldSource,
      });
      assert.deepEqual(errors, []);
      if (process.argv.includes("--shortcuts-only")) return;
    }
    if (process.argv.includes("--locales-only")) {
      await require("./locales-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--daily-only")) {
      await require("./daily-auto-browser.cjs")({
        page,
        context,
        origin,
        calls,
        nav,
        op,
      });
      await require("./daily-browser.cjs")({
        page,
        origin,
        calls,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--output-only")) {
      await require("./output-language-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--appearance-only")) {
      await require("./appearance-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--page-translation-only")) {
      await require("./page-translation-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--inline-only")) {
      await require("./inline-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
        choose,
        setResultText,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--action-order-only")) {
      await require("./action-order-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--navigation-only")) {
      await require("./navigation-browser.cjs")({
        page,
        context,
        origin,
        calls,
        streams,
        artifacts,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--qa-only")) {
      await require("./qa-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--context-menu-only")) {
      await require("./context-menu-browser.cjs")({
        page,
        context,
        origin,
        calls,
        coldSource,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--actions-only")) {
      await require("./actions-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--result-only")) {
      await require("./result-browser.cjs")({
        page,
        context,
        origin,
        calls,
        streams,
        artifacts,
        nav,
        op,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--selection-only")) {
      await require("./selection-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--reasoning-only")) {
      await require("./reasoning-browser.cjs")({
        page,
        origin,
        calls,
        modelRequests,
        artifacts,
        nav,
        op,
        choose,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--radial-hover-only")) {
      await require("./radial-hover-browser.cjs")({
        context,
        origin,
        calls,
        artifacts,
      });
      assert.deepEqual(errors, []);
      return;
    }
    if (process.argv.includes("--radial-only")) {
      await require("./radial-browser.cjs")({
        page,
        context,
        origin,
        calls,
        artifacts,
        nav,
        op,
        choose,
      });
      return;
    }
    if (process.argv.includes("--tools-only")) {
      await require("./tools-browser.cjs")({
        page,
        context,
        extensionId: id,
        origin,
        calls,
        streams,
        artifacts,
      });
      return;
    }
    await op("test-connection").click();
    await page.getByText("连接成功", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-connection=key]").inputValue(), "");
    await page.screenshot({ path: path.join(artifacts, "connections.png") });
    await page.locator("[data-connection=key]").fill("invalid-fixture");
    await op("test-connection").click();
    await page
      .locator("#connection-status")
      .filter({ hasText: "认证失败" })
      .waitFor();
    await page.locator("[data-connection=key]").fill("");
    await nav("actions");
    await page.locator("[data-op=edit-action][data-id=plain]").click();
    const defaultTrialText = await page.locator("#test-input").inputValue();
    assert(
      defaultTrialText.startsWith("Reading is not simply"),
      "Every action starts with English trial text",
    );
    assert.equal(await page.locator(".test-panel select").count(), 0);
    await nav("actions");
    await op("new").click();
    assert.equal(
      await page.locator("#test-input").inputValue(),
      defaultTrialText,
    );
    await nav("actions");
    await page.locator("[data-op=edit-action][data-id=translate]").click();
    assert.equal(
      await page.locator("#test-input").inputValue(),
      defaultTrialText,
    );
    await page
      .locator(".test-panel")
      .screenshot({ path: path.join(artifacts, "trial-input.png") });
    await op("test-run").click();
    await page.locator(".result-paper").waitFor();
    assert(
      (await page.locator(".result-paper").innerText()).includes("Processed:"),
    );
    await page.locator("[data-op=bookmark]").click();
    await op("home").click();
    assert.equal(await page.locator(".collection-card").count(), 1);
    await page.locator(".daily-card").hover();
    await op("daily-refresh").click();
    await page.waitForFunction(() =>
      document
        .querySelector(".workspace .daily-thought")
        ?.textContent.includes("A thought generated"),
    );
    await page.reload();
    assert.equal(await page.locator(".collection-card").count(), 1);
    assert(
      (await page.locator(".workspace .daily-thought").textContent()).includes(
        "A thought generated",
      ),
    );
    await nav("actions");
    await page.locator("[data-op=edit-action][data-id=translate]").click();
    const customTrialText = "My own trial text, entered directly.";
    await page.locator("#test-input").fill(customTrialText);
    await choose("#ui-locale", "en");
    assert.equal(
      await page.locator("#test-input").inputValue(),
      customTrialText,
      "Custom text survives rerendering",
    );
    await choose("#ui-locale", "zh-CN");
    await op("test-run").click();
    await page.locator(".result-paper").waitFor();
    assert(
      (await page.locator(".result-paper").innerText()).includes(
        "Processed: " + customTrialText,
      ),
      "Trial uses the entered text",
    );
    await page.locator("#test-input").fill("DELAY_FIXTURE");
    await op("test-run").click();
    await op("test-run").click();
    await page.waitForTimeout(1400);
    assert.equal(
      await page.locator(".result-paper").count(),
      0,
      "Cancelled result is never applied",
    );
    await op("home").click();
    await op("daily-settings").click();
    await op("daily-preview").click();
    await page
      .locator(".daily-preview-text")
      .filter({ hasText: "A thought generated" })
      .waitFor();
    const beforeSave = calls.length;
    await op("daily-save").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    assert.equal(
      calls.length,
      beforeSave,
      "Saving a preview does not spend another model call",
    );
    assert(
      (await page.locator(".workspace .daily-thought").textContent()).includes(
        "A thought generated",
      ),
    );
    for (const protocol of ["responses", "anthropic", "gemini"]) {
      await nav("connections");
      await choose("[data-connection=protocol]", protocol);
      assert.equal(
        await page.locator("[data-connection=url]").inputValue(),
        origin + "/v1",
      );
      await page.locator("#connection-advanced > summary").click();
      await page.locator("[data-connection=maxTokens]").fill("4096");
      await loadModels();
      await op("save-connection").click();
      await op("test-connection").click();
      await page.getByText("连接成功", { exact: true }).waitFor();
      assert.equal(
        await page.locator("[data-connection=maxTokens]").inputValue(),
        "4096",
      );
      if (protocol === "responses") {
        await page.locator("#connection-advanced > summary").click();
        await page.screenshot({
          path: path.join(artifacts, "connections-responses-cache.png"),
          fullPage: true,
        });
        await choose("[data-connection=openaiCache]", "auto");
        await op("save-connection").click();
        await page.reload();
        await page.locator("h1").waitFor();
        assert.equal(
          await page.locator("[data-connection=openaiCache]").inputValue(),
          "auto",
        );
        await op("test-connection").click();
        await page.getByText("连接成功", { exact: true }).waitFor();
        assert.equal(
          await page.locator("[data-connection=openaiCache]").inputValue(),
          "auto",
        );
        await page.locator("#connection-advanced > summary").click();
        await choose("[data-connection=openaiCache]", "explicit");
        await op("save-connection").click();
      }
    }
    await choose("[data-connection=protocol]", "chat");
    await loadModels();
    await op("save-connection").click();
    await nav("appearance");
    await page.locator('[data-op=swatch][data-color="preset:indigo"]').click();
    await page.locator("[data-style=customTypography]").check();
    await page.locator("[data-style=size]").evaluate((node) => {
      node.value = "19";
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await choose("#style-target", "selection");
    await page.locator('[data-op=swatch][data-color="preset:brown"]').click();
    assert.deepEqual(
      await page
        .locator("#style-target option")
        .evaluateAll((options) => options.map((option) => option.value)),
      ["page", "selection"],
    );
    await op("theme-menu").click();
    await page.locator("[data-op=theme-mode][data-value=dark]").click();
    await page.keyboard.press("Escape");
    await choose("#ui-locale", "en");
    await page.screenshot({
      path: path.join(artifacts, "appearance-selection-dark.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 420, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, "appearance-selection-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await choose("#ui-locale", "zh-CN");
    await op("theme-menu").click();
    await page.locator("[data-op=theme-mode][data-value=light]").click();
    await page.keyboard.press("Escape");
    const source = await context.newPage();
    source.on("pageerror", (e) => errors.push(e.message));
    await source.goto(origin + "/page");
    await source.locator("[data-pagework=ui]").waitFor({ state: "attached" });
    const tabId = await page.evaluate(
      async (origin) =>
        (await chrome.tabs.query({})).find((t) =>
          t.url?.startsWith(origin + "/page"),
        ).id,
      origin,
    );
    const enabled = await page.evaluate(
      async (tabId) =>
        chrome.runtime.sendMessage({ type: "tab.enable", tabId }),
      tabId,
    );
    assert(enabled.ok, JSON.stringify(enabled));
    const host = source.locator("[data-pagework=ui]");
    assert.equal(
      await host.count(),
      1,
      "Opening the page toolbar reuses the automatic instance",
    );
    await host.locator("#toolbar").waitFor();
    await host.locator("#toolbar [data-op=run]").click();
    await source.locator("[data-pagework=result]").first().waitFor();
    await host.locator("#status").filter({ hasText: "处理完成" }).waitFor();
    assert.equal(await source.locator("#first em").innerText(), "active");
    assert.equal(await source.locator("[data-pagework=result]").count(), 6);
    for (const privateText of [
      "HIDDEN_SECRET",
      "EDITABLE_SECRET",
      "FORM_SECRET",
      "CODE_SECRET",
    ])
      assert(!JSON.stringify(calls).includes(privateText));
    await source.locator("#native-button").click();
    assert.equal(await source.evaluate(() => nativeClicks), 1);
    await page.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: "tab.enable", tabId }),
      tabId,
    );
    await source.screenshot({ path: path.join(artifacts, "page-results.png") });
    await host.locator("#toolbar [data-op=restore]").click();
    assert.equal(await source.locator("[data-pagework=result]").count(), 0);
    await source.evaluate(() => {
      const p = document.createElement("p");
      p.id = "late";
      p.textContent = "DELAY_FIXTURE before change";
      document.querySelector("main").append(p);
    });
    await host.locator("#toolbar [data-op=run]").click();
    await source
      .locator("#late")
      .evaluate(
        (n) => (n.textContent = "Changed while the model was processing"),
      );
    await source
      .locator("#late [data-pagework=result]")
      .filter({ hasText: "Processed: Changed while the model was processing" })
      .waitFor();
    assert.equal(
      await source.locator("#late [data-pagework=result]").count(),
      1,
      "Incremental translation replaces edited source without stale output",
    );
    await host.locator("#toolbar [data-op=restore]").click();
    await source.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector("#first"));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(r);
    });
    const box = await source.locator("#first").boundingBox();
    await source.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await source.mouse.up();
    await host
      .locator(
        "#selection > .selection-toolbar-row > .selection-actions > [data-selection-action=translate]",
      )
      .click();
    await host.locator("#output").filter({ hasText: "Processed:" }).waitFor();
    await host.locator("#result [data-op=bookmark]").click();
    await page.reload();
    await op("home").click();
    assert.equal(await page.locator(".collection-card").count(), 2);

    const restricted = await page.evaluate(async (tabId) => {
      const [entry] = await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          try {
            await chrome.storage.local.get("protectedConfiguration");
            return false;
          } catch {
            return true;
          }
        },
      });
      return entry.result;
    }, tabId);
    assert(restricted, "Content scripts cannot read the credential store");
    const startSelection = async (text) => {
      await source.locator("#first").evaluate((node, text) => {
        node.textContent = text;
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }, text);
      await source.mouse.move(8, 8);
      await source.mouse.up();
      await host
        .locator(
          "#selection > .selection-toolbar-row > .selection-actions > [data-selection-action=translate]",
        )
        .click();
      await host.locator("#output").filter({ hasText: "逐步" }).waitFor();
      assert.equal(await host.locator("#output").textContent(), "逐步");
      return streams.at(-1);
    };
    await nav("connections");
    for (const protocol of ["responses", "anthropic", "gemini", "chat"]) {
      await choose("[data-connection=protocol]", protocol);
      await loadModels();
      await op("save-connection").click();
      const exchange = await startSelection("STREAM_FIXTURE " + protocol);
      assert(
        !exchange.closed,
        "The model response is still open when the first text is visible",
      );
      assert.equal(
        await host.locator("#selection .selection-result #output").count(),
        1,
        "Native selection results are integrated into the toolbar",
      );
      assert.equal(
        await host
          .locator("#result .original,#result .header,#result.panel")
          .count(),
        0,
        "Selection result has no separate window or source section",
      );
      assert(await host.locator("#result [data-op=bookmark]").isDisabled());
      assert(await host.locator("#result [data-op=stop-result]").isVisible());
      await host
        .locator("#output")
        .evaluate((node) => (window.firstOutputNode = node));
      exchange.write("输出 🌿");
      await source.waitForFunction(
        (node) => node.textContent === "逐步输出 🌿",
        await host.locator("#output").elementHandle(),
      );
      assert(
        await host
          .locator("#output")
          .evaluate((node) => node === window.firstOutputNode),
        "Streaming preserves the result panel DOM",
      );
      if (protocol === "chat") {
        if (
          await host
            .locator("#selection [data-selection-command=expand]")
            .isVisible()
        )
          await host
            .locator("#selection [data-selection-command=expand]")
            .click();
        await host
          .locator("#selection [data-selection-command=settings]")
          .click();
        assert(await host.locator("#output").isHidden());
        exchange.write("设置中");
        await host
          .locator("#selection [data-selection-command=cancel]")
          .click();
        await host.locator("#output").filter({ hasText: "设置中" }).waitFor();
        assert(
          await host
            .locator("#output")
            .evaluate((node) => node === window.firstOutputNode),
        );
        exchange.write(
          "\n" +
            "这是面板内的长结果，用于检查流式滚动与紧凑布局。\n".repeat(40),
        );
        await source.waitForFunction(
          (body) => body.scrollHeight > body.clientHeight,
          await host.locator(".selection-result-body").elementHandle(),
        );
        await host
          .locator(".selection-result-body")
          .evaluate((node) => (node.scrollTop = 0));
        exchange.write("末尾更新");
        await host.locator("#output").filter({ hasText: "末尾更新" }).waitFor();
        assert.equal(
          await host
            .locator(".selection-result-body")
            .evaluate((node) => node.scrollTop),
          0,
          "Reading above the bottom does not jump during streaming",
        );
      }
      exchange.finish();
      await host
        .locator("#result-status")
        .filter({ hasText: "处理完成" })
        .waitFor();
      assert(await host.locator("#result [data-op=bookmark]").isEnabled());
      assert(await host.locator("#result [data-op=stop-result]").isHidden());
      if (protocol === "chat") {
        await source.screenshot({
          path: path.join(artifacts, "selection-result-integrated.png"),
        });
        await host.locator("#output").dblclick({ position: { x: 12, y: 12 } });
        assert(
          (await source.evaluate(() => getSelection().toString())).trim(),
          "Result text remains selectable",
        );
        await source.waitForFunction(
          (button) => button.disabled,
          await host
            .locator(
              "#selection > .selection-toolbar-row > .selection-actions > [data-selection-action=plain]",
            )
            .elementHandle(),
        );
        assert(
          await host
            .locator(
              "#selection > .selection-toolbar-row > .selection-actions > [data-selection-action=plain]",
            )
            .isDisabled(),
          "Result text cannot be executed as a stale page selection",
        );
        assert(
          await host
            .locator(
              "#selection > .selection-toolbar-row > .selection-actions > [data-selection-action=translate]",
            )
            .isEnabled(),
          "The active result action can always collapse its result",
        );
        await source.evaluate(() => getSelection().removeAllRanges());
        assert(
          await host.locator("#result").isVisible(),
          "Changing the selection alone keeps the result available",
        );
        await source.setViewportSize({ width: 360, height: 500 });
        await source.waitForFunction(
          (node) => {
            const panel = node.getBoundingClientRect();
            return (
              panel.left >= 0 &&
              panel.right <= innerWidth &&
              panel.bottom <= innerHeight
            );
          },
          await host.locator("#selection").elementHandle(),
        );
        await source.screenshot({
          path: path.join(artifacts, "selection-result-narrow.png"),
        });
        await source.setViewportSize({ width: 1440, height: 1000 });
        await source.mouse.click(8, 8);
        assert(
          await host.locator("#result").isHidden(),
          "Clicking outside dismisses the unpinned result",
        );
        assert(await host.locator("#selection").isHidden());
      }
    }
    assert(
      calls.some(
        (c) =>
          c.path === "/v1/chat/completions" && c.auth === "Bearer fixture-key",
      ),
    );
    assert(
      calls.some(
        (c) =>
          c.path === "/v1/responses" &&
          c.body.input[0].content[0].prompt_cache_breakpoint?.mode ===
            "explicit" &&
          c.body.prompt_cache_options?.mode === "explicit" &&
          c.body.prompt_cache_key.length === 64,
      ),
    );
    assert(
      calls.some(
        (c) =>
          c.path === "/v1/interactions" &&
          c.key === "fixture-key" &&
          c.body.system_instruction &&
          c.body.store === false,
      ),
    );
    assert(
      calls.some(
        (c) =>
          c.path === "/v1/messages" &&
          c.key === "fixture-key" &&
          c.body.system[0].cache_control.type === "ephemeral",
      ),
    );
    let exchange = await startSelection("STREAM_FIXTURE stop");
    await host.locator("[data-op=stop-result]").click();
    await host
      .locator("#result-status")
      .filter({ hasText: "已停止" })
      .waitFor();
    assert.equal(await host.locator("#output").textContent(), "逐步");
    assert(await host.locator("#result [data-op=bookmark]").isDisabled());
    for (let i = 0; i < 20 && !exchange.closed; i++)
      await source.waitForTimeout(50);
    assert(exchange.closed, "Stopping aborts the upstream response");
    exchange = await startSelection("STREAM_FIXTURE interrupted");
    exchange.interrupt();
    await host
      .locator("#result-status")
      .filter({ hasText: "处理已中断" })
      .waitFor();
    assert.equal(await host.locator("#output").textContent(), "逐步");
    assert(await host.locator("#result [data-op=copy]").isDisabled());
    const previous = await startSelection("STREAM_FIXTURE previous"),
      replacement = await startSelection("STREAM_FIXTURE replacement");
    replacement.write("新结果");
    replacement.finish();
    await host
      .locator("#result-status")
      .filter({ hasText: "处理完成" })
      .waitFor();
    assert.equal(await host.locator("#output").textContent(), "逐步新结果");
    for (let i = 0; i < 20 && !previous.closed; i++)
      await source.waitForTimeout(50);
    assert(previous.closed, "Reselecting aborts the previous response");
    exchange = await startSelection("STREAM_FIXTURE close");
    await host
      .locator(
        "#selection > .selection-toolbar-row > .selection-actions > [data-selection-action=translate]",
      )
      .click();
    assert(await host.locator("#result").isHidden());
    for (let i = 0; i < 20 && !exchange.closed; i++)
      await source.waitForTimeout(50);
    assert(exchange.closed, "Closing the result aborts the upstream response");
    assert(await host.locator("#result").isHidden());
    await page.reload();
    await op("home").click();
    assert.equal(await page.locator(".collection-card").count(), 2);
    const settings = await page.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "settings.public" }),
    );
    assert(!JSON.stringify(settings).includes("fixture-key"));
    assert.deepEqual(errors, []);
    const deniedUsage = await page.evaluate(async (tabId) => {
      const [entry] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => chrome.runtime.sendMessage({ type: "usage.list" }),
      });
      return entry.result;
    }, tabId);
    assert.equal(deniedUsage.error, "notAllowed");
    await nav("connections");
    await choose("[data-connection=protocol]", "anthropic");
    await loadModels();
    await op("save-connection").click();
    const partialUsageStream = await startSelection(
      "STREAM_FIXTURE usage partial",
    );
    await host.locator("[data-op=stop-result]").click();
    await host
      .locator("#result-status")
      .filter({ hasText: "已停止" })
      .waitFor();
    for (let i = 0; i < 20 && !partialUsageStream.closed; i++)
      await page.waitForTimeout(50);
    assert(partialUsageStream.closed);
    await choose("[data-connection=protocol]", "chat");
    await loadModels();
    await op("save-connection").click();
    await page.evaluate(async () => {
      const { processRequest } = await import("./client.js");
      await processRequest({
        source: "trial",
        actionId: "translate",
        stream: true,
        blocks: [{ id: "one", text: "NO_USAGE_FIXTURE" }],
      }).promise;
    });
    cacheFailure = true;
    try {
      const code = await page.evaluate(async () => {
        const { processRequest } = await import("./client.js");
        try {
          await processRequest({
            source: "trial",
            actionId: "translate",
            blocks: [{ id: "auth", text: "Auth error fixture" }],
          }).promise;
          return null;
        } catch (error) {
          return error.code;
        }
      });
      assert.equal(code, "authError");
    } finally {
      cacheFailure = false;
    }
    const beforeBatch = calls.length,
      beforeBatchRecords = await page.evaluate(
        async () =>
          (await chrome.runtime.sendMessage({ type: "usage.overview" })).value
            .totalRecords,
      );
    await page.evaluate(async () => {
      const { processRequest } = await import("./client.js");
      await Promise.all([
        processRequest({
          source: "trial",
          actionId: "translate",
          blocks: Array.from({ length: 20 }, (_, i) => ({
            id: String(i),
            text: "Usage batch " + i,
          })),
        }).promise,
        processRequest({
          source: "trial",
          actionId: "translate",
          blocks: [{ id: "concurrent", text: "Concurrent call" }],
        }).promise,
      ]);
    });
    assert.equal(calls.length, beforeBatch + 5);
    let usage = await page.evaluate(async () => {
      const all = [];
      let before;
      while (true) {
        const rows = (
          await chrome.runtime.sendMessage({ type: "usage.list", before })
        ).value;
        if (!rows.length) return all;
        all.push(...rows);
        const last = rows.at(-1);
        before = [last.startedAt, last.id];
      }
    });
    assert.equal(
      usage.length - beforeBatchRecords,
      5,
      "Each batch and concurrent request produces exactly one record",
    );
    assert(
      usage.length >= calls.length + 1,
      "All received requests are recorded, including the authentication error; cancellation may happen before the server receives an attempt",
    );
    assert.equal(
      new Set(usage.map((r) => r.id)).size,
      usage.length,
      "Concurrent calls do not overwrite each other",
    );
    assert(!usage.some((r) => r.source === "connectionTest"));
    for (const source of ["trial", "page", "selection", "daily"])
      assert(
        usage.some((r) => r.source === source),
        source,
      );
    for (const protocol of ["chat", "responses", "anthropic", "gemini"]) {
      const r = usage.find(
        (r) => r.protocol === protocol && r.status === "success" && r.tokens,
      );
      assert.equal(r.tokens.inputTokens, 100);
      assert.equal(r.tokens.outputTokens, 20);
      assert.equal(r.tokens.cachedTokens, 60);
      assert.equal(r.tokens.totalTokens, protocol === "gemini" ? 127 : 120);
      if (protocol === "gemini") assert.equal(r.tokens.reasoningTokens, 7);
    }
    const partialRecord = usage.find(
      (r) => r.protocol === "anthropic" && r.status === "cancelled",
    );
    assert.equal(partialRecord.tokens.inputTokens, 100);
    assert.equal(partialRecord.tokens.outputTokens, 1);
    assert.equal(partialRecord.usageFinal, false);
    assert(usage.some((r) => r.status === "success" && r.tokens === null));
    assert(usage.some((r) => r.errorCode === "authError" && r.tokens === null));
    assert(!JSON.stringify(usage).includes("fixture-key"));
    assert(!JSON.stringify(usage).includes("PREVIEW_CUSTOM_INSTRUCTION"));
    assert(!JSON.stringify(usage).includes("STREAM_FIXTURE"));
    await nav("usage");
    await page.waitForFunction(
      () => document.querySelectorAll("[data-usage-id]").length > 0,
    );
    const total = usage.reduce(
      (sum, r) => sum + (r.tokens?.totalTokens || 0),
      0,
    );
    assert.equal(
      await page.locator("[data-usage-total=totalTokens]").textContent(),
      new Intl.NumberFormat("zh-CN").format(total),
    );
    const beforeReload = usage.length;
    await page.reload();
    await page.waitForFunction(
      (n) =>
        document
          .querySelector("#usage-coverage")
          .textContent.startsWith(n + " 次调用"),
      beforeReload,
    );
    await choose("#usage-period", "today");
    assert(
      (await page.locator("#usage-coverage").textContent()).startsWith(
        beforeReload + " 次调用",
      ),
    );
    const modelKey = JSON.stringify([usage[0].connectionId, usage[0].model]);
    await choose("#usage-model", modelKey);
    assert.equal(
      await page.locator("[data-usage-total=totalTokens]").textContent(),
      new Intl.NumberFormat("zh-CN").format(total),
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "usage-light.png"),
      fullPage: true,
    });
    await choose("#ui-locale", "en");
    await op("theme-menu").click();
    await page.locator("[data-op=theme-mode][data-value=dark]").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("h1").textContent(), "Usage");
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "usage-dark.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 420, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, "usage-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await op("usage-clear-ask").click();
    await page.locator("dialog .dialog-actions [data-op=dialog-close]").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    assert(
      (await page.locator("#usage-coverage").textContent()).startsWith(
        beforeReload + " calls",
      ),
    );
    await op("usage-clear-ask").click();
    await op("usage-clear").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    await page.getByText("No calls recorded", { exact: true }).waitFor();
    assert.deepEqual(
      await page.evaluate(
        async () =>
          (await chrome.runtime.sendMessage({ type: "usage.list" })).value,
      ),
      [],
    );
    await op("home").click();
    assert.equal(await page.locator(".collection-card").count(), 2);
    assert.deepEqual(errors, []);
    if (process.argv.includes("--workspace-only")) {
      console.log(
        "PASS: workspace routes, action trials, appearance previews, model settings, usage and real page/selection workflows.",
      );
      return;
    }
    await require("./cache-browser.cjs")({
      page,
      context,
      manager,
      extensionId: id,
      origin,
      calls,
      setFailure: (value) => (cacheFailure = value),
      artifacts,
      nav,
      op,
      choose,
    });
    await require("./tools-browser.cjs")({
      page,
      context,
      extensionId: id,
      origin,
      calls,
      streams,
      artifacts,
    });
    await require("./navigation-browser.cjs")({
      page,
      context,
      origin,
      calls,
      streams,
      artifacts,
    });
    await require("./appearance-browser.cjs")({
      page,
      context,
      origin,
      calls,
      artifacts,
      nav,
      op,
      choose,
    });
    await require("./inline-browser.cjs")({
      page,
      context,
      origin,
      calls,
      artifacts,
      nav,
      op,
      choose,
      setResultText,
    });
    await require("./radial-hover-browser.cjs")({
      context,
      origin,
      calls,
      artifacts,
    });
    await require("./radial-browser.cjs")({
      page,
      context,
      origin,
      calls,
      artifacts,
      nav,
      op,
      choose,
    });
    await require("./connections-browser.cjs")({
      page,
      origin,
      calls,
      modelRequests,
      artifacts,
      nav,
      op,
      choose,
    });
    await require("./reasoning-browser.cjs")({
      page,
      origin,
      calls,
      modelRequests,
      artifacts,
      nav,
      op,
      choose,
    });
    await require("./selection-browser.cjs")({
      page,
      context,
      origin,
      calls,
      artifacts,
      nav,
      op,
      choose,
    });
    await require("./result-browser.cjs")({
      page,
      context,
      origin,
      calls,
      streams,
      artifacts,
      nav,
      op,
    });
    await require("./qa-browser.cjs")({
      page,
      context,
      origin,
      calls,
      artifacts,
      nav,
      op,
      choose,
    });
    await require("./context-menu-browser.cjs")({
      page,
      context,
      origin,
      calls,
      coldSource,
    });
    await require("./action-order-browser.cjs")({
      page,
      context,
      origin,
      calls,
      artifacts,
      nav,
      op,
    });
    await require("./actions-browser.cjs")({
      page,
      context,
      origin,
      calls,
      artifacts,
      nav,
      op,
    });
    await require("./output-language-browser.cjs")({
      page,
      context,
      origin,
      calls,
      artifacts,
      nav,
      op,
      choose,
    });
    await require("./daily-browser.cjs")({
      page,
      origin,
      calls,
      artifacts,
      nav,
      op,
      choose,
    });
    await require("./locales-browser.cjs")({
      page,
      context,
      origin,
      calls,
      artifacts,
      nav,
      op,
      choose,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: automatic first-visit/reload/navigation selection toolbar with native mouse/keyboard, editable exclusion and no model call; per-request usage for 4 protocols, cached/cache-write tokens, partial/missing/cancelled/error records, concurrent persistence, history/filter/clear UI; real MV3 load; obsolete page navigation removed; action trials and static appearance previews; 4 local HTTP protocols and incremental selection rendering before response completion; stop/close/reselect abort and interrupted partial text; config/key isolation; actual DOM extraction/insertion/restoration; collection/daily persistence.",
    );
  } catch (error) {
    console.log(
      "Content status",
      await Promise.all(
        context.pages().map((p) =>
          p
            .locator("[data-pagework=ui] #status")
            .evaluate(
              (node) => ({ url: location.href, status: node.textContent }),
              null,
              { timeout: 1000 },
            )
            .catch(() => null),
        ),
      ),
    );
    if (page) {
      console.log(
        "UI",
        await page
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
      await page
        .screenshot({ path: path.join(artifacts, "failure.png") })
        .catch(() => {});
    }
    console.log("Errors", errors);
    throw error;
  } finally {
    await context.close();
    await new Promise((r) => server.close(r));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
