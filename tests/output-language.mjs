import assert from "node:assert/strict";
import {
  ACTION_PROMPTS,
  hasOutputLanguage,
  resolveOutputLanguage,
} from "../prompts.js";
import {
  messages,
  setLocale,
  localizeAction,
  localizeActionName,
} from "../copy.js";
import { getPresets } from "../data.js";
import {
  actionInstructions,
  resultKey,
  createProcessor,
} from "../processor.js";

setLocale("en");
const english = getPresets();
setLocale("zh-CN");
const chinese = getPresets();
for (const kind of Object.keys(ACTION_PROMPTS)) {
  const en = english.find((a) => a.kind === kind),
    zh = chinese.find((a) => a.kind === kind);
  assert.equal(en.instruction, zh.instruction);
  assert.equal(en.instruction, "");
  if (kind !== "translate") {
    assert.equal(en.outputLanguage, "interface");
    assert(hasOutputLanguage(en));
  }
  const action = {
    ...en,
    targetLanguage: "zh-Hans",
    outputLanguage: "zh-Hans",
  };
  const instructions = actionInstructions(action);
  assert(instructions.includes(ACTION_PROMPTS[kind]));
  assert.equal(
    actionInstructions({ ...action, instruction: "  " }),
    instructions,
  );
  const custom = actionInstructions({
    ...action,
    instruction: "Keep special terms.",
  });
  assert.equal(custom.split(ACTION_PROMPTS[kind]).length, 2);
  assert.equal(custom.split("Keep special terms.").length, 2);
  assert(
    custom.indexOf(ACTION_PROMPTS[kind]) <
      custom.indexOf("Keep special terms."),
  );
  assert.equal(
    localizeAction({ ...en, outputLanguage: "ja" }, "zh-CN").outputLanguage,
    "ja",
  );
  assert.equal(
    localizeAction(
      { ...en, builtin: false, instruction: "My saved prompt" },
      "zh-CN",
    ).instruction,
    "My saved prompt",
  );
}
for (const instruction of ["", "  "]) {
  assert.throws(
    () => actionInstructions({ kind: "custom", mode: "whole", instruction }),
    (error) => error.code === "invalidAction",
    "A custom action must describe its task",
  );
}
assert(
  actionInstructions({
    kind: "custom",
    mode: "whole",
    instruction: "Extract dates.",
  }).startsWith("Extract dates."),
);
const { hasSameLanguages } = await import("../translation.js");
for (const presets of [english, chinese])
  assert.equal(
    presets.find((action) => action.kind === "translate").targetLanguage,
    "interface",
  );
const following = {
  ...english[0],
  sourceLanguage: "en",
  targetLanguage: "interface",
};
assert(hasSameLanguages(following, "en"));
assert(!hasSameLanguages(following, "ja"));
assert(!hasSameLanguages({ ...following, sourceLanguage: "auto" }, "en"));
const resolvedTranslation = (locale) => ({
  ...following,
  sourceLanguage: "auto",
  targetLanguage: resolveOutputLanguage(following.targetLanguage, locale),
});
assert(
  actionInstructions(resolvedTranslation("ja")).includes("into Japanese (ja)."),
);
assert.equal(localizeAction(following, "ja").targetLanguage, "interface");
assert(!hasOutputLanguage({ kind: "translate" }));
assert(!hasOutputLanguage({ kind: "custom" }));
assert.equal(
  localizeActionName("Classical to modern Chinese", "zh-CN"),
  "古文释义",
);
assert.equal(resolveOutputLanguage(undefined, "zh-CN"), "zh-Hans");
assert.equal(resolveOutputLanguage("interface", "en"), "en");
assert.equal(resolveOutputLanguage("ja", "en"), "ja");
assert.equal(resolveOutputLanguage("ja", "zh-CN"), "ja");
const base = english.find((a) => a.kind === "summary");
const translated = { ...resolvedTranslation("en"), outputLanguage: "de" };
assert(
  !actionInstructions(translated).includes("Output language:"),
  "Translation retains its own target language",
);
const connection = {
  id: "fixture",
  url: "https://fixture.test/v1",
  protocol: "chat",
  model: "fixture",
  maxTokens: 1000,
};
assert.notEqual(
  await resultKey(connection, resolvedTranslation("en"), "same"),
  await resultKey(connection, resolvedTranslation("ja"), "same"),
  "Translation cache keys follow the resolved target language",
);
assert.notEqual(
  await resultKey(connection, { ...base, outputLanguage: "en" }, "same"),
  await resultKey(
    connection,
    { ...base, instruction: "Use a numbered list.", outputLanguage: "en" },
    "same",
  ),
  "Adding custom instructions invalidates the cached default result",
);
const cache = {
  generation: 0,
  entries: new Map(),
  async getMany(keys) {
    return new Map(
      keys
        .filter((key) => this.entries.has(key))
        .map((key) => [key, this.entries.get(key)]),
    );
  },
  async touch() {},
  async putMany(entries) {
    for (const entry of entries) this.entries.set(entry.key, entry.text);
  },
};
const process = createProcessor(cache);
let calls = 0;
const run = async (language) =>
  process({
    action: { ...base, outputLanguage: language },
    blocks: [{ id: "one", text: "The same source text." }],
    connection,
    key: "",
    signal: new AbortController().signal,
    invoke: async (c, k, instructions) => {
      calls++;
      assert(
        instructions.includes(
          `Output language: ${messages.en.languages[language]} (${language}).`,
        ),
      );
      return language;
    },
  });
