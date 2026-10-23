import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const scenario = process.argv[2];
if (!scenario) {
  for (const value of [
    "missing",
    "existing",
    "opted-out",
    "full",
    "full-missing",
    "plain-legacy-en",
    "plain-legacy-zh",
    "plain-current-default",
    "plain-custom",
    "plain-renamed",
    "plain-copy",
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), value],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  console.log(
    "PASS: old default gloss prompts upgraded; custom prompts and copied actions preserved; preset upgrade and Q&A shortcut defaults applied once.",
  );
  process.exit(0);
}
import { getPresets, defaultAppearance } from "../data.js";
import { setLocale } from "../copy.js";
setLocale("en");
const actions = getPresets().filter(
  (action) => !scenario.includes("missing") || action.id !== "qa",
);
const previousQa = actions.find((action) => action.id === "qa");
if (previousQa)
  Object.assign(previousQa, {
    quick: false,
    outputLength: "balanced",
    outputLanguage: "ja",
  });
actions[2] = {
  ...actions[2],
  name: "My explanation",
  instruction: "Keep my own prompt.",
  builtin: false,
  model: "my-model",
};
actions.push({ ...actions[2], id: "custom", kind: "custom", quick: false });
if (scenario.startsWith("full")) {
  actions.find((action) => action.id === "summary").quick = true;
  actions.find((action) => action.id === "custom").quick = true;
}
const oldPlainPrompt =
  "Rewrite classical Chinese in clear modern Chinese. Preserve characters, events, and tone. Briefly explain difficult allusions after the relevant paragraph. Return only the rewritten text and necessary notes.";
const defaultPlain = structuredClone(
  actions.find((action) => action.id === "plain"),
);
const repairsPlain = [
  "plain-legacy-en",
  "plain-legacy-zh",
  "plain-current-default",
  "plain-renamed",
].includes(scenario);
if (scenario.startsWith("plain-")) {
  const plain = actions.find((action) => action.id === "plain");
  if (scenario === "plain-copy") {
    actions.push({
      ...plain,
      id: "copied-plain",
      builtin: false,
      instruction: oldPlainPrompt,
    });
  } else {
    Object.assign(plain, {
      builtin: false,
      model: "my-model",
      outputLanguage: "zh-Hans",
      mode: "whole",
      placement: "panel",
      quick: false,
      instruction:
        scenario === "plain-current-default"
          ? plain.instruction
          : oldPlainPrompt,
    });
    if (scenario === "plain-legacy-en")
      plain.name = "Classical to modern Chinese";
    if (scenario === "plain-legacy-zh") {
      plain.name = "古文转白话";
      plain.instruction =
        "将古文改写为通顺的现代白话文，忠实保留人物、情节和语气。难懂的典故可以在对应段落后简短解释。只输出白话文和必要的注释。";
    }
    if (scenario === "plain-renamed") plain.name = "My classics";
    if (scenario === "plain-custom")
      plain.instruction =
        "Rewrite classical Chinese for my specialist Chinese class.";
  }
}
const qaDefaultAlreadyApplied =
  scenario === "opted-out" || scenario.startsWith("plain-");
const expectedWrites = repairsPlain || !qaDefaultAlreadyApplied ? 1 : 0;
const stored = {
  ...(qaDefaultAlreadyApplied ? { qaShortcutDefaultApplied: true } : {}),
  settings: {
    website: { sites: { "example.com": { lights: "on" } } },
    actions,
    appearance: structuredClone(defaultAppearance),
    connections: [],
    defaultConnection: null,
    preferences: { locale: "en", theme: "light", palette: "graphite" },
  },
  collection: [{ id: "saved" }],
  daily: { result: "My daily thought" },
  credentials: { kept: "fixture" },
};
const before = structuredClone(stored);
let writes = 0;
globalThis.chrome = {
  storage: {
    local: {
      setAccessLevel: async () => {},
      get: async (keys) =>
        structuredClone(
          Object.fromEntries(
            (typeof keys === "string" ? [keys] : keys).map((key) => [
              key,
              stored[key],
            ]),
          ),
        ),
      set: async (values) => {
        writes++;
        Object.assign(stored, structuredClone(values));
      },
    },
  },
};
const { initialize, readStore } = await import("../store.js");
await initialize();
assert.equal(writes, expectedWrites);
for (const previous of before.settings.actions) {
  const current = stored.settings.actions.find(
    (action) => action.id === previous.id,
  );
  assert.deepEqual(
    current,
    previous.id === "plain" && repairsPlain
      ? {
          ...previous,
          instruction: defaultPlain.instruction,
          builtin: scenario !== "plain-renamed",
        }
      : previous.id === "qa" && !qaDefaultAlreadyApplied
        ? { ...previous, quick: true }
        : previous,
  );
}
const qa = stored.settings.actions.find((action) => action.id === "qa");
assert.equal(qa.quick, !qaDefaultAlreadyApplied);
assert.equal(
  qa.outputLength,
  scenario.includes("missing") ? "brief" : "balanced",
);
assert.equal(
  qa.outputLanguage,
  scenario.includes("missing") ? "interface" : "ja",
);
assert.equal(stored.qaShortcutDefaultApplied, true);

const { actions: updated, ...settings } = stored.settings;
const { actions: old, ...originalSettings } = before.settings;
assert.deepEqual(settings, originalSettings);
assert.deepEqual(stored.collection, before.collection);
assert.deepEqual(stored.daily, before.daily);
assert.deepEqual(stored.credentials, before.credentials);
await initialize();
await readStore();
assert.equal(
  writes,
  expectedWrites,
  "Initialization is once-only and reads never write",
);
console.log(
  "PASS: existing profiles receive missing presets without overwriting actions, connections, site settings or saved content.",
);
