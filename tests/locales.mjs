import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LOCALES, resolveLocale } from "../locale.js";
import {
  messages,
  setLocale,
  localizeAction,
  localizeActionName,
} from "../copy.js";
import { getPresets } from "../data.js";
import { DAILY_PROMPT, resolveOutputLanguage } from "../prompts.js";

const siteLanguages = JSON.parse(
  await readFile(new URL("../website/languages.json", import.meta.url), "utf8"),
);
assert.deepEqual(
  siteLanguages.map(({ code }) => code).sort(),
  Object.keys(LOCALES).sort(),
  "Every interface locale has a product homepage route",
);

for (const [browser, expected] of [
  ["en-US", "en"],
  ["en-GB", "en"],
  ["zh", "zh-CN"],
  ["zh-CN", "zh-CN"],
  ["zh-SG", "zh-CN"],
  ["zh-TW", "zh-TW"],
  ["zh-HK", "zh-TW"],
  ["zh-MO", "zh-TW"],
  ["zh-Hant", "zh-TW"],
  ["zh-Hant-CN", "zh-TW"],
  ["zh-Hans-TW", "zh-CN"],
  ["ZH-hAnt-hK", "zh-TW"],
  ["ja-JP", "ja"],
  ["ko-KR", "ko"],
  ["fr-CA", "fr"],
  ["de-AT", "de"],
  ["es-419", "es"],
  ["pt-BR", "pt-BR"],
  ["pt", "pt-BR"],
  ["pt-PT", "pt-BR"],
  ["PT-br", "pt-BR"],
  ["ru-RU", "ru"],
  ["ru-KZ", "ru"],
  ["id-ID", "id"],
  ["it-CH", "it"],
  ["tr-TR", "tr"],
  ["th-TH", "th"],
  ["vi-VN", "vi"],
  ["ar-SA", "en"],
  ["", "en"],
])
  assert.equal(resolveLocale("system", browser), expected, browser);

function verifyShape(reference, value, path) {
  assert.equal(typeof value, typeof reference, path);
  if (typeof reference === "object") {
    assert.deepEqual(
      Object.keys(value).sort(),
      Object.keys(reference).sort(),
      path,
    );
    for (const key of Object.keys(reference))
      verifyShape(reference[key], value[key], path + "." + key);
  } else if (typeof reference === "string") {
    assert(value.trim(), path);
    const placeholders = (text) =>
      (text.match(/\{(?:hits|total|shared)\}/g) || []).sort();
    assert.deepEqual(placeholders(value), placeholders(reference), path);
  }
}

const functions = {
  "shortcuts.help": ["MODEL_NAME"],
  actionCount: [7],
  quickToggle: ["MODEL_NAME"],
  followDefault: ["MODEL_NAME"],
  saved: ["MODEL_NAME"],
  customColor: ["#123abc"],
  removeColor: ["#123abc"],
  "home.count": [7],
  "home.matchedCount": [7, 9],
  "real.reasoningInvalid": ["LEVEL_NAME"],
  "real.progress": [7, 9],
  "usage.cacheInfo": [7, "1.25", 50],
  "usage.chartValue": ["1,234"],
  "usage.chartDay": ["DATE", "TOKENS", "7"],
};
const chromeKeys = Object.keys(
  JSON.parse(
    await readFile(new URL("../_locales/en/messages.json", import.meta.url)),
  ),
).sort();
assert.deepEqual(Object.keys(messages).sort(), Object.keys(LOCALES).sort());
for (const [locale, metadata] of Object.entries(LOCALES)) {
  assert.equal(resolveLocale(locale, "en-US"), locale);
  assert.equal(
    resolveLocale(locale, "zh-TW"),
    locale,
    "Explicit choices override the system",
  );
  const copy = messages[locale];
  assert(
    metadata.output in messages.en.languages,
    `${locale}: output language is selectable`,
  );
  verifyShape(messages.en, copy, locale);
  for (const [path, args] of Object.entries(functions)) {
    const text = path.split(".").reduce((value, key) => value[key], copy)(
      ...args,
    );
    for (const arg of args)
      assert(text.includes(String(arg)), `${locale}.${path}: missing ${arg}`);
    assert(!text.includes("${"), `${locale}.${path}: unevaluated template`);
  }
  const coverage = copy.usage.coverage({
    calls: 17,
    reported: 11,
    partial: 3,
    missing: 2,
  });
  for (const count of [17, 11, 3, 2]) assert(coverage.includes(String(count)));
  setLocale(locale);
  assert.equal(
    getPresets().find((action) => action.id === "translate").targetLanguage,
    "interface",
  );
  assert.equal(resolveOutputLanguage("interface", locale), metadata.output);
  assert.equal(resolveOutputLanguage(undefined, locale), metadata.output);
  assert.equal(
    resolveOutputLanguage("ru", locale),
    "ru",
    "A fixed output language stays fixed",
  );
  assert.equal(copy.home.promptDefault, DAILY_PROMPT[locale]);
  for (const action of getPresets()) {
    assert.equal(
      action.instruction,
      "",
      "Built-in additions default to empty in every locale",
    );
    const custom = {
      ...action,
      builtin: false,
      name: "MY_NAME",
      description: "MY_DESCRIPTION",
      instruction: "MY_PROMPT",
      outputLanguage: "ru",
    };
    assert.deepEqual(localizeAction(custom, "en"), custom);
    assert.equal(
      localizeActionName(copy.presets[action.kind].name, "en"),
      messages.en.presets[action.kind].name,
    );
    assert.equal(
      localizeAction(action, "en").outputLanguage,
      action.outputLanguage,
    );
  }
  const catalog = JSON.parse(
    await readFile(
      new URL(
        `../_locales/${locale.replace("-", "_")}/messages.json`,
        import.meta.url,
      ),
    ),
  );
  assert.deepEqual(Object.keys(catalog).sort(), chromeKeys);
  assert.equal(catalog.appName.message, copy.brand);
  assert(catalog.description.message.length <= 132);
}
setLocale("en");
console.log(
  "PASS: all locale catalogs complete, regional/system matching, Traditional Chinese scripts, dynamic placeholders, Chrome metadata, preset round trips, shared model instructions and interface/fixed output languages.",
);
