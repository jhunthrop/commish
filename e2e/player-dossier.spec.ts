import { and, eq, ne } from "drizzle-orm";
import { createDb, type Db } from "@research/db/client";
import { nflPlayers, playerCrosswalk, players, playerStatLines, playerWeekObservations, preseasonBoardReasons, preseasonProjections, statWeeks } from "@research/db/schema";
import { statMetricName, STAT_LINE_SOURCE } from "@research/projections/lines";
import { BOARD_SOURCE, recordPreseasonBoardReasons, recordPreseasonProjections } from "@research/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";
import { recordObservations, type PlayerWeekObservation } from "@research/projections/store";
import { E2E_TRADES_LEAGUE_ID } from "./global-setup";
import { expect, SEEDED_SEASON_LEAGUE_ID, test } from "./support/fixtures";

/**
 * PLAYER DOSSIER E2E-LITE (Task 7, Step 2) — the peek's call card/range rail/role module and the
 * full page's uncapped dossier, against the real running app, real Postgres, real WorkOS session.
 *
 * EVERY ROW THIS SPEC WRITES BELONGS TO ITS OWN FIXTURE IDENTITY (fix round 1, CRITICAL 1) — a
 * `players` row, an `nfl_players` row, and the crosswalk between them, all under IDs this spec
 * owns outright (`FIXTURE_PLAYER_ID`/`FIXTURE_NFL_ID`, never a real free agent's). The first
 * version of this spec reused a REAL free agent's row and `onConflictDoUpdate`d that player's OWN
 * crosswalk entry to point at a fake nfl id — a real player's identity, silently repointed, with no
 * cleanup. That is fixed here: nothing this spec writes shares a primary key with anything
 * `npm run seed` or a real feed ever writes, and `cleanupFixtureRows` (run in BOTH `beforeAll`,
 * against a crashed prior run's leftovers, and `afterAll`) deletes every one of them, in FK order,
 * so the database this spec leaves behind is byte-for-byte what it found.
 *
 * WHY THIS SPEC SEEDS BOARD/STAT DATA AT ALL — a real finding from writing it, recorded in the
 * Task 7 report: `npm run seed` never writes `preseason_projections`/`player_crosswalk`/
 * `nfl_players` (that is `scripts/preseason-persist.ts`'s job, run outside the e2e suite), so
 * `collectPlayerFacts` answers `null` for every player the stock fixture seeds and the dossier
 * composition is unreachable in e2e with no changes here. This seeds the minimal, MECHANICAL
 * evidence a real board write would produce for one fixture player — a market anchor, an
 * availability read, one prior season of real weekly production — never an LLM-authored capsule
 * (the one thing the task brief explicitly forbids fabricating): `player_capsules` is never seeded
 * either, and the full-page test asserts that honest absence rather than papering over it.
 *
 * WHY BOARD ROWS STILL USE `BOARD_SOURCE`, NOT A FIXTURE SOURCE KEY (fix round 1, CRITICAL 1b) —
 * every reader on the path this spec exercises (`preseasonReadings` in `league-service/player.ts`,
 * `dossierFactsFor` in `league-service/dossier-facts.ts`) hardcodes the literal `BOARD_SOURCE`
 * constant; there is no configurable source parameter a fixture key could stand in for, so a row
 * under any other source name would simply never be read. The safety hazard fix round 1 actually
 * flagged was `as_of` MULTIPLICITY, not the source name: `assertSingleGeneration` throws for the
 * whole product the moment two DIFFERENT `as_of` stamps exist under `(season, BOARD_SOURCE)` at
 * once, and the first version of this spec picked an arbitrary fixed `as_of` that collided with a
 * real generation already live in this shared dev Postgres (546 rows, from `scripts/preseason-
 * persist.ts` run outside this suite). `resolveBoardAsOf` below fixes that at the root: it resolves
 * whatever single `as_of` this database's `(season, BOARD_SOURCE)` generation is ALREADY carrying
 * and writes this fixture's one extra row into that SAME generation, under the brand-new fixture
 * nfl id — never a second, competing `as_of`, so `assertSingleGeneration` never has anything to
 * object to, for this fixture's player or anyone else's, at any point during this spec's run. A
 * database with no generation yet (a fresh CI Postgres) falls back to `FALLBACK_BOARD_ASOF`. The
 * row is deleted in `afterAll` either way, so the live generation's row count is exactly what it
 * was before this spec ran the moment the test file finishes.
 *
 * STAT-LINE ROWS (the prior-season observations `SeasonStrip` reads its "a game" fact from) hit
 * the same wall from the other direction: `capsules/collect.ts`'s `lastSeasonStoriesFor` reads
 * observations through `statLinesAsOfForLiveSurface`, hardcoded to `STAT_LINE_SOURCE`
 * (`NFLVERSE_SOURCE.playerWeek`) with no per-call override either. Unlike the board, there is no
 * single-generation invariant on this store at all — `store.ts`'s own docblock: "a feed that later
 * says something different is saying it at a later as_of, which is a new row" — multiple `as_of`
 * values coexisting is the NORMAL shape of this table, so there is no live-generation collision
 * risk to design around here; the only obligation left is cleanup, which `cleanupFixtureRows`
 * handles by deleting every row keyed to `FIXTURE_NFL_ID`, an id no real feed will ever emit.
 *
 * THE CURRENT SEASON'S OWN LOG (`SeasonTotalsAndLog`, "under this league's scoring") reads
 * `player_stat_lines` instead — a plain simulated-box-score table with no provenance/source concept
 * at all, keyed on `players.id`. Seeding a few weeks there for `FIXTURE_PLAYER_ID` is unremarkable
 * scaffolding by the same standard `npm run seed`'s own 4,250 rows already are for every real
 * player; nothing here claims to be real production data.
 *
 * WHY NOT `TEST_DATABASE_URL` (fix round 1, CRITICAL 1d): the e2e `webServer` (`playwright.config.ts`)
 * runs the app against whatever `DATABASE_URL` `.env.local` names, which every other spec's own
 * `global-setup.ts` seed already targets — manager A's WorkOS session, every league, every other
 * fixture this suite reuses lives only in that database. Pointing this ONE spec's app process at
 * `TEST_DATABASE_URL` (port 5433) instead would mean either running the ENTIRE global setup a
 * second time against a second database (doubling every e2e run's cost, for one spec) or getting a
 * database with none of manager A's leagues in it at all — either way, "how other specs run" is
 * exactly what would change. This spec stays on the same `DATABASE_URL` every other spec uses, and
 * leans on strict cleanup instead of database isolation to stay safe.
 */

