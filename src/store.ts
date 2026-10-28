import {
  PROTECTED_CONFIGURATION,
  encryptCredentials,
  decryptCredentials,
} from "./credential-store.js";
import type { EncryptedConfiguration } from "./credential-store.js";
import {
  configuration,
  configurationText,
  initializeSyncRecords,
  recordConfigurationChanges,
} from "./sync-records.js";
import { connectionAvailable } from "./providers.js";
import { createWebsiteSettings } from "./website.js";
import type {
  StoreData,
  Snapshot,
  Settings,
  PublicSettings,
  CollectionInput,
} from "./types.js";
import { getPresets, defaultAppearance } from "./data.js";
import {
  C,
  locale,
  setLocale,
  localizeAction,
  usesPresetDefaults,
} from "./copy.js";
let writes = Promise.resolve();
const ready = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});
// Exact shipped defaults identify the saved preset text being replaced.
const previousPlainInstructions = new Set([
  "将古文改写为通顺的现代白话文，忠实保留人物、情节和语气。难懂的典故可以在对应段落后简短解释。只输出白话文和必要的注释。",
  "Rewrite classical Chinese in clear modern Chinese. Preserve characters, events, and tone. Briefly explain difficult allusions after the relevant paragraph. Return only the rewritten text and necessary notes.",
  "直接给出所选古文的现代汉语释义。词语或短语只给出简洁词义，完整句段改写为通顺白话，忠实保留人物、情节和语气。仅在理解所选原文确有需要时，追加简短的词句或典故注释。输出从释义正文开始，到必要注释结束，不与读者对话。",
  "Give the modern Chinese meaning of the selected Classical Chinese text directly. For a word or phrase, give a concise meaning; for a sentence or passage, give a fluent, faithful rendition preserving characters, events, and tone. Append brief word or allusion notes only where needed to understand the selected text. Start with the rendition and end with any necessary notes, without addressing the reader.",
  "Explain the meaning of the supplied Classical Chinese text directly. Treat even a short fragment as the complete source for this invocation. For a word or phrase, give a concise gloss; for a sentence or passage, give a fluent, faithful rendition preserving characters, events, and tone. When writing in Chinese, use contemporary Chinese. Append brief word or allusion notes only where needed to understand the source. Start with the rendition and end with any necessary notes, without addressing the reader.",
]);
let initializing: Promise<void> | undefined;
export function initialize() {
  return (initializing ||= initializeStore());
}
async function initializeStore() {
  await ready;
  await migrateCredentials();
  const found = await chrome.storage.local.get<{
    settings?: Settings;
    qaShortcutDefaultApplied?: boolean;
  }>(["settings", "qaShortcutDefaultApplied"]);
  if (found.settings) {
    setLocale(found.settings.preferences.locale);
    const added = getPresets().filter(
      (preset) =>
        !found.settings!.actions.some((action) => action.id === preset.id),
    );
    const actions = found.settings.actions.map((action) => {
      if (
        action.id !== "plain" ||
        action.kind !== "plain" ||
        (action.instruction.trim() !== "" &&
          !previousPlainInstructions.has(action.instruction.trim()))
      )
        return action;
      const next = { ...action, instruction: "" };
      next.builtin = usesPresetDefaults(
        localizeAction({ ...next, builtin: false }, locale),
        locale,
      );
      return next.instruction === action.instruction &&
        next.builtin === action.builtin
        ? action
        : next;
    });
    const promptsUpdated = actions.some(
      (action, index) => action !== found.settings!.actions[index],
    );
    actions.push(...added);
    // Apply the revised Q&A default once; later user changes remain authoritative.
    if (!found.qaShortcutDefaultApplied) {
      const qa = actions.find((action) => action.id === "qa");
      if (qa) qa.quick = true;
    }
    if (
      added.length ||
      promptsUpdated ||
      !found.settings.website ||
      !found.qaShortcutDefaultApplied
    )
      await chrome.storage.local.set({
        settings: {
          ...found.settings,
          actions,
          website: found.settings.website || createWebsiteSettings(),
        },
        qaShortcutDefaultApplied: true,
      });
    return;
  }
  setLocale("system");
  await chrome.storage.local.set({
    qaShortcutDefaultApplied: true,
    settings: {
      website: createWebsiteSettings(),
      actions: getPresets(),
      appearance: structuredClone(defaultAppearance),
      customColors: [],
      connections: [],
      defaultConnection: null,
      defaultDecisionConnection: null,
      preferences: { locale: "system", theme: "system", palette: "graphite" },
    },
    collection: [],
    daily: {
      model: "default",
      prompt: C.home.promptDefault,
      outputLanguage: "interface",
      useCollection: false,
      result: null,
      date: null,
    },
  });
}
type ProtectedConfiguration = Pick<
  StoreData,
  "credentials" | "configurationRecords"
