import { PROTECTED_CONFIGURATION } from "./credential-store.js";
import type { StoreData } from "./types.js";
import {
  SYNC_MIN_PASSPHRASE,
  SYNC_VERSION,
  SyncError,
  configurationHash,
  decryptConfiguration,
  deriveSyncKey,
  encryptConfiguration,
  newSalt,
} from "./sync-data.js";
import type { SyncData, SyncEnvelope } from "./sync-data.js";
import {
  configuration,
  configurationText,
  initializeSyncRecords,
  mergeConfiguration,
  applyConfiguration,
} from "./sync-records.js";

const PREFIX = "aside-config:";
const HEAD = `${PREFIX}head`;
export const SYNC_LOCAL_KEY = "configurationSync";
export const SYNC_SESSION_KEY = "configurationSyncKey";
const CHUNK_SIZE = 7_000;
// Leave room for the current and next snapshot while publishing a new revision.
const MAX_CIPHER_CHARS = 42_000;
const SYNC_DELAY_MS = 7_000;
interface Head extends Omit<SyncEnvelope, "ciphertext"> {
  chunks: number;
}
interface LocalState {
  version: number;
  enabled: boolean;
  revision: string | null;
  lastSyncedAt: number | null;
  error: string | null;
}
interface SessionKey {
  key: string;
  salt: string;
}
export interface SyncStatus {
  enabled: boolean;
  remote: boolean;
  revision: string | null;
  mode: "off" | "locked" | "ready" | "waiting" | "error";
  lastSyncedAt: number | null;
  error: string | null;
}
export type SyncConnect = "create" | "join" | "unlock";
interface Dependencies {
  storage: Pick<
    typeof chrome.storage,
    "local" | "sync" | "session" | "onChanged"
  >;
  mutate(
    fn: (data: StoreData) => Promise<void>,
    options?: { sync?: boolean },
  ): Promise<unknown>;
  applied(): Promise<void>;
}
const emptyState = (): LocalState => ({
  version: SYNC_VERSION,
  enabled: false,
  revision: null,
  lastSyncedAt: null,
  error: null,
});
const chunkKeys = (head: Head) =>
  Array.from(
    { length: head.chunks },
    (_, i) => `${PREFIX}${head.revision}:${i}`,
  );
