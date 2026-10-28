import type { Action, Connection, Daily, StoreData } from "./types.js";
import { localizeAction } from "./copy.js";
import { getPresets } from "./data.js";
import { defaultConnectionKey, ModelError } from "./providers.js";

export type SyncedConnection = Omit<Connection, "models" | "hasKey" | "id"> & {
  id: string;
  key: string;
};
export type SyncedAction = Omit<Action, "quick">;
export type SyncedDaily = Pick<
  Daily,
  "model" | "prompt" | "outputLanguage" | "useCollection"
>;
export interface SyncRecord<T> {
  updatedAt: number;
  writer: string;
  value: T | null;
}
export const DEFAULT_MODEL_KEYS = [
  "defaultConnection",
  "defaultDecisionConnection",
] as const;
type DefaultModelKey = (typeof DEFAULT_MODEL_KEYS)[number];
export interface SyncData {
  defaults?: Partial<Record<DefaultModelKey, SyncRecord<string>>>;
  connections: Record<string, SyncRecord<SyncedConnection>>;
  actions: Record<string, SyncRecord<SyncedAction>>;
  daily: SyncRecord<SyncedDaily>;
}
export interface SyncReplica {
  deviceId: string;
  clock: number;
  data: SyncData;
}
interface Configuration {
  defaults: Record<DefaultModelKey, string | null>;
  connections: Record<string, SyncedConnection>;
  actions: Record<string, SyncedAction>;
  daily: SyncedDaily;
}
export function configuration(data: StoreData): Configuration {
  return {
    defaults: {
      defaultConnection: data.settings.defaultConnection,
      defaultDecisionConnection:
        data.settings.defaultDecisionConnection ?? null,
    },
    connections: Object.fromEntries(
      data.settings.connections
        .filter((c) => c.id)
        .map((c) => {
          const { models: _models, hasKey: _hasKey, ...connection } = c;
          return [
            c.id!,
            { ...connection, id: c.id!, key: data.credentials[c.id!] || "" },
          ];
        }),
    ),
    actions: Object.fromEntries(
      data.settings.actions.map((action) => {
        // Default display copy follows the local interface language, not the writer's language.
        const { quick: _quick, ...shared } = localizeAction(action, "en");
        return [action.id, shared];
      }),
    ),
    daily: {
      model: data.daily.model,
      prompt: data.daily.prompt,
      outputLanguage: data.daily.outputLanguage,
      useCollection: data.daily.useCollection,
    },
  };
}
export function configurationText(data: unknown): string {
  return JSON.stringify(data, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")),
        )
      : value,
  );
}
const same = (a: unknown, b: unknown) =>
  configurationText(a) === configurationText(b);
