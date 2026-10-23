import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const icons = new URL("../icons/", import.meta.url);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
});
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    const source = size <= 32 ? "icon-small.svg" : "icon.svg";
    const svg = await readFile(new URL(source, icons), "utf8");
    const png = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image();
        image.src =
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d").drawImage(image, 0, 0, size, size);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { svg, size },
    );
    await writeFile(
      new URL(`icon-${size}.png`, icons),
      Buffer.from(png, "base64"),
    );
    console.log(`icons/icon-${size}.png ← ${source}`);
  }
} finally {
  await browser.close();
}
