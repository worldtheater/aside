import assert from "node:assert/strict";

// Exercise the installed menu and its event handler without a real model call.
const listeners = {};
const event = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
const stored = {},
  menus = new Map(),
  sent = [],
  injected = [],
  opened = [];
globalThis.chrome = {
  runtime: {
    id: "fixture",
    getURL: (path) => `chrome-extension://fixture/${path}`,
    onInstalled: event("installed"),
    onMessage: event("message"),
    onConnect: event("connect"),
  },
  storage: {
    session: {
      get: async () => ({}),
      set: async () => {},
    },
    local: {
      setAccessLevel: async () => {},
      get: async (keys) =>
        structuredClone(
          Object.fromEntries(
            (typeof keys === "string" ? [keys] : keys).map((key) => [
              key,
              stored[key],
            ]),
          ),
        ),
      set: async (values) => Object.assign(stored, structuredClone(values)),
    },
  },
  scripting: {
    getRegisteredContentScripts: async () => [],
    executeScript: async (details) => {
      injected.push(details);
      if (details.files?.includes("content.js"))
        globalThis.__pagework ??= Promise.resolve();
      return [{ result: details.func ? await details.func() : undefined }];
    },
  },
  contextMenus: {
    onClicked: event("click"),
    removeAll: (done) =>
      setImmediate(() => {
        menus.clear();
        done();
      }),
    create: (item, done) =>
      setImmediate(() => {
        assert(!menus.has(item.id), `Duplicate menu: ${item.id}`);
        if (item.parentId) assert(menus.has(item.parentId));
        menus.set(item.id, item);
        done();
      }),
  },
  tabs: {
    onActivated: event("tab-activated"),
    onRemoved: event("tab-removed"),
    onDetached: event("tab-detached"),
    onAttached: event("tab-attached"),
    onReplaced: event("tab-replaced"),
    query: async () => [],
    sendMessage: async (tabId, message) => sent.push({ tabId, message }),
    create: async (details) => opened.push(details),
  },
  commands: { onCommand: event("command") },
};
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en" },
  configurable: true,
});
await import("../background.js");
await listeners.installed({ reason: "install" });
// The new command is routed before page processing and cannot inject a toolbar.
const beforeSwitch = injected.length;
await listeners.command("switch-recent-tab", { windowId: 99 });
assert.equal(injected.length, beforeSwitch);

assert.equal(menus.get("selection").title, "Process selection with Aside");
assert.deepEqual(
  [...menus.keys()],
  ["selection", ...stored.settings.actions.map((a) => `selection:${a.id}`)],
);
assert.equal(menus.get("selection:summary").parentId, "selection");
assert.equal(
  stored.settings.actions.find((a) => a.id === "summary").quick,
  false,
);
assert(
  [...menus.values()].every((item) => item.contexts.join() === "selection"),
);

const message = (request) =>
  new Promise((resolve) =>
    listeners.message(
      request,
      {
        id: "fixture",
        url: "chrome-extension://fixture/index.html",
      },
      resolve,
    ),
  );
const save = async (patch) => {
  const response = await message({ type: "settings.save", patch });
  assert(response.ok, JSON.stringify(response));
};
const custom = {
  id: "custom:note",
  name: "My note",
  instruction: "Explain the selected text.",
  kind: "custom",
  mode: "whole",
  placement: "panel",
  quick: false,
  icon: "spark",
  model: "default",
};
await save({ actions: [...stored.settings.actions, custom] });
assert.equal(menus.get("selection:custom:note").title, "My note");
await Promise.all([
  save({
    actions: stored.settings.actions.map((a) =>
      a.id === custom.id ? { ...a, name: "Renamed note" } : a,
    ),
  }),
  save({ preferences: { ...stored.settings.preferences, locale: "zh-CN" } }),
]);
assert.equal(menus.get("selection").title, "用旁白处理选中文字");
assert.equal(menus.get("selection:translate").title, "翻译");
assert.equal(menus.get("selection:custom:note").title, "Renamed note");
assert.equal(menus.size, stored.settings.actions.length + 1);

