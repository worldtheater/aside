const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({
  page,
  context,
  extensionId,
  origin,
  calls,
  streams,
  artifacts,
}) => {
  const source = await context.newPage();
  const errors = [];
  source.on("pageerror", (error) => errors.push(error.message));
  await source.goto(origin + "/tools-page");
  const host = source.locator("[data-pagework=ui]");
  const dock = host.locator("#dock");
  const panel = host.locator("#toolbar");
  await dock.waitFor();
  const tabId = await page.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
    source.url(),
  );
  const openTools = async () => {
    const result = await page.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: "tab.enable", tabId }),
      tabId,
    );
    assert(result.ok, JSON.stringify(result));
  };
  const before = calls.length;
  assert(await panel.isHidden());
  assert((await dock.boundingBox()).width <= 40);
  await source.screenshot({ path: path.join(artifacts, "floating-entry.png") });
  await dock.click();
  assert(
    await host.locator("#radial").evaluate((n) => n.classList.contains("open")),
  );
  await openTools();
  assert(
    !(await host
      .locator("#radial")
      .evaluate((n) => n.classList.contains("open"))),
  );
  assert(await panel.isVisible());
  assert.equal(await dock.getAttribute("aria-expanded"), "true");
  assert.equal(await host.locator("[data-language]").count(), 2);
  await host.locator("[data-language=sourceLanguage]").selectOption("en");
  await host.locator("[data-language=targetLanguage]").selectOption("en");
  assert(await panel.locator("[data-op=run]").isDisabled());
  assert(
    (await host.locator("#status").textContent()).includes(
      "源语言和目标语言相同",
    ),
  );
  assert.equal(calls.length, before);
  // The host also rejects an invalid pair, even when no UI validation runs.
  const invalid = await page.evaluate(
    async (tabId) =>
      chrome.runtime.sendMessage({
        type: "tab.run",
        tabId,
        actionId: "translate",
        scope: "body",
        translation: { sourceLanguage: "en", targetLanguage: "en" },
      }),
    tabId,
  );
  assert.equal(invalid.error, "sameLanguages");
  const blockedProcess = await page.evaluate(async () => {
    const { processRequest } = await import("./client.js");
    try {
      await processRequest({
        actionId: "translate",
        translation: { sourceLanguage: "ja", targetLanguage: "ja" },
        blocks: [{ id: "a", text: "same language" }],
      }).promise;
      return null;
    } catch (error) {
      return error.code;
    }
  });
  assert.equal(blockedProcess, "sameLanguages");
  assert.equal(calls.length, before);
  await source.screenshot({
    path: path.join(artifacts, "floating-language-warning.png"),
  });
  await host.locator("[data-language=targetLanguage]").selectOption("ja");
  await panel.locator("[data-op=run]").click();
  await host.locator("#status").filter({ hasText: "处理完成" }).waitFor();
  assert(
    calls
      .slice(before)
      .every((call) =>
        call.body.messages[0].content.includes(
          "from English (en) into Japanese (ja)",
        ),
      ),
  );
  await source.screenshot({ path: path.join(artifacts, "floating-tools.png") });
  await host.locator("[data-op=hide-toolbar]").click();
  assert(await dock.isVisible());
  assert(await panel.isHidden());
  await dock.focus();
  await source.keyboard.press("Enter");
  assert(
    await host.locator("#radial").evaluate((n) => n.classList.contains("open")),
  );
  await openTools();
  assert(
    !(await host
      .locator("#radial")
      .evaluate((n) => n.classList.contains("open"))),
  );
  assert(await panel.isVisible());
  await source.keyboard.press("Escape");
  assert(await panel.isHidden());
  const drag = await dock.boundingBox();
  await source.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2);
  await source.mouse.down();
  await source.mouse.move(14, 80, { steps: 10 });
  await source.mouse.up();
  assert.equal(await dock.getAttribute("data-side"), "left");
  assert(
    await panel.isHidden(),
    "Dragging does not activate the floating entry",
  );
  await source.setViewportSize({ width: 390, height: 640 });
  await dock.focus();
  await source.keyboard.press("Enter");
  assert(
    await host.locator("#radial").evaluate((n) => n.classList.contains("open")),
  );
  await openTools();
  assert(
    !(await host
      .locator("#radial")
      .evaluate((n) => n.classList.contains("open"))),
  );
  await panel.waitFor();
  const bounds = await panel.boundingBox();
  assert(
    bounds.x >= 0 &&
      bounds.x + bounds.width <= 390 &&
      bounds.y >= 0 &&
      bounds.y + bounds.height <= 640,
  );
  assert(
    await source.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await source.screenshot({
    path: path.join(artifacts, "floating-tools-mobile.png"),
  });
  await source.mouse.click(380, 620);
  assert(await panel.isHidden());
  await source.setViewportSize({ width: 1440, height: 1000 });
  await source.reload();
  await dock.waitFor();
  assert(await panel.isHidden());
  assert.equal(await host.count(), 1);

  // A hidden source setting must not block the simplified popup. Its automatic
  // detection is an invocation override, leaving the saved action unchanged.
  const savedTranslation = await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    const action = settings.actions.find((a) => a.kind === "translate");
    await chrome.storage.local.set({
      settings: {
        ...settings,
        actions: settings.actions.map((a) =>
          a.id === action.id
            ? { ...a, sourceLanguage: "en", targetLanguage: "en" }
            : a,
        ),
      },
    });
    return action;
  });

  // Native extension popups are CDP "other" targets, not Playwright tab pages.
  const cdp = await context.browser().newBrowserCDPSession();
  let target, sessionId;
  let nextId = 0;
  const pending = new Map();
  cdp.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message),
      result = pending.get(message.id);
    if (!result) return;
    pending.delete(message.id);
    if (message.error) result.reject(new Error(message.error.message));
    else result.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      cdp
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch(reject);
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const click = async (selector) => {
    const rect = await evaluate(
      `(async()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:"nearest"});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...rect,
      button: "left",
      clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...rect,
      button: "left",
      clickCount: 1,
    });
    if (selector !== "[data-op=run]")
      await evaluate(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))",
      );
  };
  const choose = async (selector, value) => {
    const id = await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).id`,
    );
    await click(`[data-select-for="${id}"]`);
    await click(`[role=option][data-value="${value}"]`);
    const actual = await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).value`,
    );
    if (actual !== value) await screenshot("popup-menu-failure.png");
    assert.equal(actual, value);
  };
  const screenshot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    require("node:fs").writeFileSync(
      path.join(artifacts, name),
      Buffer.from(data, "base64"),
    );
  };
  const openPopup = async () => {
    await source.bringToFront();
    await page.evaluate(() => chrome.action.openPopup());
    const { targetInfos } = await cdp.send("Target.getTargets");
    target = targetInfos.find(
      (info) => info.url === `chrome-extension://${extensionId}/popup.html`,
    );
    assert(target, JSON.stringify(targetInfos));
    ({ sessionId } = await cdp.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    }));
    await evaluate(`new Promise(resolve => {
      const ready = () => document.querySelector('#action') ? resolve(true) : requestAnimationFrame(ready);
      ready();
    })`);
  };
  await openPopup();
  assert(await evaluate('!!document.querySelector("#action")'));
  assert.equal(
    await evaluate('document.querySelectorAll("[data-op=enable]").length'),
    0,
  );
  assert.equal(
    await evaluate('document.querySelectorAll("#languages select").length'),
    1,
  );
  assert.equal(
    await evaluate('document.querySelectorAll("[data-feature-scope]").length'),
    0,
  );
  assert.deepEqual(
    await evaluate(
      'Array.from(document.querySelectorAll("[data-feature-group] input[type=checkbox]"), node => node.dataset.feature)',
    ),
    ["toolbar", "floating"],
  );
  await screenshot("popup-website-controls.png");
  assert(
    await evaluate(`(()=>{
    const controls=Array.from(document.querySelectorAll('[data-feature-group] input[type=checkbox]'));
    return controls.every(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})&&document.querySelector('.popup-header').getBoundingClientRect().top===0;
  })()`),
    "Native popup keeps the website switches in the available viewport",
  );
  assert.equal(
    await evaluate(
      'document.querySelectorAll("#scope,[data-language=sourceLanguage]").length',
    ),
    0,
  );
  assert(!(await evaluate('document.querySelector("[data-op=run]").disabled')));
  await choose("#action", "explain");
  assert.equal(
    await evaluate('document.querySelectorAll("#languages select").length'),
    0,
  );
  assert(!(await evaluate('document.querySelector("[data-op=run]").disabled')));
  await choose("#action", "translate");
  await choose("[data-language=targetLanguage]", "fr");
  assert(!(await evaluate('document.querySelector("[data-op=run]").disabled')));
  await screenshot("popup-translation.png");
  const popupCount = calls.length;
  await click("[data-op=run]");
  await host
    .locator("#status")
    .filter({ hasText: "处理完成" })
    .waitFor({ state: "attached" });
  assert(
    await panel.isHidden(),
    "Running from the browser popup does not open the page controls",
  );
  assert.equal(await dock.getAttribute("aria-expanded"), "false");
  assert(await host.locator("#result.panel").isVisible());
  assert.equal(
    await source.locator("[data-pagework=result]").count(),
    0,
    "The popup opens a result panel instead of inserting translations into the page",
  );
  assert.equal(
    await host
      .locator(".result .selection-result-body")
      .evaluate((node) => getComputedStyle(node).paddingTop),
    "0px",
  );
  assert(
    (await host.locator(".original").textContent()).includes(
      "Reading is active thinking.",
    ),
  );
  assert(
    !(await host.locator(".original").textContent()).includes("Navigation"),
  );
  await source.screenshot({
    path: path.join(artifacts, "popup-translated-page.png"),
  });
  assert(calls.length > popupCount);
  assert(
    calls
      .slice(popupCount)
      .every((call) =>
        call.body.messages[0].content.includes(
          "from the detected source language into French (fr)",
        ),
      ),
  );
  assert.equal(
    await host.locator("[data-language=targetLanguage]").inputValue(),
    "fr",
  );
  assert(
    !(await cdp.send("Target.getTargets")).targetInfos.some(
      (info) => info.targetId === target.targetId,
    ),
  );
  assert.equal(
    await source.locator("nav [data-pagework=result]").count(),
    0,
    "The popup processes the main content, excluding navigation",
  );
  await page.evaluate(async (saved) => {
    const { settings } = await chrome.storage.local.get("settings");
    const action = settings.actions.find((a) => a.id === saved.id);
    if (action.sourceLanguage !== "en" || action.targetLanguage !== "en")
      throw Error("Popup language changes must not rewrite the saved action");
    await chrome.storage.local.set({
      settings: {
        ...settings,
        actions: settings.actions.map((a) => (a.id === saved.id ? saved : a)),
      },
    });
  }, savedTranslation);
  // Popup Q&A quotes the selection and waits for a separate, explicit question.
  const quoted = await source.locator("#first").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return node.textContent;
  });
  await openPopup();
  await choose("#action", "qa");
  const beforeQuestion = calls.length;
  await click("[data-op=run]");
  const composer = host.locator("#question");
  await composer.waitFor();
  const popupResult = host.locator("#result.panel");
  assert(await popupResult.isVisible());
  assert(
    await host.locator("#selection").isHidden(),
    "Popup Q&A uses the independent result window",
  );
  assert.equal(await host.locator("#selection #question").count(), 0);
  const qaName = await page.evaluate(
    async () =>
      (
        await chrome.runtime.sendMessage({ type: "settings.public" })
      ).value.actions.find((a) => a.id === "qa").name,
  );
  assert.equal(
    await popupResult.locator(".header strong").textContent(),
    qaName,
  );
  let composerBounds = await popupResult.boundingBox();
  assert(
    composerBounds.x > source.viewportSize().width / 2,
    "Popup Q&A opens in the right-hand result window rather than the upper-left toolbar",
  );
  const sharedAppearance = await popupResult.evaluate((node) => {
    const toolbar = node.getRootNode().querySelector("#selection");
    const actual = getComputedStyle(node),
      reference = getComputedStyle(toolbar);
    const keys = [
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "boxShadow",
      "borderRadius",
      "paddingTop",
      "paddingRight",
      "paddingLeft",
      "gap",
    ];
    const button = getComputedStyle(node.querySelector(".header button"));
    const toolbarButton = getComputedStyle(
      toolbar.querySelector(".selection-button"),
    );
    return {
      matchingSurface: keys.every((key) => actual[key] === reference[key]),
      border: actual.borderTopWidth,
      matchingButton: ["width", "height", "padding", "borderRadius"].every(
        (key) => button[key] === toolbarButton[key],
      ),
    };
  });
  assert.deepEqual(sharedAppearance, {
    matchingSurface: true,
    border: "0px",
    matchingButton: true,
  });
  assert.equal(
    calls.length,
    beforeQuestion,
    "Opening Q&A never sends page text to the model",
  );
  assert.equal(await composer.locator("#question-quote").textContent(), quoted);
  assert.equal(await composer.locator("textarea").inputValue(), "");
  assert(await composer.locator("[data-op=question-run]").isDisabled());
  const input = composer.locator("textarea");
  assert.equal(
    await input.evaluate((node) => getComputedStyle(node).resize),
    "none",
  );
  const initialInput = await input.boundingBox();
  assert(initialInput.height >= 96);
  await input.fill(
    Array.from({ length: 10 }, (_, i) => `Question line ${i + 1}`).join("\n"),
  );
  const grownInput = await input.boundingBox();
  assert(
    grownInput.height > initialInput.height + 80,
    "Question input grows with its content",
  );
  assert(
    await input.evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
  );
  await input.fill("");
  assert(
    Math.abs((await input.boundingBox()).height - initialInput.height) < 1,
    "Clearing the question restores its minimum height",
  );
  const assertFooter = async (result, question = false) => {
    const geometry = await result.evaluate((node, question) => {
      const footer = node.querySelector(
        question ? ".selection-settings-footer" : ".selection-result-footer",
      );
      const button = footer.querySelector(
        question
          ? "[data-op=question-run]"
          : ".selection-result-actions button:not([hidden])",
      );
      const grip = footer.querySelector(".selection-resize");
      const box = button.getBoundingClientRect();
      const handle = grip.getBoundingClientRect();
      return {
        top:
          box.top -
          footer.getBoundingClientRect().top -
          parseFloat(getComputedStyle(footer).borderTopWidth),
        bottom: node.getBoundingClientRect().bottom - box.bottom,
        alignment: Math.abs(
          handle.top + handle.height / 2 - box.top - box.height / 2,
        ),
        resize: getComputedStyle(node).resize,
      };
    }, question);
    assert(
      Math.abs(geometry.top - geometry.bottom) < 1,
      JSON.stringify(geometry),
    );
    assert(
      geometry.alignment < 1,
      "Resize grip shares the action row: " + JSON.stringify(geometry),
    );
    assert.equal(
      geometry.resize,
      "none",
      "The panel uses the shared resize grip",
    );
  };
  await assertFooter(popupResult, true);
  await source.screenshot({ path: path.join(artifacts, "popup-qa-quote.png") });
  // Submitting and regenerating keep the same independent window and its position.
  const grip = await popupResult.locator(".header").boundingBox();
  await source.mouse.move(grip.x + 30, grip.y + grip.height / 2);
  await source.mouse.down();
  await source.mouse.move(grip.x - 50, grip.y - 60 + grip.height / 2, {
    steps: 6,
  });
  await source.mouse.up();
  composerBounds = await popupResult.boundingBox();
  const beforeResize = await popupResult.boundingBox();
  await popupResult.locator(".selection-resize").press("Shift+ArrowLeft");
  await popupResult.locator(".selection-resize").press("Shift+ArrowDown");
  const afterResize = await popupResult.boundingBox();
  assert(Math.abs(afterResize.width - beforeResize.width + 40) < 1);
  assert(Math.abs(afterResize.height - beforeResize.height - 40) < 1);
  assert.equal(
    (await input.boundingBox()).height,
    initialInput.height,
    "Resizing the panel does not stretch the empty question",
  );
  const handle = await popupResult.locator(".selection-resize").boundingBox();
  await source.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await source.mouse.down();
  await source.mouse.move(
    handle.x + handle.width / 2 + 70,
    handle.y + handle.height / 2 + 30,
    { steps: 6 },
  );
  await source.mouse.up();
  const resized = await popupResult.boundingBox();
  assert(Math.abs(resized.width - afterResize.width - 70) < 2);
  assert(Math.abs(resized.height - afterResize.height - 30) < 2);
  assert.equal((await input.boundingBox()).height, initialInput.height);
  await assertFooter(popupResult, true);
  composerBounds = resized;
  const question = "What does active thinking mean? POPUP_QUESTION";
  await composer.locator("textarea").fill(question);
  assert.equal(
    calls.length,
    beforeQuestion,
    "Typing a question does not submit it",
  );
  await composer.locator("textarea").press("Meta+Enter");
  await host
    .locator("#result-status")
    .filter({ hasText: "处理完成" })
    .waitFor();
  const questionInput = calls.at(-1).body.messages.at(-1).content;
  assert(questionInput.includes(question));
  assert(questionInput.includes(`> ${quoted}`));
  assert(await popupResult.isVisible());
  assert(await host.locator("#selection").isHidden());
  assert.equal(
    await popupResult.locator(".header strong").textContent(),
    qaName,
  );
  await assertFooter(popupResult);
  const answerBounds = await popupResult.boundingBox();
  assert(
    Math.abs(answerBounds.x - composerBounds.x) < 1 &&
      Math.abs(answerBounds.y - composerBounds.y) < 1,
    "The answer stays in the same dragged result window",
  );
  await popupResult.locator("[data-op=refresh-result]").click();
  await popupResult
    .locator("#result-status")
    .filter({ hasText: "处理完成" })
    .waitFor();
  assert(await popupResult.isVisible());
  assert(await host.locator("#selection").isHidden());
  const regeneratedBounds = await popupResult.boundingBox();
  assert(
    Math.abs(regeneratedBounds.x - composerBounds.x) < 1 &&
      Math.abs(regeneratedBounds.y - composerBounds.y) < 1,
  );
  await popupResult.screenshot({
    path: path.join(artifacts, "popup-qa-result.png"),
  });
  await source.keyboard.press("Escape");
  await source.evaluate(() => getSelection().removeAllRanges());

  // With no selection the main page content is the quote, not a question.
  await source.reload();
  await dock.waitFor();
  await source.setViewportSize({ width: 390, height: 640 });
  await openPopup();
  await choose("#action", "qa");
  const beforePageQuestion = calls.length;
  await click("[data-op=run]");
  await composer.waitFor();
  const pageQuote = await composer.locator("#question-quote").textContent();
  assert(pageQuote.includes("Read carefully") && pageQuote.includes(quoted));
  assert(
    !pageQuote.includes("Navigation") && !pageQuote.includes("FORM_SECRET"),
  );
  assert.equal(calls.length, beforePageQuestion);
  assert.equal(await composer.locator("textarea").inputValue(), "");
  const compact = await popupResult.boundingBox();
  assert(
    compact.x >= 0 &&
      compact.y >= 0 &&
      compact.x + compact.width <= 390 &&
      compact.y + compact.height <= 640,
  );
  const inputBox = await composer.locator("textarea").boundingBox();
  const footerBox = await composer
    .locator(".selection-settings-footer")
    .boundingBox();
  assert(
    inputBox.height >= 96 && inputBox.y + inputBox.height <= footerBox.y,
    "The complete question input stays above the footer on a narrow screen",
  );
  await source.screenshot({
    path: path.join(artifacts, "popup-qa-mobile.png"),
  });
  await composer.locator("[data-op=question-close]").click();
  await source.setViewportSize({ width: 1440, height: 1000 });

  const nextStream = async (start) => {
    for (let attempt = 0; attempt < 60 && streams.length === start; attempt++)
      await source.waitForTimeout(50);
    assert(streams.length > start, "The controlled model stream was started");
    return streams.at(-1);
  };
  for (const action of ["translate", "plain", "explain", "summary"]) {
    const text = `STREAM_FIXTURE_WAIT popup-${action}`;
    await source.locator("main").evaluate((main, text) => {
      main.replaceChildren(
        Object.assign(document.createElement("p"), { textContent: text }),
      );
    }, text);
    await openPopup();
    await choose("#action", action);
    const start = streams.length;
    await click("[data-op=run]");
    const result = host.locator("#result.panel");
    await result.waitFor();
    const output = result.locator("#output");
    await result
      .locator("#output[aria-busy=true]")
      .waitFor({ state: "attached" });
    assert.equal(
      await output.textContent(),
      "",
      "The panel is visible before the first response byte",
    );
    assert.equal(await result.locator(".original").textContent(), text);
    assert.equal(
      await result.evaluate((node) => getComputedStyle(node).borderTopWidth),
      "0px",
    );
    assert.equal(
      await result
        .locator(".header button")
        .first()
        .evaluate((node) => getComputedStyle(node).width),
      "32px",
    );
    assert(await result.locator("[data-op=bookmark]").isDisabled());
    const stream = await nextStream(start);
    if (action === "explain")
      await result.screenshot({
        path: path.join(artifacts, "popup-panel-waiting.png"),
      });
    const element = await output.elementHandle();
    stream.write("## A partial answer");
    await output
      .locator("h2")
      .filter({ hasText: "A partial answer" })
      .waitFor();
    assert(
      !stream.closed,
      "Partial output is shown while the request is still running",
    );
    stream.write("\n\nMore streamed content.");
    await output.filter({ hasText: "More streamed content." }).waitFor();
    if (action === "explain")
      await result.screenshot({
        path: path.join(artifacts, "popup-panel-streaming.png"),
      });
    stream.finish();
    await result
      .locator("#result-status")
      .filter({ hasText: "处理完成" })
      .waitFor();
    assert(
      await element.evaluate((node) => node.isConnected),
      "Completing a stream preserves the panel DOM",
    );
    assert(await result.locator("[data-op=bookmark]").isEnabled());
    assert.equal(await source.locator("[data-pagework=result]").count(), 0);
    assert.equal(await output.getAttribute("aria-busy"), "false");
    assert(await result.locator("[data-op=stop-result]").isHidden());
    await assertFooter(result);
    const top = await result.locator(".original").evaluate((node) => {
      const body = node.parentElement;
      body.scrollTop = 0;
      return (
        node.getBoundingClientRect().top - body.getBoundingClientRect().top
      );
    });
    assert.equal(
      top,
      0,
      "The original text starts at the top of its content area",
    );
  }
  // Regeneration stays in the popup's result panel and can be stopped mid-stream.
  const beforeRegenerate = streams.length;
  await host.locator("#result [data-op=refresh-result]").click();
  await host.locator("#output[aria-busy=true]").waitFor({ state: "attached" });
  const regenerate = await nextStream(beforeRegenerate);
  regenerate.write("A stopped partial answer");
  await host
    .locator("#output")
    .filter({ hasText: "A stopped partial answer" })
    .waitFor();
  await host.locator("#result [data-op=stop-result]").click();
  await host.locator("#result-status").filter({ hasText: "已停止" }).waitFor();
  assert(await host.locator("#result [data-op=copy]").isDisabled());
  for (let i = 0; i < 30 && !regenerate.closed; i++)
    await source.waitForTimeout(50);
  assert(regenerate.closed, "Stopping the panel aborts the upstream request");
  await cdp.detach();
  assert.deepEqual(errors, []);
  await source.close();
  console.log(
    "PASS: automatic floating entry, drag/snap, keyboard/collapse, narrow viewport, reload; actual Chrome popup Q&A waits for an explicit question with selected/page quotes; all four processing actions open a panel before the first byte and stream without DOM replacement; source starts at the top; regenerate/stop; popup output language/main-content scope; toolbar and saved action unchanged.",
  );
};
