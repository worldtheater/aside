const assert = require("node:assert/strict");
const path = require("node:path");
module.exports = async ({ page, context, artifacts, nav, op, choose }) => {
  const stored = await page.evaluate(() =>
    chrome.storage.local.get(["settings", "collection", "daily"]),
  );
  const pageTitle = "聊斋志異/第01卷 - 维基文库，自由的图书馆";
  const fixtures = [
    {
      id: "first",
      sourceText: "异史氏曰：乡人之愚可笑也。诸如此类，不足为怪。",
      text: "乡下人的糊涂确实可笑。这样的事情，并不值得大惊小怪。",
      actionName: "Classical to modern Chinese",
      createdAt: "2026-10-19T10:00:00Z",
      url: "https://zh.wikisource.org/wiki/example",
    },
    {
      id: "second",
      sourceText: "劳山道士。王生慕道，入山求仙。",
      text: "王生向往修道，于是进山寻访仙人。",
      actionName: "文言转白话",
      createdAt: "2026-10-18T10:00:00Z",
      url: "https://zh.wikisource.org/wiki/example",
    },
    {
      id: "third",
      sourceText:
        "Good notes connect ideas. They help us understand what changed.",
      text: "好的笔记连接想法，帮助我们理解认识发生了什么变化。",
      actionName: "Translate",
      createdAt: "2026-10-17T10:00:00Z",
      url: "https://example.com/notes",
    },
    {
      id: "local",
      sourceText: "A private note.",
      text: "自定义结果",
      actionName: "我的读书笔记",
      createdAt: "2026-10-16T10:00:00Z",
      url: "",
    },
  ].map((item) => ({ title: pageTitle, sourceTitle: pageTitle, ...item }));
  // Read the actual localized default rather than depending on historical wording.
  const plainName = await page.evaluate(
    async () =>
      (await import("./copy.js")).messages["zh-CN"].presets.plain.name,
  );
  fixtures[1].actionName = plainName;
  try {
    assert(
      await op("collection-search-toggle").isHidden(),
      "Empty collections hide search",
    );
    assert(await page.locator(".daily-guidance").isVisible());
    await page.screenshot({
      path: path.join(artifacts, "home-setup-entry.png"),
      animations: "disabled",
    });
    await page.locator(".daily-setup").click();
    assert.equal(await page.locator("h1").textContent(), "模型连接");
    await nav("help");
    assert.equal(await page.locator("h1").textContent(), "关于");
    const version = await page.evaluate(
      () => chrome.runtime.getManifest().version,
    );
    assert(
      (await page.locator(".help-version").textContent()).includes(version),
    );
    assert.equal(
      await page.locator('.help-links a[href$="/issues"]').getAttribute("href"),
      "https://github.com/worldtheater/aside/issues",
    );
    assert.equal(await page.locator(".help-credits li").count(), 3);
    assert(
      (await page.locator(".help-credits").textContent()).includes(
        "Dark Reader",
      ),
    );
    const helpLink = await page
      .locator('.sidebar-footer [data-route="help"]')
      .boundingBox();
    assert(helpLink.y > 850, "Help is anchored at the bottom of the sidebar");
    await page.screenshot({
      path: path.join(artifacts, "help-about-light.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await page.screenshot({
      path: path.join(artifacts, "help-about-dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    const helpLabels = await page.evaluate(async () => {
      const { messages } = await import("./copy.js");
      return Object.entries(messages).map(([locale, copy]) => [
        locale,
        copy.nav.help,
      ]);
    });
    for (const [locale, label] of helpLabels) {
      await choose("#ui-locale", locale);
      assert.equal(await page.locator("h1").textContent(), label);
    }
    await choose("#ui-locale", "ru");
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, "help-about-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await choose("#ui-locale", "zh-CN");
    await nav("home");
    await page.evaluate(
      async ({ fixtures }) => {
        const { daily } = await chrome.storage.local.get("daily");
        await chrome.storage.local.set({
          collection: fixtures,
          daily: {
            ...daily,
            result: "读得慢一点，让一个想法多停留片刻。",
            date: "2026-10-18",
          },
        });
      },
      { fixtures },
    );
    await page.reload();
    await op("home").waitFor();
    assert.deepEqual(
      await page.locator(".sidebar-group h2").allTextContents(),
      ["内容", "设置"],
    );
    assert.equal(
      await page
        .locator(".sidebar [aria-current=page]")
        .getAttribute("data-route"),
      "home",
    );
    assert.equal(await page.locator("[data-op=page-menu]").count(), 0);
    assert.equal(await page.locator(".collection-card").count(), 4);
    assert.notEqual(
      await page.locator(".collection-card h3").nth(0).textContent(),
      await page.locator(".collection-card h3").nth(1).textContent(),
    );
    assert(
      (
        await page.locator(".collection-card h3").first().textContent()
      ).startsWith("异史氏曰"),
    );
    assert.equal(
      await page.locator(".collection-card-meta>span").first().textContent(),
      plainName,
    );
    assert.equal(
      await page.locator(".collection-origin>span").first().textContent(),
      "zh.wikisource.org",
    );
    assert.equal(
      await page
        .locator(".collection-origin")
        .first()
        .getAttribute("aria-label"),
      pageTitle,
    );
    assert(
      (
        await page.locator(".collection-origin img").first().getAttribute("src")
      ).includes("/_favicon/"),
    );
    assert((await page.locator(".daily-date").textContent()).includes("18"));
    assert.equal(await page.locator(".daily-caption").count(), 0);
    const daily = page.locator(".daily-region");
    const controls = daily.locator(".daily-controls");
    assert.deepEqual(
      await controls
        .locator("button")
        .evaluateAll((buttons) => buttons.map((b) => b.dataset.op)),
      ["daily-settings", "daily-refresh", "daily-hide-ask"],
    );
    await page.mouse.move(0, 0);
    await page.waitForFunction(
      () =>
        document.querySelector(".daily-controls").getBoundingClientRect()
          .right <=
        document.querySelector(".daily-card").getBoundingClientRect().right,
    );
    await daily.hover();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".daily-controls")).right ===
        "0px",
    );
    assert(
      await daily.evaluate((region) => {
        const card = region
          .querySelector(".daily-card")
          .getBoundingClientRect();
        const panel = region
          .querySelector(".daily-controls")
          .getBoundingClientRect();
        return (
          panel.left < card.right &&
          panel.right > card.right &&
          panel.right <= innerWidth
        );
      }),
      "The hover panel extends from behind the card without overflowing the page",
    );
    const expectCenteredTip = async (anchor) => {
      await anchor.hover();
      const tip = page.locator(".hover-tip:popover-open");
      await tip.waitFor();
      await tip.evaluate((node) =>
        Promise.all(
          node
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      const controlBounds = await anchor.boundingBox(),
        tipBounds = await tip.boundingBox();
      const expectedLeft = Math.max(
        8,
        Math.min(
          controlBounds.x + (controlBounds.width - tipBounds.width) / 2,
          page.viewportSize().width - tipBounds.width - 8,
        ),
      );
      assert(
        Math.abs(tipBounds.x - expectedLeft) < 1,
        "Tips center over their anchor and only shift at viewport edges",
      );
      assert.equal(
        await tip.textContent(),
        await anchor.getAttribute("data-tooltip"),
      );
    };
    await expectCenteredTip(op("daily-settings"));
    assert.equal(
      await controls.evaluate((node) => getComputedStyle(node).right),
      "0px",
      "Moving into the panel keeps it open",
    );
    await page.screenshot({
      path: path.join(artifacts, "daily-hover-panel.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await daily.hover();
    await expectCenteredTip(op("daily-settings"));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expectCenteredTip(
      page.locator(".collection-card-footer [data-tooltip]").first(),
    );
    await nav("actions");
    await expectCenteredTip(
      page.locator(".toggle-label[data-tooltip]").first(),
    );
    await nav("home");
    await daily.hover();
    await op("daily-settings").click();
    await page.locator("dialog .dialog-actions [data-op=dialog-close]").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    await page.mouse.move(0, 0);
    await page.waitForFunction(
      () =>
        document.querySelector(".daily-controls").getBoundingClientRect()
          .right <=
        document.querySelector(".daily-card").getBoundingClientRect().right,
    );
    assert(
      await op("daily-settings").evaluate(
        (node) => node === document.activeElement,
      ),
      "Pointer cancellation restores focus without keeping the panel open",
    );
    await page.keyboard.press("Tab");
    assert(
      await op("daily-refresh").evaluate(
        (node) => node === document.activeElement,
      ),
    );
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".daily-controls")).right ===
        "0px",
    );
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await page.locator("#daily-prompt").waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".daily-controls")).right ===
        "0px",
    );
    assert(
      await op("daily-settings").evaluate(
        (node) =>
          node === document.activeElement && node.matches(":focus-visible"),
      ),
      "Keyboard cancellation keeps the focused panel accessible",
    );
    await daily.hover();
    const savedDaily = await page.evaluate(
      async () => (await chrome.storage.local.get("daily")).daily,
    );
    await op("daily-hide-ask").click();
    assert(await daily.isVisible(), "Closing first asks for confirmation");
    assert.equal(await page.locator("dialog > .dialog-close").count(), 0);
    await page.locator("dialog [data-op=dialog-close]").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    assert(await daily.isVisible(), "Cancel keeps the card");
    await daily.hover();
    await op("daily-hide-ask").click();
    await op("daily-hide").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    assert.equal(await daily.count(), 0);
    assert(
      await page.locator(".page-heading [data-op=daily-restore]").isVisible(),
    );
    await page.reload();
    await op("daily-restore").waitFor();
    assert.equal(await daily.count(), 0, "Hidden state persists after reload");
    assert.deepEqual(
      await page.evaluate(
        async () => (await chrome.storage.local.get("daily")).daily,
      ),
      savedDaily,
    );
    await op("daily-restore").press("Enter");
    await daily.waitFor();
    assert.equal(await op("daily-restore").count(), 0);
    assert.equal(
      await page.locator(".daily-thought").textContent(),
      savedDaily.result,
    );
    await page.mouse.move(0, 0);
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".daily-controls")).right ===
        "0px",
    );
    assert(
      await op("daily-settings").evaluate(
        (node) => node === document.activeElement,
      ),
      "Restoring focuses settings and reveals the panel for keyboard use",
    );
    await page.reload();
    await daily.waitFor();
    assert.equal(
      await op("daily-restore").count(),
      0,
      "Restored state persists after reload",
    );
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, "home-sidebar-light.png"),
      fullPage: true,
      animations: "disabled",
    });

    const search = page.locator("#collection-search");
    const searchBox = page.locator(".collection-search");
    const searchToggle = op("collection-search-toggle");
    assert.equal(await page.locator(".home-shortcut").count(), 0);
    const assertNoTip = async (control) => {
      assert(
        await control.getAttribute("aria-label"),
        "Keep an accessible name",
      );
      assert.equal(await control.getAttribute("data-tooltip"), null);
      assert.equal(await control.getAttribute("title"), null);
    };
    await assertNoTip(searchToggle);
    await assertNoTip(page.locator('[data-select-for="ui-locale"]'));
    await assertNoTip(op("theme-menu"));
    assert.equal(
      await page.locator(".language-control").getAttribute("data-tooltip"),
      null,
    );
    await assertNoTip(op("history-back"));
    await assertNoTip(op("history-forward"));
    const settle = (node) =>
      node.evaluate(async (root) => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        await Promise.all(
          root
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
    assert(await search.isHidden());
    assert(await search.isDisabled());
    assert.equal(await searchToggle.getAttribute("aria-expanded"), "false");
    const collapsedSearchWidth = (await searchBox.boundingBox()).width;
    await searchBox.evaluate((root) => {
      root.dataset.transitions = "";
      root.addEventListener("transitionend", (event) => {
        if (event.target === root)
          root.dataset.transitions += event.propertyName + ";";
      });
    });
    await searchToggle.click();
    assert(await search.evaluate((input) => input === document.activeElement));
    await assertNoTip(searchToggle);
    await settle(searchBox);
    assert((await searchBox.boundingBox()).width > collapsedSearchWidth);
    assert(
      (await searchBox.getAttribute("data-transitions")).includes("width"),
      "Search expands with a real width transition",
    );
    await page.locator(".collection-bar").screenshot({
      path: path.join(artifacts, "collection-search-expanded.png"),
    });
    await page.locator("#collection-search").fill("王生");
    assert.equal(await page.locator(".collection-card").count(), 1);
    assert.equal(
      await page.locator("#collection-count").textContent(),
      "1 / 4 则",
    );
    await page.locator("#collection-search").fill("wikisource");
    assert.equal(await page.locator(".collection-card").count(), 2);
    await search.press("Escape");
    await settle(searchBox);
    assert(await search.isHidden());
    assert.equal(
      await page.locator(".collection-card").count(),
      4,
      "Collapsing search clears hidden filters",
    );
    assert(
      await searchToggle.evaluate(
        (button) => button === document.activeElement,
      ),
    );
    await assertNoTip(searchToggle);
    await page.keyboard.press("Enter");
    assert(await search.evaluate((input) => input === document.activeElement));
    await assertNoTip(searchToggle);
    await search.fill("王生");
    await page.locator(".page-heading h1").click();
    await settle(searchBox);
    assert(
      (await search.isHidden()) && (await search.isDisabled()),
      "Clicking outside on the page collapses search",
    );
    assert.equal(await searchToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await search.inputValue(), "");
    assert.equal(await page.locator(".collection-card").count(), 4);
    await searchToggle.click();
    await search.fill("王生");
    await search.press("Tab");
    assert(await search.evaluate((input) => input !== document.activeElement));
    await page.keyboard.press("Escape");
    await settle(searchBox);
    assert(
      await search.isHidden(),
      "Escape collapses search even after focus leaves the input",
    );
    assert.equal(await searchToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator(".collection-card").count(), 4);
    await searchToggle.click();
    await page.locator("#collection-search").fill("");
    assert.equal(
      await page
        .locator(
          "#collection-sort,[data-op=collection-filters],#collection-filters",
        )
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator(".collection-card-open")
        .first()
        .getAttribute("data-id"),
      "first",
    );
    await page.locator("#collection-search").fill("古文释义");
    assert.equal(await page.locator(".collection-card").count(), 2);
    await page.locator("#collection-search").fill("no matching passage");
    assert.equal(await page.locator(".collection-card").count(), 0);
    await page.locator(".collection-empty [data-op=collection-reset]").click();
    assert.equal(await page.locator(".collection-card").count(), 4);
    await page.locator("[data-op=collection-open][data-id=first]").click();
    assert(
      (await page.locator(".collection-source").textContent()).includes(
        pageTitle,
      ),
    );
    await assertNoTip(page.locator("dialog > .dialog-close"));
    await page.locator("dialog").screenshot({
      path: path.join(artifacts, "collection-detail.png"),
      animations: "disabled",
    });
    await page.locator("dialog > .dialog-close").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);

    // A long passage and expanded source must share one bounded scroll area.
    await page.evaluate(
      async (fixtures) =>
        chrome.storage.local.set({
          collection: fixtures.map((item, i) =>
            i
              ? item
              : {
                  ...item,
                  sourceText: item.sourceText.repeat(40),
                  text: item.text.repeat(50),
                },
          ),
        }),
      fixtures,
    );
    await page.setViewportSize({ width: 390, height: 640 });
    await page.locator("[data-op=collection-open][data-id=first]").click();
    const detail = page.locator("dialog");
    await detail.locator(".collection-original summary").click();
    assert(
      (await detail.locator(".collection-original").getAttribute("open")) !==
        null,
    );
    assert(
      await detail.evaluate((node) => {
        const footer = node
          .querySelector(".dialog-actions")
          .getBoundingClientRect();
        const body = node.querySelector(".collection-detail-body");
        return (
          footer.bottom <= innerHeight &&
          body.scrollHeight > body.clientHeight &&
          node.getBoundingClientRect().bottom <= innerHeight
        );
      }),
      "Expanding the original keeps the footer inside the viewport",
    );
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw Error("Fixture copy denied");
      };
    });
    await detail.locator("[data-op=collection-copy]").click();
    const notice = page.locator("#toast[data-kind=error]:not([hidden])");
    await notice.waitFor();
    assert.equal(await notice.getAttribute("role"), "alert");
    assert(
      await notice.locator(":scope > svg circle").count(),
      "Errors use a warning icon",
    );
    assert(
      await notice.evaluate((node) => {
        const rect = node.querySelector("span").getBoundingClientRect();
        return (
          document
            .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            ?.closest("#toast") === node
        );
      }),
      "Feedback is in the active modal and accepts pointer input",
    );
    assert(
      await detail.evaluate((node) => {
        const footer = node
          .querySelector(".dialog-actions")
          .getBoundingClientRect();
        const notice = node.querySelector("#toast").getBoundingClientRect();
        return footer.bottom <= notice.top && notice.bottom <= innerHeight;
      }),
      "Inline feedback leaves the footer visible",
    );
    await page.waitForTimeout(3200);
    assert(await notice.isVisible(), "Errors remain readable until dismissed");
    await page.screenshot({
      path: path.join(artifacts, "collection-long-error-mobile.png"),
      animations: "disabled",
    });
    await notice.locator("[data-op=dismiss-notice]").click();
    assert(await page.locator("#toast").isHidden());
    await detail.locator("[data-op=collection-copy]").click();
    await notice.waitFor();
    await detail.locator(":scope > .dialog-close").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    assert(
      await page.locator("#toast").isHidden(),
      "Closing a dialog also dismisses its feedback",
    );
    await page.evaluate(
      (fixtures) => chrome.storage.local.set({ collection: fixtures }),
      fixtures,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });

    const assertOptionsHover = async (name) => {
      const card = page.locator(".collection-card").first();
      const options = card.locator('[data-op="collection-menu"]');
      await options.hover();
      await settle(card);
      assert(
        await options.evaluate(
          (button) =>
            getComputedStyle(button).backgroundColor !==
            getComputedStyle(button.closest(".collection-card"))
              .backgroundColor,
        ),
        "The options button remains distinct from the highlighted card",
      );
      await card.screenshot({
        path: path.join(artifacts, `collection-options-hover-${name}.png`),
        animations: "disabled",
      });
    };
    await assertOptionsHover("light");
    await page.locator(".collection-card").first().hover();
    await page.locator("[data-op=collection-menu][data-id=first]").click();
    await page.evaluate(() => {
      window.copiedPassage = "";
      navigator.clipboard.writeText = async (text) => {
        window.copiedPassage = text;
      };
    });
    await page.locator(".collection-menu [data-op=collection-copy]").click();
    assert.equal(
      await page.evaluate(() => window.copiedPassage),
      fixtures[0].text,
    );
    await page.locator("[data-op=collection-menu][data-id=first]").click();
    await page.evaluate(() => {
      window.createTab = chrome.tabs.create;
      chrome.tabs.create = async ({ url }) => {
        window.openedSource = url;
        return {};
      };
    });
    await page
      .locator(".collection-menu [data-op=collection-source-open]")
      .click();
    assert.equal(
      await page.evaluate(() => window.openedSource),
      fixtures[0].url,
    );
    await page.evaluate(() => {
      chrome.tabs.create = window.createTab;
    });
    await page.locator("[data-op=collection-menu][data-id=first]").click();
    await page
      .locator(".collection-menu [data-op=collection-remove-ask]")
      .click();
    assert.equal(
      await page.locator(".collection-card").count(),
      4,
      "Delete is not applied before confirmation",
    );
    assert.equal(await page.locator("dialog > .dialog-close").count(), 0);
    const cancelDelete = await page
      .locator("dialog [data-op=dialog-close]")
      .boundingBox();
    const confirmDelete = await page
      .locator("dialog [data-op=collection-remove]")
      .boundingBox();
    assert(cancelDelete.x + cancelDelete.width < confirmDelete.x);
    await page.locator("dialog .dialog-actions [data-op=dialog-close]").click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    assert.equal(
      (await page.evaluate(() => chrome.storage.local.get("collection")))
        .collection.length,
      4,
    );
    await page.locator("[data-op=collection-menu][data-id=first]").click();
    await page
      .locator(".collection-menu [data-op=collection-remove-ask]")
      .click();
    await op("collection-remove").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".collection-card").length === 3 &&
        !document.querySelector("dialog").open,
    );
    assert.equal(
      (await page.evaluate(() => chrome.storage.local.get("collection")))
        .collection.length,
      3,
    );

    await nav("actions");
    assert.equal(await page.locator("h1").textContent(), "处理方式");
    assert.equal(
      await page
        .locator(".sidebar [aria-current=page]")
        .getAttribute("data-route"),
      "actions",
    );
    await op("home").click();
    await choose("#ui-locale", "en");
    assert.equal(
      await page.locator(".collection-card-meta>span").first().textContent(),
      "Classical text gloss",
    );
    assert.equal(
      await page.locator(".language-label .active").textContent(),
      "EN",
    );
    await choose("#ui-locale", "zh-CN");
    await op("theme-menu").click();
    await page.locator("[data-op=theme-mode][data-value=dark]").click();
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, "home-sidebar-dark.png"),
      fullPage: true,
      animations: "disabled",
    });

    await assertOptionsHover("dark");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await searchToggle.click();
    assert.equal(
      await searchBox.evaluate(
        (root) => root.getAnimations({ subtree: true }).length,
      ),
      0,
    );
    await searchToggle.click();
    assert(await search.isEnabled());
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector(".sidebar").inert);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert(await page.locator(".sidebar").evaluate((node) => node.inert));
    await op("navigation-open").click();
    assert(await page.locator(".main").evaluate((node) => node.inert));
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.route),
      "help",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await op("navigation-open").getAttribute("aria-expanded"),
      "false",
    );
    await nav("actions");
    assert.equal(await page.locator("h1").textContent(), "处理方式");
    assert(await page.locator(".sidebar").evaluate((node) => node.inert));
    await nav("home");
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, "home-sidebar-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    await op("navigation-open").click();
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, "home-sidebar-mobile-nav.png"),
    });
    await page.keyboard.press("Escape");
    for (const width of [320, 768, 900, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `No page overflow at ${width}px`,
      );
    }
    await page.evaluate(() => chrome.storage.local.set({ collection: [] }));
    await op("collection-search-toggle").waitFor({ state: "hidden" });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#collection-search").inputValue(), "");
    console.log(
      "Homepage setup, About in all locales, empty collection search, navigation, menus and responsive layout passed",
    );
  } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate((stored) => chrome.storage.local.set(stored), stored);
    await page.reload();
    await page.locator("h1").waitFor();
  }
};
