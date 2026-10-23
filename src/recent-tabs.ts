type TabHistory = Record<number, number[]>;
const HISTORY_KEY = "recentTabs";
let pending = Promise.resolve();

// Activation events and rapid commands share one queue. Session storage survives
// service-worker suspension without persisting tab IDs across browser sessions.
function updateHistory(change: (history: TabHistory) => void | Promise<void>) {
  const next = pending.then(async () => {
    const stored = await chrome.storage.session.get(HISTORY_KEY);
    const history = (stored[HISTORY_KEY] ?? {}) as TabHistory;
    await change(history);
    await chrome.storage.session.set({ [HISTORY_KEY]: history });
  });
  pending = next.catch((error) => {
    // Tabs can disappear while Chrome is handling a command or moving a window.
    console.info("Aside could not update recent tabs:", error);
  });
  return pending;
}

function remember(history: TabHistory, windowId: number, tabId: number) {
  history[windowId] = [
    tabId,
    ...(history[windowId] ?? []).filter((id) => id !== tabId),
  ];
}

function forget(history: TabHistory, windowId: number, tabId: number) {
  const remaining = (history[windowId] ?? []).filter((id) => id !== tabId);
  if (remaining.length) history[windowId] = remaining;
  else delete history[windowId];
}

export function trackRecentTabs() {
  chrome.tabs.onActivated.addListener(({ windowId, tabId }) => {
    void updateHistory((history) => remember(history, windowId, tabId));
  });
  chrome.tabs.onRemoved.addListener((tabId, { windowId, isWindowClosing }) => {
    void updateHistory((history) => {
      if (isWindowClosing) delete history[windowId];
      else forget(history, windowId, tabId);
    });
  });
  chrome.tabs.onDetached.addListener((tabId, { oldWindowId }) => {
    void updateHistory((history) => forget(history, oldWindowId, tabId));
  });
  chrome.tabs.onAttached.addListener((tabId) => {
    void updateHistory(async (history) => {
      const tab = await chrome.tabs.get(tabId);
      if (tab.active) remember(history, tab.windowId, tabId);
    });
  });
  chrome.tabs.onReplaced.addListener((added, removed) => {
    void updateHistory((history) => {
      for (const ids of Object.values(history)) {
        const index = ids.indexOf(removed);
        if (index !== -1) ids[index] = added;
      }
    });
  });
  void updateHistory(async (history) => {
    for (const tab of await chrome.tabs.query({ active: true })) {
      if (tab.id !== undefined && !history[tab.windowId])
        remember(history, tab.windowId, tab.id);
    }
  });
}

export function switchRecentTab(windowId?: number): Promise<void> {
  return updateHistory(async (history) => {
    const tabs = await chrome.tabs.query(
      windowId === undefined ? { currentWindow: true } : { windowId },
    );
    const active = tabs.find((tab) => tab.active);
    if (active?.id === undefined) return;
    const live = new Set(tabs.map((tab) => tab.id));
    history[active.windowId] = (history[active.windowId] ?? []).filter((id) =>
      live.has(id),
    );
    remember(history, active.windowId, active.id);
    const previous = history[active.windowId][1];
    if (previous === undefined) return;
    await chrome.tabs.update(previous, { active: true });
    // Do not wait for onActivated before accepting the next key press.
    remember(history, active.windowId, previous);
  });
}
