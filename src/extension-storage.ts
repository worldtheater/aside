import { isFirefox } from "./browser.js";
import { createPrivateStorage } from "./private-storage.js";
import type { StorageChanges, LocalStorageArea } from "./private-storage.js";

type Listener = (changes: StorageChanges, area: string) => void;
const listeners = new Map<Listener, Listener>();
let channel: BroadcastChannel | undefined;
if (isFirefox) {
  if (!location.href.startsWith(chrome.runtime.getURL("")))
    throw new Error("Private settings are only available to extension pages");
  channel = new BroadcastChannel("aside-settings-changed");
  channel.onmessage = (event: MessageEvent<StorageChanges>) =>
    dispatch(event.data);
}
function dispatch(changes: StorageChanges) {
  for (const listener of listeners.keys()) listener(changes, "local");
}
export const storageChanges = {
  addListener(listener: Listener) {
    if (listeners.has(listener)) return;
    // Firefox's native local area is not our private settings store. Never let
    // content-script writes to that area impersonate a trusted settings event.
    const native: Listener = (changes, area) => {
      if (!isFirefox || area !== "local") listener(changes, area);
    };
    listeners.set(listener, native);
    chrome.storage.onChanged.addListener(native);
  },
  removeListener(listener: Listener) {
    const native = listeners.get(listener);
    if (native) chrome.storage.onChanged.removeListener(native);
    listeners.delete(listener);
  },
};
export const localStore: LocalStorageArea = isFirefox
  ? createPrivateStorage((changes) => {
      channel!.postMessage(changes);
      dispatch(changes);
    })
  : chrome.storage.local;
export const localStoreReady = isFirefox
  ? Promise.resolve()
  : chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
export const configurationStorage = {
  local: localStore,
  sync: chrome.storage.sync,
  session: chrome.storage.session,
  onChanged: storageChanges,
};
