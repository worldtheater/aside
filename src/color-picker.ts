import { C } from "./copy.js";
import { escapeHtml as e } from "./html.js";
import { closeMenu, showMenu } from "./controls.js";

type Hsv = { h: number; s: number; v: number };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const rgb = (hex: string) =>
  [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
const hexFromRgb = (channels: number[]) =>
  "#" +
  channels
    .map((value) => Math.round(value).toString(16).padStart(2, "0"))
    .join("");

function toHsv(hex: string, previousHue = 0): Hsv {
  const [r, g, b] = rgb(hex).map((value) => value / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const hue = !delta
    ? previousHue
    : 60 *
      (max === r
        ? ((g - b) / delta + 6) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4);
  return { h: hue, s: max ? delta / max : 0, v: max };
}
function toHex({ h, s, v }: Hsv) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const channels =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return hexFromRgb(channels.map((channel) => (channel + m) * 255));
}

export function showColorPicker(
  trigger: HTMLButtonElement,
  initial: string,
  change: (hex: string, commit: boolean) => void,
) {
  if (trigger.getAttribute("aria-expanded") === "true") {
    closeMenu(true);
    return;
  }
  let color = initial.toLowerCase(),
    hsv = toHsv(color);
  const popup = showMenu(
    trigger,
    `
    <div class="color-sv">
      <input class="color-axis" data-axis="s" type="range" min="0" max="100" step="1" aria-label="${e(C.picker.saturation)}">
      <input class="color-axis" data-axis="v" type="range" min="0" max="100" step="1" aria-label="${e(C.picker.brightness)}">
      <span class="color-cursor" aria-hidden="true"></span>
    </div>
    <input class="color-hue" type="range" min="0" max="360" step="1" aria-label="${e(C.picker.hue)}">
    <div class="color-values"><span class="color-preview" aria-hidden="true"></span><label class="color-field"><span>${C.picker.hex}</span><input id="color-hex" type="text" maxlength="7" spellcheck="false" autocomplete="off" aria-describedby="color-error"></label></div>
    <div class="color-rgb">${[C.picker.red, C.picker.green, C.picker.blue].map((label, i) => `<label class="color-field"><span aria-hidden="true">${["R", "G", "B"][i]}</span><input type="number" data-channel="${i}" min="0" max="255" step="1" aria-label="${e(label)}"></label>`).join("")}</div>
    <p class="color-error" id="color-error" role="status" hidden></p>
  `,
    C.picker.choose,
    "color-popover",
  );
  popup.setAttribute("role", "dialog");
  const sv = popup.querySelector<HTMLElement>(".color-sv")!;
  const hex = popup.querySelector<HTMLInputElement>("#color-hex")!;
  const hue = popup.querySelector<HTMLInputElement>(".color-hue")!;
  const axes = [...popup.querySelectorAll<HTMLInputElement>("[data-axis]")];
  const channels = [
    ...popup.querySelectorAll<HTMLInputElement>("[data-channel]"),
  ];
  const error = popup.querySelector<HTMLElement>(".color-error")!;

  function paint(source?: HTMLInputElement) {
    popup.style.setProperty("--color-hue", String(hsv.h));
    popup.style.setProperty("--color-x", `${hsv.s * 100}%`);
    popup.style.setProperty("--color-y", `${(1 - hsv.v) * 100}%`);
    popup.style.setProperty("--picked-color", color);
    if (source !== hex) hex.value = color.toUpperCase();
    hex.removeAttribute("aria-invalid");
    error.hidden = true;
    hue.value = String(hsv.h);
    axes.forEach((input) => {
      input.value = String(hsv[input.dataset.axis as "s" | "v"] * 100);
    });
    rgb(color).forEach((value, i) => {
      if (channels[i] !== source) channels[i].value = String(value);
    });
  }
  function update(commit: boolean, source?: HTMLInputElement) {
    color = toHex(hsv);
    paint(source);
    change(color, commit);
  }
  function setHex(value: string, source?: HTMLInputElement) {
    color = value.toLowerCase();
    hsv = toHsv(color, hsv.h);
    paint(source);
    change(color, true);
  }
  function move(event: PointerEvent) {
    const rect = sv.getBoundingClientRect();
    hsv.s = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    hsv.v = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
    update(false);
  }
  sv.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    axes[0].focus({ preventScroll: true });
    sv.setPointerCapture(event.pointerId);
    move(event);
  });
  sv.addEventListener("pointermove", (event) => {
    if (sv.hasPointerCapture(event.pointerId)) move(event);
  });
  sv.addEventListener("lostpointercapture", () => change(color, true));
  hue.addEventListener("input", () => {
    hsv.h = Number(hue.value);
    update(false);
  });
  hue.addEventListener("change", () => change(color, true));
  axes.forEach((input) => {
    input.addEventListener("input", () => {
      hsv[input.dataset.axis as "s" | "v"] = Number(input.value) / 100;
      update(false);
    });
    input.addEventListener("change", () => change(color, true));
  });
  function readHex(commit: boolean) {
    let value = hex.value.trim().replace(/^#/, "");
    if (commit && /^[\da-f]{3}$/i.test(value))
      value = [...value].map((char) => char + char).join("");
    if (/^[\da-f]{6}$/i.test(value))
      setHex("#" + value, commit ? undefined : hex);
    else if (commit) {
      hex.setAttribute("aria-invalid", "true");
      error.textContent = C.picker.invalidHex;
      error.hidden = false;
    }
  }
  hex.addEventListener("input", () => readHex(false));
  hex.addEventListener("change", () => readHex(true));
  hex.addEventListener("keydown", (event) => {
    if (event.key === "Enter") readHex(true);
  });
  channels.forEach((input, index) => {
    input.addEventListener("input", () => {
      if (!input.value || !input.validity.valid) return;
      const values = rgb(color);
      values[index] = input.valueAsNumber;
      setHex(hexFromRgb(values), input);
    });
    input.addEventListener("change", () => paint());
  });
  popup.addEventListener("focusout", (event) => {
    if (
      event.relatedTarget instanceof Node &&
      !popup.contains(event.relatedTarget) &&
      !trigger.contains(event.relatedTarget)
    )
      closeMenu();
  });
  paint();
  hex.focus({ preventScroll: true });
  hex.select();
}
