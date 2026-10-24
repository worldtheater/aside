const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async ({ context, origin, calls, artifacts }) => {
  const source = await context.newPage();
  const errors = [];
  source.on("pageerror", (error) => errors.push(error.message));
  try {
    await source.goto(origin + "/radial-hover");
    const host = source.locator("[data-pagework=ui]");
    const dock = host.locator("#dock");
    const radial = host.locator("#radial");
    const pin = radial.locator("[data-op=dock-pin]");
    const tip = radial.locator(".hover-tip");
    const settle = async (locator) => {
      await locator.evaluate((node) =>
        Promise.all(
          node
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
    };
    const expectTip = async (button) => {
      await button.hover();
      await radial.locator(".hover-tip:popover-open").waitFor();
      await settle(tip);
      assert.equal(
        await tip.textContent(),
        await button.getAttribute("aria-label"),
      );
      assert.equal(
        await button.getAttribute("title"),
        null,
        "Menu tips never use native title text",
      );
      assert.equal(
        await button.getAttribute("aria-describedby"),
        await tip.getAttribute("id"),
      );
      assert.equal(
        await tip.evaluate((node) => getComputedStyle(node).opacity),
        "1",
      );
      const bounds = await tip.boundingBox();
      const viewport = source.viewportSize();
      const target = await button.boundingBox();
      assert(
        bounds.x >= 8 && bounds.x + bounds.width <= viewport.width - 8 + 1,
        `The full tip fits horizontally inside the viewport: ${JSON.stringify({ op: await button.getAttribute("data-op"), bounds, viewport })}`,
      );
      assert(
        bounds.y >= 8 && bounds.y + bounds.height <= viewport.height - 8 + 1,
        "The full tip fits vertically inside the viewport",
      );
      assert(
        bounds.y + bounds.height <= target.y ||
          bounds.y >= target.y + target.height,
        "The tip follows the button's final position without covering it",
      );
    };
    await dock.waitFor();
    await radial.evaluate((root) => {
      root.dataset.pointerEntries = "[]";
      root.dataset.motion = "[]";
      root.addEventListener("transitionrun", (event) => {
        if (event.propertyName !== "transform") return;
        const motion = event.target
          .getAnimations()
          .find((animation) => animation.transitionProperty === "transform");
        const frames = motion?.effect.getKeyframes();
        if (!frames?.length) return;
        const pose = (frame) => {
          const matrix = new DOMMatrix(frame.transform);
          return {
            radius: Math.hypot(matrix.m41, matrix.m42),
            scale: Math.hypot(matrix.m11, matrix.m12),
            rotations: [
              ...frame.transform.matchAll(/rotate\(([-\d.]+)deg\)/g),
            ].map((match) => Number(match[1])),
          };
        };
        root.dataset.motion = JSON.stringify([
          ...JSON.parse(root.dataset.motion),
          {
            open: root.classList.contains("open"),
            op: event.target.dataset.op,
            start: pose(frames[0]),
            end: pose(frames.at(-1)),
            timing: motion.effect.getTiming(),
          },
        ]);
      });
      root.addEventListener("pointerover", (event) => {
        const button = event.target.closest("button");
        if (button)
          root.dataset.pointerEntries = JSON.stringify([
            ...JSON.parse(root.dataset.pointerEntries),
            button.dataset.op,
          ]);
      });
    });
    const expectMotion = async (open) => {
      const motions = JSON.parse(await radial.getAttribute("data-motion"));
      if (
        await source.evaluate(
          () => matchMedia("(prefers-reduced-motion:reduce)").matches,
        )
      ) {
        assert.deepEqual(
          motions,
          [],
          "Reduced motion keeps the menu stationary while fading",
        );
        return;
      }
      const ops = [
        "open-settings",
        "page-translate",
        "toggle-lights",
        "quick-question",
        "dock-pin",
      ];
      assert.equal(
        motions.length,
        ops.length,
        "Each menu button has exactly one flight transition",
      );
      for (const [index, op] of ops.entries()) {
        const motion = motions.find((item) => item.op === op);
        assert(motion, `${op} animates when ${open ? "opening" : "closing"}`);
        assert.equal(motion.open, open);
        assert(
          Math.abs(motion.start.radius - (open ? 0 : 76)) < 0.01,
          `${op} starts at the correct radius`,
        );
        assert(
          Math.abs(motion.end.radius - (open ? 76 : 0)) < 0.01,
          `${op} ends at the correct radius`,
        );
        assert(
          Math.abs(motion.start.scale - (open ? 0.4 : 1)) < 0.001,
          `${op} starts at the original scale`,
        );
        assert(
          Math.abs(motion.end.scale - (open ? 1 : 0.4)) < 0.001,
          `${op} ends at the original scale`,
        );
        assert.equal(motion.start.rotations.length, 2);
        assert.deepEqual(
          motion.start.rotations,
          motion.end.rotations,
          `${op} flies straight without sweeping around the dock`,
        );
        assert.equal(motion.timing.duration, open ? 200 : 120);
        assert(
          Math.abs(motion.timing.delay - (open ? index * 25 : 0)) < 0.001,
          "Opening keeps the original stagger; closing stays simultaneous",
        );
        assert.equal(
          motion.timing.easing,
          open ? "cubic-bezier(0.34, 1.56, 0.64, 1)" : "ease-in",
        );
      }
    };
    const closeAtCentre = async () => {
      await settle(radial);
      await radial.evaluate((root) => (root.dataset.motion = "[]"));
      await dock.click();
      await settle(radial);
      assert.equal(await radial.getAttribute("class"), "radial");
      await expectMotion(false);
    };
    const openAtCentre = async () => {
      await dock.hover();
      await settle(dock);
      const rect = await dock.boundingBox();
      await radial.evaluate((root) => {
        root.dataset.pointerEntries = "[]";
        root.dataset.motion = "[]";
      });
      await source.mouse.click(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      assert.equal(await radial.getAttribute("class"), "radial open");
      await radial.locator("button").first().waitFor();
      await settle(radial);
      await expectMotion(true);
      assert.deepEqual(
        JSON.parse(await radial.getAttribute("data-pointer-entries")),
        [],
        "Opening at the dock centre never hits a menu button during the animation",
      );
      assert.equal(
        await radial.locator("button:hover").count(),
        0,
        "Resting over the dock never hovers Pin",
      );
      assert.equal(await radial.locator("button:focus-visible").count(), 0);
      assert.equal(
        await radial.locator(".hover-tip:popover-open").count(),
        0,
        "Opening at the centre never shows a menu tip",
      );
      assert.equal(await pin.getAttribute("aria-pressed"), "false");
      assert(
        await pin.evaluate(
          (node) =>
            getComputedStyle(node).backgroundColor ===
            getComputedStyle(
              node.parentElement.querySelector("[data-op=open-settings]"),
            ).backgroundColor,
        ),
      );
      assert(
        await dock.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return (
            node
              .getRootNode()
              .elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              )
              ?.closest("button") === node
          );
        }),
        "The dock retains its centre hit target",
      );
    };
    const before = calls.length;
    await openAtCentre();
    await closeAtCentre();
    await openAtCentre();
    await source.screenshot({
      path: path.join(artifacts, "radial-centre-open.png"),
      clip: { x: 1220, y: 380, width: 220, height: 240 },
    });
    for (const op of [
      "open-settings",
      "page-translate",
      "toggle-lights",
      "quick-question",
      "dock-pin",
    ])
      await expectTip(radial.locator(`[data-op=${op}]`));
    await source.screenshot({
      path: path.join(artifacts, "radial-hover-tip.png"),
      clip: { x: 1120, y: 340, width: 320, height: 360 },
    });
    await settle(pin);
    assert(await pin.evaluate((node) => node.matches(":hover")));
    assert.equal(
      await pin.getAttribute("title"),
      null,
      "Menu buttons do not show native tips",
    );
    assert(
      await pin.getAttribute("aria-label"),
      "Pin keeps its accessible name",
    );
    assert(
      await pin.evaluate(
        (node) =>
          getComputedStyle(node).backgroundColor !==
          getComputedStyle(
            node.parentElement.querySelector("[data-op=open-settings]"),
          ).backgroundColor,
      ),
    );
    await source.mouse.move(0, 0);
    await radial
      .locator(".hover-tip:popover-open")
      .waitFor({ state: "hidden" });
    assert.equal(await pin.getAttribute("aria-describedby"), null);
    await settle(pin);
    assert(await pin.evaluate((node) => !node.matches(":hover")));
    // Disabled controls never show a custom or native tooltip.
    const translate = radial.locator("[data-op=page-translate]");
    await translate.evaluate((button) => (button.disabled = true));
    await translate.hover();
    assert.equal(await radial.locator(".hover-tip:popover-open").count(), 0);
    await translate.evaluate((button) => (button.disabled = false));
    await closeAtCentre();
    assert.equal(await radial.getAttribute("class"), "radial");
    assert.equal(await radial.locator(".hover-tip:popover-open").count(), 0);

    // Both docking sides and motion preferences use the same hit testing.
    for (const [width, height, side, reducedMotion, colorScheme] of [
      [390, 720, "right", "no-preference", "dark"],
      [390, 720, "left", "no-preference", "light"],
      [1440, 1000, "left", "reduce", "dark"],
    ]) {
      await source.setViewportSize({ width, height });
      await source.emulateMedia({ reducedMotion, colorScheme });
      await dock.hover();
      await settle(dock);
      const rect = await dock.boundingBox();
      await source.mouse.move(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      await source.mouse.down();
      await source.mouse.move(width / 2, height / 2, { steps: 6 });
      await source.mouse.move(side === "left" ? 20 : width - 20, height / 2, {
        steps: 8,
      });
      await source.mouse.up();
      await source.waitForTimeout(260); // Existing drag suppression window.
      await openAtCentre();
      await expectTip(radial.locator("[data-op=toggle-lights]"));
      if (width === 390 && side === "right")
        await source.screenshot({
          path: path.join(artifacts, "radial-lights-tip-narrow.png"),
        });
      await expectTip(pin);
      await source.screenshot({
        path: path.join(artifacts, `radial-tip-${side}-${colorScheme}.png`),
      });
      await pin.click();
      assert.equal(await pin.getAttribute("aria-pressed"), "true");
      await expectTip(pin);
      await pin.click();
      assert.equal(await pin.getAttribute("aria-pressed"), "false");
      await closeAtCentre();
    }
    await dock.focus();
    await source.keyboard.press("Enter");
    await settle(radial);
    assert(
      await radial
        .locator("[data-op=open-settings]")
        .evaluate((node) => node.getRootNode().activeElement === node),
      "Keyboard opening still focuses the first action",
    );
    await radial.locator(".hover-tip:popover-open").waitFor();
    await settle(tip);
    assert.equal(
      await tip.textContent(),
      await radial
        .locator("[data-op=open-settings]")
        .getAttribute("aria-label"),
    );
    const homeBounds = await radial
      .locator("[data-op=open-settings]")
      .boundingBox();
    const focusTipBounds = await tip.boundingBox();
    assert(
      focusTipBounds.y + focusTipBounds.height <= homeBounds.y,
      "Keyboard tips wait for the flyout to reach its final position",
    );
    await source.keyboard.press("Escape");
    assert.equal(await radial.locator(".hover-tip:popover-open").count(), 0);
    assert.equal(await radial.locator("button[tabindex='0']").count(), 0);
    assert.equal(
      calls.length,
      before,
      "Opening, hovering and pinning never call a model",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: original flyout animation retained; dock-centre opening never hits or hovers Pin; all five localized custom hover tips and state updates, disabled/closed tip suppression, viewport bounds, keyboard focus, both sides, narrow/dark and reduced-motion layouts remain functional.",
    );
  } finally {
    await source.close();
  }
};
