import { MOCK_CONFIG } from "../src/mock-draft/config";
import { expect, test } from "./support/fixtures";

/**
 * The Assistant tab, end to end on a real mock room — the one surface the unit suite cannot
 * prove by itself, because `advisorFor` (`@/draft-service/assistant/service`) reads a REAL
 * `getDraftStore().getDraftState` and a REAL evidence board, none of which a component test
 * constructs. This spec proves the whole wire: a real mock room, a real
 * `GET /api/drafts/[draftId]/assistant` call, the one card and the pool odds rendered before
 * the host's own pick, and a real post-pick beat once that pick lands.
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
const ON_CLOCK_TIMEOUT_MS = (BOT_COUNT + 2) * MOCK_CONFIG.botDelay.maxSeconds * 1_000;

async function setTableChip(page: import("@playwright/test").Page, chip: string, groupLabel: string, optionName: string): Promise<void> {
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
async function makeTopPick(page: import("@playwright/test").Page): Promise<void> {
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
}

test("mock room -> the pool carries the odds, the Assistant tab shows the one card before your pick, and a beat line after it", async ({ managerA }) => {
  test.setTimeout(180_000);

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

  // --- The pool rows carry the next-turn odds the moment the advisor lands (spec section 7).
  await expect(managerA.getByTestId("advisor-odds-pct").first()).toBeVisible({ timeout: 15_000 });

  // --- The Assistant tab, opened before this seat has made any pick at all: the advisor always
  // previews the asking seat's own current-or-next decision, so the one card is already there
  // the moment the room exists.
  await managerA.getByTestId("drawer-handles").getByRole("tab", { name: "Assistant" }).click();
  const card = managerA.getByTestId("advisor-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(managerA.getByTestId("advisor-name")).not.toBeEmpty();
  await expect(managerA.getByTestId("advisor-why")).not.toBeEmpty();
  await expect(managerA.getByTestId("advisor-stamp")).toContainText(/runs$/);

  // --- The human's own real turn, then a real pick through the Pool tab -----------------------
  // The room's real on-clock copy is the clock strip's "YOUR PICK · {place}" (clock-strip.tsx) —
  // never "You're on the clock", which the copy law's contraction ban forbids anyway.
  await expect(managerA.getByText(/YOUR PICK/).first()).toBeVisible({ timeout: ON_CLOCK_TIMEOUT_MS });
  await managerA.getByTestId("drawer-handles").getByRole("tab", { name: "Pool" }).click();
  await makeTopPick(managerA);

  // --- Back on the Assistant tab, the post-pick beat has landed. Never asserted to an exact
  // sentence: `postPickBeat` (`beat.ts`) picks between "Best available." and a named-player
  // sentence depending on whether this seat's own top-of-pool pick matches the card's own pick
  // under `recommendPick`'s expected-value scoring — a real fact about a real evidence board
  // this spec does not control, so the only honest assertion is that a beat rendered at all.
  await managerA.getByTestId("drawer-handles").getByRole("tab", { name: "Assistant" }).click();
  const beat = managerA.getByTestId("assistant-beat");
  await expect(beat).toBeVisible({ timeout: 15_000 });
  await expect(beat).not.toHaveText("");
});