const FIXTURE_PLAYER_ID = "e2e_dossier_fixture_player";
const FIXTURE_NFL_ID = "e2e_dossier_fixture_nfl";
const FIXTURE_PLAYER_NAME = "E2E Dossier Fixture";
const FIXTURE_POSITION = "WR" as const;
/** Any real team code works — display and bye-week lookups degrade gracefully for a team that
 *  simply has no game that week; this fixture never asserts anything about it. */
const FIXTURE_NFL_TEAM = "KC";

const FALLBACK_BOARD_ASOF = new Date("2020-01-01T00:00:00.000Z");
const PRIOR_SEASON = PRODUCT_SEASON - 1;

/** The one `as_of` this fixture's board row must be written under — whatever this database's
 *  `(PRODUCT_SEASON, BOARD_SOURCE)` generation already carries, or `FALLBACK_BOARD_ASOF` if no
 *  generation exists yet. See this file's own docblock for why this is never a second generation. */
async function resolveBoardAsOf(db: Db): Promise<Date> {
  const existing = await db
    .selectDistinct({ asOf: preseasonProjections.asOf })
    .from(preseasonProjections)
    .where(and(eq(preseasonProjections.season, PRODUCT_SEASON), eq(preseasonProjections.source, BOARD_SOURCE)));
  if (existing.length > 1) {
    throw new Error(
      `[e2e] player-dossier: ${BOARD_SOURCE} for season ${PRODUCT_SEASON} already carries ${existing.length} distinct as_of generations before this fixture wrote anything; refusing to add a third ambiguous one.`,
    );
  }
  return existing[0]?.asOf ?? FALLBACK_BOARD_ASOF;
}

/**
 * Deletes every row this spec ever writes, in FK-safe (children before parents) order. Run in
 * `beforeAll` (a crashed prior run's leftovers) AND `afterAll` (this run's own rows) — the same
 * "clear stray state at both ends" discipline `trades.spec.ts`'s own `clearStrayState` keeps,
 * applied here to a fixture identity rather than a fixture league's transient trade state.
 */
