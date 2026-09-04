import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

/**
 * THE COMPACTION LAW, MEASURED — the regression gate for the founder's drawer-at-half board
 * break (2026-09-03): with the pool drawer at half height the quilt's rows overflowed their
 * boxes, R-labels overlapped, and the YOU column's dashed placeholders sheared out of their
 * rows. The law under test ("all 15 rounds visible, zero scroll, at every drawer height, and
 * every cell in a row shares that row's ONE height") is asserted with real bounding boxes at
 * two viewports and two drawer heights, during the caller's own turn so the clock holds the
 * board still. The pure height math lives in `src/draft-room/quilt/state/heights.ts`; this
 * spec proves the browser agrees with it.
 *
 * Unlike `quilt-shots` / `quilt-warm-shots` this is an ASSERTION, not a design tool — it runs
 * with the suite. It still writes its frames into `.superpowers/screenshots/` so a failure
 * comes with its own picture.
 */
const TEAM_COUNT = 12;
const ON_CLOCK_TIMEOUT_MS = 240_000;
const OUT_DIR = ".superpowers/screenshots";
/** Sub-pixel slack for `getBoundingClientRect` comparisons. */
const EPSILON = 1.5;

interface RowGeometry {
  readonly id: string;
  readonly kind: string;
  readonly top: number;
  readonly height: number;
  readonly cellTops: readonly number[];
  readonly cellHeights: readonly number[];
  /** The R-label's box and whether it is showing visible text (sr-only fallback excluded). */
  readonly labelTop: number;
  readonly labelBottom: number;
  readonly labelVisible: boolean;
}

interface BoardGeometry {
  readonly top: number;
  readonly bottom: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly rows: readonly RowGeometry[];
}

function measureBoard(page: Page): Promise<BoardGeometry> {
  return page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('[data-testid="quilt-board"]');
    if (board === null) throw new Error("quilt-board not on stage");
    const box = board.getBoundingClientRect();
    const rows = [...board.querySelectorAll<HTMLElement>("[data-round-kind]")].map((row) => {
      const rowBox = row.getBoundingClientRect();
      const children = [...row.children] as HTMLElement[];
      const label = children[0]!;
      const labelBox = label.getBoundingClientRect();
      const cells = children.slice(1).map((cell) => cell.getBoundingClientRect());
      return {
        id: row.getAttribute("data-testid") ?? "",
        kind: row.getAttribute("data-round-kind") ?? "",
        top: rowBox.top,
        height: rowBox.height,
        cellTops: cells.map((cell) => cell.top),
        cellHeights: cells.map((cell) => cell.height),
        labelTop: labelBox.top,
        labelBottom: labelBox.bottom,
        labelVisible: label.querySelector(".sr-only") === null && (label.textContent ?? "").trim() !== "",
      };
    });
    return { top: box.top, bottom: box.bottom, scrollHeight: board.scrollHeight, clientHeight: board.clientHeight, rows };
  });
}

/** Every law the founder's screenshot showed broken, as one geometry audit. */
function auditBoard(geometry: BoardGeometry, stage: string): void {
  const { rows } = geometry;
  expect(rows.length, `${stage}: all rounds on stage`).toBe(15);

  // LAW: zero scroll — the board never overflows its box.
  expect(geometry.scrollHeight, `${stage}: board must not scroll`).toBeLessThanOrEqual(geometry.clientHeight + EPSILON);

  for (const row of rows) {
    // LAW: one height per row — every cell (filled, empty, dashed YOURS, on-clock) shares it.
    const maxCell = Math.max(...row.cellHeights);
    const minCell = Math.min(...row.cellHeights);
    expect(maxCell - minCell, `${stage} ${row.id}: cells share one height`).toBeLessThanOrEqual(EPSILON);
    expect(maxCell, `${stage} ${row.id}: cells fit the row`).toBeLessThanOrEqual(row.height + EPSILON);
    const maxTop = Math.max(...row.cellTops);
    const minTop = Math.min(...row.cellTops);
    expect(maxTop - minTop, `${stage} ${row.id}: cells sit on one line`).toBeLessThanOrEqual(EPSILON);
    // LAW: cells stay inside their own row's box — no shearing into the next round.
    for (const [index, top] of row.cellTops.entries()) {
      expect(top, `${stage} ${row.id}: cell top inside row`).toBeGreaterThanOrEqual(row.top - EPSILON);
      expect(top + row.cellHeights[index]!, `${stage} ${row.id}: cell bottom inside row`).toBeLessThanOrEqual(row.top + row.height + EPSILON);
    }
    // LAW: no row spills past the board.
    expect(row.top + row.height, `${stage} ${row.id}: row inside board`).toBeLessThanOrEqual(geometry.bottom + EPSILON);
  }

  // LAW: rows never overlap each other.
  const ordered = [...rows].sort((a, b) => a.top - b.top);
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const above = ordered[index]!;
    const below = ordered[index + 1]!;
    expect(above.top + above.height, `${stage}: ${above.id} must not overlap ${below.id}`).toBeLessThanOrEqual(below.top + EPSILON);
  }

  // LAW: visible R-labels never overlap (short rows drop theirs to sr-only instead).
  const labeled = ordered.filter((row) => row.labelVisible);
  for (let index = 0; index < labeled.length - 1; index += 1) {
    const above = labeled[index]!;
    const below = labeled[index + 1]!;
    expect(above.labelBottom, `${stage}: label ${above.id} must not overlap ${below.id}`).toBeLessThanOrEqual(below.labelTop + EPSILON);
  }

  // LAW: the full window (the active round plus up to the prior three, 2026-09-03 roster
  // ruling) exists, never exceeds its four-round depth, and EVERY row in it keeps the 28px
  // readable minimum at these viewports.
  const fulls = rows.filter((row) => row.kind === "full");
  expect(fulls.length, `${stage}: a full window exists`).toBeGreaterThanOrEqual(1);
  expect(fulls.length, `${stage}: the window is at most four rounds`).toBeLessThanOrEqual(4);
  for (const full of fulls) {
    expect(full.height, `${stage} ${full.id}: window row stays readable`).toBeGreaterThanOrEqual(28 - EPSILON);
  }
}

