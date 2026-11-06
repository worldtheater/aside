const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({ page, context, origin }) => {
  const source = await context.newPage();
  const url = origin + "/native-recovery";
  await source.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta charset="utf-8"><title>Translation recovery</title><style>
      body{margin:24px;font:17px/1.5 system-ui}main{max-width:720px}p{min-height:240px}
      </style></head><body><main><h1>Continue reading after a translation failure</h1>
      ${Array.from({ length: 24 }, (_, i) => `<p id="row-${i}">Recovery paragraph ${i} with original reading content.</p>`).join("")}
      </main></body></html>`,
    }),
  );
  try {
    await source.goto(url);
    const host = source.locator("[data-pagework=ui]");
    await host.waitFor({ state: "attached" });
    const tabId = await page.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      url,
    );
    await page.evaluate(
      (tabId) =>
        chrome.scripting.executeScript({
          target: { tabId },
          world: "ISOLATED",
          func: () => {
            const fixture = (globalThis.recoveryFixture = {
              calls: [],
              failures: 0,
              failText: "Recovery paragraph 8 ",
              detectFails: false,
              detections: 0,
              holdText: null,
              created: 0,
              destroyed: 0,
            });
            addEventListener("pagehide", () => {
              sessionStorage.setItem(
                "native-session-cleanup",
                JSON.stringify({
                  created: fixture.created,
                  destroyed: fixture.destroyed,
                }),
              );
            });
            globalThis.Translator = {
              availability: async () => "available",
              create: async () => {
                fixture.created++;
                return {
                  translate: async (text) => {
                    fixture.calls.push(text);
                    if (fixture.failText && text.includes(fixture.failText)) {
                      fixture.failures++;
                      throw new DOMException(
                        "Other generic failures occurred.",
                        "UnknownError",
                      );
                    }
                    if (fixture.holdText && text.includes(fixture.holdText)) {
                      fixture.holding = true;
                      // Deliberately resolve after cancellation to check stale-result isolation.
                      return new Promise((resolve) => {
                        fixture.finishHeld = () => resolve("本地译文：" + text);
                      });
                    }
                    return "本地译文：" + text;
                  },
                  destroy() {
                    fixture.destroyed++;
                  },
                };
              },
            };
            globalThis.LanguageDetector = {
              availability: async () => "available",
              create: async () => ({
                detect: async () => {
                  fixture.detections++;
                  if (fixture.detectFails)
                    throw new Error("Detector fixture failure");
                  return [{ detectedLanguage: "en", confidence: 1 }];
                },
                destroy() {},
              }),
            };
          },
        }),
      tabId,
    );
    const configure = (patch) =>
      page.evaluate(
        ({ tabId, patch }) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            args: [patch],
            func: (patch) => {
              Object.assign(recoveryFixture, patch);
            },
          }),
        { tabId, patch },
      );
    const state = () =>
      page.evaluate(async (tabId) => {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "ISOLATED",
          func: () => {
            return {
              calls: recoveryFixture.calls,
              failures: recoveryFixture.failures,
              detections: recoveryFixture.detections,
              holding: recoveryFixture.holding,
              failText: recoveryFixture.failText,
              holdText: recoveryFixture.holdText,
              created: recoveryFixture.created,
              destroyed: recoveryFixture.destroyed,
            };
          },
        });
        return result.result;
      }, tabId);
    const start = (sourceLanguage = "en") =>
      page.evaluate(
        ({ tabId, sourceLanguage }) =>
          chrome.runtime.sendMessage({
            type: "tab.run",
            tabId,
            actionId: "translate",
            panel: false,
            translation: { sourceLanguage, targetLanguage: "fr" },
          }),
        { tabId, sourceLanguage },
      );
    const restore = () =>
      page.evaluate(
        (tabId) => chrome.runtime.sendMessage({ type: "tab.restore", tabId }),
        tabId,
      );
    const result = (index) =>
      source.locator(`#row-${index} > [data-pagework=result]`);
    const notice = host.locator("#translation-recovery");
    const retry = notice.locator("[data-op=retry-page]");
    const paused = async () => {
      await retry.waitFor();
      await host
        .locator("[data-op=page-translate][data-translation-state=paused]")
        .waitFor({ state: "attached" });
      assert.equal(
        await host.locator("#toolbar").getAttribute("aria-busy"),
        "false",
      );
      assert((await notice.textContent()).includes("翻译已暂停"));
    };

    await host.locator("#dock").click();
    assert((await start()).ok);
    await result(0).waitFor();
    assert.equal((await state()).created, 1);
    assert.equal((await state()).destroyed, 0);
    await result(0).evaluate((node) => {
      globalThis.firstRecoveryResult = node;
    });
    const failedLog = source.waitForEvent("console", {
      predicate: (message) =>
        message.type() === "error" &&
        message.text().startsWith("[Aside] Native translation failed"),
    });
    await source.locator("#row-8").scrollIntoViewIfNeeded();
    await paused();
    const diagnostic = await (await failedLog).args()[1].jsonValue();
    assert.equal(diagnostic.stage, "translate");
    assert.equal(diagnostic.sourceLanguage, "en");
    assert.equal(diagnostic.targetLanguage, "fr");
    assert.equal(
      diagnostic.texts[diagnostic.failedTextIndex],
      "Recovery paragraph 8 with original reading content.",
    );
    assert(
      (await notice.textContent()).includes(
        "UnknownError: Other generic failures occurred.",
      ),
      "The native exception must reach the recovery notice through the task port",
    );
    assert.equal((await state()).failures, 1);
    assert.equal(
      (await state()).created,
      1,
      "Scrolling reuses the first translator",
    );
    assert.equal(
      (await state()).destroyed,
      1,
      "Failure releases the damaged instance",
    );
    const failedCalls = (await state()).calls.length;
    await source.evaluate(() => {
      location.hash = "row-16";
    });
    await source.waitForURL("**#row-16");
    // The previous toast disappeared after 2.5 seconds. This recovery action persists.
    await source.waitForTimeout(2800);
    assert(await retry.isVisible());
    assert.equal(
      (await state()).calls.length,
      failedCalls,
      "Scrolling while paused sends no requests",
    );
    assert.equal(await result(16).count(), 0);
    await notice.screenshot({
      path: path.join(__dirname, "../artifacts/translation-paused-light.png"),
    });
    await source.emulateMedia({ colorScheme: "dark" });
    await source
      .locator("[data-pagework=ui][data-theme=dark]")
      .waitFor({ state: "attached" });
    await notice.screenshot({
      path: path.join(__dirname, "../artifacts/translation-paused-dark.png"),
    });
    await source.emulateMedia({ colorScheme: "light" });

    await source.locator("#row-8").scrollIntoViewIfNeeded();
    await retry.click();
    await paused();
    assert.equal(
      (await state()).failures,
      2,
      "An unsuccessful retry pauses again without a loop",
    );
    assert.equal((await state()).created, 2);
    assert.equal((await state()).destroyed, 2);
    await configure({ failText: "" });
    await source.locator("#row-8").evaluate((node) => {
      node.textContent = "Updated recovery paragraph 8.";
    });
    await source.locator("#row-16").scrollIntoViewIfNeeded();
    await retry.click();
    await result(16).waitFor();
    await notice.waitFor({ state: "hidden" });
    await source.locator("#row-8").scrollIntoViewIfNeeded();
    await result(8).waitFor();
    assert.equal(
      (await state()).created,
      3,
      "Retry creates one fresh shared instance",
    );
    assert.equal((await state()).destroyed, 2);
    assert(
      (
        await result(8).evaluate((node) => node.shadowRoot.textContent)
      ).includes("Updated recovery paragraph 8."),
    );
    assert(
      await result(0).evaluate(
        (node) => node === globalThis.firstRecoveryResult,
      ),
      "Completed DOM results stay in place",
    );
    assert.equal(
      (await state()).calls.filter((text) =>
        text.startsWith("Recovery paragraph 0 "),
      ).length,
      1,
    );

    await configure({ failText: "Second failure" });
    await source.locator("#row-8").evaluate((node) => {
      node.textContent = "Second failure paragraph.";
    });
    await paused();
    await notice.locator("[data-op=restore]").click();
    await notice.waitFor({ state: "hidden" });
    assert.equal(await source.locator("[data-pagework=result]").count(), 0);
    const stoppedCalls = (await state()).calls.length;
    await source.locator("#row-20").scrollIntoViewIfNeeded();
    await source.waitForTimeout(300);
    assert.equal((await state()).calls.length, stoppedCalls);

    // A rejected language-detection promise must not poison every retry.
    await configure({ failText: "", detectFails: true });
    await source.evaluate(() => scrollTo(0, 0));
    assert((await start("auto")).ok);
    await paused();
    assert(
      (await notice.textContent()).includes("Error: Detector fixture failure"),
    );
    assert.equal((await state()).detections, 1);
    await configure({ detectFails: false });
    await source.keyboard.press("Escape");
    await host.locator("#dock").click();
    const radial = host.locator("#radial [data-op=page-translate]");
    assert.equal(
      await radial.getAttribute("aria-label"),
      "翻译已暂停 · 重试并继续",
    );
    await radial.click();
    await result(0).waitFor();
    await notice.waitFor({ state: "hidden" });
    assert.equal((await state()).detections, 2);

    // Restoring after retry also cancels the resumed operation.
    await configure({ failText: "Delayed native retry" });
    await source.locator("#row-0").evaluate((node) => {
      node.textContent = "Delayed native retry.";
    });
    await paused();
    await configure({ failText: "", holdText: "Delayed native retry" });
    await retry.click();
    for (let i = 0; i < 100 && !(await state()).holding; i++)
      await source.waitForTimeout(50);
    assert((await state()).holding, JSON.stringify(await state()));
    await source.locator("#row-20").evaluate((node) => {
      node.textContent = "Queued while the shared translator is busy.";
    });
    await source.locator("#row-20").scrollIntoViewIfNeeded();
    await source.waitForTimeout(300);
    assert(
      !(await state()).calls.includes(
        "Queued while the shared translator is busy.",
      ),
    );
    const beforeStop = await state();
    assert.equal(beforeStop.created - beforeStop.destroyed, 1);
    await restore();
    assert.equal((await state()).created, (await state()).destroyed);
    await page.evaluate(
      (tabId) =>
        chrome.scripting.executeScript({
          target: { tabId },
          world: "ISOLATED",
          func: () => recoveryFixture.finishHeld(),
        }),
      tabId,
    );
    await source.waitForTimeout(200);
    assert.equal(await source.locator("[data-pagework=result]").count(), 0);
    assert(await notice.isHidden());
    assert.equal((await state()).created, beforeStop.created);

    await configure({ holdText: "" });
    const startFresh = async (text) => {
      await source.evaluate(() => scrollTo(0, 0));
      await source.locator("#row-0").evaluate((node, text) => {
        node.textContent = text;
      }, text);
      assert((await start()).ok);
      await result(0).waitFor();
      const active = await state();
      assert.equal(active.created - active.destroyed, 1);
      await page.evaluate(
        (tabId) => chrome.tabs.sendMessage(tabId, { type: "ui.show" }),
        tabId,
      );
    };
    await startFresh("Stop a healthy native session.");
    await host.locator("#toolbar [data-op=run]").click();
    assert.equal((await state()).created, (await state()).destroyed);
    assert.equal(
      await result(0).count(),
      1,
      "Stop preserves the completed result",
    );

    await startFresh("Switch languages during a native session.");
    await host
      .locator("#toolbar [data-language=targetLanguage]")
      .selectOption("ja");
    assert.equal((await state()).created, (await state()).destroyed);
    assert.equal(await result(0).count(), 0);
    await host.locator("#toolbar [data-op=run]").click();
    await result(0).waitFor();
    assert.equal((await state()).created - (await state()).destroyed, 1);

    // Genuine application-route changes release the session; document anchors
    // were already checked above while the translation was paused.
    await source.evaluate(() =>
      history.pushState({}, "", "/native-next-route"),
    );
    assert.equal((await state()).created, (await state()).destroyed);
    await startFresh("Leave the document with a native translator alive.");
    await source.goto(origin + "/native-next-document");
    const cleanup = await source.evaluate(() =>
      JSON.parse(sessionStorage.getItem("native-session-cleanup")),
    );
    assert.equal(
      cleanup.created,
      cleanup.destroyed,
      "Leaving the document releases the translator",
    );
    console.log(
      "Native recovery: session reuse, failure/retry cleanup, serialized scrolling, stop, language change, route/document navigation, preserved results and late-result cancellation pass.",
    );
  } finally {
    await source.close();
  }
};
