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

  // The seeded season league's own card, not the whole page: every league card renders a week
  // status badge (`HomeLeagueCard`), so scoping to this ONE card is what keeps the assertion
  // honest against a page that happens to hold other leagues too.
  const seasonCard = managerA.getByRole("article").filter({ has: managerA.getByRole("link", { name: SEASON_LEAGUE_NAME, exact: true }) });
  await expect(seasonCard.getByText("In progress")).toBeVisible();
  await expect(seasonCard.getByRole("link", { name: /Watch the scores/i })).toBeVisible();

  await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}`);
  await expect(managerA.getByText("In progress")).toBeVisible();
  // The plain-language lock, in the manager's own words — not "the button is gone", which a
  // regression that broke lineup-fetching entirely would also produce.
  await expect(managerA.getByText(/lineup can.t change/i)).toBeVisible();

  // The home board's own refresh, proven by its CONSEQUENCE rather than a timer: wait for the
  // interval-driven request itself (`HomeBoard`'s `setInterval`,
  // `LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs` = 30s) instead of sleeping it out. The timeout
  // here is generous relative to that interval, not tight against it — a slow CI box should
  // still see the request land well inside it.
  await managerA.goto("/app");
  await managerA.waitForRequest((request) => request.url().includes("/api/home"), { timeout: 40_000 });
});
