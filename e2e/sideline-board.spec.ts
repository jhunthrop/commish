import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { overflowAt } from "./support/overflow";

/**
 * THE DRAFT HQ BOARD ON SIDELINE (research surfaces round, 2026-09-10). The board is the product's
 * densest research surface and it was the last seven-column table in the app. It is now a list of
 * 44px rows with the face still present, one number per row with its basis, one-based tier bands,
 * and the "Not on an active roster" band on its own ground.
 *
 * The universe is the real board in the dev database, league-free (`?league=generic`), which is
 * also the one board surface that carries the PPR / Half PPR / Standard selector — inside a league
 * the league's own rules decide and there is no selector to keep.
 *
 * Pictures go to `.superpowers/mocks/screenshots/` in the theme the run asked for
 * (`E2E_COLOR_SCHEME`), for the ledger and the persona panel.
 */
const OUT_DIR = ".superpowers/mocks/screenshots";
const BOARD = "/app/draft/board?league=generic";

function theme(): string {
  return process.env.E2E_COLOR_SCHEME ?? "light";
}

/** Waits until every headshot on the board has loaded or fallen back, so a photograph shows faces
 *  rather than the rings a fresh request leaves. */
async function headshotsSettled(page: Page): Promise<void> {
  await expect
    .poll(async () => page.locator('[data-testid="board-row"] img').evaluateAll((images) => images.length > 0 && images.every((image) => (image as HTMLImageElement).complete)), { timeout: 20_000 })
    .toBe(true);
}

test("the board is a list of people with one number each, not a table, at desktop width", async ({ managerA }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 1440, height: 1000 });
  await managerA.goto(BOARD);
  await expect(managerA.getByRole("heading", { level: 1, name: "The Board" })).toBeVisible();

  const rows = managerA.locator('[data-testid="board-row"]');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  expect(await rows.count()).toBeGreaterThan(20);

  // P10: the table is gone. A comparison list is rows, and nothing on this page is a grid of cells.
  expect(await managerA.locator("main table").count()).toBe(0);

  // P1: a face on every row that is about a person, at the research step (32px), and the name is
  // the largest thing on the row.
  const first = rows.first();
  await expect(first.locator('[data-testid="player-face-team"], [data-testid="avatar"]').first()).toBeVisible();
  await expect(first.getByTestId("pool-player-name")).toBeVisible();

  // P2/P11, and fix round 1's own H1: exactly one figure per row, it is the quantity the board is
  // ORDERED by (points over replacement), and its caption names the replacement it is over.
  expect(await first.getByTestId("big-number").count()).toBe(1);
  await expect(first.getByTestId("big-number")).toContainText("Over a replacement ");

  // The one number never contradicts the order the rows are in, measured on the rendered board.
  const figures = await rows.locator('[data-testid="big-number"] > span:first-child').evaluateAll((nodes) => nodes.map((node) => Number(node.textContent)));
  const ranked = figures.filter((value) => Number.isFinite(value));
  expect(ranked.length).toBeGreaterThan(20);
  expect(ranked, "a row shows a larger number than the row above it").toEqual([...ranked].sort((a, b) => b - a));

  // The projection is not lost: it rides the facts line, at body size.
  await expect(first).toContainText(" projected");

  // P10: 44px rows, the research density, with the face still present.
  const height = await first.locator("> div").first().evaluate((node) => Math.round(node.getBoundingClientRect().height));
  expect(height, "a research row is 44px").toBeGreaterThanOrEqual(44);
  expect(height).toBeLessThan(56);

  // The scoring selector stays on this league-free board, and the export with it.
  await expect(managerA.getByRole("group", { name: "Scoring" })).toBeVisible();
  await expect(managerA.getByRole("button", { name: "Export CSV" })).toBeVisible();

  // P3: no solid Court blue CALL TO ACTION in the viewport, which is the honest answer for a
  // research surface — nothing on this screen drafts anybody. A segmented control's selected
  // segment also fills with the accent and is excluded on purpose: it is a STATE, not a verb, and
  // counting it would make every filter row fail a principle about buttons.
  const solid = await managerA.evaluate(() =>
    Array.from(document.querySelectorAll("button, a")).filter((node) => {
      const rect = node.getBoundingClientRect();
      const visible = rect.width > 0 && rect.top < window.innerHeight && rect.bottom > 0;
      return visible && node.className.split(" ").includes("bg-accent") && node.closest('[role="group"]') === null;
    }).length,
  );
  expect(solid, "a research surface carries no verb").toBe(0);

  await headshotsSettled(managerA);
  await managerA.screenshot({ path: `${OUT_DIR}/draft-hq-board-desktop-${theme()}.png`, fullPage: false });
});

test("a position tab opens one-based tier bands and keeps every figure's basis", async ({ managerA }) => {
  await managerA.setViewportSize({ width: 1440, height: 1000 });
  await managerA.goto(BOARD);
  await expect(managerA.locator('[data-testid="board-row"]').first()).toBeVisible({ timeout: 30_000 });
  await managerA.getByRole("group", { name: "Position" }).getByRole("button", { name: "RB", exact: true }).click();

  // TIERS ARE ONE-BASED. The badge carries the grade's pigment; the letter printed on it is the
  // tier a manager counts, and a manager counts from one.
  const band = managerA.locator("[data-grade]").first();
  await expect(band).toBeVisible();
  await expect(band).toContainText("RB left");
  expect((await band.innerText()).trim().startsWith("1"), "the band opens at tier 1").toBe(true);
});

test("the board fits a phone without scrolling sideways, face and number intact", async ({ managerA }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 360, height: 740 });
  await managerA.goto(BOARD);
  const rows = managerA.locator('[data-testid="board-row"]');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(rows.first().getByTestId("big-number")).toBeVisible();

  // P10 AT 360px, measured honestly: a clipped `truncate` cell is not overflow, and the shell's own
  // header is not this surface's debt. `overflowAt` separates the two — see its own docblock.
  const overflow = await overflowAt(managerA);
  test.info().annotations.push({ type: "page-scroll", description: `${overflow.scroll}px of document overflow, shell included` });
  expect(overflow.offenders, "the board sticks out past a 360px viewport").toEqual([]);

  await headshotsSettled(managerA);
  await managerA.screenshot({ path: `${OUT_DIR}/draft-hq-board-phone-${theme()}.png`, fullPage: false });
});