async function cleanupFixtureRows(db: Db): Promise<void> {
  await db.delete(preseasonBoardReasons).where(and(eq(preseasonBoardReasons.season, PRODUCT_SEASON), eq(preseasonBoardReasons.source, BOARD_SOURCE), eq(preseasonBoardReasons.playerId, FIXTURE_NFL_ID)));
  await db.delete(preseasonProjections).where(and(eq(preseasonProjections.season, PRODUCT_SEASON), eq(preseasonProjections.source, BOARD_SOURCE), eq(preseasonProjections.playerId, FIXTURE_NFL_ID)));
  await db.delete(playerWeekObservations).where(eq(playerWeekObservations.playerId, FIXTURE_NFL_ID));
  await db.delete(playerStatLines).where(eq(playerStatLines.playerId, FIXTURE_PLAYER_ID));
  await db.delete(playerCrosswalk).where(eq(playerCrosswalk.playerId, FIXTURE_PLAYER_ID));
  await db.delete(nflPlayers).where(eq(nflPlayers.id, FIXTURE_NFL_ID));
  await db.delete(players).where(eq(players.id, FIXTURE_PLAYER_ID));
}

async function seedDossierFixture(db: Db): Promise<void> {
  const boardAsOf = await resolveBoardAsOf(db);

  await db.insert(players).values({ id: FIXTURE_PLAYER_ID, name: FIXTURE_PLAYER_NAME, position: FIXTURE_POSITION, nflTeam: FIXTURE_NFL_TEAM });
  await db.insert(nflPlayers).values({ id: FIXTURE_NFL_ID, name: FIXTURE_PLAYER_NAME, position: FIXTURE_POSITION });
  await db.insert(playerCrosswalk).values({ playerId: FIXTURE_PLAYER_ID, nflPlayerId: FIXTURE_NFL_ID, method: "e2e_fixture", resolvedAt: boardAsOf });

  await recordPreseasonProjections(db, [
    {
      season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: FIXTURE_NFL_ID,
      rank: 1, positionRank: 1, projectedPoints: 224.6, valueOverReplacement: 84.6, valueRank: 1,
      expectedGames: 15.4, floorPoints: 168.2, medianPoints: 224.6, ceilingPoints: 289.1, tier: 0,
      asOf: boardAsOf, momentKind: "live",
    },
  ]);

  await recordPreseasonBoardReasons(db, [
    { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: FIXTURE_NFL_ID, code: "market_anchor", detail: "", payload: { marketPoints: 206.6, delta: 18 } },
    { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: FIXTURE_NFL_ID, code: "scarcity", detail: "", payload: { positionRank: 4, replacementLevel: 140 } },
    { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: FIXTURE_NFL_ID, code: "availability", detail: "", payload: { expectedGames: 15.4, floorGames: 11, ceilingGames: 17 } },
  ]);

  // One real prior season of weekly production — the "lastSeasonStory" color facts SeasonStrip
  // states, and the ONE path `dossier.basis.scoringLabel` ("PPR", the league-agnostic basis)
  // reaches the page through. Three weeks, rising, so "best week" and "a real move" both have
  // something honest to say.
  const priorAsOf = new Date(Date.UTC(PRIOR_SEASON, 10, 1));
  const priorWeeks: readonly PlayerWeekObservation[] = [1, 2, 3].flatMap((week) => {
    const rushingYards = 60 + week * 20;
    return [
      { season: PRIOR_SEASON, week, playerId: FIXTURE_NFL_ID, source: STAT_LINE_SOURCE, metric: statMetricName("rushingYards"), value: rushingYards, asOf: priorAsOf },
      { season: PRIOR_SEASON, week, playerId: FIXTURE_NFL_ID, source: STAT_LINE_SOURCE, metric: statMetricName("receivingYards"), value: 15, asOf: priorAsOf },
    ];
  });
  await recordObservations(db, priorWeeks);

  // The CURRENT season's own game log ("under this league's scoring") — `player_stat_lines`, a
  // plain simulated box score with no provenance concept, keyed on `players.id` directly. Three
  // of whatever weeks this database has already scored (`stat_weeks.status !== 'scheduled'`),
  // resolved here rather than hardcoded, so this fixture never assumes a specific week number the
  // seed happens to have reached.
  const scoredWeeks = await db.select({ week: statWeeks.week }).from(statWeeks).where(ne(statWeeks.status, "scheduled")).orderBy(statWeeks.week);
  const currentWeeks = scoredWeeks.slice(0, 3).map((row) => row.week);
  if (currentWeeks.length > 0) {
    await db
      .insert(playerStatLines)
      .values(currentWeeks.map((week) => ({ playerId: FIXTURE_PLAYER_ID, week, targets: 6, receptions: 4, receivingYards: 55, receivingTouchdowns: 1 })))
      .onConflictDoNothing();
  }
}

test.beforeAll(async () => {
  const db = createDb();
  try {
    await cleanupFixtureRows(db);
    await seedDossierFixture(db);
  } finally {
    await db.$client.end();
  }
});

test.afterAll(async () => {
  const db = createDb();
  try {
    await cleanupFixtureRows(db);
  } finally {
    await db.$client.end();
  }
});

