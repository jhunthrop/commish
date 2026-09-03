import { DEV_SEED } from "../src/data/seed/config";
import { expect, SEEDED_SEASON_LEAGUE_ID, test } from "./support/fixtures";

const SEASON_LEAGUE_NAME = DEV_SEED.season.name;

/**
 * Task 10's edge proof: the stats-ingestion worker (`@/stats-pipeline`) actually ticked, for
 * real, against the real docker stack — `global-setup` drives `MOCK_STATS_LIVE_WEEK` through
 * enough ticks (via `npm run stats:ingest`'s own script) to reach the seeded season's current
 * week, deterministically, rather than this suite waiting out
 * `STATS_INGESTION_CONFIG.pollIntervalMs` (30 minutes) — a browser test that waits half an hour
 * is a browser test nobody runs. Every surface that reads that week's state has to agree with
 * it: the cross-league home card, the league page's own scoreboard, and the lineup editor's
 * lock — and the home board has to keep agreeing with it on its own, without a reload.
 */
test("a week in progress shows on the home card, locks the league page's lineup, and the home board refreshes on its own", async ({ managerA }) => {
  await managerA.goto("/app");

  // The seeded season league's own row, not the whole page: `/app` is the rail's full-page
  // form now (the rail redesign, 2026-09-03) — `LeagueRows`, a `<ul>` whose items each carry
  // one league — so the row is a `listitem` (the old board's `Table`/`role="row"` is gone).
  // The row link's accessible name is "{league}. {state line}." and a live league's state line
  // begins with "Live", so the name itself is the live assertion.
  const seasonRow = managerA
    .getByRole("listitem")
    .filter({ has: managerA.getByRole("link", { name: new RegExp(`^${SEASON_LEAGUE_NAME}\\. Live`) }) });
  await expect(seasonRow.getByRole("link", { name: /Watch the scores/i })).toBeVisible();

  await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}`);
  await expect(managerA.getByText("Live")).toBeVisible();
  // The plain-language lock, in the manager's own words — not "the button is gone", which a
  // regression that broke lineup-fetching entirely would also produce. COPY MOVE, followed
  // deliberately: the design-v2 gauntlet wave (8f7b8f9) retoned the lock sentence from "can't
  // change" to "cannot change" (matching the server's own copy in `lineups.ts`), and the old
  // `/can.t/` pattern cannot match "cannot". Same sentence, same lock — tighter pattern.
  await expect(managerA.getByText(/lineup cannot change/i)).toBeVisible();

  // The home board's own refresh, proven by its CONSEQUENCE rather than a timer: wait for the
  // interval-driven request itself (`HomeBoard`'s `setInterval`,
  // `LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs` = 30s) instead of sleeping it out. The timeout
  // here is generous relative to that interval, not tight against it — a slow CI box should
  // still see the request land well inside it.
  await managerA.goto("/app");
  await managerA.waitForRequest((request) => request.url().includes("/api/home"), { timeout: 40_000 });
});
