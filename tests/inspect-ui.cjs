const assert = require("node:assert/strict");

// CDP can inspect closed roots. Expose this one only in Playwright's isolated
// selector world; the page and other extensions keep seeing a closed root.
async function inspectUI(page) {
  const host = page.locator("[data-pagework=ui]");
  await host.waitFor({ state: "attached" });
  assert(await host.evaluate((node) => node.shadowRoot === null));
  const session = await page.context().newCDPSession(page);
  try {
    const contexts = [];
    session.on("Runtime.executionContextCreated", ({ context }) =>
      contexts.push(context),
    );
    await session.send("Runtime.enable");
    const { frameTree } = await session.send("Page.getFrameTree");
    const utility = contexts.find(
      (c) =>
        c.name.startsWith("__playwright_utility_world_") &&
        c.auxData?.frameId === frameTree.frame.id,
    );
    assert(utility, "Playwright's selector world is available");
    const { root } = await session.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const find = (node) => {
      const attrs = node.attributes || [];
      if (
        attrs.some(
          (value, i) =>
            i % 2 === 0 && value === "data-pagework" && attrs[i + 1] === "ui",
        )
      )
        return node;
      for (const child of node.children || []) {
        const match = find(child);
        if (match) return match;
      }
    };
    const shadow = find(root)?.shadowRoots?.[0];
    assert.equal(shadow?.shadowRootType, "closed");
    const { object } = await session.send("DOM.resolveNode", {
      backendNodeId: shadow.backendNodeId,
      executionContextId: utility.id,
    });
    const result = await session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function() {
        const root = this;
        const original = Object.getOwnPropertyDescriptor(Element.prototype, 'shadowRoot').get;
        Object.defineProperty(Element.prototype, 'shadowRoot', {
          configurable: true,
          get() { return this === root.host ? root : original.call(this); }
        });
      }`,
    });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    assert(
      await host.evaluate((node) => node.shadowRoot === null),
      "Inspection never exposes the UI to page scripts",
    );
  } finally {
    await session.detach();
  }
}

function watchUI(context, errors) {
  context.on("page", (page) =>
    page.on("domcontentloaded", () => {
      const url = page.url();
      if (!/^https?:/.test(url)) return;
      inspectUI(page).catch((error) => {
        // Navigation invalidates the previous document's CDP node IDs.
        if (!page.isClosed() && page.url() === url)
          errors.push(`UI inspection (${url}): ${error.message}`);
      });
    }),
  );
}
module.exports = { inspectUI, watchUI };
