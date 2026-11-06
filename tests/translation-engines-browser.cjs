const assert = require("node:assert/strict");
module.exports = async ({ page, context, origin, calls, nav, op, choose }) => {
  // Start with an empty installation: neither engine needs an AI connection.
  const snapshot = (
    await page.evaluate(() => chrome.runtime.sendMessage({ type: "snapshot" }))
  ).value;
  assert.equal(snapshot.connections.length, 0);
  await nav("actions");
  await page.locator("[data-op=edit-action][data-id=translate]").click();
  await choose("#translation-engine", "browser");
  assert.equal(await page.locator("#instruction").count(), 0);
  assert.equal(await page.locator("[data-draft=model]").count(), 0);
  await choose("[data-language=sourceLanguage]", "en");
  await choose("[data-language=targetLanguage]", "zh-Hans");
  function installNativeFixture() {
    globalThis.nativeCalls = [];
    globalThis.nativeCreates = 0;
    globalThis.nativeDestroyed = 0;
    globalThis.Translator = {
      availability: async () => "available",
      create: async ({ sourceLanguage, targetLanguage }) => {
        globalThis.nativeCreates++;
        return {
          translate: async (text) => {
            globalThis.nativeCalls.push({
              text,
              sourceLanguage,
              targetLanguage,
            });
            return "本地译文：" + text;
          },
          destroy() {
            globalThis.nativeDestroyed++;
          },
        };
      },
    };
  }
  await page.evaluate(installNativeFixture);
  await page.locator("#test-input").fill("Editor trial without a model.");
  await op("test-run").click();
  await page
    .locator("#test-results")
    .filter({ hasText: "本地译文：Editor trial without a model." })
    .waitFor();
  assert.deepEqual(
    await page.evaluate(() => [nativeCreates, nativeDestroyed]),
    [1, 1],
  );
  // A finite task may also contain several native batches; it owns one instance
  // until the whole task is complete, independently of the reading session.
  await page
    .locator("#test-input")
    .fill(
      Array.from(
        { length: 500 },
        (_, i) => `Long native trial text. ${i} `,
      ).join(""),
    );
  await op("test-run").click();
  await page
    .locator("#test-results")
    .filter({ hasText: "本地译文：Long native trial text." })
    .waitFor();
  await page.waitForFunction(() => nativeDestroyed === 2);
  assert.deepEqual(
    await page.evaluate(() => [nativeCreates, nativeDestroyed]),
    [2, 2],
  );
  assert((await page.evaluate(() => nativeCalls.length)) > 3);
  await op("save").click();
  await page.locator("[data-op=edit-action][data-id=translate]").waitFor();
  const saved = (
    await page.evaluate(() => chrome.runtime.sendMessage({ type: "snapshot" }))
  ).value;
  assert.equal(
    saved.actions.find((a) => a.id === "translate").translationEngine,
    "browser",
  );

  const source = await context.newPage();
  const inspection = await context.newCDPSession(source);
  try {
    await source.goto(origin + "/native-engine");
    const host = source.locator("[data-pagework=ui]");
    await host.waitFor({ state: "attached" });
    await source.bringToFront();
    const tabId = await page.evaluate(
      async () =>
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
    );
    assert(
      await page.evaluate(
        (origin) => chrome.permissions.request({ origins: [origin + "/*"] }),
        origin,
      ),
    );
    // The product uses the content script's isolated world, never page scripts.
    await page.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: () => {
          globalThis.Translator = {
            availability: async () => "available",
            create: async ({ monitor }) => {
              const events = new EventTarget();
              monitor?.(events);
              for (const loaded of [0, 1]) {
                events.dispatchEvent(
                  Object.assign(new Event("downloadprogress"), { loaded }),
                );
                await new Promise((resolve) => requestAnimationFrame(resolve));
              }
              return {
                translate: async (text) => "本地译文：" + text,
                destroy() {},
              };
            },
          };
        },
      });
    }, tabId);
    const dock = host.locator("#dock");
    await dock.waitFor();
    // Observe in the existing test-only selector world; the UI root stays closed
    // to the web page and to the injected translation fixture.
    const contexts = [];
    inspection.on("Runtime.executionContextCreated", ({ context }) =>
      contexts.push(context),
    );
    await inspection.send("Runtime.enable");
    const utility = contexts.find((c) =>
      c.name.startsWith("__playwright_utility_world_"),
    );
    assert(utility);
    const observation = await inspection.send("Runtime.evaluate", {
      contextId: utility.id,
      expression: `(() => {
        const notice = document.querySelector('[data-pagework=ui]').shadowRoot.querySelector('.native-download');
        globalThis.nativeDownloadFlashes = 0;
        new MutationObserver(() => {
          if (!notice.hidden) globalThis.nativeDownloadFlashes++;
        }).observe(notice, { attributes: true, attributeFilter: ['hidden'] });
      })()`,
    });
    assert(
      !observation.exceptionDetails,
      JSON.stringify(observation.exceptionDetails),
    );
    await dock.focus();
    await source.keyboard.press("Enter");
    assert(await host.locator("#radial [data-op=page-translate]").isEnabled());
    assert(await host.locator("#radial [data-op=text-translate]").isEnabled());
    await host.locator("#radial [data-op=text-translate]").click();
    const panel = host.locator("#text-translation");
    await panel.waitFor();
    await panel
      .locator("[data-text-language=sourceLanguage]")
      .selectOption("en");
    await panel.locator("textarea").fill("Typed text without a key.");
    await panel.locator("[data-text-command=run]").click();
    await panel
      .locator(".output")
      .filter({ hasText: "本地译文：Typed text without a key." })
      .waitFor();
    await panel.locator("[data-text-command=close]").click();

    const result = await page.evaluate(
      (tabId) =>
        chrome.runtime.sendMessage({
          type: "tab.run",
          tabId,
          actionId: "translate",
          scope: "body",
          panel: false,
        }),
      tabId,
    );
    assert(result.ok, JSON.stringify(result));
    await source.locator("[data-pagework=result]").first().waitFor();
    await source.waitForFunction(() =>
      [...document.querySelectorAll("[data-pagework=result]")].some((n) =>
        n.shadowRoot.textContent.includes("本地译文："),
      ),
    );
    const {
      result: { value: flashes },
    } = await inspection.send("Runtime.evaluate", {
      contextId: utility.id,
      expression: "globalThis.nativeDownloadFlashes",
      returnByValue: true,
    });
    assert.equal(
      flashes,
      0,
      "Ready language packs must not flash a download notice",
    );
    assert.equal(
      calls.length,
      0,
      "Direct translation never invokes the AI model fixture",
    );
    const usage = (
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: "usage.list" }),
      )
    ).value;
    assert.equal(usage.length, 0, "No invented AI usage records");
    // Auto-detection must see the page, not isolated labels such as "Once".
    // A misdetected unsupported pair used to cancel the entire scroll session.
    await page.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: "tab.restore", tabId }),
      tabId,
    );
    await source.evaluate(() => {
      // Use a fresh label so the earlier explicit-language run cannot serve it from cache.
      document.querySelector("th").textContent = "Once";
      const late = document.createElement("p");
      late.id = "native-late";
      late.style.marginTop = "3000px";
      late.textContent =
        "This paragraph appears only after scrolling further down the page.";
      document.querySelector("main").append(late);
    });
    await page.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: () => {
          globalThis.nativePageTest = {
            detections: [],
            translations: [],
            destroyed: 0,
          };
          globalThis.LanguageDetector = {
            availability: async () => "available",
            create: async () => ({
              detect: async (text) => {
                globalThis.nativePageTest.detections.push(text);
                return [
                  {
                    detectedLanguage: text.includes(
                      "Reading is active thinking.",
                    )
                      ? "en"
                      : "it",
                    confidence: 1,
                  },
                ];
              },
              destroy: () => globalThis.nativePageTest.destroyed++,
            }),
          };
          globalThis.Translator = {
            availability: async ({ sourceLanguage }) =>
              sourceLanguage === "en" ? "available" : "unavailable",
            create: async ({ sourceLanguage, targetLanguage }) => ({
              translate: async (text) => {
                globalThis.nativePageTest.translations.push({
                  text,
                  sourceLanguage,
                  targetLanguage,
                });
                return "本地译文：" + text;
              },
              destroy() {},
            }),
          };
        },
      });
    }, tabId);
    const pageState = () =>
      page.evaluate(
        async (tabId) =>
          (
            await chrome.scripting.executeScript({
              target: { tabId },
              world: "ISOLATED",
              func: () => globalThis.nativePageTest,
            })
          )[0].result,
        tabId,
      );
    const startAutoPage = () =>
      page.evaluate(
        (tabId) =>
          chrome.runtime.sendMessage({
            type: "tab.run",
            tabId,
            actionId: "translate",
            scope: "body",
            panel: false,
            translation: { sourceLanguage: "auto", targetLanguage: "zh-Hans" },
          }),
        tabId,
      );
    assert((await startAutoPage()).ok);
    await source.locator("#first [data-pagework=result]").waitFor();
    await source.locator("th [data-pagework=result]").waitFor();
    const firstScreen = await pageState();
    assert.equal(firstScreen.detections.length, 1);
    assert(
      firstScreen.detections[0].includes(
        "This paragraph appears only after scrolling",
      ),
    );
    assert.equal(firstScreen.destroyed, 1);
    assert.equal(
      await source.locator("#native-late [data-pagework=result]").count(),
      0,
    );
    await source.locator("#native-late").scrollIntoViewIfNeeded();
    await source.locator("#native-late [data-pagework=result]").waitFor();
    const afterScroll = await pageState();
    assert.equal(
      afterScroll.detections.length,
      1,
      "Scrolling must reuse the resolved page language",
    );
    assert(
      afterScroll.translations.some(({ text }) => text === "Once"),
      JSON.stringify(afterScroll),
    );
    assert(
      afterScroll.translations.every(
        ({ sourceLanguage, targetLanguage }) =>
          sourceLanguage === "en" && targetLanguage === "zh",
      ),
    );

    // Restoring the page during detection cancels the session and prevents late jobs.
    await page.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: "tab.restore", tabId }),
      tabId,
    );
    await source.evaluate(() => {
      document.querySelector("#native-late").remove();
      window.scrollTo(0, 0);
    });
    await page.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: () => {
          globalThis.pageDetectionStarted = new Promise((started) => {
            globalThis.LanguageDetector.create = async () => ({
              detect: () =>
                new Promise((resolve) => {
                  globalThis.finishPageDetection = resolve;
                  started();
                }),
              destroy: () => globalThis.nativePageTest.destroyed++,
            });
          });
        },
      });
    }, tabId);
    assert((await startAutoPage()).ok);
    await page.evaluate(async (tabId) => {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: async () => {
          await globalThis.pageDetectionStarted;
          return typeof globalThis.finishPageDetection === "function";
        },
      });
      if (!result.result)
        throw new Error("Page language detection did not start");
    }, tabId);
    await page.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: "tab.restore", tabId }),
      tabId,
    );
    await page.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: async () => {
          globalThis.finishPageDetection([
            { detectedLanguage: "en", confidence: 1 },
          ]);
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        },
      });
    }, tabId);
    const afterCancel = await pageState();
    assert.equal(afterCancel.destroyed, 2);
    assert.equal(
      afterCancel.translations.length,
      afterScroll.translations.length,
    );
    assert.equal(await source.locator("[data-pagework=result]").count(), 0);
    console.log(
      "Native page language: one detection across short labels and scroll batches; pending detection cancels cleanly.",
    );
    await require("./native-packs-browser.cjs")({
      page,
      source,
      host,
      tabId,
      nav,
      choose,
    });
    await require("./page-translation-recovery-browser.cjs")({
      page,
      context,
      origin,
    });
    console.log(
      "Browser translation: editor, typed text and in-page translation work without AI configuration.",
    );
  } finally {
    await inspection.detach();
    await source.close();
  }
};
