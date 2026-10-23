import assert from "node:assert/strict";

const listeners = {},
  stored = {},
  updates = [];
const tabs = new Map([
  [1, { id: 1, windowId: 10, active: true }],
  [2, { id: 2, windowId: 10, active: false }],
  [3, { id: 3, windowId: 10, active: false }],
  [4, { id: 4, windowId: 20, active: true }],
  [5, { id: 5, windowId: 20, active: false }],
]);
const event = (name) => ({
  addListener: (listener) => {
    listeners[name] = listener;
  },
});
const settle = () => new Promise((resolve) => setImmediate(resolve));
let currentWindow = 10,
  failNextUpdate = false;
const activate = async (id) => {
  const tab = tabs.get(id);
  for (const candidate of tabs.values())
    if (candidate.windowId === tab.windowId)
      candidate.active = candidate.id === id;
  listeners.activated({ tabId: id, windowId: tab.windowId });
  await settle();
};
globalThis.chrome = {
  storage: {
    session: {
      get: async () => structuredClone(stored),
      set: async (value) => Object.assign(stored, structuredClone(value)),
    },
  },
  tabs: {
    onActivated: event("activated"),
    onRemoved: event("removed"),
    onDetached: event("detached"),
    onAttached: event("attached"),
    onReplaced: event("replaced"),
    query: async (query) =>
      structuredClone(
        [...tabs.values()].filter(
          (tab) =>
            (query.windowId === undefined || tab.windowId === query.windowId) &&
            (!query.currentWindow || tab.windowId === currentWindow) &&
            (query.active === undefined || query.active === tab.active),
        ),
      ),
    get: async (id) => structuredClone(tabs.get(id)),
    update: async (id) => {
      if (failNextUpdate) {
        failNextUpdate = false;
        throw Error("Tab was closed while switching");
      }
      updates.push(id);
      // The native activation callback can arrive after the update resolves.
      const tab = tabs.get(id);
      for (const candidate of tabs.values())
        if (candidate.windowId === tab.windowId)
          candidate.active = candidate.id === id;
      queueMicrotask(() =>
        listeners.activated({ tabId: id, windowId: tab.windowId }),
      );
      return structuredClone(tab);
    },
  },
};
const { trackRecentTabs, switchRecentTab } = await import("../recent-tabs.js");
trackRecentTabs();
await settle();
assert.deepEqual(stored.recentTabs, { 10: [1], 20: [4] });
await switchRecentTab(10);
assert.deepEqual(updates, [], "Unvisited background tabs are excluded");
await activate(2);
await activate(1);
await switchRecentTab(10);
await switchRecentTab(10);
await settle();
assert.deepEqual(updates, [2, 1]);
await Promise.all(Array.from({ length: 8 }, () => switchRecentTab(10)));
await settle();
assert.deepEqual(
  updates.slice(-8),
  [2, 1, 2, 1, 2, 1, 2, 1],
  "Every rapid command toggles exactly once",
);
await activate(3);
await switchRecentTab(10);
await switchRecentTab(10);
await settle();
assert.deepEqual(
  stored.recentTabs[10],
  [3, 1, 2],
  "Manual browsing establishes a new pair",
);
tabs.delete(1);
listeners.removed(1, { windowId: 10, isWindowClosing: false });
await switchRecentTab(10);
await settle();
assert.equal(
  updates.at(-1),
  2,
  "Closing the previous tab exposes the next recently used live tab",
);
await activate(5);
currentWindow = 20;
await switchRecentTab();
await settle();
assert.equal(updates.at(-1), 4);
assert.deepEqual(stored.recentTabs[10], [2, 3]);
// A command queued from one window cannot jump to a newly focused window.
await switchRecentTab(10);
await settle();
assert.equal(updates.at(-1), 3);
assert.deepEqual(stored.recentTabs[20], [4, 5]);
listeners.detached(2, { oldWindowId: 10 });
tabs.get(2).windowId = 20;
tabs.get(2).active = false;
listeners.attached(2, { newWindowId: 20 });
await settle();
assert.deepEqual(stored.recentTabs[10], [3]);
assert.deepEqual(stored.recentTabs[20], [4, 5]);
await activate(2);
await switchRecentTab(20);
await settle();
assert.deepEqual(stored.recentTabs[20], [4, 2, 5]);
const replaced = tabs.get(2);
tabs.delete(2);
tabs.set(6, { ...replaced, id: 6 });
listeners.replaced(6, 2);
await settle();
await switchRecentTab(20);
await settle();
assert.equal(updates.at(-1), 6);
// Prune a stale live-window reference even if its close event has not arrived.
tabs.delete(4);
await switchRecentTab(20);
await settle();
assert.equal(updates.at(-1), 5);
const info = console.info,
  messages = [];
console.info = (...args) => messages.push(args);
try {
  failNextUpdate = true;
  await switchRecentTab(20);
  await switchRecentTab(20);
  await settle();
  assert.equal(messages.length, 1);
  assert.equal(
    updates.at(-1),
    6,
    "A disappeared-tab failure cannot poison later commands",
  );
} finally {
  console.info = info;
}
listeners.removed(6, { windowId: 20, isWindowClosing: true });
await settle();
assert.equal(stored.recentTabs[20], undefined);
assert.deepEqual(stored.recentTabs[10], [3]);
console.log(
  "PASS: recent-tab toggle, rapid commands, manual browsing, per-window isolation, unseen background tabs, close/move/replace cleanup and failure recovery.",
);
