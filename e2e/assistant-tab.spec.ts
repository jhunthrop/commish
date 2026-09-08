import { mkdirSync, writeFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { MOCK_CONFIG } from "../src/mock-draft/config";
import { expect, test } from "./support/fixtures";

/**
 * The Assistant tab, end to end on a real mock room — the one surface the unit suite cannot
 * prove by itself, because `advisorFor` (`@/draft-service/assistant/service`) reads a REAL
 * `getDraftStore().getDraftState` and a REAL evidence board, none of which a component test
 * constructs. This spec proves the whole wire: a real mock room, a real
 * `GET /api/drafts/[draftId]/assistant` call, the lead card with the candidate rows and the
 * pool odds rendered before the host's own pick, and, on the clock, THE FOLD: the lead card's
 * Draft button inside the viewport with the tab unscrolled, on the desk at 1440x900 with the
 * drawer at its half height and on the phone at 390x844 (the pick count round, after the
 * founder had to scroll to reach Draft). The measured heights land in
 * `.superpowers/mocks/screenshots/advisor-fold.json` beside the two photographs.
 *
 * `setTableChip`/`AVAILABLE_PLAYERS_LIST`/`makeTopPick` below are copied from `mock-draft.spec.ts`
 * rather than imported — this suite keeps no shared per-spec helper module (see that file's own
 * docblock on why each spec here stays self-contained), and this file needs only a small slice
 * of what that one already proves (the lobby workflow, the pool's own Draft-and-verify idiom).
 */

const TEAM_COUNT = 8;
const BOT_COUNT = TEAM_COUNT - 1;
/** The widest clock tier (see `mock-draft.spec.ts`'s own `PICK_SECONDS` docblock: the narrow
 *  30s tier measured fragile against a real browser under this repo's own background load). */
const PICK_SECONDS = 90;
/** Every bot ahead of the host at its slowest seeded delay, padded for scheduler jitter. */
const ON_CLOCK_TIMEOUT_MS = (BOT_COUNT + 2) * (MOCK_CONFIG.botDelay.baseMs + MOCK_CONFIG.botDelay.jitterMs) + 15_000;
const OUT_DIR = ".superpowers/mocks/screenshots";
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function setTableChip(page: Page, chip: string, groupLabel: string, optionName: string): Promise<void> {
  await expect(async () => {
    const group = page.getByRole("group", { name: groupLabel });
    if ((await group.count()) === 0) {
      await page.getByTestId(`table-chip-${chip}`).click();
      await expect(group).toBeVisible({ timeout: 2_000 });
    }
    await group.getByRole("button", { name: optionName, exact: true }).click();
    await expect(group).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

const AVAILABLE_PLAYERS_LIST = "Available players, best first";

/** Click-and-verify on the top QUILT drawer row, retried, rather than a naive `.first()` click
 *  (same race reasoning as `mock-draft.spec.ts`'s own `makeTopPick` docblock). The quilt's pool
 *  rows are `drawer-row`s whose name is a `PlayerName` BUTTON (the row's first button in DOM
 *  order) — there is no name testid contract in the quilt, so the name is read from that button
 *  and the row is re-found by it. */
async function makeTopPick(page: Page): Promise<string> {
  const pool = page.getByRole("list", { name: AVAILABLE_PLAYERS_LIST });
  await pool.getByRole("button", { name: "Draft", exact: true }).first().waitFor({ timeout: 15_000 });
  const firstRow = pool.getByTestId("drawer-row").first();
  const pickedName = await firstRow.getByRole("button").first().innerText();
  const uniqueRow = pool.getByTestId("drawer-row").filter({ hasText: pickedName });
  await expect(async () => {
    if ((await uniqueRow.count()) > 0) {
      await uniqueRow.first().getByRole("button", { name: "Draft", exact: true }).click({ timeout: 5_000 });
    }
    await expect(uniqueRow).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  return pickedName;
}

interface FoldMeasure {
  readonly viewport: string;
  /** The tab's own scroll area: its visible height and how tall its content is. */
  readonly tabHeight: number;
  readonly tabContentHeight: number;
  readonly tabScrollTop: number;
  /** The lead card's box, and its verb's bottom edge, in viewport pixels. */
  readonly cardTop: number;
  readonly cardHeight: number;
  readonly verbBottom: number;
}

/** The visible Assistant tab (the desk and phone trees both mount one; CSS shows one). */
function visibleTab(page: Page): Locator {
  return page.getByTestId("assistant-tab").locator("visible=true");
}

/** Measures the fold with NO scrolling: the tab's scroll area is asserted unscrolled and the
 *  lead card's Draft verb is asserted inside the viewport. */
async function measureFold(page: Page, viewport: { readonly width: number; readonly height: number }): Promise<FoldMeasure> {
  const tab = visibleTab(page);
  const card = tab.getByTestId("advisor-card");
  const verb = card.getByRole("button", { name: "Draft", exact: true });
  await expect(verb).toBeVisible({ timeout: 15_000 });
  const metrics = await tab.evaluate((el) => ({ tabHeight: el.clientHeight, tabContentHeight: el.scrollHeight, tabScrollTop: el.scrollTop }));
  const cardBox = (await card.boundingBox())!;
  const verbBox = (await verb.boundingBox())!;
  const measure: FoldMeasure = { viewport: `${viewport.width}x${viewport.height}`, ...metrics, cardTop: Math.round(cardBox.y), cardHeight: Math.round(cardBox.height), verbBottom: Math.round(verbBox.y + verbBox.height) };
  expect(measure.tabScrollTop).toBe(0);
  expect(measure.verbBottom).toBeLessThanOrEqual(viewport.height);
  expect(measure.cardHeight).toBeLessThanOrEqual(measure.tabHeight);
  return measure;
}

test("mock room -> the lead card and rows before your pick, Draft above the fold on desk and phone, the pool odds, a real pick", async ({ managerA }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize(DESK);

  await managerA.goto("/");
  await managerA.getByRole("link", { name: "Try a mock draft" }).click();
  await expect(managerA).toHaveURL(/\/app\/mock-drafts$/);

  await setTableChip(managerA, "teams", "Teams", String(TEAM_COUNT));
  await setTableChip(managerA, "clock", "Pick clock", `${PICK_SECONDS}s`);
  await expect(async () => {
    await managerA.getByRole("button", { name: "Draft now" }).click();
    await expect(managerA).toHaveURL(/\/app\/drafts\//, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });

  const gotIt = managerA.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();

  // --- The Assistant tab, opened before this seat has made any pick at all: the advisor always
  // previews the asking seat's own current-or-next decision, so the panel is already there the
  // moment the room exists: the lead card, the selector at 5 and four rows under it.
  await managerA.getByTestId("drawer-handles").getByRole("tab", { name: "Assistant" }).click();
  const desk = managerA.getByTestId("quilt-room");
  const card = desk.getByTestId("advisor-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(desk.getByTestId("advisor-name")).not.toBeEmpty();
  await expect(desk.getByTestId("advisor-why")).not.toBeEmpty();
  await expect(desk.getByTestId("advisor-stamp")).toContainText(/runs$/);
  await expect(desk.getByRole("group", { name: "Show" }).getByRole("button", { name: "5", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(desk.getByTestId("advisor-candidate")).toHaveCount(4);
  // The cell's text is the figure followed by its screen-reader sentence, so match the start.
  await expect(desk.getByTestId("advisor-candidate").first().getByTestId("advisor-odds-runs")).toContainText(/^\d+ of \d+/);
  await expect(managerA.getByText("Best available.")).toHaveCount(0);

  // --- The human's own real turn. The room's real on-clock copy is the clock strip's
  // "YOUR PICK · {place}" (clock-strip.tsx) — never "You're on the clock", which the copy law's
  // contraction ban forbids anyway.
  await expect(managerA.getByText(/YOUR PICK/).first()).toBeVisible({ timeout: ON_CLOCK_TIMEOUT_MS });

  // --- THE FOLD, desk: the drawer at its half height, the tab unscrolled, Draft inside 900px.
  const deskFold = await measureFold(managerA, DESK);
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-room-desk.png` });

  // --- THE FOLD, phone: the same room at 390x844 on the phone tree's ASSIST tab.
  await managerA.setViewportSize(PHONE);
  await managerA.getByRole("navigation", { name: "Draft room tabs" }).getByRole("button", { name: /assist/i }).click();
  const phoneFold = await measureFold(managerA, PHONE);
  await expect(visibleTab(managerA).getByTestId("advisor-candidate")).toHaveCount(4);
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-room-phone.png` });
  writeFileSync(`${OUT_DIR}/advisor-fold.json`, JSON.stringify({ desk: deskFold, phone: phoneFold }, null, 2));

  // --- Back on the desk, a real pick through the Pool tab. The pool rows carry the same
  // next-turn odds the card does (spec section 7), scoped to the desk tree: the phone tree
  // renders the same rows hidden at this width.
  await managerA.setViewportSize(DESK);
  await managerA.getByTestId("drawer-handles").getByRole("tab", { name: "Pool" }).click();
  await expect(desk.getByTestId("advisor-odds-pct").first()).toBeVisible({ timeout: 15_000 });
  const pickedName = await makeTopPick(managerA);

  // --- After the pick the tab moves on to the next decision: the card again, no beat line —
  // and never the wrong people (founder report 2026-09-08): while the view computed before
  // this pick is still the one on screen, the man just drafted is filtered out of the lead and
  // the rows at render time, and the card says it is re-reading; the fresh view then lands.
  await managerA.getByTestId("drawer-handles").getByRole("tab", { name: "Assistant" }).click();
  await expect(desk.getByTestId("advisor-name").filter({ hasText: pickedName })).toHaveCount(0);
  await expect(desk.getByTestId("advisor-candidate").filter({ hasText: pickedName })).toHaveCount(0);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveAttribute("data-on-clock", "false", { timeout: 15_000 });
  await expect(desk.getByTestId("advisor-recomputing")).toHaveCount(0, { timeout: 15_000 });
  await expect(desk.getByTestId("advisor-name")).not.toHaveText(pickedName);
  await expect(managerA.getByTestId("assistant-beat")).toHaveCount(0);
  await expect(managerA.getByText("Best available.")).toHaveCount(0);
});
