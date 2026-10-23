import { svgTextColors } from "./lights-svg-text.js";

type LocalElement = HTMLImageElement | SVGSVGElement;
export const localRepairAttribute = "data-aside-lights-repair";
const svgPaintProperties = ["fill", "stroke", "stop-color"] as const;

export function pageBackground(element: Element) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  const chain: Element[] = [];
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  )
    chain.push(current);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1, 1);
  for (const node of chain.reverse()) {
    ctx.fillStyle = getComputedStyle(node).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
  }
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return {
    color: `rgb(${r} ${g} ${b})`,
    brightness: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
  };
}

/** Deterministic repairs owned by basic Lights; no model or messaging dependency. */
export class LightsLocalRepairs {
  private enabled = false;
  private timer = 0;
  private records = new Map<LocalElement, string>();
  private effects = new Set<LocalElement>();
  private sheet: HTMLStyleElement | null = null;
  private observer = new MutationObserver(() => this.schedule());
  private schedule = () => {
    if (!this.enabled || this.timer || document.hidden) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.scan();
    }, 600);
  };
  configure(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      clearTimeout(this.timer);
      this.timer = 0;
      this.observer.disconnect();
      document.removeEventListener("scroll", this.schedule, true);
      window.removeEventListener("resize", this.schedule);
      document.removeEventListener("visibilitychange", this.schedule);
      document.removeEventListener("load", this.schedule, true);
      for (const element of this.effects) this.clearEffect(element);
      this.records.clear();
      this.sheet?.remove();
      this.sheet = null;
      return;
    }
    this.sheet = document.createElement("style");
    this.sheet.dataset.asideLights = "local";
    this.sheet.classList.add("darkreader");
    this.sheet.textContent = `[${localRepairAttribute}="unblend"]{mix-blend-mode:normal!important}svg[${localRepairAttribute}="measure"],svg[${localRepairAttribute}="measure"] *{transition:none!important}`;
    // Important layered declarations outrank unlayered page/engine rules while
    // leaving the site's original fill and opacity untouched.
    this.sheet.textContent += `@layer{svg[${localRepairAttribute}="text"] [data-aside-lights-text]{fill:var(--aside-lights-text-fill)!important}}`;
    this.sheet.textContent += `svg[${localRepairAttribute}="svg"]{background-color:var(--aside-lights-svg-background)!important}`;
    for (const property of svgPaintProperties)
      this.sheet.textContent += `svg[${localRepairAttribute}="svg"],svg[${localRepairAttribute}="svg"] *{${property}:var(--aside-lights-svg-${property})!important}`;
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
        "fill",
        "stroke",
        "stop-color",
        "viewBox",
        "opacity",
        "visibility",
        "fill-opacity",
        "stroke-opacity",
        "x",
        "y",
        "dx",
        "dy",
        "transform",
        "d",
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
  private scan() {
    if (!this.enabled || document.hidden) return;
    if (this.sheet && !this.sheet.isConnected)
      (document.head || document.documentElement).append(this.sheet);
    for (const element of new Set([...this.records.keys(), ...this.effects])) {
      if (!element.isConnected) {
        this.records.delete(element);
        this.clearEffect(element);
      }
    }
    for (const element of document.querySelectorAll<LocalElement>("img,svg")) {
      if (element.closest("[data-pagework]")) continue;
      const rect = element.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.width * rect.height < 16 * 16 ||
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= innerHeight ||
        rect.left >= innerWidth
      )
        continue;
      if (element instanceof SVGSVGElement) {
        if (
          !element.ownerSVGElement &&
          ((rect.width >= 160 && rect.height >= 160) ||
            element.querySelector("text"))
        )
          this.repairSvg(element);
        continue;
      }
      if (!element.complete || !element.naturalWidth) continue;
      // Measure the site's blend mode, not our own normal-blend override.
      element.removeAttribute(localRepairAttribute);
      const style = getComputedStyle(element);
      if (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) !== 0 &&
        ["multiply", "darken", "color-burn"].includes(style.mixBlendMode) &&
        pageBackground(element).brightness < 0.45
      ) {
        element.setAttribute(localRepairAttribute, "unblend");
        this.effects.add(element);
      } else this.effects.delete(element);
    }
  }
  private clearEffect(element: LocalElement) {
    element.removeAttribute(localRepairAttribute);
    if (element instanceof SVGSVGElement) {
      element.style.removeProperty("--aside-lights-svg-background");
      for (const node of [
        element,
        ...element.querySelectorAll<SVGElement>("*"),
      ]) {
        for (const property of svgPaintProperties)
          node.style?.removeProperty(`--aside-lights-svg-${property}`);
        node.removeAttribute("data-aside-lights-text");
        node.style?.removeProperty("--aside-lights-text-fill");
      }
    }
    this.effects.delete(element);
  }
  private repairSvg(element: SVGSVGElement) {
    // An SVG diagram can encode different meanings using black and white. If the
    // basic theme collapses their contrast, restore those original paints.
    // This deterministic loss of contrast does not require a model classification.
    const nodes = [element, ...element.querySelectorAll<SVGElement>("*")];
    if (nodes.length > 2000) return;
    const effect = element.getAttribute(localRepairAttribute);
    element.setAttribute(localRepairAttribute, "measure");
    const themed = nodes.map((node) => {
      const style = getComputedStyle(node);
      return svgPaintProperties.map((property) =>
        style.getPropertyValue(property),
      );
    });
    const textColors = svgTextColors(element);
    const sheets = [
      ...document.querySelectorAll<HTMLStyleElement>("style.darkreader"),
    ]
      .filter((node) => node !== this.sheet)
      .map((node) => node.sheet)
      .filter((sheet): sheet is CSSStyleSheet =>
        Boolean(sheet && !sheet.disabled),
      );
    let paints: string[][], surface: { color: string; brightness: number };
    sheets.forEach((sheet) => {
      sheet.disabled = true;
    });
    try {
      paints = nodes.map((node) => {
        const style = getComputedStyle(node);
        return svgPaintProperties.map((property) =>
          style.getPropertyValue(property),
        );
      });
      surface = pageBackground(element);
    } finally {
      sheets.forEach((sheet) => {
        sheet.disabled = false;
      });
      // Flush restored theme paints before allowing CSS transitions again.
      getComputedStyle(element).fill;
      if (effect) element.setAttribute(localRepairAttribute, effect);
      else element.removeAttribute(localRepairAttribute);
    }
    // Compare visible fills of the same shape type. Text, strokes, clipping
    // paths and hidden tooltip backgrounds are not interchangeable data marks.
    const visibleFills = nodes.map((node) => {
      if (
        !node.matches("path,rect,circle,ellipse,polygon,polyline") ||
        node.closest("defs,clipPath,mask,pattern,marker")
      )
        return false;
      const bounds = node.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return false;
      const style = getComputedStyle(node);
      if (style.visibility !== "visible" || Number(style.fillOpacity) === 0)
        return false;
      for (
        let parent: Element | null = node;
        parent;
        parent = parent.parentElement
      ) {
        const current = getComputedStyle(parent);
        if (current.display === "none" || Number(current.opacity) === 0)
          return false;
      }
      return true;
    });
    // Paint evidence, rather than our custom style properties, invalidates a
    // diagram after its own CSS or shapes change. Geometry and interaction stay intact.
    const signature = JSON.stringify([
      paints,
      themed,
      surface,
      visibleFills,
      textColors.map(([node, color]) => [nodes.indexOf(node), color]),
    ]);
    if (
      this.records.get(element) === signature &&
      (effect === "svg" ||
        textColors.every(
          ([node, color]) =>
            node.style.getPropertyValue("--aside-lights-text-fill") === color,
        ))
    )
      return;
    this.records.set(element, signature);
    this.clearEffect(element);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const brightness = (paint: string) => {
      if (!CSS.supports("color", paint)) return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = paint;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return a < 128 ? null : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const fills = new Map<string, { dark: number[]; light: number[] }>();
    nodes.forEach((node, index) => {
      if (!visibleFills[index]) return;
      const before = brightness(paints[index][0]),
        after = brightness(themed[index][0]);
      if (before === null || after === null) return;
      const group = fills.get(node.localName) || { dark: [], light: [] };
      if (before < 0.25) group.dark.push(after);
      if (before > 0.75) group.light.push(after);
      fills.set(node.localName, group);
    });
    // Keep the existing shape-restoration scope; a small SVG with text only
    // needs text repair, not a new light backing for the whole diagram.
    const bounds = element.getBoundingClientRect();
    if (
      bounds.width < 160 ||
      bounds.height < 160 ||
      ![...fills.values()].some((group) =>
        group.dark.some((dark) =>
          group.light.some((light) => Math.abs(light - dark) < 0.2),
        ),
      )
    ) {
      if (textColors.length) {
        for (const [node, color] of textColors) {
          node.style.setProperty("--aside-lights-text-fill", color);
          node.setAttribute("data-aside-lights-text", "");
        }
        element.setAttribute(localRepairAttribute, "text");
        this.effects.add(element);
      }
      return;
    }
    nodes.forEach((node, index) =>
      svgPaintProperties.forEach((property, column) =>
        node.style?.setProperty(
          `--aside-lights-svg-${property}`,
          paints[index][column],
        ),
      ),
    );
    element.style.setProperty("--aside-lights-svg-background", surface.color);
    element.setAttribute(localRepairAttribute, "svg");
    this.effects.add(element);
  }
}
