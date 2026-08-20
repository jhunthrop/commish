import { test as base, type Page } from "@playwright/test";
import { DEV_SEED } from "../../src/data/seed/config";
import { MANAGER_A_STATE, MANAGER_B_STATE, MANAGER_ZERO_STATE } from "../global-setup";

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
 */
export const test = base.extend<{ managerA: Page; managerB: Page; managerZero: Page }>({
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
});

export const expect = test.expect;

/** The already-played league `npm run seed` hands manager A the commissioner's chair in. */
export const SEEDED_SEASON_LEAGUE_ID = DEV_SEED.season.leagueId;
