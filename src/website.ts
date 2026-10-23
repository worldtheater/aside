import { ModelError, DECISION_MODELS_ENABLED } from "./providers.js";
import type {
  WebsiteFeatures,
  WebsiteSettings,
  WebsitePatch,
} from "./types.js";

const defaultWebsiteFeatures: WebsiteFeatures = {
  toolbar: true,
  floating: true,
  lights: "off",
  enhance: false,
};
export function createWebsiteSettings(): WebsiteSettings {
  return { sites: {} };
}
export function websiteHostname(url: string): string {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new ModelError("notAllowed");
  return parsed.hostname.toLowerCase();
}
export function resolveWebsite(
  settings: WebsiteSettings,
  hostname: string,
): WebsiteFeatures {
  const features = {
    ...defaultWebsiteFeatures,
    ...(Object.hasOwn(settings.sites, hostname)
      ? settings.sites[hostname]
      : {}),
  };
  return { ...features, enhance: DECISION_MODELS_ENABLED && features.enhance };
}
export function updateWebsite(
  settings: WebsiteSettings,
  hostname: string,
  patch: WebsitePatch | null,
): void {
  if (!hostname) throw new ModelError("invalidInput");
  if (patch === null) {
    delete settings.sites[hostname];
    return;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (
      !Object.hasOwn(defaultWebsiteFeatures, key) ||
      (value !== null &&
        (key === "lights"
          ? !["off", "on", "system"].includes(String(value))
          : typeof value !== "boolean"))
    )
      throw new ModelError("invalidInput");
  }
  const next = Object.hasOwn(settings.sites, hostname)
    ? { ...settings.sites[hostname] }
    : {};
  for (const [key, value] of Object.entries(patch)) {
    if (
      value === null ||
      value === defaultWebsiteFeatures[key as keyof WebsiteFeatures]
    )
      delete next[key as keyof WebsiteFeatures];
    else Object.assign(next, { [key]: value });
  }
  if (Object.keys(next).length)
    settings.sites = { ...settings.sites, [hostname]: next };
  else delete settings.sites[hostname];
}
