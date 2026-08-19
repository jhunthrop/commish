import { test as base, type Page } from "@playwright/test";
import { DEV_SEED } from "../../src/data/seed/config";
import { MANAGER_A_STATE, MANAGER_B_STATE } from "../global-setup";

/**
 * Two signed-in managers in two INDEPENDENT browser contexts — separate cookie jars, separate
 * `EventSource` connections, separate everything. That independence is the point: a realtime
 * fan-out assertion made inside one context proves nothing, because a page can always see its
 * own optimistic update.
 */
export const test = base.extend<{ managerA: Page; managerB: Page }>({
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
});

export const expect = test.expect;

/** The already-played league `npm run seed` hands manager A the commissioner's chair in. */
export const SEEDED_SEASON_LEAGUE_ID = DEV_SEED.season.leagueId;
/** The seeded snake draft, scheduled and ready to run. */
export const SEEDED_SNAKE_DRAFT_ID = DEV_SEED.snake.draftId;
export const SEEDED_SNAKE_LEAGUE_ID = DEV_SEED.snake.leagueId;
