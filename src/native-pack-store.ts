import { localStore, localStoreReady } from "./extension-storage.js";
import { isNativePackProgress, nativePackId } from "./native-packs.js";
import type {
  NativePackProgress,
  NativePackRecord,
  NativePackSnapshot,
} from "./native-packs.js";

const STORE_KEY = "native-language-packs";
export function registerNativePackTracking() {
  const active = new Map<chrome.runtime.Port, NativePackProgress>();
  const watchers = new Set<chrome.runtime.Port>();
  const ports = new Set<chrome.runtime.Port>();
  let records: NativePackRecord[] = [];
  let queue = localStoreReady
    .then(async () => {
      const stored = (await localStore.get(STORE_KEY))[STORE_KEY];
      if (Array.isArray(stored))
        records = stored.filter(
          (record) =>
            isNativePackProgress({ pack: record?.pack, state: "ready" }) &&
            (record.readyAt === undefined ||
              (Number.isFinite(record.readyAt) && record.readyAt > 0)),
        );
    })
    .catch(() => {});
  const broadcast = () => {
    const snapshot: NativePackSnapshot = {
      records,
      active: [...active.values()],
    };
    for (const watcher of watchers) {
      try {
        watcher.postMessage(snapshot);
      } catch {
        watchers.delete(watcher);
      }
    }
  };
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "native-packs" || port.sender?.id !== chrome.runtime.id)
      return;
    ports.add(port);
    let closed = false;
    port.onMessage.addListener((value: unknown) => {
      if (value === "watch") {
        if (!port.sender?.url?.startsWith(chrome.runtime.getURL(""))) return;
        watchers.add(port);
        void queue.then(broadcast);
        return;
      }
      if (!isNativePackProgress(value)) return;
      const event = value;
      if (["ready", "activation", "error"].includes(event.state))
        active.delete(port);
      else active.set(port, event);
      queue = queue
        .then(async () => {
          const id = nativePackId(event.pack);
          let record = records.find((item) => nativePackId(item.pack) === id);
          const newRecord = !record;
          if (!record) {
            record = { pack: event.pack };
            records.push(record);
          }
          const ready = event.state === "ready" && !record.readyAt;
          if (ready) record.readyAt = Date.now();
          if (newRecord || ready)
            await localStore.set({ [STORE_KEY]: records });
          // A finished operation can still report readiness after its port closes.
          if (closed) active.delete(port);
          broadcast();
        })
        .catch(() => {
          broadcast();
        });
    });
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      closed = true;
      active.delete(port);
      watchers.delete(port);
      broadcast();
    });
  });
  return async () => {
    for (const port of ports) port.disconnect();
    ports.clear();
    await queue;
    records = [];
    active.clear();
    watchers.clear();
    await localStore.remove(STORE_KEY);
  };
}
