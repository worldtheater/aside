const assert = require("node:assert/strict");
module.exports = async ({ page, context, origin }) => {
  const errors = [];
  const record = (error) => errors.push(error.message);
  page.on("pageerror", record);
  let internal;
  try {
    await page.evaluate(
      (origin) => chrome.permissions.request({ origins: [origin + "/*"] }),
      origin,
    );
    await page.evaluate(async () => {
      const { settings } = await chrome.storage.local.get("settings");
      settings.website.sites["127.0.0.1"] = { lights: "on" };
      await chrome.storage.local.set({ settings });
    });
    // An HTTP iframe can match all_frames even when its top-level page is an
    // extension/browser surface. Theme eligibility belongs to the top level.
    await page.evaluate((origin) => {
      const frame = document.createElement("iframe");
      frame.id = "internal-hosted-web-frame";
      frame.src = origin + "/internal-frame";
      document.body.append(frame);
    }, origin);
    const frame =
      page
        .frames()
        .find((frame) => frame.url() === origin + "/internal-frame") ||
      (await page.waitForEvent("framenavigated", {
        predicate: (frame) => frame.url() === origin + "/internal-frame",
      }));
    assert(frame, "The internal surface contains a matching HTTP iframe");
    await frame.waitForLoadState("load");
    const ancestors = await frame.evaluate(() =>
      Array.from(location.ancestorOrigins),
    );
    assert(ancestors.at(-1).startsWith("chrome-extension://"));
    await frame.evaluate((origin) => {
      const nested = document.createElement("iframe");
      nested.src = origin + "/nested-internal-frame";
      document.body.append(nested);
    }, origin);
    const nested =
      page
        .frames()
        .find((f) => f.url() === origin + "/nested-internal-frame") ||
      (await page.waitForEvent("framenavigated", {
        predicate: (f) => f.url() === origin + "/nested-internal-frame",
      }));
    await nested.waitForLoadState("load");
    await nested.evaluate(() => {
      const child = document.createElement("iframe");
      child.srcdoc = "<p>Internal related frame</p>";
      document.body.append(child);
    });
    const related = await (
      await nested.locator("iframe").elementHandle()
    ).contentFrame();
    await related.waitForLoadState("load");
    for (const webFrame of [frame, nested, related]) {
      assert.equal(await webFrame.locator("style.darkreader").count(), 0);
    }
    assert.deepEqual(
      errors,
      [],
      "Internal top-level origins must be skipped without throwing",
    );
    internal = await context.newPage();
    internal.on("pageerror", record);
    await internal.goto("chrome://newtab/");
    await internal.waitForLoadState("domcontentloaded");
    assert.equal(await internal.locator("style.darkreader").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: HTTP/nested frames under internal origins and native Chrome new tab are skipped without theme errors.",
    );
  } finally {
    page.off("pageerror", record);
    await page
      .locator("#internal-hosted-web-frame")
      .evaluate((node) => node.remove())
      .catch(() => {});
    await internal?.close();
  }
};
