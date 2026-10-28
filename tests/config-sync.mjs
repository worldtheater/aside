import assert from "node:assert/strict";
import {
  ConfigurationSync,
  SYNC_LOCAL_KEY,
  SYNC_SESSION_KEY,
} from "../config-sync.js";
import {
  configurationHash,
  decryptConfiguration,
  deriveSyncKey,
  encryptConfiguration,
  newSalt,
  validateConfiguration,
} from "../sync-data.js";
import {
  configuration,
  configurationText,
  initializeSyncRecords,
  recordConfigurationChanges,
  mergeConfiguration,
  applyConfiguration,
} from "../sync-records.js";
import { getPresets, defaultAppearance } from "../data.js";
import { setLocale } from "../copy.js";
import { actionLimitError } from "../action-policy.js";
import { readSyncServiceAccess } from "../sync-page.js";
const secret = "test-key-not-for-network";
const passphrase = "fixture sync passphrase 2026";
function connection(id, name = "Same name") {
  return {
    id,
    name,
    url: "https://api.example.com/v1",
    model: "example",
    protocol: "chat",
    maxTokens: 1024,
    connected: true,
    models: [{ id: "discovered", name: "Local model cache" }],
    hasKey: true,
  };
}
function store(name) {
  return {
    settings: {
      website: { sites: { "example.com": { lights: "system" } } },
      actions: getPresets(),
      appearance: structuredClone(defaultAppearance),
      customColors: ["#123456"],
      preferences: {
        locale: "en",
        theme: name === "A" ? "light" : "dark",
        palette: "graphite",
        hideDaily: true,
      },
      connections: [connection(name)],
      defaultConnection: name,
      defaultDecisionConnection: null,
    },
    credentials: { [name]: secret, obsolete: "NOT_SYNCED" },
    collection: [{ id: name, text: "COLLECTION_PRIVATE_" + name }],
    daily: {
      model: "default",
      prompt: "A thought",
      outputLanguage: "interface",
      useCollection: true,
      result: "DAILY_PRIVATE_" + name,
      date: "2026-10-27",
    },
  };
}
function area(values = {}) {
  return {
    values,
    access: null,
    async setAccessLevel({ accessLevel }) {
      this.access = accessLevel;
    },
    async get(keys) {
      if (keys === null) return structuredClone(values);
      return structuredClone(
        Object.fromEntries(
          (typeof keys === "string" ? [keys] : keys)
            .filter((key) => Object.hasOwn(values, key))
            .map((key) => [key, values[key]]),
        ),
      );
    },
    async set(patch) {
      Object.assign(values, structuredClone(patch));
    },
    async remove(keys) {
      for (const key of typeof keys === "string" ? [keys] : keys)
        delete values[key];
    },
  };
}
const cloud = area();
function device(name, sync = cloud) {
  const local = area(store(name)),
    session = area();
  let applied = 0,
    queue = Promise.resolve(),
    beforeMutation;
  const deps = {
    storage: { local, sync, session, onChanged: { addListener() {} } },
    mutate(change, options) {
      const next = queue.then(async () => {
        if (beforeMutation) {
          const hook = beforeMutation;
          beforeMutation = undefined;
          hook(local.values);
        }
        const data = structuredClone(local.values);
        initializeSyncRecords(data);
        const before = configuration(data);
        await change(data);
        if (!options?.sync) recordConfigurationChanges(data, before);
        Object.assign(local.values, data);
      });
      queue = next.catch(() => {});
      return next;
    },
    applied: async () => {
      applied++;
    },
  };
  return {
    local: local.values,
    session: session.values,
    engine: new ConfigurationSync(deps),
    edit: (change) => deps.mutate(change),
    restart: () => new ConfigurationSync(deps),
    beforeMerge: (hook) => {
      beforeMutation = hook;
    },
    applied: () => applied,
  };
}
// Permission checks group shared service origins and remain local, without requests.
const previousChrome = globalThis.chrome;
const checkedOrigins = [];
globalThis.chrome = {
  permissions: {
    contains: async ({ origins }) => {
      checkedOrigins.push(...origins);
      return origins[0] === "https://api.example.com/*";
    },
  },
};
try {
  const services = await readSyncServiceAccess([
    connection("one", "Model one"),
    {
      ...connection("two", "Model two"),
      protocol: "responses",
      url: "https://api.example.com/v2",
    },
    { ...connection("local", "Local model"), url: "http://127.0.0.1:11434/v1" },
    { ...connection("unfinished"), connected: false },
  ]);
  assert.deepEqual(services, [
    {
      origin: "https://api.example.com",
      connections: ["Model one", "Model two"],
      granted: true,
    },
    {
      origin: "http://127.0.0.1:11434",
      connections: ["Local model"],
      granted: false,
    },
  ]);
  assert.deepEqual(checkedOrigins, [
    "https://api.example.com/*",
    "http://127.0.0.1:11434/*",
  ]);
} finally {
  if (previousChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = previousChrome;
}

// An empty local replica may still be waiting for an existing setup.
const delayedCloud = area(),
  delayed = device("delayed", delayedCloud);
const beforeWaiting = structuredClone(delayed.local);
await delayed.engine.status();
await delayed.engine.run();
await assert.rejects(
  () => delayed.engine.connect(passphrase, "join", null),
  /waiting/,
);
assert.deepEqual(delayedCloud.values, {});
assert.deepEqual(delayed.local, beforeWaiting);
assert.deepEqual(delayed.session, {});
// An old first-setup form must not overwrite a head received before submission.
const sourceCloud = area(),
  early = device("early", sourceCloud);
await early.engine.connect(passphrase, "create", null);
Object.assign(delayedCloud.values, structuredClone(sourceCloud.values));
await assert.rejects(
  () => delayed.engine.connect(passphrase, "create", null),
  /waiting/,
);
assert.deepEqual(delayedCloud.values, sourceCloud.values);
assert.deepEqual(delayed.local, beforeWaiting);
assert.deepEqual(delayed.session, {});
// Delivery between ciphertext staging and head publication also blocks creation.
const racingCloud = area(),
  racing = device("racing", racingCloud);
const originalSet = racingCloud.set;
racingCloud.set = async function (patch) {
  await originalSet.call(this, patch);
  if (
    Object.keys(patch).some(
      (key) => key.startsWith("aside-config:") && key !== "aside-config:head",
    )
  ) {
    Object.assign(this.values, structuredClone(sourceCloud.values));
  }
};
const racingStatus = await racing.engine.connect(passphrase, "create", null);
assert.equal(racingStatus.mode, "off");
assert.equal(racingStatus.enabled, false);
assert.deepEqual(racing.session, {});
assert.equal(racingStatus.error, "waiting");
assert.deepEqual(racingCloud.values, sourceCloud.values);
assert.equal(racing.local.settings.connections[0].id, "racing");
await early.engine.stop();
await racing.engine.stop();

// A failed first upload must stay off and be retryable, even after a worker restart.
const fullCloud = area(),
  retrying = device("retrying", fullCloud);
const upload = fullCloud.set;
fullCloud.set = async () => {
  throw new Error("QUOTA_BYTES exceeded");
};
const failedSetup = await retrying.engine.connect(passphrase, "create", null);
assert.equal(failedSetup.enabled, false);
assert.equal(failedSetup.error, "tooLarge");
assert.deepEqual(retrying.session, {});
assert.deepEqual(fullCloud.values, {});
assert.equal(retrying.local.credentials.retrying, secret);
fullCloud.set = upload;
assert.equal(
  (await retrying.restart().connect(passphrase, "create", null)).mode,
  "ready",
);
await retrying.engine.stop();

const find = (d, id) => d.local.settings.connections.find((c) => c.id === id);
const doc = (d) => d.local.configurationRecords.data;
const head = () => cloud.values["aside-config:head"];
const a = device("A"),
  b = device("B");
assert.equal((await a.engine.status()).enabled, false);
assert.equal(cloud.access, "TRUSTED_CONTEXTS");
const projected = configuration(a.local);
assert.equal(projected.connections.A.models, undefined);
assert.equal(projected.connections.A.hasKey, undefined);
assert.equal(projected.connections.A.key, secret);
assert.equal(projected.actions.translate.quick, undefined);
assert.equal(projected.settings, undefined);
assert.equal(projected.collection, undefined);
assert.equal(projected.daily.result, undefined);
assert(!JSON.stringify(projected).includes("NOT_SYNCED"));
// Default labels do not become cross-device edits when the interface locale changes.
setLocale("zh-CN");
const chinese = store("A");
setLocale("en");
assert.deepEqual(
  configuration(chinese).actions,
  configuration(a.local).actions,
);
const initial = initializeSyncRecords(structuredClone(a.local)).data;
const salt = newSalt(),
  key = await deriveSyncKey(passphrase, salt);
const envelope = await encryptConfiguration(initial, key, salt);
assert.deepEqual(
  await decryptConfiguration(envelope, key),
  JSON.parse(JSON.stringify(initial)),
);
await assert.rejects(
  () => decryptConfiguration({ ...envelope, updatedAt: 0 }, key),
  /wrongPassphrase/,
);
await assert.rejects(
  () => decryptConfiguration({ ...envelope, version: 1 }, key),
  /version/,
);
const invalid = structuredClone(initial);
invalid.actions.translate.value.quick = true;
assert.throws(() => validateConfiguration(invalid), /invalidData/);
invalid.actions.translate.value = null;
assert.throws(() => validateConfiguration(invalid), /invalidData/);
await assert.rejects(
  () => a.engine.connect("short", "create", null),
  /passphraseShort/,
);
await assert.rejects(
  () => a.engine.connect("            ", "create", null),
  /passphraseRequired/,
);
assert.deepEqual(cloud.values, {});
await a.engine.connect(passphrase, "create", null);
assert.equal((await a.engine.status()).mode, "ready");
assert(!JSON.stringify(cloud.values).includes(secret));
assert(!JSON.stringify(cloud.values).includes(passphrase));
assert(!JSON.stringify(a.session).includes(passphrase));
const beforeB = structuredClone(b.local);
await assert.rejects(
  () => b.engine.connect("wrong passphrase", "join", head().revision),
  /wrongPassphrase/,
);
assert.deepEqual(b.local, beforeB);
await b.engine.connect(passphrase, "join", head().revision);
await a.engine.run();
assert.deepEqual(a.local.settings.connections.map((c) => c.id).sort(), [
  "A",
  "B",
]);
assert.deepEqual(b.local.settings.connections.map((c) => c.id).sort(), [
  "A",
  "B",
]);
assert.equal(b.local.credentials.A, secret);
assert.equal(b.local.settings.defaultConnection, "B");
assert.equal(a.local.settings.defaultConnection, "A");
assert.deepEqual(b.local.settings.preferences, beforeB.settings.preferences);
assert.deepEqual(b.local.collection, beforeB.collection);
assert.equal(b.local.daily.result, beforeB.daily.result);
assert.deepEqual(find(b, "B").models, beforeB.settings.connections[0].models);
// A fresh recipient adopts both defaults, while already-configured devices keep theirs.
const defaultCloud = area(),
  source = device("source", defaultCloud);
await source.edit((data) => {
  data.settings.connections.push({
    ...connection("decision"),
    protocol: "typesafe",
  });
  data.settings.defaultDecisionConnection = "decision";
});
await source.engine.connect(passphrase, "create", null);
const fresh = device("fresh", defaultCloud);
fresh.local.settings.connections = [];
fresh.local.settings.defaultConnection = null;
fresh.local.credentials = {};
await fresh.engine.connect(
  passphrase,
  "join",
  defaultCloud.values["aside-config:head"].revision,
);
assert.equal(fresh.local.settings.defaultConnection, "source");
assert.equal(fresh.local.settings.defaultDecisionConnection, "decision");
assert.equal(fresh.applied(), 1);
const defaultOnlyChanged = structuredClone(doc(source));
const currentTime = Date.now();
defaultOnlyChanged.defaults.defaultConnection = {
  updatedAt: currentTime,
  writer: "other",
  value: "decision",
};
const noDefaults = store("empty");
noDefaults.settings.defaultConnection = null;
applyConfiguration(noDefaults, defaultOnlyChanged);
assert.equal(
  noDefaults.settings.defaultConnection,
  null,
  "Decision connections cannot fill a generation default",
);
defaultOnlyChanged.defaults.defaultConnection.value = "deleted";
applyConfiguration(noDefaults, defaultOnlyChanged);
assert.equal(
  noDefaults.settings.defaultConnection,
  null,
  "Missing connections are not selected",
);
// Already-synced devices with no default also receive a newly introduced suggestion.
const oldDocument = structuredClone(doc(source));
delete oldDocument.defaults;
const oldRecipient = store("old-recipient");
oldRecipient.settings.defaultConnection = null;
initializeSyncRecords(oldRecipient);
applyConfiguration(oldRecipient, oldDocument);
assert.equal(oldRecipient.settings.defaultConnection, null);
applyConfiguration(
  oldRecipient,
  mergeConfiguration(initializeSyncRecords(oldRecipient).data, doc(source)),
);
assert.equal(oldRecipient.settings.defaultConnection, "source");
// A default-only edit is published, but does not replace another device's choice.
await source.edit((data) => {
  data.settings.connections.push(connection("alternative"));
  data.settings.defaultConnection = "alternative";
});
await source.engine.run();
await fresh.engine.run();
assert.equal(fresh.local.settings.defaultConnection, "source");
const readyRevision = defaultCloud.values["aside-config:head"].revision;
await source.edit((data) => (data.settings.defaultConnection = "source"));
await source.engine.run();
assert.notEqual(
  defaultCloud.values["aside-config:head"].revision,
  readyRevision,
);
const settledRevision = defaultCloud.values["aside-config:head"].revision;
await fresh.engine.run();
await source.engine.run();
assert.equal(
  defaultCloud.values["aside-config:head"].revision,
  settledRevision,
  "Adoption does not republish a competing default",
);
// Clearing a suggestion is an ordinary preference update, not a permanent deletion.
await source.edit((data) => (data.settings.defaultConnection = null));
await source.engine.run();
await source.edit((data) => (data.settings.defaultConnection = "alternative"));
await source.engine.run();
assert.equal(doc(source).defaults.defaultConnection.value, "alternative");
const unchanged = structuredClone(fresh.local.settings);
await fresh.engine.run();
assert.equal(
  fresh.local.settings.defaultConnection,
  unchanged.defaultConnection,
);
const invalidDefaults = structuredClone(doc(source));
invalidDefaults.defaults.defaultConnection.value = { id: "source" };
assert.throws(() => validateConfiguration(invalidDefaults), /invalidData/);
const late = device("late", defaultCloud);
late.local.settings.defaultConnection = null;
late.local.settings.connections = [];
late.local.credentials = {};
await late.engine.connect(
  passphrase,
  "join",
  defaultCloud.values["aside-config:head"].revision,
);
assert.equal(late.local.settings.defaultConnection, "alternative");
await source.engine.stop();
await fresh.engine.stop();
await late.engine.stop();
// Content and local UI/quick-access changes do not publish or change versions.
const stable = head().revision,
  stampBefore = configurationText(doc(a));
await a.edit((data) => {
  data.settings.preferences = {
    locale: "ja",
    theme: "system",
    palette: "lavender",
    hideDaily: false,
  };
  data.settings.appearance.page.size = 22;
  data.settings.customColors.push("#abcdef");
  data.settings.website.sites["example.com"].lights = "on";
  data.settings.actions.reverse();
  data.settings.actions.forEach((action) => (action.quick = false));
  data.collection.push({ text: "not synced" });
  data.daily.result = "new local result";
});
await a.engine.run();
await b.engine.run();
assert.equal(head().revision, stable);
assert.equal(configurationText(doc(a)), stampBefore);
assert.deepEqual(b.local.settings.preferences, beforeB.settings.preferences);
assert.equal(b.local.settings.defaultConnection, "B");
assert.deepEqual(
  b.local.settings.actions.map((c) => c.id),
  beforeB.settings.actions.map((c) => c.id),
);
assert.equal(b.local.settings.actions[0].quick, true);
// Separate edits merge, including writes made while the key is locked.
delete b.session[SYNC_SESSION_KEY];
b.engine = b.restart();
await b.edit(
  (data) =>
    (data.settings.connections.find((c) => c.id === "B").name =
      "Edited B while locked"),
);
const lockedStamp = doc(b).connections.B.updatedAt;
await a.edit((data) => {
  data.settings.connections.find((c) => c.id === "A").name = "Edited A";
  data.credentials.A = "rotated-key";
});
await a.engine.run();
assert.equal((await b.engine.run()).mode, "locked");
await b.engine.connect(passphrase, "unlock", head().revision);
await a.engine.run();
assert.equal(find(a, "B").name, "Edited B while locked");
assert.equal(find(b, "A").name, "Edited A");
assert.equal(b.local.credentials.A, "rotated-key");
assert.equal(doc(b).connections.B.updatedAt, lockedStamp);
assert.equal((await b.restart().run()).mode, "ready");
// The last save wins for an entire connection, not whichever device uploads last.
await a.edit((data) => {
  data.settings.connections.find((c) => c.id === "A").url =
    "https://one.example.com";
  data.credentials.A = "one-key";
});
await new Promise((resolve) => setTimeout(resolve, 3));
await b.edit((data) => {
  data.settings.connections.find((c) => c.id === "A").url =
    "https://two.example.com";
  data.credentials.A = "two-key";
});
await b.engine.run();
await a.engine.run();
assert.equal(find(a, "A").url, "https://two.example.com");
assert.equal(a.local.credentials.A, "two-key");
// Daily configuration is one atomic record; its generated content remains local.
await a.edit((data) => (data.daily.prompt = "A's new thought instruction"));
await new Promise((resolve) => setTimeout(resolve, 3));
await b.edit((data) => {
  data.daily.outputLanguage = "ja";
  data.daily.useCollection = false;
});
const winningDaily = structuredClone(b.local.daily);
await a.engine.run();
await b.engine.run();
await a.engine.run();
assert.equal(a.local.daily.prompt, winningDaily.prompt);
assert.equal(a.local.daily.outputLanguage, "ja");
assert.equal(a.local.daily.useCollection, false);
assert.equal(a.local.daily.result, "new local result");
// Custom actions retain identity and merge, but quick visibility/order stay local.
await a.edit((data) =>
  data.settings.actions.push({
    ...getPresets()[0],
    id: "custom-a",
    kind: "custom",
    builtin: false,
    name: "A custom",
    instruction: "A task",
    quick: true,
    model: "B",
  }),
);
await b.edit((data) =>
  data.settings.actions.push({
    ...getPresets()[0],
    id: "custom-b",
    kind: "custom",
    builtin: false,
    name: "B custom",
    instruction: "B task",
    quick: true,
  }),
);
await a.engine.run();
await b.engine.run();
await a.engine.run();
assert.equal(
  b.local.settings.actions.find((c) => c.id === "custom-a").quick,
  false,
);
assert.equal(
  a.local.settings.actions.find((c) => c.id === "custom-a").quick,
  true,
);
assert(a.local.settings.actions.some((c) => c.id === "custom-b"));
// A later offline edit cannot resurrect a deleted connection or custom action.
await a.edit((data) => {
  data.settings.connections = data.settings.connections.filter(
    (c) => c.id !== "B",
  );
  delete data.credentials.B;
  data.settings.actions = data.settings.actions.filter(
    (c) => c.id !== "custom-b",
  );
});
await new Promise((resolve) => setTimeout(resolve, 3));
await b.edit((data) => {
  data.settings.connections.find((c) => c.id === "B").name = "Offline edit";
  data.settings.actions.find((c) => c.id === "custom-b").instruction =
    "Offline action edit";
});
await a.engine.run();
await b.engine.run();
await a.engine.run();
assert(!find(b, "B"));
assert.equal(b.local.credentials.B, undefined);
assert.equal(b.local.settings.defaultConnection, "A");
assert.equal(
  b.local.settings.actions.find((c) => c.id === "custom-a").model,
  "default",
);
assert(!b.local.settings.actions.some((c) => c.id === "custom-b"));
assert.equal(doc(b).connections.B.value, null);
// A stale editor cannot resurrect a received tombstone or partially save its API key.
const deletedState = structuredClone(b.local);
await assert.rejects(
  () =>
    b.edit((data) => {
      data.settings.connections.push(connection("B"));
      data.credentials.B = "stale-key";
    }),
  /recordDeleted/,
);
assert.deepEqual(b.local, deletedState);
await assert.rejects(
  () =>
    b.edit((data) => {
      data.settings.actions.push({
        ...getPresets()[0],
        id: "custom-b",
        kind: "custom",
      });
    }),
  /recordDeleted/,
);
assert.deepEqual(b.local, deletedState);

// A user save arriving during decryption is included inside the store transaction.
a.beforeMerge((data) => {
  const before = configuration(data);
  data.settings.connections.find((c) => c.id === "A").maxTokens = 3333;
  recordConfigurationChanges(data, before);
});
await a.engine.run();
await b.engine.run();
assert.equal(find(b, "A").maxTokens, 3333);
// Simulate independently published branches, then deliver Chrome's winning head.
const cloudX = area(structuredClone(cloud.values)),
  cloudY = area(structuredClone(cloud.values));
const x = device("X", cloudX),
  y = device("Y", cloudY);
await x.engine.connect(
  passphrase,
  "join",
  cloudX.values["aside-config:head"].revision,
);
await y.engine.connect(
  passphrase,
  "join",
  cloudY.values["aside-config:head"].revision,
);
for (const k of Object.keys(cloudX.values)) delete cloudX.values[k];
Object.assign(cloudX.values, structuredClone(cloudY.values));
await x.engine.run();
for (const k of Object.keys(cloudY.values)) delete cloudY.values[k];
Object.assign(cloudY.values, structuredClone(cloudX.values));
await y.engine.run();
assert(find(x, "X") && find(x, "Y") && find(y, "X") && find(y, "Y"));
assert.equal(configurationText(doc(x)), configurationText(doc(y)));
// Merge is commutative, associative, idempotent, and resolves same-time writers consistently.
const make = (time, writer, deleted = false) => ({
  ...structuredClone(initial),
  connections: {
    A: {
      updatedAt: time,
      writer,
      value: deleted ? null : { ...projected.connections.A, name: writer },
    },
  },
});
for (const first of [
  make(1, "a"),
  make(1, "b"),
  make(2, "a"),
  make(1, "c", true),
])
  for (const second of [make(1, "a"), make(2, "b"), make(3, "b", true)]) {
    const third = make(4, "c");
    assert.deepEqual(
      mergeConfiguration(first, second),
      mergeConfiguration(second, first),
    );
    assert.deepEqual(mergeConfiguration(first, first), first);
    assert.deepEqual(
      mergeConfiguration(mergeConfiguration(first, second), third),
      mergeConfiguration(first, mergeConfiguration(second, third)),
    );
  }
// Imported action unions are never silently truncated at the local creation limit.
const many = structuredClone(initial),
  localMany = store("many");
for (let i = 0; i < 25; i++)
  many.actions[`custom-${i}`] = {
    updatedAt: 1,
    writer: "a",
    value: {
      ...projected.actions.translate,
      id: `custom-${i}`,
      kind: "custom",
      builtin: false,
    },
  };
validateConfiguration(many);
applyConfiguration(localMany, many);
assert.equal(localMany.settings.actions.length, 30);
assert.equal(actionLimitError(localMany.settings.actions, 30), null);
assert.equal(
  actionLimitError([...localMany.settings.actions, {}], 30),
  "actionLimit",
);
// Multi-chunk delivery is atomic: incomplete/authentication-failed payloads never apply.
await a.edit((data) => {
  const action = data.settings.actions.find((c) => c.id === "translate");
  action.builtin = false;
  action.instruction = Array.from({ length: 800 }, () =>
    crypto.randomUUID(),
  ).join(" ");
});
await a.engine.run();
const multi = structuredClone(head());
assert(multi.chunks > 1);
const chunkKey = `aside-config:${multi.revision}:0`,
  chunk = cloud.values[chunkKey];
delete cloud.values[chunkKey];
const originalB = structuredClone(b.local.settings);
assert.equal((await b.engine.run()).mode, "waiting");
assert.deepEqual(b.local.settings, originalB);
cloud.values[chunkKey] = chunk;
assert.equal((await b.engine.run()).mode, "ready");
for (const [name, value] of Object.entries(cloud.values))
  assert(
    Buffer.byteLength(name) + Buffer.byteLength(JSON.stringify(value)) < 8192,
  );
// Stop does not discard offline edits; joining again sends those edits with their original time.
await b.engine.stop();
await b.edit(
  (data) =>
    (data.settings.connections.find((c) => c.id === "A").name =
      "Edit while stopped"),
);
await b.engine.run();
assert.equal((await b.engine.status()).mode, "off");
assert.equal(head().revision, multi.revision);
await b.engine.connect(passphrase, "join", head().revision);
await a.engine.run();
assert.equal(find(a, "A").name, "Edit while stopped");
// Oversized data cannot replace the last complete cloud revision.
const previousHead = head().revision;
await a.edit(
  (data) =>
    (data.settings.actions.find((c) => c.id === "translate").instruction =
      Array.from({ length: 3000 }, () => crypto.randomUUID()).join(" ")),
);
assert.equal((await a.engine.run()).error, "tooLarge");
assert.equal(head().revision, previousHead);
await b.engine.clear();
assert.deepEqual(cloud.values, {});
assert.equal(b.local.credentials.A, "two-key");
assert.equal((await a.engine.run()).error, "remoteMissing");
assert.equal(
  await configurationHash(doc(b)),
  await configurationHash(structuredClone(doc(b))),
);
await a.engine.stop();
await x.engine.stop();
await y.engine.stop();
// An old preview's cloud format is rejected explicitly; reset keeps local data.
const oldCloud = area({ "aside-config:head": { version: 1 } });
const oldDevice = device("old-preview", oldCloud);
assert.equal((await oldDevice.engine.status()).error, "version");
await oldDevice.engine.clear();
assert.equal(oldDevice.local.credentials["old-preview"], secret);
assert.equal(oldDevice.local.collection[0].id, "old-preview");
await oldDevice.engine.connect(passphrase, "create", null);
assert.equal((await oldDevice.engine.status()).mode, "ready");
await oldDevice.engine.stop();
console.log(
  "PASS: encrypted record merge; independent IDs, atomic credentials/daily settings, offline timestamps, deletion precedence, branch convergence, local preferences/order, validation, quotas and session locking.",
);
