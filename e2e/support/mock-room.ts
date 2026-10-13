/**
 * The mock-room helpers two specs share (`mock-draft.spec.ts`, `mock-draft-ceilings.spec.ts`):
 * the store a spec drives a real room through, the setup page's chip editor, and the one live
 * human pick. Extracted (the 2026-09-12 draft engine round) so the second spec imports rather
 * than copies; every docblock below is the original's.
 *
 * `createDraftStore` is imported from its own module rather than the `@/draft-service` barrel
 * (the same reason `mock-draft.spec.ts` always did): that barrel also re-exports
 * `resolveDraftActor` from `./authz`, which imports `@/lib/leagues/membership` and, through it,
 * `next/server` — a module Playwright's own Node process (outside Next's bundler) cannot
 * resolve.
 */
import type { Page } from "@playwright/test";
import { getDb } from "@research-ts/db/client";
import { createDraftStore, type DraftStore } from "../../src/draft-service/store";
import { getPublisher } from "../../src/lib/realtime/publisher";
import { expect } from "./fixtures";

let cachedStore: DraftStore | undefined;

/** The SAME kind of store the running server's own routes and ticker use: its `publish` really
 *  reaches the shared Redis an open browser page is subscribed to over SSE. */
export function draftStoreForE2e(): DraftStore {
  if (cachedStore === undefined) {
    cachedStore = createDraftStore({ db: getDb(), publish: (input) => getPublisher().publish(input), clock: { now: () => new Date().toISOString() } });
  }
  return cachedStore;
}

/**
 * The workflow pass (law 1): a setting is changed by tapping its chip and choosing inside the
 * borrowed editor row. Click-and-verify, retried, because the chips are server-rendered before
 * the editors hydrate (the pre-hydration hazard `design-v2.spec.ts` documents); the chosen
 * option closes the row, so the group's own disappearance is the confirmation.
 */
export async function setTableChip(page: Page, chip: string, groupLabel: string, optionName: string): Promise<void> {
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

/** The exact conflict `DraftStore.applyAction` answers when another actor's action already
 *  advanced the log first (`store.ts`'s own `isSequenceConflict` branch) — never guessed, this
 *  is the literal string the store returns. */
export const RETRY_REASON = "Someone else acted first. Try again.";

/** Comfortably longer than the widest real pick clock tier plus the widest pause window this
 *  engine could ever be mid-observing — the identical `TIME_STEP_MS` argument `seedFormatDemos`'s
 *  own `driveToCompletion` makes (`src/data/seed/seed-format-demos.ts`), copied rather than
 *  imported: that constant is module-private there, and this file needs its own for the
 *  identical reason, against a room a spec drives live rather than at seed time. */
const FAR_FUTURE_STEP_MS = 100_000_000;

export function laterTimestamp(from: string): string {
  return new Date(Date.parse(from) + FAR_FUTURE_STEP_MS).toISOString();
}

export const AVAILABLE_PLAYERS_LIST = "Available players, best first";

/**
 * Click-and-verify, retried (the SSR-fake discipline every other spec in this suite keeps) — the
 * identical mechanism `league-lifecycle.spec.ts` already established for this exact button,
 * reused rather than reinvented: the pool is a TRUNCATED top-N window
 * (`DRAFT_ROOM_CONFIG.poolPageSize`, `player-pool.tsx`'s own `truncated` slice), not the whole
 * remaining pool, so its raw row COUNT never shrinks as long as more than that many players are
 * still available — the next-ranked player slides straight into the vacated slot, and a receipt
 * built on a falling total count would wait forever. The real receipt is the TOP ROW'S OWN
 * name+team pair leaving the list; the click targets that SAME row (never `.first()` again,
 * which the pool can reorder out from under a naive retry the moment anything else lands).
 */
export async function makeTopPick(page: Page): Promise<void> {
  const pool = page.getByRole("list", { name: AVAILABLE_PLAYERS_LIST });
  await pool.getByRole("button", { name: "Draft" }).first().waitFor({ timeout: 15_000 });
  // `data-testid`, not DOM adjacency. These two facts used to be read as "the name span" and
  // "the span right after it", which was true until the pool row became TWO lines (the headshot
  // and name on one, the team code and the act controls on the next) — after which the name span
  // was the last child of its own div, `following-sibling::span[1]` matched nothing, and this
  // helper hung until the whole test timed out, eight minutes at a time. A row's layout is a
  // design decision that will change again; which span carries the team is not.
  const firstRow = pool.getByRole("listitem").first();
  const pickedName = await firstRow.getByTestId("pool-player-name").innerText();
  const pickedTeam = await firstRow.getByTestId("pool-player-team").innerText();
  const uniqueRow = pool.getByRole("listitem").filter({ hasText: pickedName }).filter({ hasText: pickedTeam });
  // Checks for the row's own departure BEFORE clicking again on each retry: a prior attempt's
  // click can land (the row leaves) even when that SAME attempt's own `toHaveCount(0)` check
  // missed the window, and re-clicking `uniqueRow`'s Draft button once it no longer exists would
  // otherwise hang the whole `toPass` budget waiting for an element that will never reappear.
  await expect(async () => {
    if ((await uniqueRow.count()) > 0) {
      await uniqueRow.getByRole("button", { name: "Draft" }).click({ timeout: 5_000 });
    }
    await expect(uniqueRow).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
}
