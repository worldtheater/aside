const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({ context }) => {
  const page = await context.newPage();
  try {
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({
      path: path.join(
        process.env.EXTENSION_PATH || path.resolve(__dirname, ".."),
        "extract.js",
      ),
    });
    const read = (scope = "body", within) =>
      page.evaluate(
        ({ scope, within }) => ({
          root:
            PageworkExtract.root(scope).id ||
            PageworkExtract.root(scope).tagName,
          texts: PageworkExtract.extract(
            scope,
            within ? document.querySelector(within) : undefined,
          ).map((b) => b.text),
        }),
        { scope, within },
      );

    // Sixteen candidates, including earlier navigation cards and a visible
    // teaser. Semantic main content must take priority over document order.
    await page.setContent(`<!doctype html><body>
      <nav>${Array.from({ length: 12 }, (_, i) => `<article>Navigation preview ${i}</article>`).join("")}</nav>
      <main style="display:none"><p>Hidden main</p></main>
      <main></main>
      <article id="teaser"><p>Visible teaser</p></article>
      <main id="actual"><h1>Main heading</h1><p id="paragraph">Actual prose</p></main>
    </body>`);
    assert.equal(await page.locator("main,[role=main],article").count(), 16);
    assert.deepEqual(await read(), {
      root: "actual",
      texts: ["Main heading", "Actual prose"],
    });
    assert((await read("all")).texts.includes("Visible teaser"));
    assert((await read("all")).texts.includes("Navigation preview 0"));
    assert(!(await read("all")).texts.includes("Hidden main"));
    await page.locator("#paragraph").evaluate((node) => {
      node.innerHTML = "Updated <em>prose</em>";
    });
    assert.deepEqual(await read("body", "#paragraph em"), {
      root: "actual",
      texts: ["Updated prose"],
    });
    assert.deepEqual((await read("body", "#teaser")).texts, []);

    // Ignore excluded ancestors, transparent and closed content, and containers
    // with no readable prose. display:contents must not hide visible children.
    await page.setContent(`<!doctype html><body>
      <aside><main><p>Sidebar main</p></main></aside>
      <div hidden><main><p>Hidden ancestor</p></main></div>
      <div style="opacity:0"><main><p>Transparent ancestor</p></main></div>
      <details><summary>Collapsed</summary><main><p>Closed details</p></main></details>
      <main><pre>Code only</pre></main>
      <main data-pagework="result">Extension content</main>
      <main contenteditable="true">Editable content</main>
      <main><p hidden>Hidden descendants</p></main>
      <div id="actual" role="main" style="display:contents"><p>Visible descendants</p></div>
    </body>`);
    assert.deepEqual(await read(), {
      root: "actual",
      texts: ["Visible descendants"],
    });

    await page.setContent(`<!doctype html><body>
      <header><article>Header card</article></header>
      <nav><article>Menu card</article></nav>
      <article hidden>Hidden article</article>
      <article></article>
      <article id="actual"><p>Article prose</p></article>
    </body>`);
    assert.deepEqual(await read(), {
      root: "actual",
      texts: ["Article prose"],
    });
    await page.locator("#actual").evaluate((node) => {
      node.hidden = true;
    });
    await page.locator("body").evaluate((node) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = "Body prose without an eligible landmark";
      node.append(paragraph);
    });
    assert.deepEqual(await read(), {
      root: "BODY",
      texts: ["Body prose without an eligible landmark"],
    });
    console.log(
      "PASS: main-content priority, 16 competing landmarks, hidden/empty/peripheral exclusions, display:contents, article/body scope and incremental ownership.",
    );
  } finally {
    await page.close();
  }
};