const fromToolbar = await message({
  type: "actions.save",
  changes: [
    {
      id: "toolbar-note",
      name: "Toolbar note",
      instruction: "Read this carefully.",
      model: "default",
      create: true,
    },
  ],
});
assert(fromToolbar.ok, JSON.stringify(fromToolbar));
assert.equal(menus.get("selection:toolbar-note").title, "Toolbar note");
await listeners.click(
  {
    menuItemId: "selection:custom:note",
    parentMenuItemId: "selection",
    selectionText: "Selected words",
  },
  { id: 7 },
);
assert.deepEqual(sent, [
  {
    tabId: 7,
    message: {
      type: "selection.process",
      actionId: custom.id,
      text: "Selected words",
    },
  },
]);
assert.equal(injected.length, 2);
assert.deepEqual(injected[0].files, ["extract.js", "content.js"]);
assert.equal(typeof injected[1].func, "function");
assert.equal(opened.length, 0);

let ready;
globalThis.__pagework = new Promise((resolve) => {
  ready = resolve;
});
const pendingClick = listeners.click(
  {
    menuItemId: "selection:qa",
    parentMenuItemId: "selection",
    selectionText: "Quoted text",
  },
  { id: 7 },
);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
  sent.length,
  1,
  "A cold page must finish initialization before receiving the action",
);
ready();
await pendingClick;
assert.equal(sent.at(-1).message.actionId, "qa");
assert.equal(opened.length, 0);
delete globalThis.__pagework;

const execute = chrome.scripting.executeScript,
  logError = console.error;
let menuError;
chrome.scripting.executeScript = async () => {
  throw new Error("Cannot access this page");
};
console.error = (...args) => {
  menuError = args;
};
try {
  await listeners.click(
    {
      menuItemId: "selection:qa",
      parentMenuItemId: "selection",
      selectionText: "Quoted text",
    },
    { id: 7 },
  );
  assert(menuError[1].message.includes("Cannot access"));
  assert.equal(
    opened.length,
    0,
    "An injection failure never redirects to the homepage",
  );
} finally {
  chrome.scripting.executeScript = execute;
  console.error = logError;
}
await save({
  actions: stored.settings.actions.filter((a) => a.id !== custom.id),
});
assert(!menus.has("selection:custom:note"));
for (const info of [
  { menuItemId: "selection" },
  { menuItemId: "selection:custom:note", parentMenuItemId: "selection" },
  { menuItemId: "selection:translate", parentMenuItemId: "unrelated" },
  {
    menuItemId: "selection:translate",
    parentMenuItemId: "selection",
    selectionText: " ",
  },
])
  await listeners.click(
    { selectionText: "Selected words", ...info },
    { id: 7 },
  );
assert.equal(
  sent.length,
  2,
  "Parent, deleted and unrelated entries never run the previous action",
);

await listeners.installed({ reason: "update" });
assert.equal(menus.get("selection").title, "用旁白处理选中文字");
assert.equal(menus.get("selection:toolbar-note").title, "Toolbar note");
console.log(
  "Context menu: install/reload, all actions, edits, locale, concurrent saves and selected-action routing passed.",
);

// Saving settings publishes notifications; unrelated pages are not participants
// in the storage transaction, even if one retains its asynchronous response.
const queryTabs = chrome.tabs.query,
  sendToTab = chrome.tabs.sendMessage;
const notifications = [],
  pending = new Promise(() => {});
