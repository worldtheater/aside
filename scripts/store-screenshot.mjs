import path from "node:path";
import { escapeHtml } from "../html.js";

const width = 1280;
const height = 800;
const ui = "[data-pagework=ui]";
const scenes = [
  { crops: [["main h1", "#first"]], paper: "#f3e8d8" },
  {
    crops: [["main h1", "#citation", "#first"], [`${ui} #selection`]],
    paper: "#e7eef1",
  },
  { crops: [[".collection-section"]], paper: "#e9efe8" },
  {
    crops: [
      [".field:has(#action-name)", ".field:has(#instruction)"],
      [".test-panel"],
    ],
    paper: "#eee9ed",
  },
  {
    crops: [["main h1", "#first", `${ui} #dock`, `${ui} #radial button`]],
    paper: "#22292c",
    dark: true,
  },
];

async function captureRegion(page, selectors) {
  const boxes = [];
  for (const selector of selectors) {
    for (const element of await page.locator(selector).all()) {
      const box = await element.boundingBox();
      if (box) boxes.push(box);
    }
  }
  if (!boxes.length) throw new Error(`Empty screenshot region: ${selectors}`);
  const viewport = page.viewportSize();
  const margin = 22;
  const x = Math.max(
    0,
    Math.floor(Math.min(...boxes.map((box) => box.x)) - margin),
  );
  const y = Math.max(
    0,
    Math.floor(Math.min(...boxes.map((box) => box.y)) - margin),
  );
  const right = Math.min(
    viewport.width,
    Math.ceil(Math.max(...boxes.map((box) => box.x + box.width)) + margin),
  );
  const bottom = Math.min(
    viewport.height,
    Math.ceil(Math.max(...boxes.map((box) => box.y + box.height)) + margin),
  );
  return page.screenshot({
    clip: { x, y, width: right - x, height: bottom - y },
    animations: "disabled",
  });
}

export async function renderStoreScreenshot({
  page,
  canvas,
  filename,
  output,
  locale,
  copy,
  logo,
}) {
  const index = Number(filename.slice(0, 2)) - 1;
  const scene = scenes[index];
  const { title, caption } = copy.cards[index];
  const captures = [];
  for (const selectors of scene.crops) {
    const image = await captureRegion(page, selectors);
    captures.push(
      `<figure><img alt="" src="data:image/png;base64,${image.toString("base64")}"></figure>`,
    );
  }
  await canvas.setViewportSize({ width, height });
  await canvas.setContent(
    `<!doctype html><html lang="${locale}"><style>
    *{box-sizing:border-box}
    body{margin:0;height:100vh;display:flex;flex-direction:column;padding:44px 64px 42px;background:${scene.paper};color:${scene.dark ? "#f4f1e9" : "#252a2d"};font-family:system-ui,sans-serif}
    .mast{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:1px solid currentColor}
    .brand{display:flex;align-items:center;gap:10px;font-size:21px;font-weight:650}
    .brand svg{width:27px;height:27px}
    .number{font-size:15px;letter-spacing:.14em;font-variant-numeric:tabular-nums;opacity:.72}
    h1{margin:21px 0 6px;font-size:52px;line-height:1.16;font-weight:680;letter-spacing:-.025em}
    p{margin:0;font-size:22px;line-height:1.4;opacity:.76}
    .stage{margin-top:25px;flex:1;min-height:0;display:grid;grid-template-columns:repeat(${captures.length},minmax(0,1fr));gap:24px}
    figure{min-width:0;min-height:0;margin:0;display:flex;align-items:center;justify-content:center}
    img{display:block;max-width:100%;max-height:100%;border-radius:14px;outline:1px solid #252a2d19;box-shadow:0 15px 35px #171e2521}
  </style><body><header><div class="mast"><div class="brand">${logo}<span>${escapeHtml(copy.brand)}</span></div><span class="number">${filename.slice(0, 2)} / ${String(scenes.length).padStart(2, "0")}</span></div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(caption)}</p></header><div class="stage">${captures.join("")}</div></body></html>`,
    { waitUntil: "load" },
  );
  await canvas.evaluate(() => document.fonts.ready);
  await canvas.screenshot({
    path: path.join(output, filename),
    scale: "css",
    animations: "disabled",
  });
}