test.describe("Player Dossier", () => {
  test("opens from the league players list and shows the call card, range rail and role module with real seeded data", async ({ managerA }) => {
    // `E2E_TRADES_LEAGUE_ID`, not `SEEDED_SEASON_LEAGUE_ID`: manager A fields no team in
    // `dev_league_season` (its 12 teams belong to the founder's own account and ten synthetic
    // `dev_user_NN` seed accounts), and `loadRoomData` — behind every room surface, `players`
    // included — 404s a viewer who fields no team and holds no commissioner seat. Manager A DOES
    // field a real team in `E2E_TRADES_LEAGUE_ID` (`global-setup.ts`'s own `ensureTradesLeague`,
    // draft already complete). The fixture player is free in every league by construction (a brand
    // new `players` row nothing has ever rostered), so either league would show him.
    await managerA.goto(`/app/leagues/${E2E_TRADES_LEAGUE_ID}/players`);
    await managerA.getByLabel("Search free agents").fill(FIXTURE_PLAYER_NAME);
    await managerA.getByRole("button", { name: FIXTURE_PLAYER_NAME }).first().click();

    // The bottom-sheet peek, named for the player it opened.
    await expect(managerA.getByRole("dialog", { name: FIXTURE_PLAYER_NAME })).toBeVisible();
    await expect(managerA.getByLabel("The call")).toBeVisible();
    await expect(managerA.getByLabel("Season range")).toBeVisible();
    await expect(managerA.getByLabel("Role")).toBeVisible();

    // Real seeded numbers, not placeholders: the call card's own board points (now naming its own
    // basis — fix round 1, IMPORTANT 8) and the ADP-basis pick, both stated straight from this
    // fixture's own `recordPreseasonProjections` row.
    await expect(managerA.getByLabel("The call")).toContainText("225 PPR pts");
    await expect(managerA.getByLabel("The call")).toContainText("+18 points vs his ADP");
  });

  test("the full page shows the uncapped dossier, an honest capsule fallback, and both scoring bases named", async ({ managerA }) => {
    // `SEEDED_SEASON_LEAGUE_ID`, not `E2E_TRADES_LEAGUE_ID`, for THIS test: `SeasonTotalsAndLog`'s
    // "under this league's scoring" totals/log need a league the seed script actually ran a season
    // on (`dev_league_season`'s own scored weeks), which `E2E_TRADES_LEAGUE_ID` never was. The
    // player-detail route itself is open to any signed-in viewer regardless of team ownership
    // (`resolveLeagueMembership` only requires the league to exist), so manager A can view it here
    // even without a team in `dev_league_season`.
    // `?season=${PRIOR_SEASON}`, not the page's own default (the current season): fix round 1,
    // CRITICAL 2 changed `SeasonStrip` to render only when the viewer is actually looking at the
    // season `dossier.lastSeasonStory` describes (always the PRIOR season) — the page's default
    // view (the current season, once it has a scored week, exactly like this fixture's own) now
    // honestly shows `SeasonChartFallback` instead. Requesting the prior season directly is what
    // makes `SeasonStrip`, and the "PPR" fact on it, reachable at all.
    await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}/players/${FIXTURE_PLAYER_ID}?season=${PRIOR_SEASON}`);

    await expect(managerA.getByLabel("The call")).toBeVisible();
    await expect(managerA.getByLabel("Season range")).toBeVisible();
    await expect(managerA.getByLabel("Role")).toBeVisible();

    // NO STORED CAPSULE IN THIS FIXTURE (see this file's own docblock: `player_capsules` is never
    // seeded, on purpose, and this spec does not fabricate one) — the honest fallback is that
    // "The read" renders nothing at all, never a placeholder card.
    await expect(managerA.getByLabel("The read")).toHaveCount(0);

    // BOTH SCORING BASES NAMED (Global Constraints' own 12.0-vs-14.28 fix, made visible): the
    // league's own scoring, on the totals/log headers this page never had before Task 6 —
    await expect(managerA.getByText(/under this league's scoring/).first()).toBeVisible();
    // — and the board's own league-agnostic basis, PPR, on `SeasonStrip`'s own "a game" fact,
    // reachable only because this fixture seeded a real prior season above. Scoped to the season
    // card itself (`SeasonStrip`'s own aria-label) rather than the whole page, since a bare
    // page-wide "PPR" text query could collide with an unrelated mention elsewhere in the shell.
    await expect(managerA.getByLabel(`${PRIOR_SEASON} season`).getByText("PPR", { exact: true })).toBeVisible();
  });
});
