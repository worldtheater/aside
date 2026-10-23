import { request } from "./client.js";
import { pageBackground, localRepairAttribute } from "./lights-local.js";
import { modelError } from "./providers.js";
import { LIGHTS_BATCH_SIZE } from "./lights-decision.js";
import type { LightCandidate } from "./lights-decision.js";
import type { EnhanceStatus } from "./types.js";

type VisualElement = HTMLElement;
const backgroundProperty = "--aside-lights-original-background";
const candidateSelector = "*";
const effectAttribute = "data-aside-lights-effect";
const isVisual = (element: Element): element is VisualElement =>
  element instanceof HTMLElement;

/** Optional Jev classification and cached effects; basic repairs run independently. */
export class LightsEnhancer {
  state: { status: EnhanceStatus; error?: string } = { status: "off" };
  private enabled = false;
  private version = "";
  private epoch = 0;
  private timer = 0;
  private busy: "cache" | "analyze" | null = null;
  private unreadable = false;
  private records = new Map<VisualElement, string>();
  private effects = new Set<VisualElement>();
  private sheet: HTMLStyleElement | null = null;
  private observer = new MutationObserver((changes) => {
    if (
      changes.some(
        (change) =>
          (change.target instanceof Element
            ? change.target
            : change.target.parentElement
          )?.closest("h1,h2,h3,title") ||
          (change.type === "attributes"
            ? isVisual(change.target as Element) ||
              (change.target as Element).querySelector?.(candidateSelector)
            : [...change.addedNodes, ...change.removedNodes].some(
                (node) =>
                  node instanceof Element &&
                  (isVisual(node) || node.querySelector(candidateSelector)),
              )),
      )
    )
      this.schedule();
  });
  private schedule = () => {
    if (!this.enabled || this.timer || document.hidden) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      void this.scan();
    }, 600);
  };
  configure(enabled: boolean, version: string, available: boolean) {
    const next = `${enabled}:${version}:${available}`;
    if (next === this.version) return;
    this.version = next;
    this.stop();
    this.enabled = enabled && available;
    this.state = {
      status: !enabled ? "off" : !available ? "noModel" : "ready",
    };
    if (!this.enabled) return;
    this.sheet = document.createElement("style");
    this.sheet.dataset.asideLights = "enhance";
    this.sheet.classList.add("darkreader");
    this.sheet.textContent = `[${effectAttribute}="dim"]{filter:brightness(.24) saturate(.8)!important}[${effectAttribute}="lighten"]{filter:brightness(0) invert(1)!important}[${effectAttribute}="backdrop"]{background-color:#e8e6e3!important;border-radius:3px}[${effectAttribute}="shade"]{background-image:linear-gradient(rgba(0,0,0,.76),rgba(0,0,0,.76)),var(${backgroundProperty})!important}`;
    (document.head || document.documentElement).append(this.sheet);
    this.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "src",
        "srcset",
        "width",
        "height",
        "class",
        "style",
        "aria-label",
      ],
    });
    document.addEventListener("scroll", this.schedule, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", this.schedule, { passive: true });
    document.addEventListener("visibilitychange", this.schedule);
    document.addEventListener("load", this.schedule, true);
    this.schedule();
  }
  analyze() {
    if (!this.enabled || this.busy === "analyze" || document.hidden)
      return false;
    // Explicit analysis takes precedence over an unfinished local cache lookup.
    // Its late result is discarded through the existing lifecycle token.
    if (this.busy === "cache") this.epoch++;
    this.busy = null;
    // Only an explicit action can enter the model path. Recheck current evidence;
    // the background cache still avoids paying for unchanged classifications.
    this.records.clear();
    this.unreadable = false;
    void this.scan(true);
    return true;
  }
  private stop() {
    const analyzing = this.busy === "analyze";
    this.epoch++;
    this.enabled = false;
    this.busy = null;
    this.unreadable = false;
    clearTimeout(this.timer);
    this.timer = 0;
    this.observer.disconnect();
    document.removeEventListener("scroll", this.schedule, true);
    window.removeEventListener("resize", this.schedule);
    document.removeEventListener("visibilitychange", this.schedule);
    document.removeEventListener("load", this.schedule, true);
    for (const element of this.effects) this.clearEffect(element);
    this.effects.clear();
    this.records.clear();
    this.sheet?.remove();
    this.sheet = null;
    if (analyzing) void request("lights.cancel").catch(() => {});
  }
  private clearEffect(element: VisualElement) {
    element.removeAttribute(effectAttribute);
    element.style.removeProperty(backgroundProperty);
    this.effects.delete(element);
  }
  private background(element: VisualElement) {
    return (
      element.style.getPropertyValue(backgroundProperty) ||
      getComputedStyle(element).backgroundImage
    );
  }
  private backgroundBrightness(element: VisualElement) {
    return pageBackground(element).brightness;
  }
  private context(element: VisualElement) {
    const headings: string[] = [];
    let parent = element.parentElement;
    for (
      let depth = 0;
      parent && depth < 3;
      depth++, parent = parent.parentElement
    ) {
      const heading = parent.querySelector("h1,h2,h3");
      if (
        heading?.textContent &&
        heading.getBoundingClientRect().height &&
        getComputedStyle(heading).visibility !== "hidden"
      )
        headings.push(heading.textContent.trim().slice(0, 80));
    }
    return [document.title.slice(0, 160), ...new Set(headings)]
      .join(" · ")
      .slice(0, 400);
  }
  private signature(element: VisualElement) {
    // Compare the page's underlying styles, not the enhancement we applied.
    // Otherwise a backdrop invalidates itself, while a changed parent surface
    // (including the asynchronous basic theme) never invalidates a skipped mark.
    const effect = element.getAttribute(effectAttribute);
    if (effect) element.removeAttribute(effectAttribute);
    try {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return JSON.stringify([
        location.pathname + location.hash,
        this.context(element),
        style.position,
        style.filter,
        style.mixBlendMode,
        style.visibility,
        style.opacity,
        this.backgroundBrightness(element),
        element instanceof HTMLImageElement
          ? element.currentSrc
          : element instanceof HTMLCanvasElement
            ? "canvas"
            : style.backgroundImage,
        element.getAttribute("width"),
        element.getAttribute("height"),
        element.getAttribute("class"),
        element.getAttribute("aria-label"),
        Math.round(rect.width / 16),
        Math.round(rect.height / 16),
      ]);
    } finally {
      if (effect) element.setAttribute(effectAttribute, effect);
    }
  }
  private async scan(analyze = false) {
    if (!this.enabled || this.busy || document.hidden) return;
    // Theme cleanup can detach ignored sheets while this controller stays active.
    // Reattach our owned sheet so cached effects do not silently lose their CSS.
    if (this.sheet && !this.sheet.isConnected)
      (document.head || document.documentElement).append(this.sheet);
    this.busy = analyze ? "analyze" : "cache";
    if (analyze) this.state = { status: "analyzing" };
    const epoch = this.epoch;
    const entries: {
      element: VisualElement;
      signature: string;
      candidate: LightCandidate;
    }[] = [];
    try {
      for (const [element] of this.records) {
        if (!element.isConnected) {
          this.records.delete(element);
          this.effects.delete(element);
        }
      }
      // A manual pass has a finite snapshot. Scroll/DOM events cannot extend it
      // or start another model pass while it is running.
      const elements = [...document.querySelectorAll(candidateSelector)].filter(
        (element): element is VisualElement => {
          if (!isVisual(element) || element.closest("[data-pagework]"))
            return false;
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.width * rect.height >= 16 * 16 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < innerHeight &&
            rect.left < innerWidth
          );
        },
      );
      for (const element of elements) {
        if (element.hasAttribute(localRepairAttribute)) {
          this.clearEffect(element);
          this.records.delete(element);
          continue;
        }
        if (
          !(
            element instanceof HTMLImageElement ||
            element instanceof HTMLCanvasElement
          ) &&
          !/^url\(/.test(this.background(element))
        )
          continue;
        const signature = this.signature(element);
        if (this.records.get(element) === signature) continue;
        if (
          element instanceof HTMLImageElement &&
          (!element.complete || !element.naturalWidth)
        )
          continue;
        this.clearEffect(element);
        this.records.delete(element);
        const style = getComputedStyle(element);
        if (
          style.visibility === "hidden" ||
          style.display === "none" ||
          Number(style.opacity) === 0
        )
          continue;
        // The basic engine may already have corrected this image.
        if (style.filter !== "none") continue;
        this.records.set(element, signature);
        try {
          const candidate = await this.capture(element, style);
          if (epoch !== this.epoch) return;
          if (candidate) entries.push({ element, signature, candidate });
          // A canvas can be empty before its first draw. Reconsider on subsequent
          // load, scroll or DOM events instead of caching an empty observation.
          if (candidate === undefined) this.records.delete(element);
        } catch {
          if (epoch !== this.epoch) return;
          this.unreadable = true;
        }
      }
      if (epoch !== this.epoch) return;
      for (
        let offset = 0;
        offset < entries.length;
        offset += LIGHTS_BATCH_SIZE
      ) {
        const batch = entries.slice(offset, offset + LIGHTS_BATCH_SIZE);
        const decisions = await request(
          analyze ? "lights.enhance" : "lights.cached",
          {
            candidates: batch.map((entry) => entry.candidate),
          },
        );
        if (epoch !== this.epoch) return;
        for (const decision of decisions) {
          const entry = batch.find((item) => item.candidate.id === decision.id);
          if (!entry || !entry.element.isConnected) continue;
          if (entry.signature !== this.signature(entry.element)) {
            this.records.delete(entry.element);
            continue;
          }
          if (decision.effect !== "preserve") {
            if (decision.effect === "shade")
              entry.element.style.setProperty(
                backgroundProperty,
                getComputedStyle(entry.element).backgroundImage,
              );
            entry.element.setAttribute(effectAttribute, decision.effect);
            this.effects.add(entry.element);
          }
        }
      }
      if (analyze)
        this.state = { status: this.unreadable ? "partial" : "done" };
    } catch (caught) {
      if (epoch !== this.epoch) return;
      const error = modelError(caught);
      this.state = {
        status: error.code === "noDecisionConnection" ? "noModel" : "error",
        error: error.code,
      };
    } finally {
      if (epoch === this.epoch) this.busy = null;
    }
  }
  private async loadImage(url: string) {
    const resource = await request("lights.fetch", { url });
    if (!resource.binary || !resource.type.startsWith("image/"))
      throw new Error("Unreadable image");
    const image = new Image();
    image.src = `data:${resource.type};base64,${resource.body}`;
    await image.decode();
    return image;
  }
  private async capture(
    element: VisualElement,
    style: CSSStyleDeclaration,
  ): Promise<LightCandidate | null | undefined> {
    const rect = element.getBoundingClientRect();
    const isBackground = !(
      element instanceof HTMLImageElement ||
      element instanceof HTMLCanvasElement
    );
    let source: HTMLImageElement | HTMLCanvasElement;
    if (isBackground) {
      // A single image layer can be shaded independently of its HTML content.
      const match = this.background(element).match(
        /^url\(["']?([^"']+?)["']?\)$/,
      );
      if (!match || !/^https?:/.test(match[1])) return null;
      source = await this.loadImage(match[1]);
    } else source = element as HTMLImageElement | HTMLCanvasElement;
    const sourceWidth =
      source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const sourceHeight =
      source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (!sourceWidth || !sourceHeight) return undefined;
    // Enlarge small marks, not their surrounding empty padding, so thin lettering
    // remains legible to the image model at its minimum input dimensions.
    const scale = 512 / Math.max(sourceWidth, sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    let pixels: ImageData;
    try {
      ctx.drawImage(source, 0, 0, width, height);
      pixels = ctx.getImageData(0, 0, width, height);
    } catch (error) {
      if (
        !(source instanceof HTMLImageElement) ||
        !/^https?:/.test(source.currentSrc)
      )
        throw error;
      source = await this.loadImage(source.currentSrc);
      canvas.width = width;
      ctx.drawImage(source, 0, 0, width, height);
      pixels = ctx.getImageData(0, 0, width, height);
    }
    let count = 0,
      brightness = 0,
      dark = 0,
      light = 0,
      colorful = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      const [r, g, b, a] = pixels.data.subarray(i, i + 4);
      if (a < 128) continue;
      const value = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      count++;
      brightness += value;
      if (value < 0.35) dark++;
      if (value > 0.65) light++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colorful++;
    }
    if (!count) return undefined;
    brightness /= count;
    // Restrict cloud analysis to bright canvases and potentially unreadable dark marks.
    if (
      element instanceof HTMLCanvasElement || isBackground
        ? brightness <= 0.6
        : dark / count <= 0.3 ||
          count / (width * height) >= 0.9 ||
          this.backgroundBrightness(element) >= 0.45
    )
      return null;
    const tiny = document.createElement("canvas");
    tiny.width = tiny.height = 8;
    const small = tiny.getContext("2d")!;
    small.drawImage(canvas, 0, 0, 8, 8);
    const visualKey = Array.from(small.getImageData(0, 0, 8, 8).data, (value) =>
      Math.round(value / 32).toString(16),
    ).join("");
    const output = document.createElement("canvas");
    output.width = Math.max(280, width);
    output.height = Math.max(280, height);
    const out = output.getContext("2d")!;
    out.fillStyle = "#d8d8d8";
    out.fillRect(0, 0, output.width, output.height);
    out.drawImage(
      canvas,
      (output.width - width) / 2,
      (output.height - height) / 2,
    );
    let ancestor = isBackground ? element : element.parentElement,
      behindText = false;
    for (
      let depth = 0;
      ancestor && depth < 3;
      depth++, ancestor = ancestor.parentElement
    ) {
      const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
      for (
        let checked = 0, node = walker.nextNode();
        node && checked < 120;
        node = walker.nextNode()
      ) {
        if (!node.textContent?.trim()) continue;
        checked++;
        const parent = node.parentElement;
        if (
          !parent ||
          (parent !== element && parent.contains(element)) ||
          parent.closest(
            "script,style,noscript,textarea,[hidden],[data-pagework]",
          )
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (
          box.width &&
          box.height &&
          box.left < rect.right &&
          box.right > rect.left &&
          box.top < rect.bottom &&
          box.bottom > rect.top &&
          getComputedStyle(parent).visibility !== "hidden"
        ) {
          behindText = true;
          break;
        }
      }
      if (behindText) break;
    }

    return {
      id: crypto.randomUUID(),
      tag: isBackground
        ? "background"
        : element instanceof HTMLCanvasElement
          ? "canvas"
          : "img",
      label: (
        element.getAttribute("aria-label") ||
        element.getAttribute("alt") ||
        ""
      ).slice(0, 160),
      context: this.context(element),
      position: `${style.position}; z-index ${style.zIndex}`,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      behindText,
      brightness,
      darkFraction: dark / count,
      lightFraction: light / count,
      colorfulFraction: colorful / count,
      transparentFraction: 1 - count / (width * height),
      backgroundBrightness: this.backgroundBrightness(element),
      visualKey,
      image: output.toDataURL("image/png").split(",")[1],
    };
  }
}
