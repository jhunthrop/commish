import { and, eq, inArray } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client";
import { nflPlayers, playerCrosswalk, players, preseasonProjections, rosterSlots, teams } from "../src/db/schema";
import { statMetricName, STAT_LINE_SOURCE } from "../src/projections/lines";
import { BOARD_SOURCE, recordPreseasonBoardReasons, recordPreseasonProjections } from "../src/projections/preseason/board-store";
import { PRODUCT_SEASON } from "../src/projections/preseason/current";
import { recordObservations, type PlayerWeekObservation } from "../src/projections/store";
import { E2E_TRADES_LEAGUE_ID } from "./global-setup";
import { expect, SEEDED_SEASON_LEAGUE_ID, test } from "./support/fixtures";

/**
 * PLAYER DOSSIER E2E-LITE (Task 7, Step 2) — the peek's call card/range rail/role module and the
 * full page's uncapped dossier, against the real running app, real Postgres, real WorkOS session.
 *
 * WHY THIS SPEC SEEDS ITS OWN BOARD DATA, THE SAME "SCAFFOLDING, NOT THE TESTED SURFACE" IDIOM
 * `global-setup.ts`'s `ensureTradesLeague`/`ensureHeldTradeLeague` ALREADY USE — a real finding
 * from writing this spec, recorded in the Task 7 report: `npm run seed` never writes
 * `preseason_projections`/`player_crosswalk`/`nfl_players` at all (that is
 * `scripts/preseason-persist.ts`'s job, run outside the e2e suite), so `collectPlayerFacts`
 * answers `null` for EVERY player in the stock e2e fixture and the dossier composition is
 * currently unreachable in e2e with no changes here. This seeds the minimal, MECHANICAL evidence
 * a real board write would produce for ONE real free agent already in the seeded season league —
 * a market anchor, an availability read, one prior season of real weekly production — never an
 * LLM-authored capsule (the one thing the task brief explicitly forbids fabricating): this
 * fixture's own `body.capsule` stays `null`, on purpose, because nothing seeds `player_capsules`
 * either, and the full-page test below asserts that honest absence rather than papering over it.
 *
 * IDEMPOTENT, RERUN-SAFE, AND NEVER TOUCHES ANOTHER PLAYER'S ROW: `recordPreseasonProjections`/
 * `recordPreseasonBoardReasons`/`recordObservations` are the SAME real writer functions the actual
 * ingestion pipeline calls, each already idempotent on its own natural key (no ad hoc SQL).
 *
 * `as_of` IS RESOLVED FROM THE LIVE DATABASE, NEVER HARDCODED — a real finding from running this
 * spec once: this environment's shared Postgres can ALREADY carry a real `(PRODUCT_SEASON,
 * BOARD_SOURCE)` generation (from `scripts/preseason-persist.ts` run outside this suite, against
 * this same database, for real dev work). A fixed fixture `as_of` collided with that real
 * generation and tripped `assertSingleGeneration` (`board-store.ts`) for the WHOLE product, not
 * just this fixture's player — every `player-season` read 500'd until the stray row was deleted
 * by hand. `resolveBoardAsOf` below reads whatever single `as_of` already exists for this
 * `(season, source)` pair and writes the fixture row into that SAME generation; a database with no
 * existing generation yet (a fresh CI Postgres) falls back to `FALLBACK_BOARD_ASOF`. Either way
 * there is only ever one `as_of` in play, so reruns are safe and a real ingestion run before or
 * after this spec never sees two generations.
 */

const FALLBACK_BOARD_ASOF = new Date("2020-01-01T00:00:00.000Z");
const PRIOR_SEASON = PRODUCT_SEASON - 1;

/** The one `as_of` this fixture's board row must be written under — whatever the database already
 *  carries for `(PRODUCT_SEASON, BOARD_SOURCE)`, or `FALLBACK_BOARD_ASOF` if nothing does yet. */
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

interface DossierFixture {
  readonly playerId: string;
  readonly playerName: string;
  readonly gsisId: string;
}

/** Skill positions only — `capsules/collect.ts`'s `lastSeasonStoriesFor` filters its whole
 *  population through `isSkillPosition` (QB/RB/WR/TE), so a K/DEF free agent can NEVER get a
 *  `lastSeasonStory` no matter how many prior-season observations this fixture seeds for him. A
 *  real finding from this spec's first e2e run: `findFreeAgent` originally picked the lowest-id
 *  free agent with no position filter, landed on a kicker, and `SeasonStrip` (which needs
 *  `lastSeasonStory`) silently fell back to `SeasonChartFallback` instead. */
const SKILL_POSITIONS_FOR_FIXTURE = new Set(["QB", "RB", "WR", "TE"]);

/**
 * WHY THE FREE AGENT MUST BE FREE IN TWO LEAGUES AT ONCE — a second real finding from this spec's
 * e2e runs. `dev_league_season`'s own teams belong to `jh@derbee.ai` and ten `dev_user_NN` seed
 * accounts, none of which manager A's stored session is (`resolveLeagueMembership` treats the
 * player detail page as open to any signed-in viewer, but `loadRoomData` — behind every OTHER
 * room surface, `players` included — 404s a viewer who fields no team and holds no commissioner
 * seat there). Manager A DOES field a team in `E2E_TRADES_LEAGUE_ID` (`global-setup.ts`'s own
 * `ensureTradesLeague`, draft already complete), so the free-agent LIST test below opens that
 * league instead; the full-page test keeps `SEEDED_SEASON_LEAGUE_ID` for its real scored weeks
 * (`SeasonTotalsAndLog`'s own game log needs a league the seed script actually ran a season on,
 * which `E2E_TRADES_LEAGUE_ID` never was). One board fixture, shown correctly through either
 * league's own lens, exactly like a real free agent would be.
 */
