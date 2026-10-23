/** Local contrast repair for solid SVG text, without changing chart marks. */
export function svgTextColors(svg: SVGSVGElement): [SVGElement, string][] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  type Color = [number, number, number, number];
  const parse = (paint: string): Color | null => {
    if (!CSS.supports("color", paint)) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = paint;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data] as Color;
  };
  const over = (ink: Color, paper: Color): Color => {
    const alpha = ink[3] / 255;
    return [
      ink[0] * alpha + paper[0] * (1 - alpha),
      ink[1] * alpha + paper[1] * (1 - alpha),
      ink[2] * alpha + paper[2] * (1 - alpha),
      255,
    ];
  };
  const luminance = (color: Color) =>
    color.slice(0, 3).reduce((sum, channel, i) => {
      const c = channel / 255;
      return (
        sum +
        [0.2126, 0.7152, 0.0722][i] *
          (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      );
    }, 0);
  const contrast = (ink: Color, paper: Color) => {
    const composited = over(ink, paper);
    // Round toward the paper when checking 8-bit colors, so translucent text
    // does not fall just below the threshold after the browser composites it.
    for (let i = 0; i < 3; i++)
      composited[i] =
        composited[i] > paper[i]
          ? Math.floor(composited[i])
          : Math.ceil(composited[i]);
    const a = luminance(composited),
      b = luminance(paper);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (node: Element) => {
    if (!styles.has(node)) styles.set(node, getComputedStyle(node));
    return styles.get(node)!;
  };
  const visible = (node: Element) => {
    for (let p: Element | null = node; p; p = p.parentElement) {
      const s = style(p);
      if (
        s.display === "none" ||
        s.visibility !== "visible" ||
        Number(s.opacity) === 0
      )
        return false;
    }
    return true;
  };
  // Do not guess the paper color under photos, gradients, blend modes or filters.
  const simpleSurface = (node: Element, textOpacity = false) => {
    for (let p: Element | null = node; p; p = p.parentElement) {
      const s = style(p);
      if (
        (!textOpacity && Number(s.opacity) !== 1) ||
        s.filter !== "none" ||
        s.mixBlendMode !== "normal" ||
        s.maskImage !== "none" ||
        s.clipPath !== "none" ||
        s.backgroundImage !== "none"
      )
        return false;
    }
    return true;
  };
  if (!simpleSurface(svg)) return [];
  let paper: Color = [255, 255, 255, 255];
  const parents: Element[] = [];
  for (let p: Element | null = svg; p; p = p.parentElement) parents.push(p);
  for (const p of parents.reverse()) {
    const color = parse(style(p).backgroundColor);
    if (color) paper = over(color, paper);
  }
  const layers: {
    node: SVGElement;
    bounds: DOMRect;
    matrix: DOMMatrix | null;
    fill: Color | null;
    stroke: Color | null;
    simple: boolean;
  }[] = [];
  const result: [SVGElement, string][] = [];
  for (const node of svg.querySelectorAll<SVGElement>("*")) {
    if (node.closest("defs,clipPath,mask,pattern,marker") || !visible(node))
      continue;
    if (
      node instanceof SVGGeometryElement ||
      node.matches("image,use,foreignObject")
    ) {
      const s = style(node),
        bounds = node.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const fill = parse(s.fill),
        stroke = parse(s.stroke);
      if (fill) fill[3] *= Number(s.fillOpacity);
      if (stroke) stroke[3] *= Number(s.strokeOpacity);
      layers.push({
        node,
        bounds,
        matrix:
          node instanceof SVGGraphicsElement
            ? node.getScreenCTM()?.inverse() || null
            : null,
        fill,
        stroke,
        simple: simpleSurface(node),
      });
      continue;
    }
    if (
      !(node instanceof SVGTextContentElement) ||
      !node.textContent?.trim() ||
      ![...node.childNodes].some(
        (child) =>
          child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
      ) ||
      !simpleSurface(node, true)
    )
      continue;
    const s = style(node),
      ink = parse(s.fill);
    // Keep opacity and paint semantics. Contrast is measured after compositing;
    // a faded label is changed only if its existing opacity can meet the target.
    if (!ink || s.stroke !== "none") continue;
    const paintAlpha = ink[3] / 255;
    ink[3] *= Number(s.fillOpacity);
    for (
      let parent: Element | null = node;
      parent && parent !== svg;
      parent = parent.parentElement
    )
      ink[3] *= Number(style(parent).opacity);
    const count = node.getNumberOfChars(),
      matrix = node.getScreenCTM();
    if (!count || !matrix) continue;
    const backgrounds: Color[] = [];
    for (const index of new Set([0, Math.floor(count / 2), count - 1])) {
      const box = node.getExtentOfChar(index);
      const point = new DOMPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      ).matrixTransform(matrix);
      let background: Color | null = paper;
      for (const layer of layers) {
        const r = layer.bounds;
        if (
          point.x < r.left ||
          point.x > r.right ||
          point.y < r.top ||
          point.y > r.bottom
        )
          continue;
        if (!(layer.node instanceof SVGGeometryElement) || !layer.matrix) {
          background = null;
          break;
        }
        const local = point.matrixTransform(layer.matrix);
        const fills =
          layer.node.isPointInFill(local) && style(layer.node).fill !== "none";
        const strokes =
          layer.node.isPointInStroke(local) &&
          style(layer.node).stroke !== "none";
        if (!fills && !strokes) continue;
        if (
          !layer.simple ||
          (fills && !layer.fill) ||
          (strokes && !layer.stroke)
        ) {
          background = null;
          break;
        }
        if (fills) background = over(layer.fill!, background);
        if (strokes) background = over(layer.stroke!, background);
      }
      if (!background) break;
      backgrounds.push(background);
    }
    if (
      backgrounds.length !== new Set([0, Math.floor(count / 2), count - 1]).size
    )
      continue;
    const score = (color: Color) =>
      Math.min(...backgrounds.map((bg) => contrast(color, bg)));
    const target = 4.5;
    if (score(ink) >= target) continue;
    // Mix toward a neutral endpoint: hue is retained for colored chart labels.
    const endpoints: Color[] = [
      [255, 255, 255, ink[3]],
      [0, 0, 0, ink[3]],
    ];
    const end = endpoints.sort((a, b) => score(b) - score(a))[0];
    if (score(end) < target) continue; // Mixed surfaces need a different treatment.
    const mix = (amount: number): Color => [
      Math.round(ink[0] + (end[0] - ink[0]) * amount),
      Math.round(ink[1] + (end[1] - ink[1]) * amount),
      Math.round(ink[2] + (end[2] - ink[2]) * amount),
      ink[3],
    ];
    let low = 0,
      high = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (low + high) / 2;
      if (score(mix(mid)) >= target) high = mid;
      else low = mid;
    }
    const color = mix(high);
    result.push([
      node,
      `rgb(${color.slice(0, 3).join(" ")}${paintAlpha === 1 ? "" : ` / ${paintAlpha}`})`,
    ]);
  }
  // Changing a text parent's inherited fill must not recolor a child run that
  // already has sufficient contrast or intentionally uses a different paint.
  for (const node of svg.querySelectorAll<SVGElement>("tspan,textPath")) {
    if (
      result.some(([parent]) => parent !== node && parent.contains(node)) &&
      !result.some(([patched]) => patched === node)
    )
      result.push([node, style(node).fill]);
  }
  return result;
}
