const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({ page, context, origin, calls, artifacts }) => {
  const source = await context.newPage(),
    errors = [];
  source.on("pageerror", (error) => errors.push(error.message));
  const url = origin + "/viewport-translation";
  await source.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html>
    <html><head><meta charset="utf-8"><title>Incremental reading fixture</title><style>
    body{margin:24px;font:17px/1.6 system-ui;background:#fff;color:#252b31}
    main{max-width:720px}p{box-sizing:border-box;min-height:260px;padding:16px 0;margin:0;border-bottom:1px solid #ddd}
    #reveal{display:none}#scrollbox{height:250px;overflow:auto;border:1px solid #888}
    #scrollbox p{min-height:180px}button{font:inherit}
    @media(prefers-color-scheme:dark){body{background:#181c20;color:#e0e6ed}p{border-color:#444}}
    </style></head><body><nav>Navigation outside the article</nav><main>
    <h1>Read at your own pace</h1>
    <details id="native-details"><summary>More reading</summary><p>Native details revealed paragraph.</p></details>
    ${Array.from({ length: 48 }, (_, i) => `<p id="row-${i}">Viewport paragraph ${i}: <em>original emphasis</em><span> with an inline <code>field_${i}</code> and source detail.</span>${[4, 18].includes(i) ? " DELAY_FIXTURE" : ""}</p>`).join("")}
    <section id="reveal"><p>Newly revealed paragraph.</p></section>
    <section id="scrollbox">${Array.from({ length: 10 }, (_, i) => `<p id="nested-${i}">Nested reading paragraph ${i}.</p>`).join("")}</section>
    <p id="only-number">68.8</p><p id="last">Far end summary evidence.</p>
    </main></body></html>`,
    }),
  );
  try {
    await source.goto(url);
    const host = source.locator("[data-pagework=ui]");
    await host.waitFor({ state: "attached" });
    const tabId = await page.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((t) => t.url === url).id,
      url,
    );
    const send = (message) =>
      page.evaluate(
        ({ tabId, message }) => chrome.tabs.sendMessage(tabId, message),
        { tabId, message },
      );
    const start = async (actionId = "translate", panel = false) => {
      const result = await page.evaluate(
        ({ tabId, actionId, panel }) =>
          chrome.runtime.sendMessage({
            type: "tab.run",
            tabId,
            actionId,
            scope: "body",
            panel,
          }),
        { tabId, actionId, panel },
      );
      assert(result.ok, JSON.stringify(result));
    };
    const textOf = (selector) =>
      source
        .locator(selector + " > [data-pagework=result]")
        .evaluate((node) => node.shadowRoot.textContent);
    const waitResult = async (selector, text) => {
      await source.locator(selector + " > [data-pagework=result]").waitFor();
      if (text)
        await source.waitForFunction(
          ({ selector, text }) =>
            document
              .querySelector(selector + " > [data-pagework=result]")
              ?.shadowRoot.textContent.includes(text),
          { selector, text },
        );
    };
    const idle = async () => {
      await source.waitForTimeout(200);
      await host
        .locator("#toolbar[aria-busy=false]")
        .waitFor({ state: "attached" });
    };
    const inputs = (index) =>
      calls.slice(index).flatMap((call) => {
        try {
          const data = JSON.parse(call.body.messages.at(-1).content);
          return data.items?.map((item) => item.text) || [data.text];
        } catch {
          return [call.body.messages.at(-1).content];
        }
      });
    const dock = host.locator("#dock");
    const radial = host.locator("#radial");
    const translationButton = radial.locator("[data-op=page-translate]");
    const expectState = async (state) => {
      await radial
        .locator(`[data-op=page-translate][data-translation-state=${state}]`)
        .waitFor({ state: "attached" });
      assert.equal(
        await translationButton.getAttribute("aria-label"),
        { original: "原文", processing: "翻译中", translated: "已翻译" }[state],
      );
      assert.equal(
        await translationButton.getAttribute("aria-busy"),
        String(state === "processing"),
      );
      assert.equal(
        await translationButton.getAttribute("aria-pressed"),
        String(state !== "original"),
      );
      assert.equal(
        await translationButton.locator(".translation-badge").count(),
        0,
        "No corner check badge",
      );
      const lamp = await translationButton.evaluate((button) => {
        const light = getComputedStyle(button, "::after");
        return {
          content: light.content,
          color: light.backgroundColor,
          animation: light.animationName,
          animated: button
            .getAnimations({ subtree: true })
            .some((animation) => animation instanceof CSSAnimation),
          activeBackground:
            button.classList.contains("on") ||
            button.classList.contains("translated"),
        };
      });
      assert.equal(lamp.animation, "none");
      assert.equal(
        lamp.animated,
        false,
        "Translation never animates the button or indicator",
      );
      assert.equal(lamp.activeBackground, false);
      if (state === "original")
        assert.equal(
          lamp.content,
          "none",
          "Original text has no lit indicator",
        );
      else {
        assert.equal(lamp.content, '""');
        const [red, green, blue] = lamp.color.match(/\d+/g).map(Number);
        assert(
          state === "processing"
            ? blue > green && blue > red
            : green > red && green > blue,
          `${state} uses a steady ${state === "processing" ? "blue" : "green"} light: ${lamp.color}`,
        );
      }
      assert.equal(
        await dock.getAttribute("aria-busy"),
        null,
        "Translation busy state is absent from the dock",
      );
      assert.equal(await dock.getAttribute("aria-description"), null);
      assert.equal(
        await dock.evaluate(
          (node) => getComputedStyle(node, "::after").content,
        ),
        "none",
        "The dock has no status dot",
      );
      assert.equal(
        await dock.evaluate((node) => node.classList.contains("translated")),
        false,
      );
    };
    await host.locator("#dock").click();
    await expectState("original");
    await radial.evaluate((node) =>
      Promise.all(
        node
          .getAnimations({ subtree: true })
          .map((a) => a.finished.catch(() => {})),
      ),
    );
    await source.screenshot({
      path: path.join(artifacts, "translation-state-original.png"),
      clip: { x: 1220, y: 350, width: 220, height: 300 },
    });
    await translationButton.evaluate((button) => {
      globalThis.translationStateButton = button;
      globalThis.translationHomeButton = button.parentElement.querySelector(
        "[data-op=open-settings]",
      );
      globalThis.translationDockLogo = button
        .getRootNode()
        .querySelector("#dock > svg");
    });
    const before = calls.length;
    const near = await source.locator("#row-4").boundingBox();
    assert(
      near.y > 1000 && near.y < 1600,
      "Fixture includes an offscreen paragraph in the preload band",
    );
    await translationButton.click();
    await expectState("processing");
    await waitResult("h1");
    assert((await source.locator("[data-pagework=result]").count()) > 0);
    await expectState("processing"); // Partial output is not completion.
    // Pointer-down hides a tip; leaving and returning is a fresh hover.
    await source.mouse.move(0, 0);
    await translationButton.hover();
    await radial.locator(".hover-tip:popover-open").waitFor();
    assert.equal(await radial.locator(".hover-tip").textContent(), "翻译中");
    assert(
      await dock.evaluate(
        (node) => node.querySelector("svg") === globalThis.translationDockLogo,
      ),
      "Progress never replaces the dock logo",
    );
    await source.screenshot({
      path: path.join(artifacts, "translation-state-processing.png"),
      clip: { x: 1220, y: 350, width: 220, height: 300 },
    });
    await waitResult("#row-0");
    await waitResult("#row-4");
    await idle();
    await expectState("translated");
    assert(
      await translationButton.evaluate(
        (button) =>
          button === globalThis.translationStateButton &&
          button.parentElement.querySelector("[data-op=open-settings]") ===
            globalThis.translationHomeButton,
      ),
      "Progress updates preserve menu button identity and focus",
    );
    assert.equal(
      await radial.locator(".hover-tip").textContent(),
      "已翻译",
      "A visible tooltip updates without moving the pointer",
    );
    assert(
      await dock.evaluate(
        (node) => node.querySelector("svg") === globalThis.translationDockLogo,
      ),
    );
    await source.screenshot({
      path: path.join(artifacts, "translation-state-complete.png"),
      clip: { x: 1220, y: 350, width: 220, height: 300 },
    });
    await source.mouse.move(0, 0);
    assert(
      inputs(before).some((text) => text.includes("Viewport paragraph 4:")),
      "A small offscreen band is preloaded",
    );
    assert(
      !inputs(before).some(
        (text) =>
          text.includes("Viewport paragraph 12:") ||
          text.includes("Far end summary evidence."),
      ),
      "Distant text is not sent at startup",
    );
    assert.equal(
      await source.locator("#row-12 [data-pagework=result]").count(),
      0,
    );
    assert.equal(
      await source.locator("nav [data-pagework=result]").count(),
      0,
      "Body scope stays inside the article",
    );
    assert(
      !inputs(before).some((text) => text.includes("Processed:")),
      "Injected output cannot become model input",
    );
    const firstWave = calls.length;
    await source.waitForTimeout(350);
    assert.equal(
      calls.length,
      firstWave,
      "Output insertion does not trigger a translation loop",
    );

    await source.locator("#row-18").scrollIntoViewIfNeeded();
    await expectState("processing");
    await source.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expectState("processing");
    await source.emulateMedia({
      colorScheme: "dark",
      reducedMotion: "no-preference",
    });
    await expectState("processing");
    await source.screenshot({
      path: path.join(artifacts, "translation-state-processing-dark.png"),
      clip: { x: 1220, y: 350, width: 220, height: 300 },
    });
    await waitResult("#row-18");
    await idle();
    await expectState("translated");
    await source.screenshot({
      path: path.join(artifacts, "translation-state-complete-dark.png"),
      clip: { x: 1220, y: 350, width: 220, height: 300 },
    });
    await source.emulateMedia({ colorScheme: "light" });
    assert(
      !inputs(before).some((text) => text.includes("Viewport paragraph 35:")),
      "Scrolling does not enqueue the rest of the document",
    );
    const scrolled = calls.length;
    await source.evaluate(() => scrollTo(0, 0));
    await idle();
    assert.equal(
      calls.length,
      scrolled,
      "Returning to completed paragraphs does not request them again",
    );

    // Incremental scans must preserve the whole paragraph across nested inline nodes.
    const editStart = calls.length;
    await source
      .locator("#row-0 > span:not([data-pagework])")
      .evaluate((node) => (node.firstChild.data = " with edited inline "));
    await waitResult("#row-0", "with edited inline field_0");
    await idle();
    const edits = inputs(editStart);
    assert.equal(edits.length, 1, "Only the edited paragraph is sent");
    assert(
      edits[0].startsWith(
        "Viewport paragraph 0: original emphasis with edited inline field_0",
      ),
    );
    assert.equal(
      await source.locator("#row-0 > [data-pagework=result]").count(),
      1,
    );
    assert.equal(
      await source.locator("#row-0 em").innerText(),
      "original emphasis",
    );

    await expectState("translated");
    const rerender = calls.length;
    await translationButton.evaluate((button) => {
      globalThis.quickBatchSamples = [];
      globalThis.quickBatchBackground =
        getComputedStyle(button).backgroundColor;
      let previousState = button.dataset.translationState;
      globalThis.quickBatchObserver = new MutationObserver(() => {
        if (button.dataset.translationState === previousState) return;
        previousState = button.dataset.translationState;
        globalThis.quickBatchSamples.push({
          state: previousState,
          background: getComputedStyle(button).backgroundColor,
          animated: button
            .getAnimations({ subtree: true })
            .some((animation) => animation instanceof CSSAnimation),
        });
      });
      globalThis.quickBatchObserver.observe(button, {
        attributes: true,
        attributeFilter: ["data-translation-state"],
      });
    });
    // Each cache hit completes quickly, but the gaps remain inside the quiet
    // window. The light must stay blue until the entire burst has settled.
    for (let i = 0; i < 3; i++) {
      await source.locator("#row-0").evaluate((node) => {
        node.innerHTML =
          "Viewport paragraph 0: <em>original emphasis</em><span> with edited inline <code>field_0</code> and source detail.</span>";
      });
      await waitResult("#row-0", "with edited inline field_0");
      await idle();
      await expectState("processing");
      assert.equal(
        await host.locator("#toolbar").getAttribute("aria-busy"),
        "false",
        "Completed batches keep the blue indicator during the quiet window",
      );
    }
    assert(
      await translationButton.evaluate(() =>
        globalThis.quickBatchSamples.every(
          (sample) => sample.state === "processing",
        ),
      ),
      `Frequent batches never flash green between blue periods: ${JSON.stringify(await translationButton.evaluate(() => globalThis.quickBatchSamples))}`,
    );
    await expectState("translated");
    const quickBatches = await translationButton.evaluate(() => {
      globalThis.quickBatchObserver.disconnect();
      return {
        samples: globalThis.quickBatchSamples,
        background: globalThis.quickBatchBackground,
      };
    });
    const transitions = quickBatches.samples
      .map((sample) => sample.state)
      .filter((state, index, all) => index === 0 || state !== all[index - 1]);
    assert.deepEqual(
      transitions,
      ["processing", "translated"],
      "A burst has one blue period followed by one green completion",
    );
    assert(
      quickBatches.samples.every(
        (sample) => sample.background === quickBatches.background,
      ),
      "Translation state never changes the button background",
    );
    assert(
      quickBatches.samples.every((sample) => !sample.animated),
      "The status light never flashes or breathes",
    );
    assert.equal(
      calls.length,
      rerender,
      "Page re-renders restore unchanged output from cache",
    );

    // Restoring while completion is pending must also cancel its delayed light.
    await source.locator("#row-0").evaluate((node) => {
      node.innerHTML =
        "Viewport paragraph 0: <em>original emphasis</em><span> with edited inline <code>field_0</code> and source detail.</span>";
    });
    await waitResult("#row-0", "with edited inline field_0");
    await idle();
    await expectState("processing");
    await send({ type: "page.restore" });
    await expectState("original");
    await source.waitForTimeout(750);
    await expectState("original");
    await start();
    await waitResult("#row-0", "with edited inline field_0");
    await idle();

    await source
      .locator("#row-0")
      .evaluate((node) =>
        node.insertAdjacentHTML(
          "beforebegin",
          '<p id="inserted">Inserted visible paragraph.</p>',
        ),
      );
    await waitResult("#inserted");
    await idle();
    await source
      .locator("main")
      .evaluate((node) =>
        node.insertAdjacentHTML(
          "beforeend",
          '<p id="new-far">New distant paragraph.</p>',
        ),
      );
    const beforeFar = calls.length;
    await idle();
    assert.equal(
      calls.length,
      beforeFar,
      "New distant content waits until approached",
    );
    await source.locator("#inserted").evaluate((node) => node.remove());
    await idle();
    await source.locator("#row-0").evaluate((node) => {
      const reveal = document.querySelector("#reveal");
      node.before(reveal);
      reveal.style.display = "block";
    });
    await waitResult("#reveal p");
    await idle();
    await source.locator("#reveal").evaluate((node) => (node.hidden = true));
    await idle();
    assert.equal(
      await source.locator("#reveal [data-pagework=result]").count(),
      0,
      "Hidden source loses its rendered output",
    );
    const revealed = calls.length;
    await source.locator("#reveal").evaluate((node) => (node.hidden = false));
    await waitResult("#reveal p");
    await idle();
    assert.equal(
      calls.length,
      revealed,
      "Revealing unchanged content reuses the cache",
    );

    await source
      .locator("#native-details")
      .evaluate((node) => (node.open = true));
    await waitResult("#native-details p");
    await idle();
    await source
      .locator("#native-details")
      .evaluate((node) => (node.open = false));
    await idle();
    assert.equal(
      await source.locator("#native-details p [data-pagework=result]").count(),
      0,
    );
    const beforeDetails = calls.length;
    await source
      .locator("#native-details")
      .evaluate((node) => (node.open = true));
    await waitResult("#native-details p");
    await idle();
    assert.equal(
      calls.length,
      beforeDetails,
      "Native details expansion reuses cached output",
    );

    // An in-flight older revision cannot overwrite the current text.
    await source
      .locator("#row-0")
      .evaluate((node) =>
        node.insertAdjacentHTML(
          "beforebegin",
          '<p id="race">DELAY_FIXTURE superseded paragraph.</p>',
        ),
      );
    for (
      let i = 0;
      i < 80 &&
      !inputs(before).some(
        (text) => text === "DELAY_FIXTURE superseded paragraph.",
      );
      i++
    )
      await source.waitForTimeout(25);
    assert(inputs(before).includes("DELAY_FIXTURE superseded paragraph."));
    await source
      .locator("#race")
      .evaluate(
        (node) =>
          (node.textContent =
            "Replacement paragraph while the old request is running."),
      );
    await waitResult(
      "#race",
      "Replacement paragraph while the old request is running.",
    );
    await idle();
    assert.equal(
      await textOf("#race"),
      "Processed: Replacement paragraph while the old request is running.",
    );
    assert.equal(
      await source.locator("#race [data-pagework=result]").count(),
      1,
    );

    await source.locator("#scrollbox").scrollIntoViewIfNeeded();
    await waitResult("#nested-0");
    await idle();
    assert.equal(
      await source.locator("#nested-8 [data-pagework=result]").count(),
      0,
      "A clipped inner scroller only translates the visible part",
    );
    await source
      .locator("#scrollbox")
      .evaluate((node) => (node.scrollTop = 1400));
    await waitResult("#nested-8");
    await idle();
    await source.locator("#new-far").scrollIntoViewIfNeeded();
    await waitResult("#new-far");
    await idle();
    assert.equal(
      await source.locator("#only-number [data-pagework=result]").count(),
      0,
      "Numbers stay untouched in incremental waves",
    );

    // Restoring disconnects both observers, including queued/in-flight work.
    await source.evaluate(() => scrollTo(0, 0));
    await idle();
    await source
      .locator("#row-0")
      .evaluate((node) =>
        node.insertAdjacentHTML(
          "beforebegin",
          '<p id="cancel">DELAY_FIXTURE cancelled page wave.</p>',
        ),
      );
    for (
      let i = 0;
      i < 80 && !inputs(before).includes("DELAY_FIXTURE cancelled page wave.");
      i++
    )
      await source.waitForTimeout(25);
    assert(inputs(before).includes("DELAY_FIXTURE cancelled page wave."));
    await send({ type: "page.restore" });
    await expectState("original");
    assert.equal(await source.locator("[data-pagework=result]").count(), 0);
    const stopped = calls.length;
    await source
      .locator("#row-0")
      .evaluate(
        (node) => (node.textContent = "No automatic work after restore."),
      );
    await source.locator("#row-35").scrollIntoViewIfNeeded();
    await source.waitForTimeout(1400);
    await expectState("original");
    assert.equal(calls.length, stopped);
    assert.equal(
      await source.locator("[data-pagework=result]").count(),
      0,
      "Late responses cannot restore removed output",
    );
    await source.locator("#cancel").evaluate((node) => node.remove());

    // A new session translates only the current region and reuses prior results.
    await source.evaluate(() => scrollTo(0, 0));
    const resumed = calls.length;
    await start();
    await waitResult("#row-0");
    await waitResult("#row-1");
    await idle();
    assert(
      inputs(resumed).every(
        (text) => text === "No automatic work after restore.",
      ),
      "Completed work survives restore in the shared cache",
    );
    await source.setViewportSize({ width: 390, height: 820 });
    await source.evaluate(() => scrollTo(0, 0));
    await idle();
    await source.screenshot({
      path: path.join(artifacts, "viewport-translation-mobile-light.png"),
    });
    await source.emulateMedia({ colorScheme: "dark" });
    await idle();
    await source.screenshot({
      path: path.join(artifacts, "viewport-translation-mobile-dark.png"),
    });
    assert(
      await source.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Incremental output fits a narrow viewport",
    );
    assert(
      await source
        .locator("#row-0 > [data-pagework=result]")
        .evaluate(
          (node) =>
            getComputedStyle(node.shadowRoot.firstElementChild).color ===
            getComputedStyle(node.parentElement).color,
        ),
      "Inline text follows the page color in dark mode",
    );
    await source.setViewportSize({ width: 1440, height: 1000 });
    await source.emulateMedia({ colorScheme: "light" });
    await source.screenshot({
      path: path.join(artifacts, "viewport-translation-desktop.png"),
    });

    // Regeneration bypasses cache while retaining viewport scheduling.
    await send({ type: "ui.show" });
    const regenerate = calls.length;
    await host.locator("#toolbar [data-op=refresh-page]").click();
    await waitResult("#row-0");
    await idle();
    assert(
      calls.length > regenerate,
      "Regenerate works during an idle observation session",
    );
    assert(
      !inputs(regenerate).some((text) =>
        text.includes("Viewport paragraph 35:"),
      ),
    );

    // Stop keeps completed output, aborts work, and disconnects dynamic updates.
    await source
      .locator("#row-0")
      .evaluate((node) =>
        node.insertAdjacentHTML(
          "beforebegin",
          '<p id="stop-wave">DELAY_FIXTURE stopped page wave.</p>',
        ),
      );
    for (
      let i = 0;
      i < 80 &&
      !inputs(regenerate).includes("DELAY_FIXTURE stopped page wave.");
      i++
    )
      await source.waitForTimeout(25);
    assert(inputs(regenerate).includes("DELAY_FIXTURE stopped page wave."));
    await host.locator("#toolbar [data-op=run]").click();
    await host
      .locator("#status")
      .filter({ hasText: "已停止" })
      .waitFor({ state: "attached" });
    assert(
      (await source.locator("[data-pagework=result]").count()) > 0,
      "Stop preserves completed translations",
    );
    const afterStop = calls.length;
    await source
      .locator("#row-0")
      .evaluate((node) => (node.textContent = "No automatic work after stop."));
    await source.locator("#row-35").scrollIntoViewIfNeeded();
    await source.waitForTimeout(1400);
    assert.equal(calls.length, afterStop);
    assert.equal(
      await source.locator("#stop-wave [data-pagework=result]").count(),
      0,
    );
    await source.locator("#stop-wave").evaluate((node) => node.remove());
    await source.evaluate(() => scrollTo(0, 0));
    await start();
    await waitResult("#row-0");
    await idle();

    await source.evaluate(() =>
      history.pushState({}, "", "/viewport-next-route"),
    );
    assert.equal(await source.locator("[data-pagework=result]").count(), 0);
    const routed = calls.length;
    await source
      .locator("#row-0")
      .evaluate(
        (node) => (node.textContent = "Route change ends incremental work."),
      );
    await idle();
    assert.equal(calls.length, routed);

    // Whole-document actions still receive the offscreen evidence and numbers.
    const full = calls.length;
    await start("summary", true);
    await host
      .locator("#result-status")
      .filter({ hasText: "处理完成" })
      .waitFor();
    await expectState("original");
    const summary = inputs(full).join("\n");
    assert(
      summary.includes("Viewport paragraph 47:") &&
        summary.includes("Far end summary evidence.") &&
        summary.includes("New distant paragraph.") &&
        summary.includes("68.8"),
      "Summary retains the entire document, including offscreen and numeric content",
    );
    assert(await host.locator("#result").isVisible());
    const afterSummary = calls.length;
    await source
      .locator("#row-0")
      .evaluate((node) => (node.textContent = "No automatic summary rerun."));
    await source.locator("#row-40").scrollIntoViewIfNeeded();
    await idle();
    assert.equal(calls.length, afterSummary);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: steady blue/green translation indicator with completion debounce, no button animation/background change or dock status; viewport + small preload; document/inner scrolling; incremental insert/edit/reveal/remove; no self-translation or duplicate requests; stale response isolation; restore/cancel/cache/navigation cleanup; full-document summary; desktop/mobile light/dark layout.",
    );
  } finally {
    await source.close();
  }
};
