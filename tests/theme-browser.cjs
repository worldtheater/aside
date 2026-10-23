const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  artifacts = path.join(root, "artifacts");
(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pagework-theme-"));
  const context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" }),
    headless: true,
    viewport: { width: 1200, height: 800 },
    colorScheme: "light",
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  });
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send("Extensions.loadUnpacked", { path: root });
    const origin = `chrome-extension://${id}/`,
      control = await context.newPage();
    await control.goto(origin + "index.html");
    await control.locator("h1").waitFor();
    const setTheme = async (mode, palette) => {
      await control.locator("[data-op=theme-menu]").click();
      await control.locator(`[data-op=theme-mode][data-value=${mode}]`).click();
      await control
        .locator(`[data-op=theme-palette][data-value=${palette}]`)
        .click();
      await control.keyboard.press("Escape");
      await control.waitForFunction(
        async ({ mode, palette }) => {
          const { settings } = await chrome.storage.local.get("settings");
          return (
            settings.preferences.theme === mode &&
            settings.preferences.palette === palette
          );
        },
        { mode, palette },
      );
    };
    const check = async ({
      mode,
      system,
      palette = "graphite",
      expected,
      color,
      file = "index.html",
      cold = false,
    }) => {
      await setTheme(mode, palette);
      if (cold)
        await control.evaluate(() => localStorage.removeItem("pagework-theme"));
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme: system });
      await page.addInitScript(() => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = async (...args) => {
          const response = await original(...args);
          if (args[0]?.type === "snapshot")
            await new Promise((resolve) => setTimeout(resolve, 500));
          return response;
        };
        window.themeFrames = [];
        const frame = () => {
          const root = document.documentElement;
          if (root)
            window.themeFrames.push({
              theme: root.dataset.theme,
              palette: root.dataset.palette,
              color: getComputedStyle(root).backgroundColor,
            });
          if (window.themeFrames.length < 90) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      await page.goto(origin + file, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.themeFrames.length >= 3);
      assert.equal(
        await page
          .locator(file === "index.html" ? "#app" : "#popup")
          .evaluate((n) => n.childElementCount),
        0,
        "Verify the frame while the app is still waiting for settings",
      );
      if (mode === "dark" && file === "index.html")
        await page.screenshot({
          path: path.join(artifacts, "home-dark-before-settings.png"),
        });
      await page
        .locator(file === "index.html" ? "h1" : ".popup-header")
        .waitFor();
      const frames = await page.evaluate(() => window.themeFrames);
      assert(frames.length >= 3);
      for (const frame of frames) {
        assert.equal(frame.theme, expected, JSON.stringify(frames));
        assert.equal(frame.palette, palette);
        assert.equal(frame.color, color, JSON.stringify(frames));
      }
      assert.deepEqual(errors, []);
      if (mode === "dark" && file === "index.html")
        await page.screenshot({
          path: path.join(artifacts, "home-dark-ready.png"),
        });
      console.log(
        `PASS: ${file}, preference=${mode}, OS=${system}, palette=${palette}, cold=${cold}; ${frames.length} frames all ${color} during delayed settings.`,
      );
      await page.close();
    };
    await check({
      mode: "dark",
      system: "light",
      expected: "dark",
      color: "rgb(27, 28, 30)",
    });
    await check({
      mode: "light",
      system: "dark",
      expected: "light",
      color: "rgb(247, 247, 246)",
    });
    await check({
      mode: "system",
      system: "dark",
      expected: "dark",
      color: "rgb(27, 28, 30)",
    });
    await check({
      mode: "system",
      system: "light",
      expected: "light",
      color: "rgb(247, 247, 246)",
    });
    await check({
      mode: "system",
      system: "dark",
      expected: "dark",
      color: "rgb(27, 28, 30)",
      cold: true,
    });
    await check({
      mode: "dark",
      system: "light",
      palette: "ocean",
      expected: "dark",
      color: "rgb(32, 41, 52)",
      file: "popup.html",
    });
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