chrome.tabs.query = async () => [{ id: 7 }, { id: 8 }];
chrome.tabs.sendMessage = (tabId, message) => {
  notifications.push({ tabId, message });
  return tabId === 8 ? pending : Promise.resolve(true);
};
try {
  for (const request of [
    {
      type: "settings.save",
      patch: {
        preferences: { locale: "zh-CN", theme: "dark", palette: "graphite" },
      },
    },
    { type: "actions.save", changes: [] },
  ]) {
    let timer;
    const response = await Promise.race([
      message(request),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Save waited for an unrelated page")),
          500,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    assert(response.ok, JSON.stringify(response));
  }
  assert.equal(stored.settings.preferences.theme, "dark");
  assert.deepEqual(
    notifications.map(({ tabId }) => tabId),
    [7, 8, 7, 8],
  );
  assert(
    notifications.every(({ message }) => message.type === "settings.updated"),
  );
} finally {
  chrome.tabs.query = queryTabs;
  chrome.tabs.sendMessage = sendToTab;
}
console.log(
  "PASS: settings/action saves publish to every page without waiting for unrelated responses.",
);

const startupFailure = new Error(
  "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
);
globalThis.__pagework = Promise.reject(startupFailure);
void globalThis.__pagework.catch(() => {});
const sentBeforeFailure = sent.length;
const failedEntry = await message({ type: "tab.enable", tabId: 7 });
assert.equal(failedEntry.ok, false);
assert.equal(failedEntry.error, "extensionDisconnected");
assert.equal(failedEntry.detail, startupFailure.message);
assert.equal(
  sent.length,
  sentBeforeFailure,
  "A failed controller is never reported as an opened toolbar",
);
delete globalThis.__pagework;
console.log(
  "PASS: injected startup failures propagate instead of acknowledging a missing toolbar.",
);

// Page commands use the tab captured with the shortcut, not a later active tab.
await listeners.command("quick-question", {
  id: 17,
  windowId: 9,
  url: "https://example.com/article",
});
assert.deepEqual(sent.at(-1), {
  tabId: 17,
  message: { type: "page.run", actionId: "qa", scope: "body", panel: true },
});
const afterCommands = injected.length;
const messagesAfterCommands = sent.length;
await listeners.command("process-page", { id: 18, windowId: 9 });
await listeners.command("unknown-command", { id: 17 });
assert.equal(injected.length, afterCommands);
assert.equal(sent.length, messagesAfterCommands);
const openedBeforeBlocked = opened.length;
for (const url of [
  undefined,
  "",
  "about:blank",
  "chrome://newtab/",
  "chrome://extensions/",
  "chrome-search://local-ntp/",
  "chrome-extension://fixture/index.html",
  "file:///tmp/page.html",
  "data:text/html,blank",
]) {
  await listeners.command("quick-question", { id: 17, url });
}
assert.equal(
  injected.length,
  afterCommands,
  "Non-web pages are rejected before injection",
);
assert.equal(sent.length, messagesAfterCommands);
assert.equal(
  opened.length,
  openedBeforeBlocked,
  "Non-web shortcuts never open settings tabs",
);
const commandExecute = chrome.scripting.executeScript;
const commandLog = console.info;
let blockedLog;
try {
  chrome.scripting.executeScript = async () => {
    throw new Error("Cannot access a protected page");
  };
  console.info = (...args) => {
    blockedLog = args;
  };
  await listeners.command("quick-question", {
    id: 17,
    url: "https://chromewebstore.google.com/detail/example",
  });
  assert(blockedLog);
  assert.equal(sent.length, messagesAfterCommands);
  assert.equal(
    opened.length,
    openedBeforeBlocked,
    "Rejected injection must not redirect to the homepage",
  );
} finally {
  chrome.scripting.executeScript = commandExecute;
  console.info = commandLog;
}
const actionsBefore = stored.settings.actions;
stored.settings.actions = actionsBefore.filter(
  (action) => action.kind !== "qa",
);
await listeners.command("quick-question", {
  id: 17,
  url: "https://example.com/article",
});
assert.equal(injected.length, afterCommands);
assert(opened.at(-1).url.endsWith("#actions"));
stored.settings.actions = actionsBefore;
console.log(
  "PASS: Q&A preserves its invoking tab, ignores retired/non-web commands, never redirects on blocked injection and opens action settings only for a removed Q&A action on a web page.",
);
