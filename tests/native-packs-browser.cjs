const assert = require("node:assert/strict");
module.exports = async ({ page, source, host, tabId, nav, choose }) => {
  function installPacksFixture() {
    const ready = new Set(["en:zh"]);
    globalThis.preparedPacks = ready;
    globalThis.packPending = new Map();
    globalThis.Translator = {
      availability: async ({ sourceLanguage, targetLanguage }) =>
        ready.has(`${sourceLanguage}:${targetLanguage}`)
          ? "available"
          : "downloadable",
      create: ({ sourceLanguage, targetLanguage, signal, monitor }) => {
        const id = `${sourceLanguage}:${targetLanguage}`;
        const resource = {
          translate: async (text) => `local:${text}`,
          destroy() {},
        };
        if (ready.has(id)) return Promise.resolve(resource);
        const events = new EventTarget();
        monitor?.(events);
        return new Promise((resolve, reject) => {
          const abort = () => {
            globalThis.packPending.delete(id);
            reject(new DOMException("Aborted", "AbortError"));
          };
          signal.addEventListener("abort", abort, { once: true });
          globalThis.packPending.set(id, {
            emit(loaded) {
              const event = new Event("downloadprogress");
              event.loaded = loaded;
              events.dispatchEvent(event);
            },
            finish() {
              signal.removeEventListener("abort", abort);
              ready.add(id);
              globalThis.packPending.delete(id);
              resolve(resource);
            },
          });
        });
      },
    };
    globalThis.LanguageDetector = { availability: async () => "available" };
  }
  await page.evaluate(installPacksFixture);
  await nav("language-packs");
  const row = (id) => page.locator(`[data-pack-row="${id}"]`);
  await row("en:zh").locator(".pack-ready").waitFor();
  await choose("[data-pack-language=target]", "fr");
  const swap = page.locator('[data-op="pack-swap-languages"]');
  await swap.click();
  assert.equal(
    await page.locator('[data-pack-language="source"]').inputValue(),
    "fr",
  );
  assert.equal(
    await page.locator('[data-pack-language="target"]').inputValue(),
    "en",
  );
  await page
    .getByRole("combobox", { name: "源语言", exact: true })
    .getByText("法语", { exact: true })
    .waitFor();
  await swap.click();
  assert.equal(await page.locator("[data-pack-remove]").isVisible(), false);
  await page.locator(".pack-help > summary").click();
  const isEdge = await page.evaluate(
    async () => (await import("./browser.js")).isEdge,
  );
  if (isEdge) {
    assert.equal(await page.locator("[data-pack-remove]").count(), 0);
  } else {
    const managerOpened = page.context().waitForEvent("page");
    await page.locator("[data-pack-remove]").click();
    const manager = await managerOpened;
    await manager.waitForURL("chrome://on-device-translation-internals/");
    assert.equal(await manager.title(), "On Device Translation Internals");
    await manager.close();
  }
  await page.locator(".pack-help > summary").click();
  await page.locator("[data-pack-prepare]").click();
  await page.waitForFunction(() => packPending.has("en:fr"));
  await page.evaluate(() => packPending.get("en:fr").emit(0.42));
  await row("en:fr").getByText("正在下载 42%", { exact: true }).waitFor();
  assert.equal(
    await row("en:fr").locator("progress").getAttribute("value"),
    "0.42",
  );
  await page.screenshot({ path: "artifacts/language-packs-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/language-packs-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => packPending.get("en:fr").emit(1));
  await row("en:fr").getByText("正在准备", { exact: true }).waitFor();
  assert.equal(await row("en:fr").locator(".pack-ready").count(), 0);
  await page.evaluate(() => packPending.get("en:fr").finish());
  await row("en:fr").locator(".pack-ready").waitFor();
  await choose("[data-pack-language=target]", "ja");
  await page.locator("[data-pack-prepare]").click();
  await page.waitForFunction(() => packPending.has("en:ja"));
  await row("en:ja").getByRole("button", { name: "取消", exact: true }).click();
  await row("en:ja").waitFor({ state: "detached" });
  await nav("home");
  await nav("language-packs");
  await row("en:fr").locator(".pack-ready").waitFor();
  assert.equal(await row("en:ja").count(), 0);
  // Returning from the browser manager must recheck actual availability.
  await page.evaluate(() => {
    preparedPacks.delete("en:fr");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await row("en:fr").waitFor({ state: "detached" });

  // A page-wide request without activation keeps an actionable prompt in place.
  await page.evaluate(
    (tabId) => chrome.runtime.sendMessage({ type: "tab.restore", tabId }),
    tabId,
  );
  await page.evaluate(
    async ({ tabId }) => {
      // This serialized function is test-only; the product never injects page code.
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: () => {
          globalThis.packPending = null;
          globalThis.packReady = false;
          globalThis.packMasked = false;
          Object.defineProperty(navigator, "userActivation", {
            configurable: true,
            value: { isActive: false },
          });
          globalThis.Translator = {
            availability: async () =>
              globalThis.packReady && !globalThis.packMasked
                ? "available"
                : "downloadable",
            create: ({ monitor, signal }) => {
              const resource = {
                translate: async (text) => `local:${text}`,
                destroy() {},
              };
              if (globalThis.packReady) {
                const events = new EventTarget();
                monitor?.(events);
                for (const loaded of [0, 1])
                  events.dispatchEvent(
                    Object.assign(new Event("downloadprogress"), { loaded }),
                  );
                return Promise.resolve(resource);
              }
              if (!navigator.userActivation.isActive)
                return Promise.reject(
                  new DOMException(
                    "User activation is required",
                    "NotAllowedError",
                  ),
                );
              const events = new EventTarget();
              monitor?.(events);
              return new Promise((resolve, reject) => {
                signal.addEventListener(
                  "abort",
                  () => reject(new DOMException("Aborted", "AbortError")),
                  { once: true },
                );
                globalThis.packPending = {
                  emit(loaded) {
                    const event = new Event("downloadprogress");
                    event.loaded = loaded;
                    events.dispatchEvent(event);
                  },
                  finish() {
                    globalThis.packReady = true;
                    resolve(resource);
                  },
                };
              });
            },
          };
        },
      });
    },
    { tabId },
  );
  const result = await page.evaluate(
    (tabId) =>
      chrome.runtime.sendMessage({
        type: "tab.run",
        tabId,
        actionId: "translate",
        scope: "body",
        panel: false,
        translation: { sourceLanguage: "en", targetLanguage: "de" },
      }),
    tabId,
  );
  assert(result.ok, JSON.stringify(result));
  const notice = host.locator(".native-download");
  await notice.locator("[data-native-command=prepare]").waitFor();
  await page.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: () => {
          navigator.userActivation.isActive = true;
        },
      }),
    tabId,
  );
  await notice.locator("[data-native-command=prepare]").click();
  await notice.getByText("英语 → 德语 · 正在准备", { exact: true }).waitFor();
  await page.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: () => packPending.emit(0.57),
      }),
    tabId,
  );
  await notice
    .getByText("英语 → 德语 · 正在下载 57%", { exact: true })
    .waitFor();
  await row("en:de").getByText("正在下载 57%", { exact: true }).waitFor();
  await source.screenshot({ path: "artifacts/language-pack-progress.png" });
  await page.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: () => packPending.finish(),
      }),
    tabId,
  );
  await notice.waitFor({ state: "hidden" });
  await source.locator("[data-pagework=result]").first().waitFor();
  assert(
    await source
      .locator("[data-pagework=result]")
      .first()
      .evaluate((node) => node.shadowRoot.textContent.startsWith("local:")),
    "The original translation continues without another click",
  );
  // Prior readiness on a website must not be misrepresented as ready here.
  await row("en:de").waitFor({ state: "detached" });

  const restore = () =>
    page.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: "tab.restore", tabId }),
      tabId,
    );
  const start = (sourceLanguage = "en", targetLanguage = "it") =>
    page.evaluate(
      ({ tabId, sourceLanguage, targetLanguage }) =>
        chrome.runtime.sendMessage({
          type: "tab.run",
          tabId,
          actionId: "translate",
          scope: "body",
          panel: false,
          translation: { sourceLanguage, targetLanguage },
          refresh: true,
        }),
      { tabId, sourceLanguage, targetLanguage },
    );
  const fixture = (command) =>
    page.evaluate(
      ({ tabId, command }) =>
        chrome.scripting.executeScript({
          target: { tabId },
          world: "ISOLATED",
          args: [command],
          func: (command) => {
            if (command === "reset" || command === "detector") {
              globalThis.packReady = false;
              globalThis.packMasked = false;
              globalThis.packPending = null;
              navigator.userActivation.isActive = false;
            }
            if (command === "activate")
              navigator.userActivation.isActive = true;
            if (command === "masked") {
              globalThis.packReady = true;
              globalThis.packMasked = true;
              navigator.userActivation.isActive = false;
            }
            if (command === "finish") globalThis.packPending.finish();
            if (command === "detector") {
              globalThis.LanguageDetector = {
                availability: async () => "downloadable",
                create: async (options) => {
                  await globalThis.Translator.create(options);
                  // Detection may outlast the activation and need a second pack.
                  globalThis.packReady = false;
                  navigator.userActivation.isActive = false;
                  return {
                    detect: async () => [
                      { detectedLanguage: "en", confidence: 1 },
                    ],
                    destroy() {},
                  };
                },
              };
            }
          },
        }),
      { tabId, command },
    );
  const prepare = async () => {
    await notice.locator("[data-native-command=prepare]").waitFor();
    await fixture("activate");
    await notice.locator("[data-native-command=prepare]").click();
    await notice.locator("progress").waitFor();
  };

  // Dismissing activation cancels the original request, without starting a download.
  await restore();
  await fixture("masked");
  assert((await start("en", "es")).ok);
  await source.locator("[data-pagework=result]").first().waitFor();
  assert(
    await notice.isHidden(),
    "Masked but ready resources do not ask for another click or report a download",
  );
  await restore();
  await fixture("reset");
  assert((await start()).ok);
  await notice.locator("[data-native-command=prepare]").waitFor();
  await notice.locator("[data-native-command=dismiss]").click();
  await notice.waitFor({ state: "hidden" });
  await host
    .locator("#toolbar[aria-busy=false]")
    .waitFor({ state: "attached" });
  assert.equal(await source.locator("[data-pagework=result]").count(), 0);

  // Restoring while downloading prevents late completion from inserting results.
  assert((await start()).ok);
  await prepare();
  await restore();
  await notice.waitFor({ state: "hidden" });
  await fixture("finish");
  await source.waitForTimeout(200);
  assert.equal(await source.locator("[data-pagework=result]").count(), 0);

  // A detector download and a translator download stay in the same page request.
  await fixture("detector");
  assert((await start("auto")).ok);
  await prepare();
  await fixture("finish");
  await prepare();
  await fixture("finish");
  await notice.waitFor({ state: "hidden" });
  await source.locator("[data-pagework=result]").first().waitFor();
  await restore();

  // Typed text uses the same continuation, and closing it cancels a pending activation.
  const dock = host.locator("#dock");
  await dock.focus();
  await source.keyboard.press("Enter");
  await host.locator("#radial [data-op=text-translate]").click();
  const panel = host.locator("#text-translation");
  await panel.locator("[data-text-language=sourceLanguage]").selectOption("en");
  await panel.locator("textarea").fill("Continue typed text after download.");
  await fixture("reset");
  await panel.locator("[data-text-command=run]").click();
  await prepare();
  await fixture("finish");
  await panel
    .locator(".output")
    .filter({ hasText: "local:Continue typed text after download." })
    .waitFor();
  await notice.waitFor({ state: "hidden" });
  await panel.locator("textarea").fill("Cancel typed text before download.");
  await fixture("reset");
  await panel.locator("[data-text-command=run]").click();
  await notice.locator("[data-native-command=prepare]").waitFor();
  await panel.locator("[data-text-command=close]").click();
  await notice.waitFor({ state: "hidden" });

  // Selection results also resume the original request after the pack is ready.
  await fixture("reset");
  await page.evaluate(
    (tabId) =>
      chrome.tabs.sendMessage(tabId, {
        type: "selection.process",
        actionId: "translate",
        text: "Continue selected text after download.",
      }),
    tabId,
  );
  await prepare();
  await fixture("finish");
  await host
    .locator("#output")
    .filter({ hasText: "local:Continue selected text after download." })
    .waitFor();
  await notice.waitFor({ state: "hidden" });
  await host.locator("[data-selection-command=close]").click();
  console.log(
    "Language packs: live progress, automatic page/text/selection continuation, sequential detection and translation downloads, dismissal and cancellation pass.",
  );
};
