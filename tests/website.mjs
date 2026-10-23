import assert from "node:assert/strict";
import {
  createWebsiteSettings,
  resolveWebsite,
  updateWebsite,
  websiteHostname,
} from "../website.js";
import { DECISION_MODELS_ENABLED } from "../providers.js";
const settings = createWebsiteSettings();
const defaults = {
  toolbar: true,
  floating: true,
  lights: "off",
  enhance: false,
};
assert.deepEqual(resolveWebsite(settings, "docs.example.com"), defaults);
updateWebsite(settings, "docs.example.com", {
  toolbar: false,
  floating: false,
});
assert.equal(resolveWebsite(settings, "docs.example.com").toolbar, false);
assert.equal(resolveWebsite(settings, "www.example.com").toolbar, true);
assert.equal(resolveWebsite(settings, "docs.example.com").floating, false);
const persisted = JSON.parse(JSON.stringify(settings));
assert.equal(resolveWebsite(persisted, "docs.example.com").floating, false);
updateWebsite(settings, "docs.example.com", { toolbar: true });
assert.deepEqual(settings.sites["docs.example.com"], { floating: false });
updateWebsite(settings, "docs.example.com", { lights: "on", enhance: true });
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
assert.deepEqual(resolveWebsite(settings, "docs.example.com"), defaults);
assert.deepEqual(settings.sites, {});
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
])
  assert.throws(() => updateWebsite(settings, "docs.example.com", patch));
assert.throws(() => updateWebsite(settings, null, { toolbar: false }));
updateWebsite(settings, "__proto__", { toolbar: false });
assert.equal(resolveWebsite(settings, "other.example").toolbar, true);
assert.equal(Object.getPrototypeOf(settings.sites), Object.prototype);
// Retired global values in stored settings must not disable tools on other sites.
settings.defaults = { ...defaults, toolbar: false, floating: false };
assert.deepEqual(resolveWebsite(settings, "other.example"), defaults);
console.log(
  "PASS: fixed defaults, remembered site switches, domain isolation, sparse overrides, validation and safe site keys.",
);
