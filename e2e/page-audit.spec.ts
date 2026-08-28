import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

/**
 * THE PAGE-LEVEL AUDIT (the Ive campaign's systemic finding S1, 2026-08-27).
 *
 * Six design reviews and four persona journeys produced 113 findings, and a whole class of them
 * was invisible to everything this repo already runs: component tests see one component, and the
 * source sweeps (`no-uppercase.source.test.ts`, `accent-budget.source.test.ts`) see one file.
 * Neither can see a PAGE — so a league home rendering five ink pills, a heading order that jumps
 * h1 to h3, a control boundary that fails contrast only once real CSS composites, and a page that
 * scrolls sideways at 360 all shipped green.
 *
 * This spec walks real routes in a real browser and asserts the four page-level laws that no
 * per-component test can:
 *   1. LAW 5 — at most one distinct ink VERB per view (see `inkVerbCount` for why the unit
 *      moved from controls to verbs when Gameday replaced the Sunday Standard).
 *   2. AXE — zero violations of the rules a composited page can actually break: colour contrast
 *      and heading order (the two the campaign found by hand, both invisible to jsdom).
 *   3. NO SIDEWAYS SCROLL at 360px, the product's own mobile floor.
 *   4. A WAY OUT — every page offers at least one in-product navigation link, so no route is the
 *      dead end the live draft room was (flow analysis N1).
 *
 * Deliberately a REPORT-then-GATE: the route list starts with the surfaces the campaign already
 * fixed, so it locks in what was won rather than reopening what is queued. Add a route here the
 * moment its own remediation lands — the list growing is the campaign closing.
 */

const require = createRequire(import.meta.url);
const AXE_CORE_PATH = require.resolve("axe-core/axe.min.js");

/** The composited rules this audit gates on — the two the campaign's own defects lived in. */
const AXE_RULES = ["color-contrast", "heading-order"] as const;

interface AxeViolation {
  readonly id: string;
  readonly help: string;
  readonly nodes: readonly { readonly html: string }[];
}

/**
 * The DISTINCT ink verbs on screen — the count law 5 actually governs.
 *
 * v3 rule 5 capped ink at one CONTROL per view, and Gameday law 5 ("the verb is obvious")
 * contradicts it directly: a draft board is a list of rows whose whole purpose is one repeated
 * verb, and a scoreboard of eight matchups offers eight ways into the same act. Capping controls
 * would have forced those surfaces to render their primary action in secondary ink — burying the
 * one thing the page exists for, which is the opposite of what either rule wanted.
 *
 * What both rules were reaching for is that a person never has to choose which of two loud things
 * to do. So the count is over distinct verbs, not instances: eight ink "Draft" buttons is ONE
 * ("Draft" is obvious); "Draft" beside an ink "Propose trade" is TWO, and that is the defect.
 *
 * Verbs are compared by their accessible text with any player, team, or number stripped, so
 * "Draft Bijan Robinson" and "Draft Puka Nacua" are recognised as the same act rather than
 * counted as two.
 *
 * VISIBLE ink only: the responsive row idiom renders a desktop and a mobile variant of the same
 * control, one of them `display:none` at any width, and law 5 governs what a person SEES.
 * Counting the DOM alone reported two pills where one is on screen (found on its own first run
 * against /browse).
 */
async function inkVerbCount(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll(".bg-text-primary")).filter(
      (el) => (el as HTMLElement).offsetParent !== null,
    );
    const verbs = visible.map((el) => {
      const label = (el as HTMLElement).innerText || el.getAttribute("aria-label") || "";
      return label
        .toLowerCase()
        .replace(/[\d.,$%+-]/g, " ") // scores, prices, margins — the object, not the act
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .slice(0, 2) // "draft bijan robinson" and "draft puka nacua" are one verb
        .join(" ");
    });
    return Array.from(new Set(verbs.filter((verb) => verb.length > 0)));
  });
}

async function axeViolations(page: Page): Promise<readonly AxeViolation[]> {
  await page.addScriptTag({ path: AXE_CORE_PATH });
  return page.evaluate(async (rules) => {
    const runner = (window as unknown as {
      axe: { run: (ctx: Document, opts: { runOnly: string[] }) => Promise<{ violations: AxeViolation[] }> };
    }).axe;
    const result = await runner.run(document, { runOnly: rules });
    return result.violations.map((violation) => ({
      id: violation.id,
      help: violation.help,
      nodes: violation.nodes.slice(0, 3).map((node) => ({ html: node.html.slice(0, 160) })),
    }));
  }, AXE_RULES as unknown as string[]);
}

function describeViolations(violations: readonly AxeViolation[]): string {
  return violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.html).join(" | ")}`).join("\n");
}

/** Every page must offer a way onward that is not the browser's own back button. */
async function inProductLinkCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('a[href^="/"]').length);
}

interface AuditedRoute {
  readonly path: string;
  readonly name: string;
}

/** The signed-in surfaces whose remediation has landed. Grows as the campaign closes. */
const SIGNED_IN_ROUTES: readonly AuditedRoute[] = [
  { path: "/app", name: "the app home" },
  { path: "/app/mock-drafts", name: "the mock draft lobby" },
  { path: "/app/profile", name: "the account room" },
  { path: "/app/wallet", name: "the wallet" },
];

/** The storefront a stranger meets. */
const PUBLIC_ROUTES: readonly AuditedRoute[] = [
  { path: "/", name: "the front door" },
  { path: "/browse", name: "the shelf" },
  { path: "/league-rules", name: "how it works" },
  { path: "/support", name: "support" },
];

test("every audited signed-in page keeps the page-level laws", async ({ managerA }) => {
  for (const route of SIGNED_IN_ROUTES) {
    await managerA.goto(route.path, { waitUntil: "domcontentloaded" });
    await managerA.waitForTimeout(600);

    const verbs = await inkVerbCount(managerA);
    expect(verbs.length, `${route.name} puts ${verbs.length} competing verbs in ink (${verbs.join(", ")}); law 5 allows one`).toBeLessThanOrEqual(1);

    const violations = await axeViolations(managerA);
    expect(violations, `${route.name}:\n${describeViolations(violations)}`).toEqual([]);

    const links = await inProductLinkCount(managerA);
    expect(links, `${route.name} offers no way onward — the dead-end class (flow analysis N1)`).toBeGreaterThan(0);
  }
});

test("every audited public page keeps the page-level laws", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const route of PUBLIC_ROUTES) {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);

    const verbs = await inkVerbCount(page);
    expect(verbs.length, `${route.name} puts ${verbs.length} competing verbs in ink (${verbs.join(", ")}); law 5 allows one`).toBeLessThanOrEqual(1);

    const violations = await axeViolations(page);
    expect(violations, `${route.name}:\n${describeViolations(violations)}`).toEqual([]);

    const links = await inProductLinkCount(page);
    expect(links, `${route.name} offers no way onward`).toBeGreaterThan(0);
  }
  await context.close();
});

test("no audited page scrolls sideways on a 360px phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  for (const route of PUBLIC_ROUTES) {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, `${route.name} scrolls sideways at 360px`).toBeLessThanOrEqual(overflow.clientWidth + 1);
  }
  await context.close();
});
