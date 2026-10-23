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
  setResultText,
}) => {
  const fields = [
    "background",
    "conversation",
    "max_output_tokens",
    "max_tool_calls",
    "metadata",
    "moderation",
    "multi_agent",
    "prompt",
    "prompt_cache_retention",
    "safety_identifier",
    "temperature",
    "top_logprobs",
    "top_p",
    "truncation",
    "user",
  ];
  const fieldList = fields.slice(0, -1).join(", ") + ", and " + fields.at(-1);
  const inlineCodeSamples = [
    {
      id: "code-fields",
      html: `<li id="code-fields"><strong>Unsupported fields:</strong> Omit ${fields
        .slice(0, -1)
        .map((field) => `<code>${field}</code>`)
        .join(", ")}, and <code>${fields.at(-1)}</code>.</li>`,
      text: `Unsupported fields: Omit ${fieldList}.`,
      output: `不支持的字段：省略 ${fields.join("、")}。`,
    },
    {
      id: "code-paragraph",
      html: '<div id="code-paragraph">Use <code><span>max_</span><span>output_tokens</span></code> with <a href="#store"><code>store</code></a>.</div>',
      text: "Use max_output_tokens with store.",
      output: "将 max_output_tokens 与 store 搭配使用。",
    },
    {
      id: "code-spaces",
      html: '<p id="code-spaces">Keep <code>alpha</code> <code>beta</code> unchanged.</p>',
      text: "Keep alpha beta unchanged.",
      output: "保持 alpha beta 不变。",
    },
    {
      id: "code-hidden",
      html: '<p id="code-hidden">Visible <code>enabled</code><code hidden>HIDDEN_INLINE_CODE_SECRET</code><code style="display:none">INVISIBLE_CODE_SECRET</code><input value="FORM_INLINE_SECRET"> remains.</p>',
      text: "Visible enabled remains.",
      output: "可见的 enabled 保持不变。",
    },
  ];
  const comparisonSamples = [
    ["GPT-5.5", "GPT-5.5", false],
    ["Gemini 3.8 Flash", "\n Gemini\t3.8   Flash \n", false],
    ["US", "us", true],
    ["Model 6.6", "Model-6.6", true],
    ["now here", "nowhere", true],
    ["Open weights", "开放权重", true],
  ];
  setResultText(
    (text) =>
      inlineCodeSamples.find((sample) => sample.text === text)?.output ??
      comparisonSamples.find(([source]) => source === text)?.[1] ??
      "Processed: " + text,
  );
  const numericSamples = [
    "0",
    "68.8",
    "1,234.56",
    "−42",
    "+7",
    "12%",
    "$0.196",
    "€ 1\u202f234,50",
    "￥１，２３４",
    "٣٧٫١",
    "(123.45)",
    "1/2",
    "20:30",
  ];
  const mixedSamples = ["68.8 points", "Model-5.5", "42 items", "2026年"];
  await nav("appearance");
  await choose("#style-target", "page");
  await op("reset-style").click();
  const source = await context.newPage();
  const url = origin + "/inline-layout";
  // The h-5 eyebrow and four-pixel heading gap reproduce the observed Mintlify layout.
  await source.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta charset="utf-8"><title>TypeSafe documentation fixture</title><style>
    body{margin:24px;font:16px/1.4 Arial,sans-serif}main{max-width:560px}h1{font-size:48px;line-height:1.15;margin:4px 0 18px}h2{font-size:22px}
    [data-as="p"]{display:block;margin:16px 0}#block-link{display:block}
    #eyebrow{height:20px;line-height:20px;font-size:12px}#clip{height:24px;overflow:hidden}
    #copy{display:flex;align-items:center;gap:4px;width:160px;height:32px;padding:4px;font:inherit;border:1px solid #bbb}#copy svg{width:14px;height:14px;flex:none}
    .cta-row{display:flex;gap:16px;align-items:center;margin:16px 0}.cta{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 16px;height:40px;max-width:100%;border:1px solid #161616;border-radius:8px;text-decoration:none;font:16px/20px Georgia,serif;color:#161616}.cta.primary{background:#161616;color:white}.cta>span:not([data-pagework]){font:500 15px/21px Arial,sans-serif}.cta.left{justify-content:flex-start}.cta-row>svg{width:14px;height:14px}
    @media(max-width:400px){.cta-row{flex-direction:column;align-items:stretch}}
    #grid svg{width:14px;height:14px}.table-scroll{overflow-x:auto}
    #grid{display:grid;grid-template-columns:1fr auto;height:24px;max-width:240px}
    table{width:100%;border-collapse:collapse}th,td{padding:8px;vertical-align:top;border-bottom:1px solid #ddd;text-align:left}th{height:24px}
    @media(max-width:400px){body{margin:12px}h1{font-size:34px}}
  </style></head><body><main>
    <header><div id="eyebrow">Get started</div><h1>Introduction</h1></header>
    <span id="linked-paragraph" data-as="p">Jev is TypeSafe’s flagship model and the first <a id="system-link" href="#system">System One model</a>. It evaluates typed <em>questions</em>. Some question types also return <a id="confidence-link" href="#confidence">confidence</a>, which your code can use.</span>
    <div id="generic-paragraph"><span>Read the <a href="#guide"><strong>model guide</strong></a> for details.</span></div>
    <div id="link-only"><a href="#standalone">Standalone resource</a></div>
    <section id="inline-code"><ul>${inlineCodeSamples[0].html}</ul>${inlineCodeSamples
      .slice(1)
      .map((sample) => sample.html)
      .join("")}
    <p><code>STANDALONE_CODE_SECRET</code>.</p>
    <div>Example:<pre><code>BLOCK_CODE_SECRET</code></pre></div></section>
    <nav id="link-nav">Resources: <a href="#nav-one">Navigation one</a> <a href="#nav-two">Navigation two</a></nav>
    <div id="block-container">Related resource: <a id="block-link" href="#block">Independent block link</a></div>
    <div id="clip" style="height:24px!important"><div id="clipped-label">Fixed wrapper</div></div><p id="after-clip">The following paragraph must remain unobscured.</p>
    <button id="copy">Copy page<svg aria-hidden="true"></svg></button><p id="after-copy">The next paragraph stays below the button.</p>
    <div class="cta-row" id="cta-row"><a id="try-cta" class="cta primary" href="#try"><span>Try Claude</span></a><a id="api-cta" class="cta" href="#api-access"><span>Get API access</span></a></div>
    <button id="left-cta" class="cta left"><svg width="14" height="14" aria-hidden="true"></svg><span>Left aligned control</span></button>
    <div id="grid">Grid label<svg aria-hidden="true"></svg></div>
    <section><h2>TypeSafe primitives</h2><h3 hidden>HIDDEN_CONTEXT_SECRET</h3><div contenteditable="true"><h3>EDITABLE_CONTEXT_SECRET</h3></div>
    <div class="table-scroll"><table id="api"><thead><tr><th>Question type</th><th>Goal</th><th id="returns">Returns</th></tr></thead><tbody><tr><td>Choice</td><td>Choose an option from a list.</td><td><code>CODE_CONTEXT_SECRET</code><input value="FORM_CONTEXT_SECRET"><span hidden>HIDDEN_CELL_SECRET</span></td></tr></tbody></table></div></section>
    <section><h2>Store policies</h2><div class="table-scroll"><table id="store"><thead><tr><th>Product</th><th>Returns</th></tr></thead><tbody><tr><td>Order</td><td>Return a purchase.</td></tr></tbody></table></div></section>
    <table id="mixed"><tr><th>Size</th><td>ROW_CONTEXT_SECRET</td></tr></table>
    <table id="numeric"><thead><tr><th>Score</th></tr></thead><tbody>
      ${numericSamples.map((text) => `<tr><td data-numeric>${text}</td></tr>`).join("")}
      ${mixedSamples.map((text) => `<tr><td data-mixed>${text}</td></tr>`).join("")}
    </tbody></table>
    <table id="comparison"><tbody>${comparisonSamples.map(([text], index) => `<tr><td data-comparison="${index}"><strong>${text}</strong></td></tr>`).join("")}</tbody></table>
  </main><script>window.copyClicks=0;document.querySelector('#copy').onclick=()=>window.copyClicks++;</script></body></html>`,
    }),
  );
  await source.goto(url);
  const host = source.locator("[data-pagework=ui]");
  await host.waitFor({ state: "attached" });
  const tabId = await page.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    url,
  );
  const originals = await source.evaluate(() =>
    Object.fromEntries(
      [
        "eyebrow",
        "clip",
        "clipped-label",
        "copy",
        "grid",
        "try-cta",
        "api-cta",
        "left-cta",
      ].map((id) => [id, document.getElementById(id).style.cssText || null]),
    ),
  );
  const run = async () => {
    const response = await page.evaluate(
      (tabId) =>
        chrome.runtime.sendMessage({
          type: "tab.run",
          tabId,
          actionId: "translate",
          scope: "body",
        }),
      tabId,
    );
    assert(response.ok);
    // Inline translation now follows reading position. Visit the document in
    // overlapping steps before asserting every layout/context sample below.
    await source.evaluate(() => scrollTo(0, 0));
    let offset = 0;
    while (true) {
      await source.evaluate((top) => scrollTo(0, top), offset);
      await source.waitForTimeout(250);
      await host
        .locator("#toolbar[aria-busy=false]")
        .waitFor({ state: "attached" });
      const { bottom, height } = await source.evaluate(() => ({
        bottom: scrollY + innerHeight,
        height: document.documentElement.scrollHeight,
      }));
      if (bottom >= height - 1) break;
      offset += 600;
    }
    await host
      .locator("#status")
      .filter({ hasText: "处理完成" })
      .waitFor({ state: "attached" });
  };
  const itemsSince = (index) =>
    calls.slice(index).flatMap((c) => {
      try {
        return JSON.parse(c.body.messages.at(-1).content).items || [];
      } catch {
        return [];
      }
    });
  const paragraphs = await source
    .locator("#linked-paragraph, #generic-paragraph")
    .allTextContents();
  const comparisonMarkup = await source
    .locator("[data-comparison]")
    .evaluateAll((nodes) => nodes.map((node) => node.innerHTML));
  const assertComparedResults = async () => {
    for (const [
      index,
      [text, output, changed],
    ] of comparisonSamples.entries()) {
      const cell = source.locator(`[data-comparison="${index}"]`);
      const result = cell.locator("[data-pagework=result]");
      assert.equal(
        await result.count(),
        changed ? 1 : 0,
        `Duplicate translation: ${text}`,
      );
      if (changed)
        assert.equal(
          await result.evaluate((node) => node.shadowRoot.textContent),
          output,
        );
      else
        assert.equal(
          await cell.innerHTML(),
          comparisonMarkup[index],
          "Original markup is untouched and no spacing is inserted",
        );
    }
  };
  const codeMarkup = await source
    .locator("#inline-code code")
    .evaluateAll((nodes) => nodes.map((node) => node.outerHTML));
  const assertInlineCodeResults = async () => {
    for (const sample of inlineCodeSamples) {
      const result = source.locator(`#${sample.id} > [data-pagework=result]`);
      assert.equal(
        await result.count(),
        1,
        "One complete translation per paragraph",
      );
      assert.equal(
        await result.evaluate((node) => node.shadowRoot.textContent),
        sample.output,
      );
    }
    assert.equal(
      await source
        .locator("code [data-pagework=result], pre [data-pagework=result]")
        .count(),
      0,
    );
    assert.deepEqual(
      await source
        .locator("#inline-code code")
        .evaluateAll((nodes) => nodes.map((node) => node.outerHTML)),
      codeMarkup,
      "Translation preserves the original code markup",
    );
  };
  const before = calls.length;
  await run();
  await assertComparedResults();
  await source.locator("#comparison").screenshot({
    path: path.join(artifacts, "inline-unchanged-translations.png"),
  });
  const requested = itemsSince(before).map((item) => item.text);
  for (const sample of inlineCodeSamples)
    assert.equal(
      requested.filter((text) => text === sample.text).length,
      1,
      `Complete inline-code source: ${sample.text}`,
    );
  for (const omitted of [
    "STANDALONE_CODE_SECRET",
    "BLOCK_CODE_SECRET",
    "HIDDEN_INLINE_CODE_SECRET",
    "INVISIBLE_CODE_SECRET",
    "FORM_INLINE_SECRET",
    "CODE_CONTEXT_SECRET",
  ])
    assert(
      !requested.some((text) => text.includes(omitted)),
      `Excluded source: ${omitted}`,
    );
  await assertInlineCodeResults();
  await source
    .locator("#inline-code")
    .screenshot({ path: path.join(artifacts, "inline-code-translation.png") });
  for (const text of numericSamples)
    assert(
      !requested.includes(text.replace(/\s+/g, " ")),
      `Pure number sent for translation: ${text}`,
    );
  assert.equal(
    await source.locator("[data-numeric] [data-pagework=result]").count(),
    0,
  );
  assert.deepEqual(
    await source.locator("[data-numeric]").allTextContents(),
    numericSamples,
  );
  for (const text of mixedSamples)
    assert(requested.includes(text), `Mixed text retained: ${text}`);
  assert.equal(
    await source.locator("[data-mixed] [data-pagework=result]").count(),
    mixedSamples.length,
  );
  await source
    .locator("#numeric")
    .screenshot({ path: path.join(artifacts, "inline-numeric-values.png") });
  for (const text of paragraphs)
    assert.equal(
      requested.filter((value) => value === text).length,
      1,
      "Inline links remain in the complete paragraph in source order",
    );
  for (const text of ["System One model", "confidence", "model guide"])
    assert(
      !requested.includes(text),
      "Prose links cannot become separate translation requests",
    );
  for (const text of [
    "Standalone resource",
    "Navigation one",
    "Navigation two",
    "Independent block link",
  ])
    assert(
      requested.includes(text),
      "Standalone and navigation links keep their own translation blocks",
    );
  for (const id of ["linked-paragraph", "generic-paragraph"]) {
    assert.equal(
      await source.locator(`#${id} > [data-pagework=result]`).count(),
      1,
    );
    assert.equal(
      await source.locator(`#${id} a [data-pagework=result]`).count(),
      0,
      "Translation cannot interrupt a sentence inside its links",
    );
  }
  const returns = itemsSince(before).filter((i) => i.text === "Returns");
  assert.equal(
    returns.length,
    2,
    "Identical labels in different UI contexts are not deduplicated",
  );
  const api = returns.find(
    (i) => i.context.sectionTitle === "TypeSafe primitives",
  );
  assert(api);
  assert.equal(api.context.pageTitle, "TypeSafe documentation fixture");
  assert.equal(api.context.tableHeaders, "Question type Goal Returns");
  assert(returns.some((i) => i.context.sectionTitle === "Store policies"));
  for (const item of itemsSince(before))
    if (item.context) {
      assert(
        Object.keys(item.context).every((k) =>
          ["pageTitle", "sectionTitle", "tableHeaders"].includes(k),
        ),
      );
      assert(!JSON.stringify(item.context).includes("SECRET"));
      assert(Object.values(item.context).every((v) => v.length <= 160));
    }
  assert.equal(
    itemsSince(before).find((item) => item.text === "ROW_CONTEXT_SECRET")
      .context.tableHeaders,
    "Size",
    "A row header does not include the neighboring data cell in context",
  );
  const assertLayout = async () => {
    const boxes = await source.evaluate(() => {
      const rect = (s) =>
        document.querySelector(s).getBoundingClientRect().toJSON();
      return {
        eyebrow: rect("#eyebrow [data-pagework=result]"),
        title: rect("h1"),
        clip: rect("#clipped-label [data-pagework=result]"),
        afterClip: rect("#after-clip"),
        copy: rect("#copy"),
        copyResult: rect("#copy [data-pagework=result]"),
        afterCopy: rect("#after-copy"),
        grid: rect("#grid"),
        gridResult: rect("#grid [data-pagework=result]"),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert(
      boxes.eyebrow.bottom <= boxes.title.top,
      "Eyebrow translation cannot cover the heading",
    );
    assert(
      boxes.clip.bottom <= boxes.afterClip.top,
      "A fixed-height ancestor grows to fit the result",
    );
    assert(boxes.copyResult.bottom <= boxes.copy.bottom + 1);
    assert(boxes.copy.bottom <= boxes.afterCopy.top);
    assert.equal(
      await source
        .locator("#copy [data-pagework=result]")
        .evaluate((node) => getComputedStyle(node).textAlign),
      "start",
      "Default flex alignment follows the original label, not the user-agent button text alignment",
    );
    assert(boxes.gridResult.bottom <= boxes.grid.bottom + 1);
    assert(!boxes.overflow);
    for (const id of ["try-cta", "api-cta", "left-cta"]) {
      const layout = await source.locator(`#${id}`).evaluate((node) => {
        const label = node.querySelector("span:not([data-pagework])");
        const result = node.querySelector("[data-pagework=result]");
        const inner = result.shadowRoot.firstElementChild;
        const properties = [
          "fontFamily",
          "fontSize",
          "fontWeight",
          "fontStyle",
          "lineHeight",
          "letterSpacing",
        ];
        const fonts = (element) =>
          Object.fromEntries(
            properties.map((key) => [key, getComputedStyle(element)[key]]),
          );
        const rect = (element) => element.getBoundingClientRect().toJSON();
        const range = document.createRange();
        range.selectNodeContents(inner);
        return {
          label: rect(label),
          result: rect(result),
          text: range.getBoundingClientRect().toJSON(),
          button: rect(node),
          labelFont: fonts(label),
          resultFont: fonts(inner),
          alignment: getComputedStyle(result).textAlign,
          columnGap: getComputedStyle(node).columnGap,
        };
      });
      assert.deepEqual(
        layout.resultFont,
        layout.labelFont,
        "Control results use the label font, not the outer wrapper font",
      );
      assert.equal(
        layout.columnGap,
        "8px",
        "The original icon spacing is preserved",
      );
      assert(layout.result.top >= layout.label.bottom - 1);
      assert(
        layout.result.top - layout.label.bottom <= 4,
        "The two rows have a compact gap",
      );
      assert(
        layout.result.bottom <= layout.button.bottom - 7,
        "The result stays inside the original button padding",
      );
      if (id === "left-cta") assert.equal(layout.alignment, "start");
      else {
        assert.equal(layout.alignment, "center");
        assert(
          Math.abs(
            layout.label.x +
              layout.label.width / 2 -
              layout.text.x -
              layout.text.width / 2,
          ) < 1,
          "Original and translated labels share a horizontal center",
        );
      }
    }
  };
  await assertLayout();
  await source
    .locator("#cta-row")
    .screenshot({ path: path.join(artifacts, "inline-button-layout.png") });
  await source.screenshot({
    path: path.join(artifacts, "inline-layout-desktop.png"),
    fullPage: true,
  });
  await source.setViewportSize({ width: 360, height: 900 });
  await source.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await assertLayout();
  await source.screenshot({
    path: path.join(artifacts, "inline-layout-mobile.png"),
    fullPage: true,
  });
  await source.setViewportSize({ width: 1440, height: 1000 });
  const processed = calls.length;
  await run();
  assert.equal(
    calls.length,
    processed,
    "The same context reuses cached results",
  );
  await assertComparedResults();
  await assertInlineCodeResults();
  await source.locator("#copy").click();
  assert.equal(
    await source.evaluate(() => window.copyClicks),
    1,
    "Original button handlers survive",
  );
  await page.evaluate(
    (tabId) => chrome.tabs.sendMessage(tabId, { type: "page.restore" }),
    tabId,
  );
  assert.equal(await source.locator("[data-pagework=result]").count(), 0);
  assert.deepEqual(
    await source.evaluate(() =>
      Object.fromEntries(
        [
          "eyebrow",
          "clip",
          "clipped-label",
          "copy",
          "grid",
          "try-cta",
          "api-cta",
          "left-cta",
        ].map((id) => [id, document.getElementById(id).style.cssText || null]),
      ),
    ),
    originals,
    "Restore puts the original height and flex styles back",
  );
  assert.deepEqual(
    await source
      .locator("#inline-code code")
      .evaluateAll((nodes) => nodes.map((node) => node.outerHTML)),
    codeMarkup,
    "Restore keeps inline code unchanged",
  );
  // A short selected label uses the same bounded context in a direct streaming request.
  await source.locator("#returns").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.evaluate(
    (tabId) =>
      chrome.tabs.sendMessage(tabId, {
        type: "selection.process",
        text: "Returns",
      }),
    tabId,
  );
  await host
    .locator("#result-status")
    .filter({ hasText: "处理完成" })
    .waitFor();
  assert.equal(
    calls.length,
    processed,
    "Selection of the same label and context reuses the page result",
  );
  await source
    .locator("#returns")
    .evaluate(
      (node) =>
        (node.closest("section").querySelector("h2").textContent =
          "Typed API results"),
    );
  const changed = calls.length;
  await page.evaluate(
    (tabId) =>
      chrome.tabs.sendMessage(tabId, {
        type: "selection.process",
        text: "Returns",
      }),
    tabId,
  );
  await host
    .locator("#result-status")
    .filter({ hasText: "处理完成" })
    .waitFor();
  assert.equal(
    calls.length,
    changed + 1,
    "Changed context cannot reuse an unrelated result",
  );
  const direct = JSON.parse(calls.at(-1).body.messages.at(-1).content);
  assert.equal(direct.text, "Returns");
  assert.equal(direct.context.sectionTitle, "Typed API results");
  // Regeneration without a new selection retains the original source context.
  await host.locator('[data-selection-command="pin"]').click();
  await source.evaluate(() => getSelection().removeAllRanges());
  await host.locator('[data-op="refresh-result"]').click();
  await host
    .locator("#result-status")
    .filter({ hasText: "处理完成" })
    .waitFor();
  assert.deepEqual(
    JSON.parse(calls.at(-1).body.messages.at(-1).content),
    direct,
  );
  // A new selection on the pinned panel gets its own context, even for the same word.
  await source
    .locator("#store th")
    .last()
    .evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
  await host.locator('[data-op="refresh-result"]').click();
  await host
    .locator("#result-status")
    .filter({ hasText: "处理完成" })
    .waitFor();
  assert.equal(
    JSON.parse(calls.at(-1).body.messages.at(-1).content).context.sectionTitle,
    "Store policies",
  );
  // A page containing only numbers needs neither a model request nor an output row.
  await page.evaluate(
    (tabId) => chrome.tabs.sendMessage(tabId, { type: "page.restore" }),
    tabId,
  );
  await source.locator("main").evaluate((node) => {
    node.innerHTML = "<p>42</p><p>$0.196</p>";
  });
  const numericOnlyCalls = calls.length;
  const runAction = (actionId) =>
    page.evaluate(
      ({ tabId, actionId }) =>
        chrome.runtime.sendMessage({
          type: "tab.run",
          tabId,
          actionId,
          scope: "body",
        }),
      { tabId, actionId },
    );
  assert((await runAction("translate")).ok);
  await host
    .locator("#status")
    .filter({ hasText: "没有识别到可处理的文字" })
    .waitFor({ state: "attached" });
  assert.equal(calls.length, numericOnlyCalls);
  assert.equal(await source.locator("[data-pagework=result]").count(), 0);
  // Numbers remain available to other actions, such as summarising a data table.
  assert((await runAction("summary")).ok);
  await host
    .locator("#status")
    .filter({ hasText: "处理完成" })
    .waitFor({ state: "attached" });
  assert(calls.length > numericOnlyCalls);
  const summaryInput = JSON.stringify(
    calls
      .slice(numericOnlyCalls)
      .map((call) => call.body.messages.at(-1).content),
  );
  assert(summaryInput.includes("42") && summaryInput.includes("$0.196"));
  // A fully unchanged page still finishes normally, without creating any output nodes.
  await page.evaluate(
    (tabId) => chrome.tabs.sendMessage(tabId, { type: "page.restore" }),
    tabId,
  );
  await source.locator("main").evaluate((node) => {
    node.innerHTML = "<p>GPT-5.5</p><p>Gemini 3.8 Flash</p>";
  });
  await run();
  assert.equal(await source.locator("[data-pagework=result]").count(), 0);
  const unchangedCalls = calls.length;
  await run();
  assert.equal(
    calls.length,
    unchangedCalls,
    "Unchanged results also remain cached",
  );
  assert.equal(await source.locator("[data-pagework=result]").count(), 0);
  setResultText();
  await source.close();
  console.log(
    "PASS: identical/whitespace-only translations omitted on fresh and cached runs, meaningful changes and original markup retained, all-unchanged pages finish normally; numeric-only blocks excluded before inline translation, mixed text and summary data preserved, numeric-only pages make no model calls; inline code retained with prose and whitespace, standalone code excluded; paragraph grouping, inline layout, restoration, context and cache reuse.",
  );
};
