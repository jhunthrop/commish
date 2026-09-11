import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { MOCK_CONFIG } from "../src/mock-draft/config";
import { expect, test } from "./support/fixtures";

/**
 * THE ADVISOR IN THE SIDELINE ROOM, end to end on a real mock room (the one surface the unit
 * suite cannot prove: a real `/assistant` answer landing in a real room). Since the 2026-09-10
 * rulings our call sits in the dock beside the one Draft verb and the shortlist is the dock's
 * "Our calls" list, so the fold question the founder asked (is Draft above the fold at desk
 * and phone) is asked of the dock's verb and the phone's pinned call block. The measured
 * geometry lands in `.superpowers/mocks/screenshots/advisor-fold.json` beside two photographs.
 *
 * The room is opened through the mock-draft API: `mock-draft.spec.ts` walks the lobby.
 */
const TEAM_COUNT = 8;
const BOT_COUNT = TEAM_COUNT - 1;
const PICK_SECONDS = 90;
const ON_CLOCK_TIMEOUT_MS = (BOT_COUNT + 2) * (MOCK_CONFIG.botDelay.baseMs + MOCK_CONFIG.botDelay.jitterMs) + 15_000;
const OUT_DIR = ".superpowers/mocks/screenshots";
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const AVAILABLE_PLAYERS_LIST = "Available players, best first";

async function openSoloRoom(page: Page): Promise<void> {
  const created = await page.request.post("/api/mock-drafts", { data: { mode: "solo", teamCount: TEAM_COUNT, pickSeconds: PICK_SECONDS, draftSlot: TEAM_COUNT } });
  const body = (await created.json()) as { readonly ok: boolean; readonly data?: { readonly draftId: string } };
  if (!body.ok || body.data === undefined) throw new Error(`[e2e] could not open a solo mock: ${JSON.stringify(body)}`);
  await page.goto(`/app/drafts/${body.data.draftId}`);
  const gotIt = page.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();
}

/** Click-and-verify on the top pool row, retried, rather than a naive `.first()` click (the same
 *  race reasoning as `mock-draft.spec.ts`'s own `makeTopPick`). The name is the row's
 *  `pool-player-name` contract; the row is re-found by it. */
async function makeTopPick(page: Page): Promise<string> {
  const pool = page.getByRole("list", { name: AVAILABLE_PLAYERS_LIST });
  await pool.getByRole("button", { name: /^Draft / }).first().waitFor({ timeout: 15_000 });
  const firstRow = pool.getByTestId("pool-row").first();
  const pickedName = await firstRow.getByTestId("pool-player-name").innerText();
  const uniqueRow = pool.getByTestId("pool-row").filter({ hasText: pickedName });
  await expect(async () => {
    if ((await uniqueRow.count()) > 0) {
      await uniqueRow.first().getByRole("button", { name: `Draft ${pickedName}` }).click({ timeout: 5_000 });
    }
    await expect(uniqueRow).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  return pickedName;
}

interface FoldMeasure {
  readonly viewport: string;
  /** The verb's bottom edge in viewport pixels, and the page's own scroll position. */
  readonly verbBottom: number;
  readonly pageScrollTop: number;
}

/** Measures the fold with NO scrolling: the verb is asserted inside the viewport. */
async function measureFold(page: Page, viewport: { readonly width: number; readonly height: number }): Promise<FoldMeasure> {
  const verb = page.getByTestId("dock-verb");
  await expect(verb).toBeVisible({ timeout: 15_000 });
  const box = (await verb.boundingBox())!;
  const pageScrollTop = await page.evaluate(() => window.scrollY);
  const measure: FoldMeasure = { viewport: `${viewport.width}x${viewport.height}`, verbBottom: Math.round(box.y + box.height), pageScrollTop };
  expect(measure.pageScrollTop).toBe(0);
  expect(measure.verbBottom).toBeLessThanOrEqual(viewport.height);
  return measure;
}

test("mock room -> our call in the dock and the rows in Our calls, Draft above the fold on desk and phone, a real pick", async ({ managerA }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize(DESK);
  await openSoloRoom(managerA);

  // The advisor always previews the asking seat's own decision, so the dock's call and the
  // shortlist are there the moment the room exists: the call's name, then Show 5 as four rows.
  const desk = managerA.getByTestId("quilt-room");
  await expect(desk.getByTestId("dock-call-name")).not.toBeEmpty({ timeout: 15_000 });
  await desk.getByRole("tab", { name: "Our calls" }).click();
  await expect(desk.getByRole("group", { name: "Show" }).getByRole("button", { name: "5", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
  await expect(desk.getByTestId("advisor-candidate")).toHaveCount(4);
  await expect(desk.getByTestId("advisor-candidate").first().getByTestId("advisor-odds-runs")).toContainText(/^\d+ of \d+/);
  await expect(managerA.getByText("Best available.")).toHaveCount(0);

  // The human's own turn.
  await expect(managerA.getByTestId("top-strip")).toHaveAttribute("data-turn", "yours", { timeout: ON_CLOCK_TIMEOUT_MS });
  await expect(desk.getByTestId("dock-call-why")).not.toBeEmpty({ timeout: 15_000 });

  // THE FOLD, desk: Draft inside 900px with the page unscrolled.
  const deskFold = await measureFold(managerA, DESK);
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-room-desk.png` });

  // THE FOLD, phone: the same room at 390x844, the call block pinned at the foot.
  await managerA.setViewportSize(PHONE);
  await expect(managerA.getByTestId("phone-room")).toBeVisible();
  const phoneFold = await measureFold(managerA, PHONE);
  await managerA.screenshot({ path: `${OUT_DIR}/advisor-room-phone.png` });
  writeFileSync(`${OUT_DIR}/advisor-fold.json`, JSON.stringify({ desk: deskFold, phone: phoneFold }, null, 2));

  // Back on the desk, a real pick through the pool's own rows, which carry the same next-turn
  // odds the call does. After the pick the call moves on: never the man just drafted.
  await managerA.setViewportSize(DESK);
  await desk.getByRole("tab", { name: "Pool" }).click();
  await expect(desk.getByTestId("pool-row").first().getByTestId("big-number")).toBeVisible({ timeout: 15_000 });
  const pickedName = await makeTopPick(managerA);
  await expect(desk.getByTestId("undo-pill")).toBeHidden({ timeout: 10_000 });
  await expect(desk.getByTestId("dock-call-name")).not.toHaveText(pickedName, { timeout: 15_000 });
  await desk.getByRole("tab", { name: "Our calls" }).click();
  await expect(desk.getByTestId("advisor-candidate").filter({ hasText: pickedName })).toHaveCount(0);
  await expect(managerA.getByText("Best available.")).toHaveCount(0);
});
