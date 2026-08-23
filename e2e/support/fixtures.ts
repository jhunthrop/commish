import { test as base, type Page } from "@playwright/test";
import { DEV_SEED } from "../../src/data/seed/config";
import { MANAGER_A_STATE, MANAGER_B_STATE, MANAGER_SIGNOUT_STATE, MANAGER_ZERO_STATE } from "../global-setup";

/**
 * Two signed-in managers in two INDEPENDENT browser contexts — separate cookie jars, separate
 * `EventSource` connections, separate everything. That independence is the point: a realtime
 * fan-out assertion made inside one context proves nothing, because a page can always see its
 * own optimistic update.
 *
 * `managerZero` is a third, stable identity `global-setup` mints and warms the same way, but the
 * seed script never claims and no spec ever joins or creates a league for — it stays at zero
 * leagues run over run, which is what `onboarding.spec.ts` needs to see Task 5's first-run fork
 * for real, rather than mocking `experienceTier`/`helpLevel`/league count the way the unit
 * suite does.
 *
 * `managerSignOut` is a fourth, whose whole job is to be signed out. Signing out revokes the
 * WorkOS session server-side, so using any of the three above would silently invalidate a
 * session the rest of the run is holding — see `global-setup.ts`'s own note.
 */
export const test = base.extend<{ managerA: Page; managerB: Page; managerZero: Page; managerSignOut: Page }>({
  managerA: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_A_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  managerB: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_B_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  managerZero: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_ZERO_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  managerSignOut: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_SIGNOUT_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export const expect = test.expect;

/** The already-played league `npm run seed` hands manager A the commissioner's chair in. */
export const SEEDED_SEASON_LEAGUE_ID = DEV_SEED.season.leagueId;

/**
 * Opens the header's notice inbox and waits for `text` to appear in it — real retries, through
 * the product's own real mechanism, never a click that only toggles visibility. Extracted from
 * `e2e/trades.spec.ts` (Phase 3 Plan C, Task 9) so `e2e/enforcement.spec.ts` (Phase 3 Plan D,
 * Task 10) reads the identical helper rather than a second, drifting copy — both specs share the
 * same real constraint this docblock states: `useNotices` fetches exactly once per page mount,
 * so a `toPass` that only re-clicks the bell against an already-failed mount fetch is retrying
 * the wrong thing forever, and `INTEGRITY_CONFIG.notices.rateLimit` (32 requests/60s, PER USER)
 * is real and shared across every spec's own page loads — a transient 429 here is a genuine,
 * expected shape this helper answers with the panel's own "Try again" button
 * (`NoticeInbox`'s `refetch()`), never a page reload that would cost this budget a second mount
 * fetch for nothing.
 */
export async function expectNotice(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: /^Notices/ }).click();
  const region = page.getByRole("region", { name: "Notices" });
  await expect(region).toBeVisible({ timeout: 5_000 });
  await expect(async () => {
    const tryAgain = region.getByRole("button", { name: "Try again" });
    if (await tryAgain.isVisible().catch(() => false)) await tryAgain.click();
    await expect(region.getByText(text).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  await page.keyboard.press("Escape");
}