assert.equal((await run("en")).parts[0].text, "en");
assert.equal((await run("zh-Hans")).parts[0].text, "zh-Hans");
assert.equal((await run("en")).stats.hits, 1);
assert.equal(calls, 2);
assert.notEqual(
  await resultKey(connection, { ...base, outputLanguage: "en" }, "same"),
  await resultKey(connection, { ...base, outputLanguage: "ja" }, "same"),
);
const gloss = actionInstructions({
  ...english.find((a) => a.kind === "plain"),
  outputLanguage: "en",
});
assert(gloss.includes("Output language: English (en)."));
assert(!gloss.includes("modern Chinese rendition"));
console.log(
  "PASS: shared English presets, independent output language, interface defaults, fixed-language preservation, translation isolation and language-specific cache reuse.",
);

const { DEFAULT_OUTPUT_LENGTH, OUTPUT_LENGTH_PROMPTS } =
  await import("../prompts.js");
const qa = {
  ...english.find((action) => action.kind === "qa"),
  outputLanguage: resolveOutputLanguage("interface", "en"),
};
assert.equal(qa.outputLength, DEFAULT_OUTPUT_LENGTH);
assert.equal(qa.mode, "whole");
assert.equal(qa.quick, true);
assert.equal(
  actionInstructions({ ...qa, outputLength: undefined }),
  actionInstructions(qa),
);
const beforeLengths = calls;
const lengthKeys = [];
for (const outputLength of Object.keys(OUTPUT_LENGTH_PROMPTS)) {
  const action = { ...qa, outputLength, outputLanguage: "ja" };
  lengthKeys.push(await resultKey(connection, action, "Why does ice float?"));
  const result = await process({
    action,
    blocks: [{ id: "question", text: "Why does ice float?" }],
    connection,
    key: "",
    signal: new AbortController().signal,
    invoke: async (c, k, instructions) => {
      calls++;
      assert(instructions.includes(OUTPUT_LENGTH_PROMPTS[outputLength]));
      assert(instructions.includes("Output language: Japanese (ja)."));
      return outputLength;
    },
  });
  assert.equal(result.parts[0].text, outputLength);
}
assert.equal(new Set(lengthKeys).size, 3);
assert.equal(calls, beforeLengths + 3);
const cachedQa = await process({
  action: { ...qa, outputLength: "brief", outputLanguage: "ja" },
  blocks: [{ id: "question", text: "Why does ice float?" }],
  connection,
  key: "",
  signal: new AbortController().signal,
  invoke: async () => {
    throw Error("An identical length should reuse its cached answer");
  },
});
assert.equal(cachedQa.stats.hits, 1);
assert.throws(
  () => actionInstructions({ ...qa, outputLength: "invalid" }),
  (error) => error.code === "invalidAction",
);
console.log(
  "PASS: Q&A length defaults, three request instructions, length-specific cache reuse and invalid length rejection.",
);

// The language sentinel is carried to the model, without locale substitution or another detection call.
for (const original of english) {
  const field =
    original.kind === "translate" ? "targetLanguage" : "outputLanguage";
  const guided = {
    ...original,
    [field]: "instruction",
    instruction: "अर्थ स्पष्ट और संक्षिप्त रखें।",
  };
  for (const locale of ["en", "zh-CN", "ja"]) {
    assert.equal(resolveOutputLanguage("instruction", locale), "instruction");
    const prompt = actionInstructions(
      localizeAction({ ...guided, builtin: false }, locale),
    );
    assert(prompt.includes(guided.instruction));
    assert(
      prompt.includes(
        "in the language in which the additional requirements are written",
      ),
    );
    assert(!prompt.includes("Simplified Chinese (zh-Hans)"));
    assert(!prompt.includes("Output language: English (en)"));
  }
  for (const instruction of ["", "  "]) {
    assert.throws(
      () => actionInstructions({ ...guided, instruction }),
      (error) => error.code === "invalidAction",
    );
  }
  assert.notEqual(
    await resultKey(connection, guided, "Same source"),
    await resultKey(
      connection,
      { ...guided, instruction: "সংক্ষিপ্ত রাখুন।" },
      "Same source",
    ),
    "Requirements in different languages have different cached results",
  );
}
console.log(
  "PASS: instruction-language selection, empty requirement rejection, interface independence and cache separation.",
);
