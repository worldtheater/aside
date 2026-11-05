export type StorageChanges = Record<string, chrome.storage.StorageChange>;
export interface LocalStorageArea {
  get<T = Record<string, unknown>>(keys: string | string[] | null): Promise<T>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

// Firefox and Safari do not support storage.local.setAccessLevel. An extension-origin
// database keeps both secrets and the endpoints that receive them privileged.
export function createPrivateStorage(
  notify: (changes: StorageChanges) => void,
): LocalStorageArea {
  let database: Promise<IDBDatabase> | undefined;
  function open() {
    return (database ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("aside-settings", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("settings");
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
    }));
  }
  async function change(values: Record<string, unknown>, remove: string[]) {
    const db = await open();
    const changes: StorageChanges = {};
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      const store = tx.objectStore("settings");
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error || new Error("Settings transaction aborted"));
      for (const key of new Set([...Object.keys(values), ...remove])) {
        const request = store.get(key);
        request.onsuccess = () => {
          const oldValue = request.result;
          const deleting = remove.includes(key);
          const newValue = deleting ? undefined : values[key];
          if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
          changes[key] = deleting ? { oldValue } : { oldValue, newValue };
          if (deleting) store.delete(key);
          else store.put(newValue, key);
        };
      }
    });
    if (Object.keys(changes).length) notify(changes);
  }
  return {
    async get<T = Record<string, unknown>>(keys: string | string[] | null) {
      const db = await open();
      const selected =
        keys === null ? null : new Set(Array.isArray(keys) ? keys : [keys]);
      return new Promise<T>((resolve, reject) => {
        const values: Record<string, unknown> = {};
        const tx = db.transaction("settings", "readonly");
        tx.oncomplete = () => resolve(values as T);
        tx.onabort = () =>
          reject(tx.error || new Error("Settings read aborted"));
        const request = tx.objectStore("settings").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const key = String(cursor.key);
          if (!selected || selected.has(key)) values[key] = cursor.value;
          cursor.continue();
        };
      });
    },
    set: (values) => change(structuredClone(values), []),
    remove: (keys) => change({}, Array.isArray(keys) ? keys : [keys]),
  };
}