const baseline = <T>(value: T): SyncRecord<T> => ({
  updatedAt: 0,
  writer: "",
  value,
});
export function initializeSyncRecords(data: StoreData): SyncReplica {
  if (!data.configurationRecords) {
    const current = configuration(data);
    // Existing settings have no reliable modification time. Joining explicitly adopts
    // cloud records for overlapping baselines; unique local records are retained.
    data.configurationRecords = {
      deviceId: crypto.randomUUID(),
      clock: 0,
      data: {
        connections: Object.fromEntries(
          Object.entries(current.connections).map(([id, value]) => [
            id,
            baseline(value),
          ]),
        ),
        actions: Object.fromEntries(
          Object.entries(current.actions).map(([id, value]) => [
            id,
            baseline(value),
          ]),
        ),
        daily: baseline(current.daily),
      },
    };
  }
  // Default choices are optional suggestions. Only an unset receiver adopts them.
  data.configurationRecords.data.defaults ??= Object.fromEntries(
    DEFAULT_MODEL_KEYS.flatMap((key) =>
      data.settings[key] ? [[key, baseline(data.settings[key]!)]] : [],
    ),
  );
  return data.configurationRecords;
}
// Called in the same serialized storage transaction as a user edit, even when
// sync is stopped or locked. Receiving data never creates a newer edit timestamp.
export function recordConfigurationChanges(
  data: StoreData,
  before: Configuration,
) {
  const replica = initializeSyncRecords(data);
  const after = configuration(data);
  const stamp = {
    updatedAt: Math.max(Date.now(), replica.clock + 1),
    writer: replica.deviceId,
  };
  let changed = false;
  function update<T>(
    previous: Record<string, T>,
    next: Record<string, T>,
    records: Record<string, SyncRecord<T>>,
  ) {
    for (const id of new Set([
      ...Object.keys(previous),
      ...Object.keys(next),
    ])) {
      if (same(previous[id], next[id])) continue;
      if (records[id]?.value === null) {
        // Reject stale editors atomically instead of saving an item that sync deletes again.
        if (next[id] !== undefined) throw new ModelError("recordDeleted");
        continue;
      }
      records[id] = { ...stamp, value: next[id] ?? null };
      changed = true;
    }
  }
  update(before.connections, after.connections, replica.data.connections);
  update(before.actions, after.actions, replica.data.actions);
  if (!same(before.daily, after.daily)) {
    replica.data.daily = { ...stamp, value: after.daily };
    changed = true;
  }
  for (const key of DEFAULT_MODEL_KEYS) {
    if (before.defaults[key] !== after.defaults[key]) {
      replica.data.defaults![key] = { ...stamp, value: after.defaults[key] };
      changed = true;
    }
  }
  if (changed) replica.clock = stamp.updatedAt;
}
function winner<T>(
  a: SyncRecord<T>,
  b: SyncRecord<T>,
  deletionWins = true,
): SyncRecord<T> {
  // Deletion is permanent for an ID. Re-creating an item must use a new ID.
  if (deletionWins && (a.value === null) !== (b.value === null))
    return a.value === null ? a : b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.writer !== b.writer) return a.writer > b.writer ? a : b;
  // Unversioned baselines can differ. Keep the merge deterministic and commutative.
  return configurationText(a.value) >= configurationText(b.value) ? a : b;
}
export function mergeConfiguration(
  local: SyncData,
  remote: SyncData,
  joining = false,
): SyncData {
  function record<T>(
    a: SyncRecord<T> | undefined,
    b: SyncRecord<T> | undefined,
    deletionWins = true,
  ): SyncRecord<T> {
    if (!a) return b!;
    if (!b) return a;
    return joining && a.updatedAt === 0 && a.value !== null
      ? b
      : winner(a, b, deletionWins);
  }
  function map<T>(
    a: Record<string, SyncRecord<T>>,
    b: Record<string, SyncRecord<T>>,
  ) {
    return Object.fromEntries(
      [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .sort()
        .map((id) => [id, record(a[id], b[id])]),
    );
  }
  return structuredClone({
    defaults: Object.fromEntries(
      DEFAULT_MODEL_KEYS.flatMap((key) => {
        const a = local.defaults?.[key],
          b = remote.defaults?.[key];
        return a || b ? [[key, record(a, b, false)]] : [];
      }),
    ),
    connections: map(local.connections, remote.connections),
    actions: map(local.actions, remote.actions),
    daily: record(local.daily, remote.daily),
  });
}
export function applyConfiguration(data: StoreData, merged: SyncData) {
  const replica = initializeSyncRecords(data);
  replica.data = structuredClone(merged);
  replica.clock = Math.max(
    replica.clock,
    ...Object.values(merged.connections).map((r) => r.updatedAt),
    ...Object.values(merged.actions).map((r) => r.updatedAt),
    merged.daily.updatedAt,
    ...Object.values(merged.defaults ?? {}).map((r) => r.updatedAt),
  );
  function ordered<T extends { id: string | null }>(
    old: readonly { id: string | null }[],
    records: Record<string, SyncRecord<T>>,
  ) {
    const ids = [
      ...old.map((item) => item.id!),
      ...Object.keys(records)
        .sort()
        .filter((id) => !old.some((item) => item.id === id)),
    ];
    return ids.flatMap((id) =>
      records[id]?.value ? [records[id].value!] : [],
    );
  }
  const oldConnections = data.settings.connections;
  data.settings.connections = ordered(oldConnections, merged.connections).map(
    ({ key: _key, ...connection }) => {
      const old = oldConnections.find(
        (c) =>
          c.id === connection.id &&
          c.url === connection.url &&
          c.protocol === connection.protocol,
      );
      return { ...connection, ...(old?.models ? { models: old.models } : {}) };
    },
  );
  data.credentials = Object.fromEntries(
    Object.values(merged.connections).flatMap(({ value }) =>
      value ? [[value.id, value.key]] : [],
    ),
  );
  const generationIds = new Set(
    data.settings.connections
      .filter((c) => defaultConnectionKey(c) === "defaultConnection")
      .map((c) => c.id),
  );
  const model = (id: string | undefined) =>
    id && generationIds.has(id) ? id : "default";
  const oldActions = data.settings.actions;
  const presets = getPresets();
  data.settings.actions = ordered(oldActions, merged.actions).map((action) => ({
    ...action,
    model: model(action.model),
    quick:
      oldActions.find((a) => a.id === action.id)?.quick ??
      presets.find((a) => a.id === action.id)?.quick ??
      false,
  }));
  for (const key of DEFAULT_MODEL_KEYS) {
    const matchesPurpose = (id: string | null | undefined) =>
      data.settings.connections.find(
        (c) => c.id === id && defaultConnectionKey(c) === key,
      );
    if (!matchesPurpose(data.settings[key])) data.settings[key] = null;
    const suggestion = matchesPurpose(merged.defaults?.[key]?.value);
    if (!data.settings[key] && suggestion?.connected && suggestion.model.trim())
      data.settings[key] = suggestion.id;
  }
  data.daily = {
    ...data.daily,
    ...merged.daily.value!,
    model: model(merged.daily.value!.model),
  };
}
