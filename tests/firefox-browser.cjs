const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { Builder, By, Key } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const root = path.resolve(__dirname, "..");
const id = "aside-ai@worldtheater.github.io";
const uuid = "5ced12e3-429c-43dc-8a60-d323fc812784";
const extensionUrl = `moz-extension://${uuid}/`;
const fixtureKey = "firefox-fixture-key";
const providerHost = "model.aside.test";
const requests = [];
const server = http.createServer(async (req, res) => {
  if (req.url === "/v1/models") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
    return;
  }
  if (req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    requests.push({ body: parsed, authorization: req.headers.authorization });
    let input = parsed.messages.at(-1).content;
    let output = "Translated: " + input;
    try {
      const data = JSON.parse(input);
      if (data.items)
        output = JSON.stringify({
          items: data.items.map((item) => ({
            id: item.id,
            text: "Translated: " + item.text,
          })),
        });
    } catch {}
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({ choices: [{ delta: { content: output } }] }) +
        "\n\ndata: " +
        JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }) +
        "\n\ndata: [DONE]\n\n",
    );
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(
    '<!doctype html><html><head><title>Firefox reading fixture</title><style>body{background:white;color:black;padding:40px;font:18px serif}p{max-width:700px}</style></head><body><main><h1>Reading fixture</h1><p id="source">Reading a difficult passage invites careful thought.</p><p>Connect the idea with its context.</p></main></body></html>',
  );
});
(async () => {
  let driver;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const providerOrigin = `http://${providerHost}:${server.address().port}`;
  try {
    const options = new firefox.Options()
      .addArguments("-headless")
      // Resolve a non-localhost HTTP provider inside this isolated profile only.
      // Loopback URLs are exempt from Firefox MV3 HTTPS upgrades.
      .setPreference("network.dns.localDomains", providerHost)
      .setPreference(
        "extensions.webextensions.uuids",
        JSON.stringify({ [id]: uuid }),
      );
    const binary =
      process.env.FIREFOX_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Firefox.app/Contents/MacOS/firefox"
        : undefined);
    if (binary) options.setBinary(binary);
    driver = await new Builder()
      .forBrowser("firefox")
      .setFirefoxService(
        new firefox.ServiceBuilder().addArguments("--allow-system-access"),
      )
      .setFirefoxOptions(options)
      .build();
    await driver.manage().setTimeouts({ script: 15000 });
    await driver.manage().window().setRect({ width: 1400, height: 1000 });
    assert.equal(
      await driver.installAddon(path.join(root, "dist/firefox"), true),
      id,
    );
    const privileged = async (script, ...args) => {
      await driver.setContext(firefox.Context.CHROME);
      try {
        return await driver.executeAsyncScript(script, ...args);
      } finally {
        await driver.setContext(firefox.Context.CONTENT);
      }
    };
    // Grant only these isolated mock origins, never change a personal profile.
    await privileged(
      `const done=arguments[arguments.length-1];const {ExtensionPermissions}=ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');ExtensionPermissions.add(arguments[0],{origins:arguments[1].map(origin=>origin+'/*'),permissions:[]}).then(()=>done(true),e=>done(String(e)));`,
      id,
      [origin, providerOrigin],
    );
    async function openExtension(page = "index.html") {
      await privileged(
        `gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});arguments[arguments.length-1](true);`,
        extensionUrl + page,
      );
      await driver.wait(
        () =>
          driver.executeScript(
            'return location.href.startsWith(arguments[0]) && document.readyState === "complete";',
            extensionUrl,
          ),
        10000,
      );
    }
    const evaluate = (script, ...args) =>
      driver.executeAsyncScript(
        `const done=arguments[arguments.length-1];(async()=>{${script}})().then(done,e=>done({testError:String(e),stack:e.stack}));`,
        ...args,
      );
    const send = async (message) => {
      const result = await evaluate(
        "return await chrome.runtime.sendMessage(arguments[0]);",
        message,
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.value;
    };
    await openExtension();
    await driver.wait(
      () =>
        driver
          .findElements(By.css(".sidebar"))
          .then((elements) => elements.length),
      10000,
    );
    const appTab = await driver.getWindowHandle();
    assert.equal((await send({ type: "snapshot" })).connections.length, 0);
    const commands = await evaluate("return await chrome.commands.getAll();");
    assert(commands.some((command) => command.name === "text-translate"));
    assert(commands.some((command) => command.name === "quick-question"));
    // Exercise the same background request as the connection editor's Test button.
    // Unlike localhost, this HTTP origin exposes accidental HTTPS upgrades.
    const models = await send({
      type: "connection.test",
      key: fixtureKey,
      connection: { url: providerOrigin + "/v1", protocol: "responses" },
    });
    assert.deepEqual(
      models.map((model) => model.id),
      ["fixture-model"],
    );
    await send({
      type: "connection.save",
      key: fixtureKey,
      connection: {
        name: "Firefox fixture",
        url: providerOrigin + "/v1",
        protocol: "chat",
        model: "fixture-model",
        models: [{ id: "fixture-model", name: "Fixture" }],
        maxTokens: 1024,
      },
    });
    const snapshot = await send({ type: "snapshot" });
    assert.equal(snapshot.connections.length, 1);
    assert.equal(snapshot.defaultConnection, snapshot.connections[0].id);
    assert(!JSON.stringify(snapshot).includes(fixtureKey));
    assert.equal(
      await evaluate(
        `const {readStore}=await import('./store.js');return (await readStore()).credentials[arguments[0]];`,
        snapshot.defaultConnection,
      ),
      fixtureKey,
    );
    const stored = await evaluate(
      `const {localStore}=await import('./extension-storage.js');return await localStore.get(null);`,
    );
    assert(stored.protectedConfiguration);
    assert(!JSON.stringify(stored).includes(fixtureKey));
    assert.deepEqual(
      await evaluate("return await chrome.storage.local.get(null);"),
      {},
    );
    await send({
      type: "settings.save",
      patch: {
        preferences: { ...snapshot.preferences, hideDaily: true, locale: "en" },
      },
    });
    await driver.switchTo().newWindow("tab");
    const websiteTab = await driver.getWindowHandle();
    await driver.get(origin);
    await driver.wait(
      () =>
        driver
          .findElements(By.css("[data-pagework=ui]"))
          .then((items) => items.length),
      10000,
    );
    const host = await driver.findElement(By.css("[data-pagework=ui]"));
    const shadow = await host.getShadowRoot();
    const element = (selector) => shadow.findElement(By.css(selector));
    const read = async (selector) => (await element(selector)).getText();
    const click = async (selector) =>
      driver
        .actions()
        .move({ origin: await element(selector) })
        .click()
        .perform();
    await click("#dock");
    await driver.wait(
      async () =>
        (await element("#radial"))
          .getAttribute("class")
          .then((value) => value.includes("open")),
      5000,
    );
    await evaluate(
      "await Promise.all(arguments[0].getAnimations({subtree:true}).map(a=>a.finished));return true;",
      await element("#radial"),
    );
    await click("[data-op=text-translate]");
    await (
      await element("#text-translation textarea")
    ).sendKeys("A custom passage.");
    await click("[data-text-command=run]");
    await driver.wait(
      async () =>
        (await read("#text-translation .output"))?.includes("Translated:"),
      15000,
    );
    assert.equal(requests.at(-1).authorization, "Bearer " + fixtureKey);
    await (await element("#text-translation textarea")).sendKeys(Key.ESCAPE);
    await driver.switchTo().window(appTab);
    const tabs = await evaluate("return await chrome.tabs.query({});");
    const tabId = tabs.find((tab) => tab.url === origin + "/").id;
    await send({
      type: "tab.run",
      tabId,
      actionId: "translate",
      scope: "body",
      panel: false,
    });
    await driver.switchTo().window(websiteTab);
    await driver.wait(
      () =>
        driver.executeScript(
          `return [...document.querySelectorAll('[data-pagework="result"]')].some(node => node.shadowRoot?.textContent.includes('Translated:'));`,
        ),
      15000,
    );
    await driver.switchTo().window(appTab);
    await send({ type: "tab.restore", tabId });
    await evaluate(
      "return await chrome.tabs.sendMessage(arguments[0],{type:'question.open'});",
      tabId,
    );
    await driver.switchTo().window(websiteTab);
    await driver.wait(
      () => element("#question-input").then((e) => e.isDisplayed()),
      5000,
    );
    assert.equal(
      (await shadow.findElements(By.css("#question-quote"))).length,
      0,
    );
    await (await element("#question-input")).sendKeys("Explain the idea.");
    await click('[data-op="question-run"]');
    await driver.wait(
      async () => (await read("#output")).includes("Translated:"),
      15000,
    );
    await click('[data-op="close-result"]');
    await driver.switchTo().window(appTab);
    // Content scripts cannot read the extension-origin IndexedDB or privileged
    // messages, and Firefox session storage must remain inaccessible.
    const access = await evaluate(
      `return (await chrome.scripting.executeScript({target:{tabId:arguments[0]},func:async()=>({session:typeof chrome.storage.session,databases:(await indexedDB.databases()).map(db=>db.name),privateReply:await chrome.runtime.sendMessage({type:'snapshot'})})}))[0].result;`,
      tabId,
    );
    assert.equal(access.session, "undefined");
    assert(!access.databases.includes("aside-settings"));
    assert.equal(access.privateReply.ok, false);
    await send({
      type: "sync.connect",
      action: "create",
      revision: null,
      passphrase: "Firefox test passphrase",
    });
    assert.equal((await send({ type: "sync.status" })).mode, "ready");
    const cloud = await evaluate("return await chrome.storage.sync.get(null);");
    assert(cloud["aside-config:head"]);
    assert(!JSON.stringify(cloud).includes(fixtureKey));
    // Both pages must observe trusted local changes via the IDB change channel.
    await driver.switchTo().newWindow("tab");
    await openExtension("index.html#home");
    await driver.wait(
      () =>
        driver.findElements(By.css(".sidebar")).then((items) => items.length),
      10000,
    );
    const secondTab = await driver.getWindowHandle();
    await driver.switchTo().window(appTab);
    await send({
      type: "connection.save",
      connection: {
        id: snapshot.connections[0].id,
        name: "Changed on another extension page",
        url: providerOrigin + "/v1",
        protocol: "chat",
        model: "fixture-model",
        models: [{ id: "fixture-model", name: "Fixture" }],
        maxTokens: 1024,
      },
    });
    await send({
      type: "collection.add",
      item: {
        title: "Saved Firefox passage",
        text: "Translated passage",
        sourceText: "Original passage",
        sourceTitle: "Reading fixture",
        url: origin,
        actionName: "Translation",
      },
    });
    await driver.switchTo().window(secondTab);
    await driver.wait(
      () =>
        driver
          .findElements(By.css(".collection-card"))
          .then((items) => items.length === 1),
      10000,
    );
    await driver.switchTo().window(appTab);
    await privileged(
      `const done=arguments[arguments.length-1];const {ExtensionPermissions}=ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');ExtensionPermissions.add(arguments[0],{origins:['http://*/*','https://*/*'],permissions:[]}).then(()=>done(true),e=>done(String(e)));`,
      id,
    );
    await driver.switchTo().window(websiteTab);
    await click("#dock");
    await evaluate(
      "await Promise.all(arguments[0].getAnimations({subtree:true}).map(a=>a.finished));return true;",
      await element("#radial"),
    );
    await click("[data-op=toggle-lights]");
    await driver.switchTo().window(appTab);
    await driver.wait(
      async () =>
        (await send({ type: "snapshot" })).website.sites["127.0.0.1"]
          ?.lights === "on",
      5000,
    );
    await driver.switchTo().window(websiteTab);
    await driver.wait(
      () =>
        driver.executeScript(
          'return document.documentElement.dataset.darkreaderMode === "dynamic";',
        ),
      10000,
    );
    await driver.switchTo().window(appTab);
    await send({ type: "website.update", tabId, patch: { lights: "off" } });
    await driver.switchTo().window(websiteTab);
    await driver.wait(
      () =>
        driver.executeScript(
          "return !document.documentElement.dataset.darkreaderMode;",
        ),
      10000,
    );
    await driver.switchTo().window(appTab);
    assert((await send({ type: "usage.list" })).length > 0);
    await driver.navigate().refresh();
    await driver.wait(
      () =>
        driver
          .findElements(By.css(".sidebar"))
          .then((elements) => elements.length),
      10000,
    );
    assert.equal(
      (await send({ type: "snapshot" })).connections[0].name,
      "Changed on another extension page",
    );
    const shortcutPage = await evaluate(
      `const {openShortcutSettings}=await import('./browser.js');await openShortcutSettings();return true;`,
    );
    assert.equal(shortcutPage, true);
    assert.equal(
      await privileged(
        `arguments[arguments.length-1](gBrowser.browsers.some(b=>b.currentURI.spec==='about:addons'));`,
      ),
      true,
    );
    console.log(
      "Firefox: HTTP provider connection and generation, model storage, custom text and inline page translation, Q&A, usage, dark mode, sync encryption, cross-page updates and content-script isolation passed.",
    );
  } catch (error) {
    if (driver) {
      console.error("Failure URL:", await driver.getCurrentUrl());
      await driver.setContext(firefox.Context.CHROME);
      console.error(
        "Firefox errors:",
        await driver.executeScript(
          'return Services.console.getMessageArray().filter(m=>m.message.includes("moz-extension:")).map(m=>m.message).slice(-12);',
        ),
      );
      await driver.setContext(firefox.Context.CONTENT);
      console.error(
        "Page text:",
        (await driver.findElement(By.css("body")).getText()).slice(-400),
      );
      fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "artifacts/firefox-failure.png"),
        await driver.takeScreenshot(),
        "base64",
      );
    }
    throw error;
  } finally {
    await driver?.quit();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
