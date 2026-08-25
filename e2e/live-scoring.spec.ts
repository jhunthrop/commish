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

  // The seeded season league's own row, not the whole page: every league row renders a week
  // status badge (`WeekStatusBadge`, via `LeagueBoard`), so scoping to this ONE row is what
  // keeps the assertion honest against a page that happens to hold other leagues too.
  // Phase 3.6, Task 10 (structural): `HomeBoard` now renders three shapes by league count — a
  // single `Card as="article"` only at n=1, an all-pre-draft hero, or (this account's own case,
  // seeded with dozens of leagues) `AttentionQueue` + `LeagueBoard`, a dense `Table` whose rows
  // carry `role="row"`, not `role="article"` — the bare `article` role this assertion used to
  // scope to no longer exists on this page at all for an account this size.
  const seasonRow = managerA.getByRole("row").filter({ has: managerA.getByRole("link", { name: SEASON_LEAGUE_NAME, exact: true }) });
  await expect(seasonRow.getByText("In progress")).toBeVisible();
  await expect(seasonRow.getByRole("link", { name: /Watch the scores/i })).toBeVisible();

  await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}`);
  await expect(managerA.getByText("In progress")).toBeVisible();
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
