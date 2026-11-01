import assert from "node:assert/strict";
import {
  createWebsiteSettings,
  nextLightsMode,
  resolveWebsite,
  updateWebsite,
  websiteHostname,
} from "../website.js";
import { DECISION_MODELS_ENABLED } from "../providers.js";
assert.equal(nextLightsMode("off"), "on");
assert.equal(nextLightsMode("on"), "system");
assert.equal(nextLightsMode("system"), "off");
const settings = createWebsiteSettings();
const defaults = {
  toolbar: true,
  floating: true,
  lights: "off",
  enhance: false,
};
assert.deepEqual(resolveWebsite(settings, "docs.example.com"), defaults);
// Global switches need no active website and apply to every hostname.
updateWebsite(settings, undefined, { toolbar: false, floating: false });
for (const hostname of ["docs.example.com", "www.example.com", ""]) {
  assert.equal(resolveWebsite(settings, hostname).toolbar, false);
  assert.equal(resolveWebsite(settings, hostname).floating, false);
}
assert.deepEqual(settings.sites, {});
const persisted = JSON.parse(JSON.stringify(settings));
assert.equal(resolveWebsite(persisted, "new.example.com").floating, false);
updateWebsite(settings, "docs.example.com", { toolbar: true });
assert.equal(resolveWebsite(settings, "www.example.com").toolbar, true);
assert.equal(resolveWebsite(settings, "www.example.com").floating, false);
assert.deepEqual(settings.sites, {});
// Site settings stay local to that hostname; resetting them preserves globals.
updateWebsite(settings, "docs.example.com", { lights: "on", enhance: true });
assert.equal(resolveWebsite(settings, "www.example.com").lights, "off");
updateWebsite(settings, "docs.example.com", { lights: "system" });
assert.equal(resolveWebsite(settings, "docs.example.com").lights, "system");
updateWebsite(settings, "docs.example.com", { lights: "off" });
assert.equal(
  resolveWebsite(settings, "docs.example.com").enhance,
  DECISION_MODELS_ENABLED,
);
assert.equal(
  settings.sites["docs.example.com"].enhance,
  true,
  "Suspension does not erase saved enhancement preferences",
);
assert.equal(resolveWebsite(settings, "www.example.com").enhance, false);
updateWebsite(settings, "docs.example.com", null);
assert.deepEqual(resolveWebsite(settings, "docs.example.com"), {
  ...defaults,
  floating: false,
});
assert.deepEqual(settings.sites, {});
updateWebsite(settings, undefined, { floating: null });
assert.deepEqual(resolveWebsite(settings, "docs.example.com"), defaults);
assert.equal(
  websiteHostname("https://DOCS.example.com:8443/a?q=b"),
  "docs.example.com",
);
for (const url of [
  "file:///tmp/a",
  "chrome://extensions",
  "data:text/html,test",
])
  assert.throws(() => websiteHostname(url));
for (const patch of [
  { lights: "unknown" },
  { toolbar: 1 },
  { floating: "yes" },
  { theme: "dark" },
  { enhance: "yes" },
  { toolbar: false, lights: "unknown" },
]) {
  const before = structuredClone(settings);
  assert.throws(() => updateWebsite(settings, "docs.example.com", patch));
  assert.deepEqual(
    settings,
    before,
    "Reject invalid patches before changing any setting",
  );
}
for (const patch of [
  null,
  { lights: "on" },
  { toolbar: false, lights: "on" },
]) {
  const before = structuredClone(settings);
  assert.throws(() => updateWebsite(settings, undefined, patch));
  assert.deepEqual(settings, before);
}
updateWebsite(settings, "__proto__", { lights: "on" });
assert.equal(resolveWebsite(settings, "other.example").lights, "off");
assert.equal(Object.getPrototypeOf(settings.sites), Object.prototype);
// Old per-site switches and retired defaults cannot override global controls.
const oldSettings = {
  sites: {
    "docs.example.com": { toolbar: false, floating: false, lights: "on" },
  },
  defaults: { ...defaults, toolbar: false, floating: false },
};
assert.deepEqual(resolveWebsite(oldSettings, "docs.example.com"), {
  ...defaults,
  lights: "on",
});
assert.deepEqual(resolveWebsite(oldSettings, "other.example"), defaults);
updateWebsite(oldSettings, undefined, { toolbar: false });
assert.equal(resolveWebsite(oldSettings, "other.example").toolbar, false);
assert.equal(resolveWebsite(oldSettings, "docs.example.com").floating, true);
console.log(
  "PASS: global independent tools, persisted settings, site-specific lights, upgrade defaults, atomic validation and safe site keys.",
);