async function findFreeAgent(db: Db): Promise<{ readonly id: string; readonly name: string; readonly position: "QB" | "RB" | "WR" | "TE" }> {
  const rostered = await db
    .select({ playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .innerJoin(teams, eq(teams.id, rosterSlots.teamId))
    .where(inArray(teams.leagueId, [SEEDED_SEASON_LEAGUE_ID, E2E_TRADES_LEAGUE_ID]));
  const rosteredIds = new Set(rostered.map((row) => row.playerId));

  const candidates = await db.select({ id: players.id, name: players.name, position: players.position }).from(players).orderBy(players.id).limit(2000);
  const freeAgent = candidates.find((candidate) => !rosteredIds.has(candidate.id) && SKILL_POSITIONS_FOR_FIXTURE.has(candidate.position));
  if (freeAgent === undefined) throw new Error("[e2e] player-dossier: no skill-position free agent found, free in both leagues, to attach a board fixture to.");
  return freeAgent as { readonly id: string; readonly name: string; readonly position: "QB" | "RB" | "WR" | "TE" };
}

async function seedDossierFixture(db: Db): Promise<DossierFixture> {
  const freeAgent = await findFreeAgent(db);
  const gsisId = `e2e_dossier_${freeAgent.id}`;
  const boardAsOf = await resolveBoardAsOf(db);

  await db.insert(nflPlayers).values({ id: gsisId, name: freeAgent.name, position: freeAgent.position }).onConflictDoNothing({ target: nflPlayers.id });
  await db
    .insert(playerCrosswalk)
    .values({ playerId: freeAgent.id, nflPlayerId: gsisId, method: "e2e_fixture", resolvedAt: boardAsOf })
    .onConflictDoUpdate({ target: playerCrosswalk.playerId, set: { nflPlayerId: gsisId, method: "e2e_fixture" } });

  await recordPreseasonProjections(db, [
    {
      season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: gsisId,
      rank: 1, positionRank: 1, projectedPoints: 224.6, valueOverReplacement: 84.6, valueRank: 1,
      expectedGames: 15.4, floorPoints: 168.2, medianPoints: 224.6, ceilingPoints: 289.1, tier: 0,
      asOf: boardAsOf, momentKind: "live",
    },
  ]);

  await recordPreseasonBoardReasons(db, [
    { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: gsisId, code: "market_anchor", detail: "", payload: { marketPoints: 206.6, delta: 18 } },
    { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: gsisId, code: "scarcity", detail: "", payload: { positionRank: 4, replacementLevel: 140 } },
    { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: gsisId, code: "availability", detail: "", payload: { expectedGames: 15.4, floorGames: 11, ceilingGames: 17 } },
  ]);

  // One real prior season of weekly production — the "lastSeasonStory" color facts SeasonStrip
  // states, and the ONE path `dossier.basis.scoringLabel` ("PPR", the league-agnostic basis)
  // reaches the page through. Three weeks, rising, so "best week" and "a real move" both have
  // something honest to say.
  const priorAsOf = new Date(Date.UTC(PRIOR_SEASON, 10, 1));
  const priorWeeks: readonly PlayerWeekObservation[] = [1, 2, 3].flatMap((week) => {
    const rushingYards = 60 + week * 20;
    return [
      { season: PRIOR_SEASON, week, playerId: gsisId, source: STAT_LINE_SOURCE, metric: statMetricName("rushingYards"), value: rushingYards, asOf: priorAsOf },
      { season: PRIOR_SEASON, week, playerId: gsisId, source: STAT_LINE_SOURCE, metric: statMetricName("receivingYards"), value: 15, asOf: priorAsOf },
    ];
  });
  await recordObservations(db, priorWeeks);

  return { playerId: freeAgent.id, playerName: freeAgent.name, gsisId };
}

let fixture: DossierFixture;

test.beforeAll(async () => {
  const db = createDb();
  try {
    fixture = await seedDossierFixture(db);
  } finally {
    await db.$client.end();
  }
});

test.describe("Player Dossier", () => {
  test("opens from the league players list and shows the call card, range rail and role module with real seeded data", async ({ managerA }) => {
    // `E2E_TRADES_LEAGUE_ID`, not `SEEDED_SEASON_LEAGUE_ID` — see `findFreeAgent`'s own docblock
    // for why manager A can open this league's free-agent list and not that one's.
    await managerA.goto(`/app/leagues/${E2E_TRADES_LEAGUE_ID}/players`);
    await managerA.getByLabel("Search free agents").fill(fixture.playerName);
    await managerA.getByRole("button", { name: fixture.playerName }).first().click();

    // The bottom-sheet peek, named for the player it opened.
    await expect(managerA.getByRole("dialog", { name: fixture.playerName })).toBeVisible();
    await expect(managerA.getByLabel("The call")).toBeVisible();
    await expect(managerA.getByLabel("Season range")).toBeVisible();
    await expect(managerA.getByLabel("Role")).toBeVisible();

    // Real seeded numbers, not placeholders: the call card's own board points and the market's
    // own ADP-basis pick, both stated straight from this fixture's own `recordPreseasonProjections`
    // row.
    await expect(managerA.getByLabel("The call")).toContainText("225 pts");
    await expect(managerA.getByLabel("The call")).toContainText("+18 points vs his price");
  });

  test("the full page shows the uncapped dossier, an honest capsule fallback, and both scoring bases named", async ({ managerA }) => {
    await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}/players/${fixture.playerId}`);

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