export class ConfigurationSync {
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ready: Promise<unknown>;
  constructor(private deps: Dependencies) {
    this.ready = Promise.all(
      ["sync", "session"].map((area) =>
        deps.storage[area as "sync" | "session"].setAccessLevel({
          accessLevel: "TRUSTED_CONTEXTS",
        }),
      ),
    );
  }
  start() {
    this.deps.storage.onChanged.addListener((changes, area) => {
      if (
        (area === "sync" &&
          Object.keys(changes).some((key) => key.startsWith(PREFIX))) ||
        (area === "local" &&
          (changes[PROTECTED_CONFIGURATION] ||
            changes.settings ||
            changes.daily))
      )
        this.schedule();
    });
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.run().catch(() => {});
    }, SYNC_DELAY_MS);
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.ready;
      return task();
    });
    this.queue = next.catch(() => {});
    return next;
  }
  private async local(): Promise<LocalState> {
    const stored = await this.deps.storage.local.get(SYNC_LOCAL_KEY);
    const state = stored[SYNC_LOCAL_KEY] as LocalState | undefined;
    return state?.version === SYNC_VERSION ? state : emptyState();
  }
  private async save(state: LocalState) {
    if (JSON.stringify(await this.local()) !== JSON.stringify(state))
      await this.deps.storage.local.set({ [SYNC_LOCAL_KEY]: state });
  }
  private async head(): Promise<Head | null> {
    const stored = await this.deps.storage.sync.get(HEAD);
    const head = stored[HEAD] as Head | undefined;
    if (!head) return null;
    if (head.version !== SYNC_VERSION) throw new SyncError("version");
    if (
      typeof head.revision !== "string" ||
      !/^[a-z0-9-]{36}$/i.test(head.revision) ||
      typeof head.salt !== "string" ||
      typeof head.iv !== "string" ||
      !Number.isFinite(head.updatedAt) ||
      !Number.isInteger(head.chunks) ||
      head.chunks < 1 ||
      head.chunks > Math.ceil(MAX_CIPHER_CHARS / CHUNK_SIZE)
    )
      throw new SyncError("invalidData");
    return head;
  }
  private async remote(head: Head): Promise<SyncEnvelope> {
    const keys = chunkKeys(head);
    const stored = await this.deps.storage.sync.get(keys);
    if (keys.some((key) => typeof stored[key] !== "string"))
      throw new SyncError("waiting");
    const ciphertext = keys.map((key) => stored[key] as string).join("");
    if (ciphertext.length > MAX_CIPHER_CHARS)
      throw new SyncError("invalidData");
    return { ...head, ciphertext };
  }
  private async session(salt: string): Promise<SessionKey | null> {
    const stored = await this.deps.storage.session.get(SYNC_SESSION_KEY);
    const session = stored[SYNC_SESSION_KEY] as SessionKey | undefined;
    return session?.salt === salt ? session : null;
  }
  async status(): Promise<SyncStatus> {
    await this.ready;
    const state = await this.local();
    let head: Head | null;
    try {
      head = await this.head();
    } catch (error) {
      return {
        enabled: state.enabled,
        revision: null,
        lastSyncedAt: state.lastSyncedAt,
        remote: true,
        mode: "error",
        error: error instanceof SyncError ? error.code : "unavailable",
      };
    }
    const unlocked = head && (await this.session(head.salt));
    const mode = !state.enabled
      ? "off"
      : !unlocked && head
        ? "locked"
        : state.error === "waiting"
          ? "waiting"
          : state.error
            ? "error"
            : !unlocked
              ? "locked"
              : "ready";
    return {
      enabled: state.enabled,
      remote: !!head,
      revision: head?.revision ?? null,
      mode,
      lastSyncedAt: state.lastSyncedAt,
      error: state.error,
    };
  }
  private async sameRevision(expected: string | null) {
    if ((await this.head())?.revision !== (expected ?? undefined))
      throw new SyncError("waiting");
  }
  private async recordFailure(error: unknown) {
    const state = await this.local();
    await this.save({
      ...state,
      error:
        error instanceof SyncError
          ? error.code
          : /QUOTA_BYTES|MAX_ITEMS|bytes.*quota/i.test(String(error))
            ? "tooLarge"
            : "unavailable",
    });
  }
  run(): Promise<SyncStatus> {
    return this.enqueue(async () => {
      try {
        await this.reconcile();
      } catch (error) {
        await this.recordFailure(error);
      }
      return this.status();
    });
  }
  private async reconcile(joining = false) {
    const state = await this.local();
    if (!state.enabled) return;
    const head = await this.head();
    if (!head) throw new SyncError("remoteMissing");
    const session = await this.session(head.salt);
    if (!session) return;
    const remote = await decryptConfiguration(
      await this.remote(head),
      session.key,
    );
    const merged = await this.merge(remote, joining);
    await this.sameRevision(head.revision);
    if ((await configurationHash(merged)) !== (await configurationHash(remote)))
      await this.publish(merged, session, head);
    else await this.acknowledge(head);
  }
  private async acknowledge(head: Head) {
    const state = await this.local();
    await this.save({
      version: SYNC_VERSION,
      enabled: true,
      revision: head.revision,
      lastSyncedAt:
        head.revision === state.revision ? state.lastSyncedAt : Date.now(),
      error: null,
    });
  }
  private async merge(
    remote: SyncData | null,
    joining = false,
  ): Promise<SyncData> {
    let merged!: SyncData;
    let changed = false;
    // Merge inside the store's write queue, so a save during decryption cannot
    // be overwritten. Record versions and materialized settings commit together.
    await this.deps.mutate(
      async (data) => {
        const replica = initializeSyncRecords(data);
        merged = remote
          ? mergeConfiguration(replica.data, remote, joining)
          : structuredClone(replica.data);
        const before = configurationText(configuration(data));
        if (remote) applyConfiguration(data, merged);
        changed = before !== configurationText(configuration(data));
      },
      { sync: true },
    );
    if (changed) await this.deps.applied();
    return merged;
  }
  private async publish(
    data: SyncData,
    session: SessionKey,
    previous: Head | null,
  ) {
    const envelope = await encryptConfiguration(
      data,
      session.key,
      session.salt,
      previous?.revision ?? null,
    );
    if (envelope.ciphertext.length > MAX_CIPHER_CHARS)
      throw new SyncError("tooLarge");
    const { ciphertext, ...metadata } = envelope;
    const head: Head = {
      ...metadata,
      chunks: Math.ceil(ciphertext.length / CHUNK_SIZE),
      parent: previous?.revision ?? null,
    };
    const keys = chunkKeys(head);
    await this.sameRevision(previous?.revision ?? null);
    try {
      await this.deps.storage.sync.set(
        Object.fromEntries(
          keys.map((key, i) => [
            key,
            ciphertext.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
          ]),
        ),
      );
      // Publish the pointer only after all authenticated ciphertext chunks exist.
      await this.sameRevision(previous?.revision ?? null);
      await this.deps.storage.sync.set({ [HEAD]: head });
    } catch (error) {
      await this.deps.storage.sync.remove(keys).catch(() => {});
      throw error;
    }
    await this.acknowledge(head);
    if (previous) await this.deps.storage.sync.remove(chunkKeys(previous));
  }
  connect(
    passphrase: string,
    action: SyncConnect,
    expectedRevision: string | null,
  ): Promise<SyncStatus> {
    return this.enqueue(async () => {
      const head = await this.head();
      if ((head?.revision ?? null) !== expectedRevision)
        throw new SyncError("waiting");
      if (!["create", "join", "unlock"].includes(action))
        throw new SyncError("invalidData");
      if (typeof passphrase !== "string" || !passphrase.trim())
        throw new SyncError("passphraseRequired");
      if (action === "create" && passphrase.length < SYNC_MIN_PASSPHRASE)
        throw new SyncError("passphraseShort");
      if ((action === "create" && head) || (action !== "create" && !head))
        throw new SyncError("waiting");
      if (action === "unlock" && !(await this.local()).enabled)
        throw new SyncError("invalidData");
      const salt = head?.salt ?? newSalt();
      const session = { salt, key: await deriveSyncKey(passphrase, salt) };
      // Authenticate before changing settings, enabling sync or remembering a key.
      const remote = head
        ? await decryptConfiguration(await this.remote(head), session.key)
        : null;
      await this.sameRevision(expectedRevision);
      await this.deps.storage.session.set({ [SYNC_SESSION_KEY]: session });
      // First setup becomes enabled only after a complete cloud revision exists.
      if (head)
        await this.save({
          ...(await this.local()),
          enabled: true,
          error: null,
        });
      try {
        const merged = await this.merge(remote, action === "join");
        if (
          !head ||
          (await configurationHash(merged)) !==
            (await configurationHash(remote!))
        )
          await this.publish(merged, session, head);
        else await this.acknowledge(head);
      } catch (error) {
        if (!head) await this.deps.storage.session.remove(SYNC_SESSION_KEY);
        await this.recordFailure(error);
      }
      return this.status();
    });
  }
  stop(): Promise<SyncStatus> {
    return this.enqueue(async () => {
      clearTimeout(this.timer);
      await this.deps.storage.session.remove(SYNC_SESSION_KEY);
      await this.save({ ...(await this.local()), enabled: false, error: null });
      return this.status();
    });
  }
  clear(): Promise<SyncStatus> {
    return this.enqueue(async () => {
      await this.deps.storage.session.remove(SYNC_SESSION_KEY);
      await this.save(emptyState());
      const cloud = await this.deps.storage.sync.get(null);
      await this.deps.storage.sync.remove(
        Object.keys(cloud).filter((key) => key.startsWith(PREFIX)),
      );
      return this.status();
    });
  }
}