>;
type StoredData = Omit<StoreData, keyof ProtectedConfiguration> & {
  [PROTECTED_CONFIGURATION]?: EncryptedConfiguration;
};
const protectedText = ({ credentials, configurationRecords }: StoreData) =>
  configurationText({ credentials, configurationRecords });

// Upgrade shipped plaintext storage once, before serving requests. Commit the
// encrypted replacement before removing either plaintext copy of the API keys.
async function migrateCredentials() {
  const stored = await chrome.storage.local.get<
    ProtectedConfiguration & StoredData
  >(["credentials", "configurationRecords", PROTECTED_CONFIGURATION]);
  if (
    stored.credentials === undefined &&
    stored.configurationRecords === undefined
  )
    return;
  if (stored[PROTECTED_CONFIGURATION] !== undefined) {
    await decryptCredentials(stored[PROTECTED_CONFIGURATION]);
  } else {
    const text = configurationText({
      credentials: stored.credentials ?? {},
      configurationRecords: stored.configurationRecords,
    });
    await chrome.storage.local.set({
      [PROTECTED_CONFIGURATION]: await encryptCredentials(text),
    });
  }
  await chrome.storage.local.remove(["credentials", "configurationRecords"]);
}
async function storedData(): Promise<StoredData> {
  await ready;
  return (await chrome.storage.local.get([
    "settings",
    "collection",
    "daily",
    PROTECTED_CONFIGURATION,
  ])) as StoredData;
}
async function decodeStore(stored: StoredData): Promise<StoreData> {
  const { [PROTECTED_CONFIGURATION]: encrypted, ...data } = stored;
  const protectedData: ProtectedConfiguration =
    encrypted === undefined
      ? { credentials: {} }
      : JSON.parse(await decryptCredentials(encrypted));
  return { ...data, ...protectedData };
}
export async function readStore(): Promise<StoreData> {
  return decodeStore(await storedData());
}
export function mutate<T>(
  fn: (data: StoreData) => T | Promise<T>,
  options?: { sync?: boolean },
) {
  const job = writes.then(async () => {
    await initialize();
    const stored = await storedData();
    const data = await decodeStore(stored);
    const previous = protectedText(data);
    initializeSyncRecords(data);
    const before = configuration(data);
    const result = await fn(data);
    if (!options?.sync) recordConfigurationChanges(data, before);
    const {
      credentials: _credentials,
      configurationRecords: _records,
      ...plain
    } = data;
    const next = protectedText(data);
    // Reuse unchanged ciphertext: a fresh IV on every read/merge would emit a
    // storage change and schedule an endless sequence of no-op sync attempts.
    await chrome.storage.local.set({
      ...plain,
      [PROTECTED_CONFIGURATION]:
        next === previous
          ? stored[PROTECTED_CONFIGURATION]
          : await encryptCredentials(next),
    });
    return result;
  });
  writes = job.then(
    () => {},
    () => {},
  );
  return job;
}
export async function snapshot(): Promise<Snapshot> {
  const data = await readStore();
  return {
    ...data.settings,
    connections: data.settings.connections
      .filter(connectionAvailable)
      .map((c) => ({
        ...c,
        hasKey: Boolean(c.id && data.credentials[c.id]),
      })),
    collection: data.collection,
    daily: data.daily,
  };
}
export function publicSettings(settings: Settings): PublicSettings {
  return {
    website: settings.website,
    actions: settings.actions,
    appearance: settings.appearance,
    preferences: settings.preferences,
    defaultConnection: settings.defaultConnection,
    defaultDecisionConnection: settings.defaultDecisionConnection,
    connections: settings.connections
      .filter(connectionAvailable)
      .map(({ id, name, model, connected, protocol }) => ({
        id,
        name,
        model,
        connected,
        protocol,
      })),
  };
}
export function addCollection(item: CollectionInput) {
  return mutate((data) => {
    const existing = data.collection.find(
      (c) => c.text === item.text && c.sourceText === item.sourceText,
    );
    if (existing) return existing;
    const entry = {
      id: crypto.randomUUID(),
      title: String(item.title || "").slice(0, 180),
      text: String(item.text || ""),
      sourceText: String(item.sourceText || ""),
      sourceTitle: String(item.sourceTitle || "").slice(0, 300),
      url: String(item.url || ""),
      actionName: String(item.actionName || "").slice(0, 100),
      createdAt: new Date().toISOString(),
    };
    if (!entry.text.trim() || entry.text.length > 240000)
      throw Error("invalidInput");
    data.collection.unshift(entry);
    return entry;
  });
}
