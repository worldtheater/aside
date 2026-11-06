const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const root = path.resolve(__dirname, "..");
const engine = process.env.CONTROLS_BROWSER || "chrome";
const options = (values) => values.map((v) => `<option>${v}</option>`).join("");
// Real shared controls and popup styles, with no model service or user settings.
const fixture = `<!doctype html><html><head>
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/themes.css">
<link rel="stylesheet" href="/selection-tools.css"><link rel="stylesheet" href="/popup.css">
</head><body><div class="selection-tools popup-panel">
<header class="popup-header">Aside</header><main class="popup-body">
<section class="popup-page" style="height:90px">Current page</section>
<section class="popup-process selection-settings"><div class="popup-process-options">
<label class="field"><span class="field-label">Action</span><select id="action">${options(["Translate", "Explain", "Summarize", "Extract", "Rewrite", "Custom"])}</select></label>
<label class="field"><span class="field-label">Language</span><select id="language" data-search="false">${options(Array.from({ length: 20 }, (_, i) => `Language ${i}`))}</select></label>
</div><label class="field"><span class="field-label">Engine</span><select id="engine" data-search="false">${options(["AI", "Microsoft", "Browser"])}</select></label><button id="outside">Start</button></section>
<section class="popup-features" style="height:135px">Feature toggles</section></main></div>
<script type="module">import {enhanceSelects} from '/controls.js'; enhanceSelects();</script></body></html>`;
(async () => {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(fixture);
      return;
    }
    const name = req.url.slice(1);
    if (!/^[\w.-]+\.(js|css)$/.test(name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      res.setHeader(
        "Content-Type",
        name.endsWith(".css") ? "text/css" : "text/javascript",
      );
      res.end(await fs.readFile(path.join(root, name)));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await (engine === "webkit"
      ? webkit.launch()
      : chromium.launch({ channel: "chrome" }));
    const page = await browser.newPage({
      viewport: { width: 400, height: 480 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const menu = page.locator(".popover-surface");
    for (const [id, choice] of [
      ["action", "Explain"],
      ["language", "Language 19"],
      ["engine", "Browser"],
    ]) {
      await page.locator(`[data-select-for=${id}]`).click();
      // Safari's automatic popup layout emits resize with identical dimensions.
      // A menu layout mutation can provoke another notification from the host.
      await page.evaluate(async () => {
        const menu = document.querySelector(".popover-surface");
        let mutations = 0;
        const observer = new MutationObserver(() => {
          mutations++;
        });
        observer.observe(menu, {
          attributes: true,
          attributeFilter: ["style"],
        });
        for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("resize"));
        await new Promise(requestAnimationFrame);
        observer.disconnect();
        window.menuResizeMutations = mutations;
      });
      assert.equal(
        await menu.isVisible(),
        true,
        `${id} must stay open after a host resize notification`,
      );
      assert.equal(
        await page.evaluate(() => window.menuResizeMutations),
        0,
        "unchanged dimensions must not start another host layout pass",
      );
      await page.locator(`[role=option][data-value="${choice}"]`).click();
      assert.equal(await page.locator(`#${id}`).inputValue(), choice);
      assert.equal(await menu.count(), 0);
    }
    const language = page.locator('[data-select-for="language"]');
    await language.click();
    await page.setViewportSize({ width: 360, height: 350 });
    await page.waitForFunction(() => {
      const rect = document
        .querySelector(".popover-surface")
        ?.getBoundingClientRect();
      return (
        rect &&
        rect.right <= innerWidth &&
        rect.bottom <= innerHeight &&
        rect.top >= 0
      );
    });
    assert.equal(
      await menu.isVisible(),
      true,
      "real resizing repositions the menu",
    );
    await language.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#language").inputValue(), "Language 0");
    await language.click();
    await page.keyboard.press("Escape");
    assert.equal(await menu.count(), 0);
    await page.locator('[data-select-for="action"]').click();
    await page.locator(".popup-header").click();
    assert.equal(await menu.count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      `PASS (${engine}): three popup dropdowns survive host resize, avoid layout loops, reposition on size changes, select, and dismiss with Escape/outside click.`,
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
