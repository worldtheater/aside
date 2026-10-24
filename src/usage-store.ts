import type {
  UsageDetails,
  UsageRecord,
  UsageFilter,
  UsageOverview,
  UsageCursor,
  UsageDay,
} from "./types.js";
import {
  addUsageToSummary,
  summarizeUsage,
  usageModelKey,
  usageSince,
  fillUsageDays,
} from "./usage.js";

const PAGE_SIZE = 50;
function notifyUsageChange() {
  const changes = new BroadcastChannel("aside-usage");
  changes.postMessage(null);
  changes.close();
}
let database: Promise<IDBDatabase> | undefined;
type StoredRecord = UsageRecord & { modelKey: string };

function openUsageDatabase(): Promise<IDBDatabase> {
  return (database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("aside-usage", 3);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) db.createObjectStore("details");
      if (event.oldVersion < 2) {
        const records = db.createObjectStore("records", { keyPath: "id" });
        records.createIndex("byTime", ["startedAt", "id"]);
        records.createIndex("byModelTime", ["modelKey", "startedAt", "id"]);
        records.createIndex("modelKey", "modelKey");
      }
      // The obsolete import marker is no longer part of the schema.
      if (db.objectStoreNames.contains("meta")) db.deleteObjectStore("meta");
    };
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
const result = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const committed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });

export async function getUsageDetails(
  id: string,
): Promise<UsageDetails | null> {
  const db = await openUsageDatabase();
  return (
    (await result<UsageDetails | undefined>(
      db.transaction("details").objectStore("details").get(id),
    )) ?? null
  );
}
export async function addUsage(record: UsageRecord, details?: UsageDetails) {
  const db = await openUsageDatabase();
  const tx = db.transaction(["records", "details"], "readwrite"),
    done = committed(tx);
  tx.objectStore("records").put({ ...record, modelKey: usageModelKey(record) });
  if (details) tx.objectStore("details").put(details, record.id);
  await done;
  notifyUsageChange();
}
function selection(
  store: IDBObjectStore,
  filter: UsageFilter,
  before?: UsageCursor,
) {
  const since = usageSince(filter.period);
  const prefix = filter.model === "all" ? [] : [filter.model];
  return {
    index: store.index(filter.model === "all" ? "byTime" : "byModelTime"),
    range: IDBKeyRange.bound(
      [...prefix, since, ""],
      [...prefix, ...(before || [Infinity, ""])],
      false,
      Boolean(before),
    ),
  };
}
export async function listUsage(
  filter: UsageFilter = { period: "all", model: "all" },
  before?: UsageCursor,
): Promise<UsageRecord[]> {
  const db = await openUsageDatabase();
  const { index, range } = selection(
    db.transaction("records").objectStore("records"),
    filter,
    before,
  );
  return new Promise((resolve, reject) => {
    const records: UsageRecord[] = [];
    const request = index.openCursor(range, "prev");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(records);
      const { modelKey: _, ...record } = cursor.value as StoredRecord;
      records.push(record);
      if (records.length === PAGE_SIZE) resolve(records);
      else cursor.continue();
    };
  });
}
export async function usageOverview(
  filter: UsageFilter = { period: "all", model: "all" },
): Promise<UsageOverview> {
  const db = await openUsageDatabase();
  const tx = db.transaction("records"),
    done = committed(tx),
    store = tx.objectStore("records");
  const total = result(store.count());
  const models: UsageOverview["models"] = [];
  const modelRequest = store.index("modelKey").openCursor(null, "nextunique");
  modelRequest.onsuccess = () => {
    const cursor = modelRequest.result;
    if (!cursor) return;
    const record = cursor.value as StoredRecord;
    models.push({
      value: record.modelKey,
      model: record.model,
      connectionName: record.connectionName,
    });
    cursor.continue();
  };
  const summary = summarizeUsage([]),
    days = new Map<number, UsageDay>();
  const { index, range } = selection(store, filter);
  const request = index.openCursor(range);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const record = cursor.value as UsageRecord;
    addUsageToSummary(summary, record);
    const date = new Date(record.startedAt).setHours(0, 0, 0, 0);
    const day = days.get(date) || {
      date,
      totalTokens: null,
      calls: 0,
      incomplete: false,
    };
    day.calls++;
    if (record.tokens?.totalTokens != null)
      day.totalTokens = (day.totalTokens ?? 0) + record.tokens.totalTokens;
    day.incomplete ||= !record.usageFinal || record.tokens?.totalTokens == null;
    days.set(date, day);
    cursor.continue();
  };
  await done;
  return {
    summary,
    days: fillUsageDays([...days.values()], filter.period),
    models,
    totalRecords: await total,
  };
}
export async function clearUsage() {
  const db = await openUsageDatabase();
  const tx = db.transaction(["records", "details"], "readwrite"),
    done = committed(tx);
  tx.objectStore("records").clear();
  tx.objectStore("details").clear();
  await done;
  notifyUsageChange();
}
