import type { CacheInfo } from "./types.js";

const CACHE_MAX_BYTES = 50 * 1024 * 1024;
export interface ResultCache {
  readonly generation: number;
  getMany(keys: string[]): Promise<Map<string, string>>;
  touch(keys: string[]): Promise<void>;
  putMany(
    entries: { key: string; text: string }[],
    generation: number,
  ): Promise<void>;
}
interface Entry {
  key: string;
  text: string;
  bytes: number;
  usedAt: number;
}
interface Totals {
  entries: number;
  bytes: number;
}
const result = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const committed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("cacheError"));
    tx.onerror = () => reject(tx.error);
  });

/** One extension-owned persistent cache; reads never update recency implicitly. */
export class IndexedResultCache implements ResultCache {
  generation = 0;
  private database?: Promise<IDBDatabase>;
  constructor(
    private name = "pagework-results",
    private maxBytes = CACHE_MAX_BYTES,
  ) {}
  private open(): Promise<IDBDatabase> {
    return (this.database ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore("entries", { keyPath: "key" })
          .createIndex("usedAt", "usedAt");
        request.result.createObjectStore("meta");
      };
      request.onerror = () => {
        this.database = undefined;
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
    }));
  }
  async getMany(keys: string[]): Promise<Map<string, string>> {
    const db = await this.open(),
      tx = db.transaction("entries"),
      done = committed(tx),
      store = tx.objectStore("entries");
    const entries = await Promise.all(
      keys.map((key) => result<Entry | undefined>(store.get(key))),
    );
    await done;
    return new Map(
      entries
        .filter((entry): entry is Entry => Boolean(entry))
        .map((entry) => [entry.key, entry.text]),
    );
  }
  async touch(keys: string[]): Promise<void> {
    if (!keys.length) return;
    const db = await this.open(),
      tx = db.transaction("entries", "readwrite"),
      done = committed(tx),
      store = tx.objectStore("entries");
    for (const key of new Set(keys)) {
      const get = store.get(key);
      get.onsuccess = () => {
        const entry = get.result as Entry | undefined;
        if (entry) store.put({ ...entry, usedAt: Date.now() });
      };
    }
    await done;
  }
  async putMany(
    entries: { key: string; text: string }[],
    generation: number,
  ): Promise<void> {
    const db = await this.open();
    if (generation !== this.generation) return;
    const tx = db.transaction(["entries", "meta"], "readwrite"),
      done = committed(tx),
      store = tx.objectStore("entries"),
      meta = tx.objectStore("meta");
    // All reads are queued while the transaction is active; their promise callbacks run in its event microtasks.
    const [stored, ...previous] = await Promise.all([
      result<Totals | undefined>(meta.get("totals")),
      ...entries.map((entry) =>
        result<Entry | undefined>(store.get(entry.key)),
      ),
    ]);
    const totals: Totals = stored
      ? { entries: stored.entries, bytes: stored.bytes }
      : { entries: 0, bytes: 0 };
    entries.forEach((entry, index) => {
      const bytes =
        new TextEncoder().encode(entry.text).length + entry.key.length + 32;
      if (!entry.text.trim() || bytes > this.maxBytes) return;
      const old = previous[index] as Entry | undefined;
      totals.bytes += bytes - (old?.bytes || 0);
      if (!old) totals.entries++;
      store.put({ ...entry, bytes, usedAt: Date.now() });
    });
    const cursor = store.index("usedAt").openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (totals.bytes > this.maxBytes && item) {
        const old = item.value as Entry;
        totals.bytes -= old.bytes;
        totals.entries--;
        item.delete();
        item.continue();
      } else meta.put(totals, "totals");
    };
    await done;
  }
  async stats(): Promise<CacheInfo> {
    const db = await this.open(),
      tx = db.transaction("meta"),
      done = committed(tx);
    const totals = await result<Totals | undefined>(
      tx.objectStore("meta").get("totals"),
    );
    await done;
    return {
      entries: totals?.entries || 0,
      bytes: totals?.bytes || 0,
      maxBytes: this.maxBytes,
    };
  }
  async clear(): Promise<void> {
    // Older pending provider requests may finish, but must not repopulate a cache the person just cleared.
    this.generation++;
    const db = await this.open(),
      tx = db.transaction(["entries", "meta"], "readwrite"),
      done = committed(tx);
    tx.objectStore("entries").clear();
    tx.objectStore("meta").clear();
    await done;
  }
}
