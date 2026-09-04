// Dev-only: a breadth-first link crawl of the running app, as the lab user — the dynamic half
// of the link audit (2026-09-04). The static sweep (`src/integrity/link-integrity.source.test.ts`)
// proves every href SPELLS a served route; this proves the served pages actually answer, by
// walking them: it starts from `/` and `/app`, follows every same-origin link it renders, and
// records for each page the HTTP status, whether the app's own not-found panel rendered, and
// every console error. It also clicks every fragment-only link it meets and flags one whose
// click produced neither a navigation nor any DOM mutation — the `/app#create-league` class of
// bug (a hash nothing listens to), flagged for human judgment rather than auto-failed, since a
// legitimate no-op exists (an anchor already at the viewport top).
//
// Run (dev server already listening, session already minted):
//   npx dotenv -e .env.local -- npx tsx scripts/mint-dev-session.ts .lab-session.json
//   LAB_BASE_URL=http://localhost:3210 LAB_SESSION_FILE=.lab-session.json \
//     npx tsx scripts/link-crawl.ts [report-out.json]
//
// Signed-out mode (no cookie, for the public surface): LAB_SIGNED_OUT=1.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const BASE_URL = (process.env.LAB_BASE_URL ?? "").trim() || "http://localhost:3000";
const PAGE_CAP = Number(process.env.LAB_CRAWL_CAP ?? "150");
const NOT_FOUND_SIGNATURE = "We could not find that page.";
const START_PATHS = ["/", "/app"] as const;

interface PageReport {
  readonly path: string;
  readonly status: number | null;
  readonly notFoundPanel: boolean;
  readonly consoleErrors: readonly string[];
  readonly deadFragmentClicks: readonly string[];
  readonly linkCount: number;
}

/** Normalize an in-app URL to its path (+search), dropping the fragment so `/x#a` and `/x` are
 *  one crawl node; dynamic pages with distinct ids stay distinct on purpose — each is a page. */
function crawlKey(url: URL): string {
  return `${url.pathname}${url.search}`;
}

async function collectSameOriginLinks(page: Page): Promise<readonly string[]> {
  return page.$$eval("a[href]", (anchors) =>
    anchors
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((href) => href.startsWith(window.location.origin)),
  );
}

/**
 * Click every fragment-only link on the page and watch for ANY consequence: a URL change beyond
 * the hash is a navigation, a DOM mutation is a listener doing its work, and a viewport scroll is
 * the browser's own anchor jump. A click with none of the three is the dead-fragment class.
 */
async function probeFragmentLinks(page: Page): Promise<readonly string[]> {
  const fragmentHrefs = await page.$$eval("a[href^='#'], a[href*='#']", (anchors) =>
    anchors
      .map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
      .filter((href) => href.includes("#") && !href.startsWith("http")),
  );
  const dead: string[] = [];
  for (const href of [...new Set(fragmentHrefs)]) {
    const fragment = href.slice(href.indexOf("#"));
    if (fragment === "#") continue;
    const link = page.locator(`a[href='${href}']`).first();
    if ((await link.count()) === 0 || !(await link.isVisible())) continue;
    const before = await page.evaluate(() => ({
      url: window.location.href,
      scrollY: window.scrollY,
      // A cheap DOM fingerprint: element count plus the hidden-attribute census. A listener that
      // opens a disclosure or mounts a panel moves at least one of these.
      dom: `${document.querySelectorAll("*").length}:${document.querySelectorAll("[hidden],[open]").length}`,
    }));
    const targetVisible = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (el === null) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    }, fragment.slice(1));
    await link.click().catch(() => {});
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      url: window.location.href,
      scrollY: window.scrollY,
      dom: `${document.querySelectorAll("*").length}:${document.querySelectorAll("[hidden],[open]").length}`,
    }));
    const urlMovedBeyondHash = new URL(after.url).pathname !== new URL(before.url).pathname;
    const anythingHappened = urlMovedBeyondHash || after.scrollY !== before.scrollY || after.dom !== before.dom;
    if (!anythingHappened && !targetVisible) dead.push(`${href} (target ${targetVisible ? "visible" : "missing-or-hidden"})`);
    // Walk back so the next probe starts from this page's own state.
    if (urlMovedBeyondHash) await page.goBack().catch(() => {});
  }
  return dead;
}

async function main(): Promise<void> {
  const signedOut = process.env.LAB_SIGNED_OUT === "1";
  const sessionFile = process.env.LAB_SESSION_FILE ?? "";
  if (!signedOut && sessionFile === "") {
    throw new Error("LAB_SESSION_FILE is not set (or pass LAB_SIGNED_OUT=1 for the public surface).");
  }

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (!signedOut) {
    const session = JSON.parse(readFileSync(sessionFile, "utf8")) as { readonly cookie: string };
    await context.addCookies([{ name: "wos-session", value: session.cookie, domain: new URL(BASE_URL).hostname, path: "/" }]);
  }

  const queue: string[] = [...START_PATHS];
  const visited = new Set<string>();
  const reports: PageReport[] = [];

  while (queue.length > 0 && visited.size < PAGE_CAP) {
    const path = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
    });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));

    let status: number | null = null;
    let notFoundPanel = false;
    let deadFragmentClicks: readonly string[] = [];
    let linkCount = 0;
    try {
      const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
      status = response?.status() ?? null;
      await page.waitForTimeout(500);
      notFoundPanel = (await page.getByText(NOT_FOUND_SIGNATURE).count()) > 0;
      const links = await collectSameOriginLinks(page);
      linkCount = links.length;
      for (const href of links) {
        const url = new URL(href);
        // The sign-out route ends the crawl session; external auth flows leave the origin anyway.
        if (url.pathname === "/sign-out" || url.pathname === "/sign-in" || url.pathname === "/sign-up") continue;
        const key = crawlKey(url);
        if (!visited.has(key) && !queue.includes(key)) queue.push(key);
      }
      deadFragmentClicks = await probeFragmentLinks(page);
    } catch (error) {
      consoleErrors.push(`crawl error: ${String(error).slice(0, 300)}`);
    }
    reports.push({ path, status, notFoundPanel, consoleErrors, deadFragmentClicks, linkCount });
    const marker = status !== 200 || notFoundPanel || deadFragmentClicks.length > 0 ? "!!" : "ok";
    console.log(`${marker} ${status ?? "ERR"} ${path}${notFoundPanel ? " [NOT FOUND PANEL]" : ""}${deadFragmentClicks.length > 0 ? ` [dead fragments: ${deadFragmentClicks.join(", ")}]` : ""}`);
    await page.close();
  }

  await browser.close();

  const outFile = process.argv[2] ?? "link-crawl-report.json";
  const summary = {
    baseUrl: BASE_URL,
    signedOut,
    pagesVisited: reports.length,
    problems: reports.filter((report) => report.status !== 200 || report.notFoundPanel || report.consoleErrors.length > 0 || report.deadFragmentClicks.length > 0),
    reports,
  };
  writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\n${reports.length} pages crawled; ${summary.problems.length} with findings. Full report: ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
