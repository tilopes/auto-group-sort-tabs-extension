// Renders assets/icon.svg to the PNG sizes the manifest uses. Chromium
// does not accept SVG manifest icons, so the PNGs are generated and committed.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const sizes = [16, 32, 48, 128];
const svg = readFileSync("assets/icon.svg", "utf8");
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const browser = await chromium.launch();
try {
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<body style="margin:0"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`,
    );
    await page.screenshot({ path: `src/icons/icon-${size}.png`, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