async function auditAndShoot(page: Page, stage: string): Promise<void> {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/quilt-compaction-${stage}.png` });
  auditBoard(await measureBoard(page), stage);
}

test("the quilt keeps one height per row at every drawer height and viewport", async ({ managerA }) => {
  test.setTimeout(480_000);

  await managerA.setViewportSize({ width: 1680, height: 1050 });
  await managerA.goto("/");
  await managerA.getByRole("link", { name: "Try a mock draft" }).click();
  await expect(managerA).toHaveURL(/\/app\/mock-drafts$/);
  // Tonight's-table chips (the reworked lobby): teams and clock keep their 12 / 60s defaults;
  // take the LAST seat so eleven bot picks hydrate the board before our first clock holds.
  await managerA.getByTestId("table-chip-seat").click();
  await managerA.getByRole("group", { name: "Your seat" }).getByRole("button", { name: String(TEAM_COUNT), exact: true }).click();
  await expect(async () => {
    await managerA.getByRole("button", { name: "Draft now" }).click();
    await expect(managerA).toHaveURL(/\/app\/drafts\//, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  const gotIt = managerA.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();

  // Photograph during OUR turn — the clock holds the board still while we measure (solo-mock
  // bots pick in seconds otherwise).
  const strip = managerA.getByTestId("clock-strip");
  await expect(strip).toHaveAttribute("data-strip-state", "your-turn", { timeout: ON_CLOCK_TIMEOUT_MS });

  const drawer = managerA.getByTestId("pool-drawer");

  // 1 — drawer collapsed (chip), tall viewport.
  await auditAndShoot(managerA, "chip-1050");

  // 2 — drawer at HALF, tall viewport: the founder's broken frame.
  await managerA.keyboard.press(" ");
  await expect(drawer).toHaveAttribute("data-drawer-height", "half");
  await auditAndShoot(managerA, "half-1050");
  await managerA.keyboard.press("Escape");
  await expect(drawer).toHaveAttribute("data-drawer-height", "collapsed");

  // 3 + 4 — the short viewport (a 1280x800 laptop), chip then half: the squeeze's worst case.
  await managerA.setViewportSize({ width: 1280, height: 800 });
  await auditAndShoot(managerA, "chip-800");
  await managerA.keyboard.press(" ");
  await expect(drawer).toHaveAttribute("data-drawer-height", "half");
  await auditAndShoot(managerA, "half-800");
  await managerA.keyboard.press("Escape");

  // 5 — the window WIDENS (2026-09-03 ruling): draft from the last seat and the snake hands
  // the turn straight back at 2.01, so rounds 1 AND 2 must both ride full — measured on the
  // same short viewport, drawer at half, the squeeze's worst case again.
  await strip.getByRole("button", { name: "Draft" }).first().click();
  await expect(managerA.getByTestId("quilt-room").getByTestId("undo-pill")).toBeHidden({ timeout: 10_000 });
  await expect(strip).toHaveAttribute("data-strip-state", "your-turn", { timeout: ON_CLOCK_TIMEOUT_MS });
  await managerA.keyboard.press(" ");
  await expect(drawer).toHaveAttribute("data-drawer-height", "half");
  await expect(managerA.getByTestId("quilt-round-1")).toHaveAttribute("data-round-kind", "full");
  await expect(managerA.getByTestId("quilt-round-2")).toHaveAttribute("data-round-kind", "full");
  await auditAndShoot(managerA, "round2-half-800");
  await managerA.keyboard.press("Escape");
});
