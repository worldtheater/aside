import { chromium } from "playwright";
import { createRequire } from "node:module";
import { readFile, mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";

// All content and model replies below are authored demonstration fixtures.
// The installed extension renders them unchanged in an isolated, disposable profile.
// No real account, API key, browsing history or external model service is used.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "web-store", "assets");
const require = createRequire(import.meta.url);
const { watchUI } = require("../tests/inspect-ui.cjs");
const paragraph =
  "Reading is not simply the act of collecting information. It is a conversation between what we already know and what we are trying to understand.";
const note =
  "A useful note does more than repeat a sentence. It connects an idea to a question, an experience, or another idea. Those connections make knowledge easier to recall and use.";
const french = [
  "Lire, c’est entrer dans une conversation",
  "Lire ne consiste pas seulement à recueillir des informations. C’est une conversation entre ce que nous savons déjà et ce que nous cherchons à comprendre.",
  "Une note utile ne se contente pas de répéter une phrase. Elle relie une idée à une question, à une expérience ou à une autre idée.",
  "Avant de surligner un paragraphe, prenez un instant pour vous demander : qu’est-ce qui a changé dans ma compréhension ? Écrivez ce changement avec vos propres mots.",
];
const english = [
  "Reading is a conversation",
  paragraph,
  "A useful note does more than repeat a sentence. It connects an idea to a question, an experience, or another idea.",
  "Before highlighting a paragraph, pause and ask: what changed in my understanding? Write that change in your own words.",
];
const translations = new Map(french.map((text, i) => [text, english[i]]));
const answer =
  "Start with one question: **What changed in my understanding?**\n\nWrite a short answer in your own words, then connect it to something you already know. For example:\n\n> A useful note is a connection, not just a quotation.\n\nSave the passage alongside your note so you can return to its context.";
const summary =
  "- **Read actively.** Connect new ideas to what you already know.\n- **Write in your own words.** Capture the change in your understanding.\n- **Keep the context.** Save useful passages so you can revisit them.";
const reflection =
  "The best note is not the sentence you kept, but the thought it helped you find.";
function article(language) {
  const lines = language === "fr" ? french : english;
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reading is a conversation — Fieldnotes</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#fafafa;color:#292e30;font:18px/1.8 Georgia,serif}header{height:82px;border-bottom:1px solid #dedbd3;display:flex;align-items:center;justify-content:space-between;padding:0 68px;font:14px system-ui;letter-spacing:.04em}header strong{font-size:20px}main{max-width:760px;margin:54px auto 90px}aside{font:12px system-ui;letter-spacing:.16em;color:#85765f;text-transform:uppercase;margin-bottom:20px}h1{font-weight:500;font-size:42px;line-height:1.18;letter-spacing:-.025em;margin:0 0 28px}p{margin:0 0 24px}footer{border-top:1px solid #dedbd3;padding-top:20px;margin-top:34px;color:#6d7376;font:13px system-ui}::selection{background:#d7e4ed}
  </style></head><body><header><strong>Fieldnotes</strong><span>Essays on reading & learning</span></header><main><aside>Reading practice / 004</aside><h1>${lines[0]}</h1><p id="first">${lines[1]}</p><p>${lines[2]}</p><p>${lines[3]}</p><footer>An original sample article for Aside.</footer></main></body></html>`;
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
  res.end(article(req.url.startsWith("/fr") ? "fr" : "en"));
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
  deviceScaleFactor: 1,
  locale: "en-US",
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
        locale: "en",
        theme: "light",
        palette: "graphite",
      },
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
      name: "Demo connection",
      url: origin + "/v1",
      model: "demo-model",
      models: [{ id: "demo-model", name: "Demo model" }],
      protocol: "chat",
      maxTokens: 4096,
      openaiCache: "auto",
      connected: true,
    },
  });
  const capture = async (page, filename) => {
    await page.mouse.move(5, 5);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(output, filename),
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
  await source.waitForFunction(() =>
    document
      .querySelector("#first > [data-pagework=result]")
      ?.shadowRoot?.textContent.includes("conversation"),
  );
  await source
    .locator("[data-pagework=ui] #toolbar[aria-busy=false]")
    .waitFor({ state: "attached" });
  await capture(source, "01-inline-translation.png");

  await source.goto(origin + "/en/reading");
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
  await ui
    .locator("#question-input")
    .fill("How can I take a useful note from this passage?");
  await ui.locator("[data-op=question-run]").click();
  await ui.locator("#output[aria-busy=false]").waitFor();
  await capture(source, "02-quick-qa.png");

  const date = new Date().toLocaleDateString("en-CA");
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
  for (const item of [
    {
      title: "Pause before highlighting",
      sourceText:
        "Before highlighting a paragraph, pause and ask: what changed in my understanding?",
      text: "Write down the change in your understanding. One precise sentence can be enough.",
      actionName: "Explain",
    },
    {
      title: "Read with a question in mind",
      sourceText: paragraph,
      text: "Reading becomes active when a new idea meets a question you already have.",
      actionName: "Explain",
    },
    {
      title: "Keep the connection",
      sourceText: note,
      text: "A useful note connects an idea to a question, an experience, or another idea.",
      actionName: "Key points",
    },
  ])
    await send({
      type: "collection.add",
      item: {
        ...item,
        sourceTitle: "Reading is a conversation",
        url: "https://example.com/reading",
      },
    });
  await app.reload();
  await app.locator(".sidebar [data-route=home]").click();
  await app.locator(".collection-card").first().waitFor();
  await capture(app, "03-collection.png");
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
        locale: "en",
        theme: "dark",
        palette: "graphite",
      },
    },
  });
  await source.goto(origin + "/en/dark-reading");
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
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
