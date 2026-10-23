import { LightsLocalRepairs } from "./lights-local.js";
import { LightsEnhancer } from "./lights-enhance.js";
import { enable, disable, isEnabled, setFetchMethod } from "darkreader";
import { request } from "./client.js";
import { resolveWebsite, websiteHostname } from "./website.js";
import type { LightsMode, LightsStatus, PublicConfig } from "./types.js";

// all_frames can match HTTP children of browser/extension pages. Check the
// top-level origin before starting; those surfaces are not supported websites.
const websiteUrl = location.ancestorOrigins.length
  ? location.ancestorOrigins[location.ancestorOrigins.length - 1]
  : location.href;
if (/^https?:\/\//i.test(websiteUrl) && !globalThis.__asideLights) {
  globalThis.__asideLights = true;
  // DOM listeners survive extension reload, while the old isolated world's
  // runtime messaging no longer works. Let our old controller release its own
  // engine and observers before the new instance inspects Dark Reader markers.
  const disposeEvent = `__aside_lights_dispose_${chrome.runtime.id}`;
  document.dispatchEvent(new Event(disposeEvent));
  let disposed = false;
  // Ordinary cross-origin frames still follow their top-level website's policy.
  const hostname = websiteHostname(websiteUrl);
  const localRepairs = new LightsLocalRepairs();
  const enhancer = new LightsEnhancer();
  let enhanced = false,
    decisionAvailable = false,
    revision = 0;
  let mode: LightsMode = "off";
  let status: LightsStatus = "off";
  let frame = 0;
  let observedBody: HTMLElement | null = null;
  const observer = new MutationObserver(schedule);
  // Websites choose their own theme attributes (and may use inline variables).
  // Observe only these two roots, without assuming a particular naming scheme.
  const observerOptions = { attributes: true };

  setFetchMethod(async (url) => {
    const resource = await request("lights.fetch", { url });
    const body = resource.binary
      ? Uint8Array.from(atob(resource.body), (character) =>
          character.charCodeAt(0),
        )
      : resource.body;
    return new Response(body, { headers: { "Content-Type": resource.type } });
  });

  function lightness(color: string): { value: number; alpha: number } {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return {
      value: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
      alpha: a / 255,
    };
  }
  function nativeDark(): boolean {
    if (!document.body) return false;
    // Inspect the site's own colors without our generated overrides. Disabling
    // and restoring sheets in one task does not paint an intermediate frame.
    const sheets = [
      ...document.querySelectorAll<HTMLStyleElement>("style.darkreader"),
    ]
      .map((node) => node.sheet)
      .filter((sheet): sheet is CSSStyleSheet =>
        Boolean(sheet && !sheet.disabled),
      );
    sheets.forEach((sheet) => {
      sheet.disabled = true;
    });
    try {
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const rootColor = lightness(root.backgroundColor);
      const bodyColor = lightness(body.backgroundColor);
      const rootValue =
        rootColor.alpha * rootColor.value + (1 - rootColor.alpha);
      const background =
        bodyColor.alpha * bodyColor.value + (1 - bodyColor.alpha) * rootValue;
      const foreground = lightness(body.color).value;
      const scheme = root.colorScheme.trim();
      if (
        ["dark", "only dark"].includes(scheme) &&
        rootColor.alpha === 0 &&
        bodyColor.alpha === 0
      )
        return true;
      return background < 0.45 && foreground > background + 0.2;
    } finally {
      sheets.forEach((sheet) => {
        sheet.disabled = false;
      });
    }
  }
  function apply() {
    if (disposed) return;
    applyBasic();
    localRepairs.configure(status === "active");
    enhancer.configure(
      enhanced && status === "active",
      String(revision),
      decisionAvailable,
    );
  }
  function applyBasic() {
    frame = 0;
    const wanted =
      mode === "on" ||
      (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    if (!wanted) {
      if (isEnabled()) disable();
      status = "off";
      observer.disconnect();
      observedBody = null;
      return;
    }
    observer.observe(document.documentElement, observerOptions);
    if (document.body && observedBody !== document.body) {
      observer.observe(document.body, observerOptions);
      observedBody = document.body;
    }
    // Do not take over or remove a theme owned by another extension or the site.
    if (
      !isEnabled() &&
      document.querySelector(
        'meta[name="darkreader"],meta[name="darkreader-lock"]',
      )
    ) {
      status = "external";
      return;
    }
    if (nativeDark()) {
      if (isEnabled()) disable();
      status = "native";
      return;
    }
    if (!isEnabled()) enable({ brightness: 100, contrast: 100, sepia: 0 });
    status = "active";
  }
  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(apply);
  }
  function update(config: PublicConfig) {
    if (disposed) return;
    const features = resolveWebsite(config.website, hostname);
    mode = features.lights;
    enhanced = features.enhance;
    decisionAvailable = config.connections.some(
      (c) =>
        c.id === config.defaultDecisionConnection &&
        c.protocol === "typesafe" &&
        c.connected,
    );
    revision++;
    if (frame) cancelAnimationFrame(frame);
    apply();
  }
  document.addEventListener("DOMContentLoaded", schedule);
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  darkQuery.addEventListener("change", schedule);
  window.addEventListener("load", schedule);
  const ready = request("settings.public").then(update);
  const onMessage: Parameters<
    typeof chrome.runtime.onMessage.addListener
  >[0] = (message, sender, respond) => {
    if (disposed || sender.id !== chrome.runtime.id) return;
    if (message.type === "settings.updated") {
      update(message.config);
      respond(true);
    } else if (message.type === "lights.status") {
      void ready.then(
        () => respond({ status, mode, enhancement: enhancer.state }),
        () => respond(null),
      );
      return true;
    } else if (message.type === "lights.analyze") {
      respond(enhancer.analyze());
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  document.addEventListener(
    disposeEvent,
    () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("DOMContentLoaded", schedule);
      darkQuery.removeEventListener("change", schedule);
      window.removeEventListener("load", schedule);
      localRepairs.configure(false);
      enhancer.configure(false, "disposed", false);
      if (isEnabled()) disable();
      if (chrome.runtime.id) chrome.runtime.onMessage.removeListener(onMessage);
    },
    { once: true },
  );
  void ready.catch(console.warn);
}
