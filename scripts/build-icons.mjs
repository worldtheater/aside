import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const icons = new URL("../icons/", import.meta.url);
const safari = process.argv.includes("--safari");
const output = safari
  ? new URL(
      "../safari/host/Assets.xcassets/AppIcon.appiconset/",
      import.meta.url,
    )
  : icons;
const images = [16, 32, 128, 256, 512].flatMap((size) =>
  [1, 2].map((scale) => ({
    size: `${size}x${size}`,
    idiom: "mac",
    scale: `${scale}x`,
    filename: `mac-icon-${size}@${scale}x.png`,
  })),
);
const targets = safari
  ? images.map((item) => ({
      size: parseInt(item.size) * parseInt(item.scale),
      filename: item.filename,
    }))
  : [16, 32, 48, 128].map((size) => ({ size, filename: `icon-${size}.png` }));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
});
try {
  const page = await browser.newPage();
  for (const { size, filename } of targets) {
    const source = size <= 32 ? "icon-small.svg" : "icon.svg";
    const svg = await readFile(new URL(source, icons), "utf8");
    const png = await page.evaluate(
      async ({ svg, size, inset }) => {
        const image = new Image();
        image.src =
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas
          .getContext("2d")
          .drawImage(image, inset, inset, size - inset * 2, size - inset * 2);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      {
        svg,
        size,
        // Keep Mac artwork inside the system icon canvas; browser icons retain their existing inset.
        inset: safari ? Math.round(size * 0.1) : size === 128 ? 16 : 0,
      },
    );
    await writeFile(new URL(filename, output), Buffer.from(png, "base64"));
    console.log(`${filename} ← ${source}`);
  }
  if (safari)
    await writeFile(
      new URL("Contents.json", output),
      JSON.stringify(
        { images, info: { version: 1, author: "xcode" } },
        null,
        2,
      ) + "\n",
    );
} finally {
  await browser.close();
}
