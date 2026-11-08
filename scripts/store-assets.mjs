import { chromium } from "playwright";
import { createRequire } from "node:module";
import { readFile, mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";

// Reading examples and model replies are authored demonstration fixtures.
// The philosophy excerpt and its edition are credited in the fixture and image.
// The installed extension renders them unchanged in an isolated, disposable profile.
// No real account, API key, browsing history or external model service is used.
const root = fileURLToPath(new URL("../", import.meta.url));
const website = process.argv.includes("--website");
const qaOnly = process.argv.includes("--qa-only");
const locale =
  process.argv.find((arg) => arg.startsWith("--locale="))?.slice(9) || "en";
const fixtures = JSON.parse(
  await readFile(
    new URL("./fixtures/store-assets.json", import.meta.url),
    "utf8",
  ),
);
const copy = fixtures[locale];
if (!copy?.reading || (!website && locale !== "en"))
  throw new Error("Use --website --locale=en, zh-CN or zh-TW.");
const output = path.join(
  root,
  website ? "docs" : "web-store",
  "assets",
  locale === "en" ? "" : locale,
);
const require = createRequire(import.meta.url);
const { watchUI } = require("../tests/inspect-ui.cjs");
const { note, philosophy, answer, summary, reflection } = copy;
const paragraph = copy.reading[1];
const french = fixtures.source;
const translations = new Map(french.map((text, i) => [text, copy.reading[i]]));
function article(language, isPhilosophy = false) {
  const lines = isPhilosophy
    ? philosophy
    : language === "fr"
      ? french
      : copy.reading;
  const citation = isPhilosophy
    ? `<div class="citation" id="citation"><a href="${copy.philosophySource.url}">${copy.philosophySource.label}</a><br>${copy.philosophySource.edition} · ${copy.philosophySource.note}</div>`
    : "";
  const paragraphs = lines
    .slice(1)
    .map((text, index) => `<p${index === 0 ? ' id="first"' : ""}>${text}</p>`)
    .join("");
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${lines[0]} — ${copy.siteTitle}</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#fafafa;color:#292e30;font:18px/1.8 Georgia,serif}header{height:82px;border-bottom:1px solid #dedbd3;display:flex;align-items:center;justify-content:space-between;padding:0 68px;font:14px system-ui;letter-spacing:.04em}header strong{font-size:20px}main{max-width:760px;margin:54px auto 90px}aside{font:12px system-ui;letter-spacing:.16em;color:#85765f;text-transform:uppercase;margin-bottom:20px}h1{font-weight:500;font-size:42px;line-height:1.18;letter-spacing:-.025em;margin:0 0 28px}p{margin:0 0 24px}footer{border-top:1px solid #dedbd3;padding-top:20px;margin-top:34px;color:#6d7376;font:13px system-ui}::selection{background:#d7e4ed}
  .citation{font:13px/1.6 system-ui;color:#6d7376;margin-bottom:16px}.citation a{color:inherit;text-underline-offset:3px}
  ${website ? "main{width:calc(100% - 48px);max-width:660px}@media(max-width:600px){header{padding:0 24px}header span{display:none}main{margin-top:30px}h1{font-size:30px}body{font-size:18px}}" : ""}</style></head><body><header><strong>${copy.siteTitle}</strong><span>${isPhilosophy ? copy.philosophyTagline : copy.readingTagline}</span></header><main><aside>${isPhilosophy ? copy.philosophyCategory : copy.readingCategory}</aside><h1>${lines[0]}</h1>${citation}${paragraphs}${isPhilosophy ? "" : `<footer>${copy.footer}</footer>`}</main></body></html>`;
}
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "demo-model" }] }));
  }
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const messages = JSON.parse(body).messages;
    const input = messages.at(-1).content;
    const instructions = messages
      .slice(0, -1)
      .map((message) => message.content)
      .join("\n");
    let text = answer;
    if (/reflect|attribution/i.test(instructions)) text = reflection;
    else if (/Summari|key points|main points/i.test(instructions))
      text = summary;
    else if (/translat/i.test(instructions)) {
      let batch;
      try {
        batch = JSON.parse(input);
      } catch {
        /* Single text input. */
      }
      text = batch?.items
        ? JSON.stringify({
            items: batch.items.map(({ id, text }) => ({
              id,
              text: translations.get(text) || text,
            })),
          })
        : translations.get(input) || input;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    article(
      req.url.startsWith("/fr") ? "fr" : locale,
      req.url.endsWith("/words-and-meaning"),
    ),
  );
});
await mkdir(output, { recursive: true });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "aside-store-"));
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: website ? 2 : 1,
  locale,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: ["--enable-unsafe-extension-debugging"],
});
const errors = [];
watchUI(context, errors);
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: root });
  const manager = await context.newPage();
  await manager.goto("chrome://extensions");
  await manager.evaluate(
    async ({ id, origin }) => {
      for (const host of [origin + "/*", "http://*/*", "https://*/*"])
        await chrome.developerPrivate.addHostPermission(id, host);
    },
    { id, origin },
  );
  const app = await context.newPage();
  app.on("pageerror", (error) => errors.push(error.message));
  await app.goto(`chrome-extension://${id}/index.html`);
  await app.locator("h1").waitFor();
  const send = (message) =>
    app.evaluate(async (message) => {
      const result = await chrome.runtime.sendMessage(message);
      if (!result.ok) throw new Error(JSON.stringify(result));
      return result.value;
    }, message);
  const snapshot = await send({ type: "snapshot" });
  await send({
    type: "settings.save",
    patch: {
      preferences: {
        ...snapshot.preferences,
        locale,
        theme: "light",
        palette: "graphite",
      },
      // Keep fixture translations on the local mock service even when the
      // installed version defaults to an online translation engine.
      actions: snapshot.actions.map((action) =>
        action.kind === "translate"
          ? { ...action, translationEngine: "ai" }
          : action,
      ),
    },
  });
  await app.evaluate(
    (origin) => chrome.permissions.request({ origins: [origin + "/*"] }),
    origin,
  );
  await send({
    type: "connection.save",
    key: "",
    connection: {
      id: null,
      name: copy.connectionName,
      url: origin + "/v1",
      model: "demo-model",
      models: [{ id: "demo-model", name: copy.modelName }],
      protocol: "chat",
      maxTokens: 4096,
      openaiCache: "auto",
      connected: true,
    },
  });
  const capture = async (page, filename) => {
    if (qaOnly && !filename.startsWith("02-")) return;
    await page.mouse.move(5, 5);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    let clip;
    if (website) {
      if (filename.startsWith("01-")) {
        const main = await page.locator("main").boundingBox();
        const first = await page.locator("#first").boundingBox();
        clip = {
          x: main.x - 24,
          y: main.y - 20,
          width: main.width + 48,
          height: first.y + first.height - main.y + 44,
        };
        filename = filename.replace("01-inline-translation", "translation");
      } else if (filename.startsWith("02-quick-qa")) {
        const panel = await page
          .locator("[data-pagework=ui] #output")
          .evaluate((node) =>
            node.closest("#selection").getBoundingClientRect().toJSON(),
          );
        const passage = await page.locator("#first").boundingBox();
        const citation = await page.locator("#citation").boundingBox();
        const left = Math.min(passage.x, panel.x);
        const top = Math.min(citation.y, panel.y);
        clip = {
          x: left - 24,
          y: top - 24,
          width:
            Math.max(passage.x + passage.width, panel.x + panel.width) -
            left +
            48,
          height:
            Math.max(passage.y + passage.height, panel.y + panel.height) -
            top +
            48,
        };
        filename = filename.replace("02-", "");
      } else if (filename.startsWith("03-collection")) {
        const workspace = await page.locator(".workspace").boundingBox();
        const cards = await page.locator(".collection-grid").boundingBox();
        clip = {
          x: workspace.x,
          y: workspace.y,
          width: workspace.width,
          height: cards.y + cards.height - workspace.y + 32,
        };
        filename = filename.replace("03-", "");
      } else if (filename === "05-dark-reading.png") {
        filename = "dark-reading.png";
      } else return;
    }
    await page.screenshot({
      path: path.join(output, filename),
      clip,
      animations: "disabled",
    });
    console.log(filename);
  };
  const source = await context.newPage();
  await source.goto(origin + "/fr/reading");
  const tabId = await app.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
    source.url(),
  );
  await send({
    type: "tab.run",
    tabId,
    actionId: "translate",
    scope: "body",
    panel: false,
  });
  await source.locator("#first > [data-pagework=result]").waitFor();
  await source.waitForFunction(
    (expected) =>
      document
        .querySelector("#first > [data-pagework=result]")
        ?.shadowRoot?.textContent.includes(expected),
    paragraph,
  );
  await source
    .locator("[data-pagework=ui] #toolbar[aria-busy=false]")
    .waitFor({ state: "attached" });
  await capture(source, "01-inline-translation.png");
  if (website) {
    await send({
      type: "settings.save",
      patch: {
        preferences: {
          ...snapshot.preferences,
          locale,
          theme: "dark",
          palette: "graphite",
        },
      },
    });
    await send({ type: "website.update", tabId, patch: { lights: "on" } });
    await source.waitForFunction(
      () => document.documentElement.dataset.darkreaderMode === "dynamic",
    );
    await capture(source, "01-inline-translation-dark.png");
    await source.setViewportSize({ width: 390, height: 1000 });
    await capture(source, "01-inline-translation-mobile-dark.png");
    await send({ type: "website.update", tabId, patch: { lights: "off" } });
    await send({
      type: "settings.save",
      patch: {
        preferences: {
          ...snapshot.preferences,
          locale,
          theme: "light",
          palette: "graphite",
        },
      },
    });
    await source.waitForFunction(
      () => !document.documentElement.dataset.darkreaderMode,
    );
    await capture(source, "01-inline-translation-mobile.png");
    await source.setViewportSize({ width: 1280, height: 800 });
  }

  if (website) await source.setViewportSize({ width: 1280, height: 1000 });
  await source.goto(`${origin}/${locale}/words-and-meaning`);
  const ui = source.locator("[data-pagework=ui]");
  await ui.locator("#dock").waitFor();
  await source.locator("#first").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const rect = await source.locator("#first").boundingBox();
  await source.mouse.move(rect.x + 10, rect.y + 10);
  await source.mouse.up();
  await ui.locator("#selection [data-selection-command=expand]").click();
  await ui.locator("#selection [data-selection-action=qa]").click();
  await ui.locator("#question-input").fill(copy.question);
  await ui.locator("[data-op=question-run]").click();
  await ui.locator("#output[aria-busy=false]").waitFor();
  if (website) {
    const passage = await source.locator("#first").boundingBox();
    const bar = await ui.locator(".selection-toolbar-row").boundingBox();
    const panel = await ui.locator("#selection").boundingBox();
    // Use the real panel drag behavior to leave the selected passage unobscured.
    const start = { x: bar.x + bar.width / 2, y: bar.y + 2 };
    await source.mouse.move(start.x, start.y);
    await source.mouse.down();
    await source.mouse.move(
      start.x + passage.x + (passage.width - panel.width) / 2 - panel.x,
      start.y + passage.y + passage.height + 22 - panel.y,
      { steps: 8 },
    );
    await source.mouse.up();
    await source.locator("#first").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }
  await capture(source, "02-quick-qa.png");
  if (website) {
    await send({
      type: "settings.save",
      patch: {
        preferences: {
          ...snapshot.preferences,
          locale,
          theme: "dark",
          palette: "graphite",
        },
      },
    });
    await send({ type: "website.update", tabId, patch: { lights: "on" } });
    await source.waitForFunction(
      () => document.documentElement.dataset.darkreaderMode === "dynamic",
    );
    await capture(source, "02-quick-qa-dark.png");
    await send({
      type: "settings.save",
      patch: {
        preferences: {
          ...snapshot.preferences,
          locale,
          theme: "light",
          palette: "graphite",
        },
      },
    });
  }

  const date = new Date().toLocaleDateString("en-CA");
  if (website) await source.setViewportSize({ width: 1280, height: 800 });
  await send({
    type: "daily.save",
    daily: {
      ...snapshot.daily,
      prompt: "Write a brief reflection about reading.",
      useCollection: false,
      date,
      result: reflection,
    },
  });
  for (const item of copy.collection)
    await send({
      type: "collection.add",
      item: {
        ...item,
        sourceTitle: copy.reading[0],
        url: "https://example.com/reading",
      },
    });
  await app.reload();
  await app.locator(".sidebar [data-route=home]").click();
  await app.locator(".collection-card").first().waitFor();
  await capture(app, "03-collection.png");
  if (website) {
    await send({
      type: "settings.save",
      patch: {
        preferences: {
          ...snapshot.preferences,
          locale,
          theme: "dark",
          palette: "graphite",
        },
      },
    });
    await app.reload();
    await app.locator(".collection-card").first().waitFor();
    await app.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await capture(app, "03-collection-dark.png");
    await send({
      type: "settings.save",
      patch: {
        preferences: {
          ...snapshot.preferences,
          locale,
          theme: "light",
          palette: "graphite",
        },
      },
    });
  }
  if (website) await app.reload();
  await app.locator(".sidebar [data-route=actions]").click();
  await app.locator("[data-op=edit-action][data-id=summary]").click();
  await app.locator("#test-input").fill(paragraph + "\n\n" + note);
  await app.locator("[data-op=test-run]").click();
  await app.locator(".result-paper").waitFor();
  await capture(app, "04-reusable-actions.png");

  await send({
    type: "settings.save",
    patch: {
      preferences: {
        ...snapshot.preferences,
        locale,
        theme: "dark",
        palette: "graphite",
      },
    },
  });
  await source.goto(`${origin}/${locale}/dark-reading`);
  await ui.locator("#dock").waitFor();
  await app.evaluate(() =>
    chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] }),
  );
  await send({ type: "website.update", tabId, patch: { lights: "on" } });
  await source.waitForFunction(
    () => document.documentElement.dataset.darkreaderMode === "dynamic",
  );
  await ui.locator("#dock").click();
  await capture(source, "05-dark-reading.png");

  if (!website) {
    // Promotional artwork uses the repository's vector logo and native HTML/CSS.
    const promo = await context.newPage();
    const logo = await readFile(path.join(root, "icons/icon.svg"), "utf8");
    for (const [width, height, filename] of [
      [440, 280, "promo-small-440x280.png"],
      [1400, 560, "promo-marquee-1400x560.png"],
    ]) {
      await promo.setViewportSize({ width, height });
      const large = width > 500;
      await promo.setContent(
        `<html><style>*{box-sizing:border-box}body{margin:0;background:#222629;color:#f0ece4;font-family:system-ui;display:flex;align-items:center;height:100vh;padding:${large ? 104 : 32}px;gap:${large ? 90 : 25}px}svg{width:${large ? 210 : 76}px;height:auto;flex:none}.brand{font-size:${large ? 100 : 43}px;font-weight:600;letter-spacing:-.055em;line-height:1.1}.tag{color:#d8a36a;font-size:${large ? 28 : 15}px;margin-top:${large ? 22 : 14}px;letter-spacing:.01em}.lines{position:absolute;right:-80px;top:60px;width:230px;opacity:.13;transform:rotate(-12deg)}.lines i{height:2px;display:block;background:#d8a36a;margin-bottom:28px}.lines i:nth-child(2n){width:70%}</style><body>${logo}<div><div class="brand">Aside</div><div class="tag">Read. Understand. Keep.</div></div>${large ? '<div class="lines"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' : ""}</body></html>`,
      );
      await capture(promo, filename);
    }
    await copyFile(
      path.join(root, "icons/icon-128.png"),
      path.join(output, "store-icon-128.png"),
    );
  }
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
