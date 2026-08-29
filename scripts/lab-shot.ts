// Dev-only: authenticated screenshots of the running app using the minted lab session.
// Run: dotenv -e .env.local -- tsx scripts/lab-shot.ts <url-path> <outfile> [width] [height] [scheme]
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const [, , path = "/app/drafts/dev_draft_snake", out = "shot.png", w = "1440", h = "900", scheme = "light"] = process.argv;

// The app under test. Defaults to the conventional dev port so every existing invocation keeps
// working; a parallel worktree running its own server sets `LAB_BASE_URL=http://localhost:3012`
// rather than editing this file, which is what stops two tracks fighting over one literal.
const baseUrl = (process.env.LAB_BASE_URL ?? "").trim() || "http://localhost:3000";

const sessionFile = process.env.LAB_SESSION_FILE;
if (sessionFile === undefined || sessionFile.length === 0) {
  throw new Error("LAB_SESSION_FILE is not set. Run scripts/mint-dev-session.ts first, or set it to that script's output path.");
}
const session = JSON.parse(readFileSync(sessionFile, "utf8"));

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({
    viewport: { width: Number(w), height: Number(h) },
    colorScheme: scheme === "dark" ? "dark" : "light",
  });
  await ctx.addCookies([{ name: "wos-session", value: session.cookie, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out, fullPage: false });
  console.log("saved", out);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
