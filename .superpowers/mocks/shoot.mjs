import { chromium } from "playwright";
import { resolve } from "node:path";

const file = `file://${resolve(process.argv[2])}`;
const out = resolve(process.argv[3]);
const name = process.argv[4];

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  for (const width of [1440, 360]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 1100 : 900 } });
    await page.goto(file, { waitUntil: "networkidle" });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.screenshot({ path: `${out}/${name}-${width}-${theme}.png`, fullPage: true });
    await page.close();
  }
}
await browser.close();
