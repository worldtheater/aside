import { ModelError, DECISION_MODELS_ENABLED } from "./providers.js";
import type {
  LightsMode,
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
export function nextLightsMode(mode: LightsMode): LightsMode {
  return mode === "off" ? "on" : mode === "on" ? "system" : "off";
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
  const site = Object.hasOwn(settings.sites, hostname)
    ? settings.sites[hostname]
    : undefined;
  return {
    toolbar: settings.toolbar ?? defaultWebsiteFeatures.toolbar,
    floating: settings.floating ?? defaultWebsiteFeatures.floating,
    lights: site?.lights ?? defaultWebsiteFeatures.lights,
    enhance:
      DECISION_MODELS_ENABLED &&
      (site?.enhance ?? defaultWebsiteFeatures.enhance),
  };
}

export function updateWebsite(
  settings: WebsiteSettings,
  hostname: string | undefined,
  patch: WebsitePatch | null,
): void {
  if (patch === null) {
    if (!hostname) throw new ModelError("invalidInput");
    delete settings.sites[hostname];
    return;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (
      !Object.hasOwn(defaultWebsiteFeatures, key) ||
      (!hostname && (key === "lights" || key === "enhance")) ||
      (value !== null &&
        (key === "lights"
          ? !["off", "on", "system"].includes(String(value))
          : typeof value !== "boolean"))
    )
      throw new ModelError("invalidInput");
  }
  const next =
    hostname && Object.hasOwn(settings.sites, hostname)
      ? { ...settings.sites[hostname] }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "toolbar" || key === "floating") {
      if (value === null || value === defaultWebsiteFeatures[key])
        delete settings[key];
      else settings[key] = value as boolean;
      continue;
    }
    if (
      value === null ||
      value === defaultWebsiteFeatures[key as keyof WebsiteFeatures]
    )
      delete next[key as keyof typeof next];
    else Object.assign(next, { [key]: value });
  }
  if (!hostname) return;
  if (Object.keys(next).length)
    settings.sites = { ...settings.sites, [hostname]: next };
  else delete settings.sites[hostname];
}
