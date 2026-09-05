import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getPlayerCapsule, type PlayerCapsuleView } from "@/capsules/store";
import type { Db } from "@/db/client";
import { captureSnapshots, leagues, matchups, nflPlayers, players, playerStatLines, rosterSlots, scoringSettings, statWeeks, teams } from "@/db/schema";
import type { Player, Position, StatLine } from "@/domain/player";
import { PPR_SCORING, type ScoringSettings } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { LEAGUE_CONFIG, seasonProgress } from "@/league";
import { nflPlayerIdFor, nflPlayerIdsFor } from "@/projections/crosswalk";
import type { SeasonStatLine } from "@/projections/lines";
import type { Law } from "@/projections/laws/types";
import { chipEligibleLaws, registry } from "@/projections/laws/registry";
import { statLinesAsOfForLiveSurface } from "@/projections/nflverse/derived-stat-lines";
import { finalWeekOf } from "@/projections/nflverse/team-eras";
import { BENCHMARK_SOURCES } from "@/projections/preseason/benchmarks";
import type { BoardReason } from "@/projections/preseason/board";
import { BOARD_SOURCE, assertSingleGeneration, boardReasons, preseasonProjectionsFor } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { preseasonRankingsFor } from "@/projections/preseason/store";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@/scoring";
import { newsFor } from "./news";

/**
 * How many finished seasons before `PRODUCT_SEASON` a player card will offer, at most — the same
 * three seasons the draft room's own peek card looks back over (`draft-service/player-history.ts`'s
 * `HISTORY_SEASONS`). Kept as this file's own constant rather than importing that one: the two
 * screens share a number today by coincidence of product taste, not by a rule that binds them
 * together, and a founder narrowing one is not a reason to narrow the other.
 */
const HISTORY_SEASONS = 3;

/** The outermost edge is the only place a wall clock is allowed, exactly as every other service
 *  in this directory has it. */
const systemClock: Clock = { now: () => new Date().toISOString() };

/** The earliest season this product will ever entertain as a real request — nowhere near
 *  `HISTORY_SEASONS`' own three-year lookback, just a sanity floor against garbage input. */
const EARLIEST_PLAUSIBLE_SEASON = 2000;

/**
 * THE ONE PLACE A `season` QUERY PARAM BECOMES A NUMBER (fix round 1, MEDIUM/LOW) — both the API
 * route and the player page parsed this identically inline before this extraction, which is
 * exactly the kind of duplication that drifts the moment one call site gets a bound the other
 * does not.
 *
 * `undefined` in, `undefined` out: an absent or empty param means "let the service pick its own
 * default", never a fabricated year. Anything that is not a clean, in-range integer — `"2025.5"`,
 * `"2025e2"`, `"abc"`, a season before this product's earliest plausible one, or one after the
 * season being drafted for — is REJECTED here rather than surviving to `playerSeason`'s own
 * `availableSeasons.includes(...)` membership check. Both would end up at the same fallback
 * (the service's own default), but rejecting malformed input up front, in one place, is the
 * difference between "this looks like validation" and "this happens to work because a later
 * filter also failed to match".
 */
export function parseSeasonParam(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return undefined;
  if (parsed < EARLIEST_PLAUSIBLE_SEASON || parsed > PRODUCT_SEASON) return undefined;
  return parsed;
}

/**
 * One week of a player's season, as the detail screen draws it.
 *
 * `points` is `null` for a week that HAPPENED WITHOUT HIM — a bye, an inactive, a man signed in
 * October. It is never a zero: "did not play" and "played and scored nothing" are different facts
 * and this product keeps them apart everywhere else (`MatchupLineupEntry.points`, and
 * `NOT_STARTED_DASH` before it).
 *
 * `percentile` is where the week sits among every week played at his position this season, on the
 * 0..1 scale `StatComparison` uses. `null` where there is no population to speak of — the caller
 * then renders the number as ordinary ink, which is `Stat`'s own "no comparison, no colour".
 */
export interface PlayerWeekView {
  readonly week: number;
  readonly points: number | null;
  readonly percentile: number | null;
}

/**
 * One played week's raw production — the game log's row (founder, 2026-08-30: ESPN-depth card).
 *
 * `carries` and `targets` are `null` for a PRIOR season (2026-09-04 widening): they are the
 * "harvest block" in `StatLine` — optional, deliberately outside `STAT_FIELDS` (see that constant's
 * own docblock) — and the point-in-time store's `statLinesAsOf` therefore never fills them from an
 * observation, for any season. The CURRENT season's rows come from `player_stat_lines` instead,
 * whose columns default to `0` and are always present, so this widening changes nothing about what
 * today's season already showed. `null` here is never a fabricated zero: a receiver who plainly
 * caught passes in a season this product cannot see his carry count for gets a dash, not a lie.
 */
export interface PlayerGameLogRow {
  readonly week: number;
  readonly points: number;
  readonly carries: number | null;
  readonly rushingYards: number;
  readonly targets: number | null;
  readonly receptions: number;
  readonly receivingYards: number;
  readonly passingYards: number;
  /** Offensive touchdowns of every kind, one column — the log is a scan, not a box score. */
  readonly touchdowns: number;
}

/** The season summed, from the same lines the log itemizes. `carries`/`targets` are `null` exactly
 *  when every row they are summed from is — see `PlayerGameLogRow`'s own docblock. */
export interface PlayerSeasonTotals {
  readonly games: number;
  readonly carries: number | null;
  readonly rushingYards: number;
  readonly targets: number | null;
  readonly receptions: number;
  readonly receivingYards: number;
  readonly passingYards: number;
  readonly touchdowns: number;
  readonly fantasyPoints: number;
}

/**
 * Everything the player screen draws, and NOTHING WE CANNOT REACH.
 *
 * The screen's source strip compares three independent readings of one quantity — where the
 * market has him, where the experts have him, where OUR MODEL has him. All three are now computed
 * here, and each is `null` for a player it genuinely cannot be computed for. What each one costs:
 *
 * - **The market** is `players.adp`, already on the row.
 * - **Expert consensus** is `preseason_rankings`, source `fantasypros_ecr_ppr`, read through
 *   `player_crosswalk` — the id join that did not exist when this docblock was first written and
 *   was the reason the cell printed a dash. It resolves for a player the crosswalk placed AND the
 *   publisher ranked, which for the current season is 441 of the 518 names on the board.
 * - **Our own board** is `preseason_projections`, source `commish_board_v7_ppr_12` (`BOARD_SOURCE`,
 *   `board-store.ts` — the market-blended board; the fit-round built v8 and v9 above it and neither
 *   cleared the held-out bar, so the constant points back at v7 until the 2025-outcomes round, with
 *   v8's and v9's rows kept in the store as the measured record; see that constant's own docblock
 *   for the full history). `commish_board_v1_ppr_12` is the raw model's own historical source, kept for provenance
 *   but no longer what a live product surface reads. Read through the same crosswalk.
 *   IT NOW FILLS FOR THE CURRENT SEASON (live-board plan, Task 4): `scripts/preseason-persist.ts`
 *   builds and stores a row for it through the LIVE arm of `BoardMoment` (`preseason/source.ts`),
 *   never by borrowing a finished season's number — the plausible-looking lie this docblock used to
 *   warn against, back when the board held only 2021-2024 and nothing newer, would have been
 *   showing 2024's number beside THIS year's consensus. That is not what happens now: `modelRank`
 *   is a real projection built FOR the current season, from its own week-one roster and market,
 *   never a neighbour's. THE HONEST LINE THIS CELL CARRIES INSTEAD: a live-taken row is
 *   UNMEASURED, not merely unfilled — `preseason/scorecard.ts`'s `assertGradableMoment` refuses to
 *   grade a `momentKind: "live"` board against anything, structurally, because the season it
 *   projects has not been played yet. So `modelRank` for the current season is exactly as real as
 *   the market's and the experts' own ranks beside it, and carries no accuracy claim neither of
 *   those two ever carried either — there is no scorecard rho to quote for ANY of the three cells
 *   until the season is over, and none of them has ever pretended otherwise.
 *
 * BOTH ARE READ AT `now`, through the same `as_of <=` gate the backtest uses. A product surface
 * lives in the present, so "everything knowable now" is both the honest read and exactly the
 * predicate a replay would use standing here — which is what lets the same store serve both.
 */
/**
 * SEASON SELECTION (2026-09-04 widening, founder: "make sure our player cards show prior year data
 * when the season hasn't started"). `player_stat_lines`/`stat_weeks` are single-season — the CURRENT
 * season only — and are empty until the league's own weeks start reporting results, which for a
 * fresh season can be months. `availableSeasons`, `season` and `isRookie` below make the rest of
 * this body ANSWER FOR ONE SEASON, chosen honestly rather than left to draw an empty current season:
 *
 * - `availableSeasons` lists every season this body could have answered for, newest first. The
 *   current season (`PRODUCT_SEASON`) is in it only once the league has actually played a week —
 *   the same `stat_weeks.status != 'scheduled'` gate the chart itself already enforced, so a
 *   preseason card never claims a current season it has zero rows for. A prior season is in it
 *   only when THIS PLAYER has at least one recorded week for it in the projection engine's
 *   point-in-time store (`player_week_observations`, read through the crosswalk) — never a season
 *   with league-wide history but nothing for him, and never a season absent from the store at all.
 * - `season` is which one of those the rest of this body (`weeks`, `log`, `totals`, `pointsPerGame`,
 *   `pointsPerGamePercentile`) actually describes: the caller's request when it named an available
 *   one, otherwise the newest available season — which is the CURRENT season once it has played a
 *   week, and the most recent PRIOR season for as long as it has not. That fallback is the whole
 *   point: a card opened in August, before this year's first snap, shows last year's real season
 *   instead of thirteen empty columns.
 * - A PRIOR season's `weeks`/`log`/`totals` are scored under THIS league's own rules from the SAME
 *   engine store `draft-service/player-history.ts`'s peek card already reads
 *   (`statLinesAsOfForLiveSurface`), never borrowed or interpolated — a season the store does not
 *   carry for him simply never enters `availableSeasons`, the same absence-over-invention rule
 *   `expertRank`/`modelRank` below already keep. `carries`/`targets` are `null` on a prior season's
 *   game log rows: see `PlayerGameLogRow`'s own docblock for why the store cannot honestly fill them.
 * - `isRookie` and `availableSeasons` TOGETHER carry a THREE-STATE fact, and a caller must read
 *   both rather than inferring one from the other (fix round 1, CRITICAL — the first version of
 *   this widening set `isRookie` from `availableSeasons.length === 0` alone, which told a real
 *   veteran the crosswalk had not placed "his first NFL season", a biography claim `isRookie` has
 *   no business making from mere data absence):
 *     1. `availableSeasons.length > 0` — normal: chart whichever season `season` names.
 *     2. `availableSeasons.length === 0 && isRookie` — a CONFIRMED rookie (`nfl_players
 *        .rookie_season === PRODUCT_SEASON`, read through the crosswalk — the one authoritative
 *        "which season did this man enter the league" fact this product carries; there is no
 *        product-side rookie flag on `players` itself). Nothing to chart because nothing has
 *        happened yet, not because nothing is known. `season` still names a year
 *        (`PRODUCT_SEASON`) so the screen has something to label. The UI prints "his first NFL
 *        season" here and nowhere else.
 *     3. `availableSeasons.length === 0 && !isRookie` — a THIRD state: not a rookie (or a rookie
 *        status this product cannot confirm, which is the SAME honest position as not being one),
 *        and no prior season on record either. Reached by a crosswalk miss (rookie status is only
 *        ever reachable through the crosswalk) or by a placed veteran the store simply has no
 *        weeks for. The UI must print a sentence that claims only what is known — "no prior
 *        seasons on record" — never the rookie sentence, which would assert a biography fact this
 *        state is defined by NOT having.
 *
 * `positionRank`, `adpPercentile`, `expertRank`, `modelRank`, `reasons` and `laws` below are NOT
 * season-selected: they are this year's draft outlook (ADP, expert consensus, our own board, the
 * board's own reasons), which is a fact about the season a manager is drafting for, not about
 * whichever season's game log he happens to be looking at.
 */
export interface PlayerSeasonBody {
  readonly player: Player;
  /** Every season this body could answer for, newest first. Can be empty for a reason `isRookie`
   *  does NOT settle on its own — see this interface's own docblock's three-state account. */
  readonly availableSeasons: readonly number[];
  /** Which season `weeks`/`log`/`totals`/`pointsPerGame`/`pointsPerGamePercentile` describe. */
  readonly season: number;
  /** A CONFIRMED rookie fact (`nfl_players.rookie_season`), never inferred from `availableSeasons`
   *  being empty — a crosswalk miss or an unrecorded veteran also has an empty `availableSeasons`
   *  and is NOT this. Read `isRookie` and `availableSeasons` together; see this interface's own
   *  docblock for the three states the pair can be in. */
  readonly isRookie: boolean;
  /** His rank among players at his position by market draft position, or `null` where the ADP
   *  feed does not carry him. */
  readonly positionRank: number | null;
  /** Where his draft position sits among every ranked player, 0..1, best is 1. `null` when he is
   *  unranked, or when the feed ranks nobody else to compare him against. */
  readonly adpPercentile: number | null;
  /**
   * Expert consensus rank for this season, or `null` where the crosswalk could not place him or
   * the publisher does not rank him. Never approximated from a neighbouring season: a consensus is
   * a claim about one August and it stops being one the moment it is borrowed.
   */
  readonly expertRank: number | null;
  /** Our own board's overall rank for this season, or `null` where there is no board for him.
   *  A real, unborrowed projection for the current season once the live board is persisted, never
   *  measured against an outcome the season has not produced yet — see the type's own docblock. */
  readonly modelRank: number | null;
  /** Points per game over the weeks he actually played in `season`, under THIS league's scoring
   *  rules. */
  readonly pointsPerGame: number | null;
  readonly pointsPerGamePercentile: number | null;
  /** Every week of `season` that has actually been played, in order — every league week for the
   *  current season, every NFL regular-season week for a prior one. */
  readonly weeks: readonly PlayerWeekView[];
  /** Which of THIS league's teams holds him, or `null` for a free agent here. */
  readonly ownedBy: string | null;
  /**
   * `leagues.isMock` for THIS league (Task 4, context honesty, 2026-09-04) — `true` for a mock
   * draft's own practice room. A roster-status claim built from `ownedBy` ("Free agent in this
   * league" / "On {team}") is a fact about a REAL room; a mock room's teams are the founder-required
   * seeded bot roster (`domain/league.ts`'s own `isBot` docblock), and telling a manager practicing
   * a mock that a player is "a free agent in this league" describes a room that does not exist the
   * way a real league does. Consumers gate that one line on this flag; every other field on this
   * body is already honest either way (`ownedBy` itself still answers correctly for a mock room's
   * own bot rosters, this flag only says whether stating it as a LEAGUE fact is honest).
   */
  readonly isMockLeague: boolean;
  /** His current designation from the harvested injuries feed ("Q", "O", "IR"), or `null` when
   *  the feed does not name him — absence means healthy as far as the source says. */
  readonly injuryDesignation: string | null;
  /** Raw production per played week, newest first — the ESPN-depth game log. */
  readonly log: readonly PlayerGameLogRow[];
  readonly totals: PlayerSeasonTotals | null;
  /** Recent headlines that name him, newest first, from the harvested news feed. */
  readonly news: readonly { readonly title: string; readonly link: string }[];
  /**
   * Task 8: every reason the CURRENT season's board stored for him (`boardReasons`, `BOARD_SOURCE`,
   * `PRODUCT_SEASON`) — the Outlook section's full chain, never truncated to a compact row's top
   * two the way the draft board's sticker is. Empty for a player the crosswalk could not place or
   * the board never ranked, the same "absence means nothing to say" rule `boardReasons` itself
   * keeps.
   */
  readonly reasons: readonly BoardReason[];
  /** The law registry, for `ReasonChip`'s own claim lookup on a `"law"` reason. */
  readonly laws: readonly Law[];
  /**
   * The auto-written capsule (spec §9 AMENDED 2026-09-04) — LLM voice over verified facts, the
   * SAME facts the sweep job computes off the board (`src/capsules/collect.ts`), mechanically
   * validated before it is ever stored. `null` for a player the sweep has not reached yet (a
   * board-irrelevant player, or one not swept), never a placeholder string standing in for
   * absence. Optional on the type (rather than always-present) so the many existing fixtures
   * that build a `PlayerSeasonBody` by hand need not all learn about capsules at once; every real
   * read through `playerSeason` sets it.
   */
  readonly capsule?: PlayerCapsuleView | null;
}

/**
 * Where `value` sits in `population`, 0..1, with 1 the best in the set.
 *
 * A population of fewer than two is not a population and returns `null` rather than a percentile
 * of 0.5 that would tint a number against nothing — the same refusal `Stat` makes for an unstated
 * comparison, kept here so the two cannot disagree.
 *
 * `better` decides which direction is up, because this file has both: more fantasy points is
 * better and a LOWER draft position is better, and a single "higher wins" helper would have
 * silently ranked the best player in the league last.
 */
function percentileOf(value: number, population: readonly number[], better: "higher" | "lower"): number | null {
  if (population.length < 2) return null;
  const worse = population.filter((other) => (better === "higher" ? other < value : other > value)).length;
  return worse / (population.length - 1);
}

/**
 * Every played week, with his own number and where that number stands.
 *
 * The population is EVERY WEEK PLAYED AT HIS POSITION THAT SEASON, not his own thirteen. A
 * player's weeks judged against themselves always produce a full spread of verdicts — a man with
 * thirteen identical afternoons gets a red week and a green one, which is a lie the reader has no
 * way to see. Against his position's whole season, a twenty-one point week is a big week because
 * it was a big week for a running back, which is the question a manager is actually asking.
 *
 * `lines` are `StatLine`s rather than the current season's own `player_stat_lines` row shape, so
 * this and `peerPointsPerGame` below serve BOTH stat-store shapes this file reads from: the
 * current season's DB rows (which structurally satisfy `StatLine` — every optional harvest field
 * present as a real, defaulted number) and a prior season's `SeasonStatLine.line` read from the
 * observation store (which does not carry those optional fields at all). Neither function reads
 * the optional fields, so the shape difference is invisible to both.
 */
function weekViews(lines: readonly StatLine[], played: readonly number[], playerId: string, position: Position, rules: ScoringRules): readonly PlayerWeekView[] {
  const population = lines.map((line) => computeFantasyPoints(line, position, rules));
  const mine = new Map(lines.filter((line) => line.playerId === playerId).map((line) => [line.week, line] as const));
  return played.map((week): PlayerWeekView => {
    const line = mine.get(week);
    if (line === undefined) return { week, points: null, percentile: null };
    const points = computeFantasyPoints(line, position, rules);
    return { week, points, percentile: percentileOf(points, population, "higher") };
  });
}

/** Each peer's own points per game over the played weeks — the population `pointsPerGame` is
 *  judged against. A man with no played week is not in it: a season he did not have is not a
 *  season anyone's average should be measured against. See `weekViews`' own note on why this
 *  takes `StatLine`s rather than one store's own row shape. */
function peerPointsPerGame(lines: readonly StatLine[], position: Position, rules: ScoringRules): readonly number[] {
  const totals = new Map<string, { total: number; games: number }>();
  for (const line of lines) {
    const running = totals.get(line.playerId) ?? { total: 0, games: 0 };
    totals.set(line.playerId, { total: running.total + computeFantasyPoints(line, position, rules), games: running.games + 1 });
  }
  return [...totals.values()].map((running) => roundPoints(running.total / running.games));
}

/** The season summed from a game log, honestly: `carries`/`targets` total only when EVERY row in
 *  the log carries a real number for it, `null` when the season's own source cannot (a prior
 *  season, always — see `PlayerGameLogRow`'s own docblock). `null` for an empty log — a season he
 *  did not play is not a season with a zero total. */
function totalsFromLog(log: readonly PlayerGameLogRow[]): PlayerSeasonTotals | null {
  if (log.length === 0) return null;
  const carriesKnown = log.every((row) => row.carries !== null);
  const targetsKnown = log.every((row) => row.targets !== null);
  const seed: PlayerSeasonTotals = {
    games: 0,
    carries: carriesKnown ? 0 : null,
    rushingYards: 0,
    targets: targetsKnown ? 0 : null,
    receptions: 0,
    receivingYards: 0,
    passingYards: 0,
    touchdowns: 0,
    fantasyPoints: 0,
  };
  return log.reduce(
    (sum, row): PlayerSeasonTotals => ({
      games: sum.games + 1,
      carries: sum.carries === null ? null : sum.carries + (row.carries ?? 0),
      rushingYards: sum.rushingYards + row.rushingYards,
      targets: sum.targets === null ? null : sum.targets + (row.targets ?? 0),
      receptions: sum.receptions + row.receptions,
      receivingYards: sum.receivingYards + row.receivingYards,
      passingYards: sum.passingYards + row.passingYards,
      touchdowns: sum.touchdowns + row.touchdowns,
      fantasyPoints: roundPoints(sum.fantasyPoints + row.points),
    }),
    seed,
  );
}

/** The four fields that vary by which season is being shown — everything else in
 *  `PlayerSeasonBody` (the draft outlook cells, ownership, injury, news) is season-independent.
 *  See `PlayerSeasonBody`'s own docblock. */
interface PlayerSeasonStats {
  readonly weeks: readonly PlayerWeekView[];
  readonly pointsPerGame: number | null;
  readonly pointsPerGamePercentile: number | null;
  readonly log: readonly PlayerGameLogRow[];
  readonly totals: PlayerSeasonTotals | null;
}

/**
 * THE CURRENT SEASON'S PATH, UNCHANGED (2026-09-04 widening carries this over byte-for-byte from
 * before seasons existed as a concept here): `player_stat_lines`, gated by `stat_weeks`, exactly as
 * `playerSeason`'s own top-level docblock describes. The one thing that moved is the wrapper — this
 * used to be inlined in `playerSeason` itself; it is a function now only so a prior season's
 * differently-sourced stats (`priorSeasonStats` below) can sit beside it as the other half of one
 * `season === PRODUCT_SEASON ? … : …` choice.
 */
async function currentSeasonStats(
  db: Db,
  playerId: string,
  position: Position,
  peerIds: readonly string[],
  played: readonly number[],
  rules: ScoringRules,
): Promise<PlayerSeasonStats> {
  const lines =
    peerIds.length === 0 || played.length === 0
      ? []
      : await db.select().from(playerStatLines).where(and(inArray(playerStatLines.playerId, peerIds), inArray(playerStatLines.week, played)));

  const weeks = weekViews(lines, played, playerId, position, rules);
  const mine = weeks.flatMap((week) => (week.points === null ? [] : [week.points]));
  const pointsPerGame = mine.length === 0 ? null : roundPoints(mine.reduce((sum, points) => sum + points, 0) / mine.length);
  const pointsPerGamePercentile = pointsPerGame === null ? null : percentileOf(pointsPerGame, peerPointsPerGame(lines, position, rules), "higher");

  const myLines = lines.filter((line) => line.playerId === playerId).sort((a, b) => b.week - a.week);
  const log: PlayerGameLogRow[] = myLines.map((line) => ({
    week: line.week,
    points: computeFantasyPoints(line, position, rules),
    carries: line.carries,
    rushingYards: line.rushingYards,
    targets: line.targets,
    receptions: line.receptions,
    receivingYards: line.receivingYards,
    passingYards: line.passingYards,
    touchdowns: line.rushingTouchdowns + line.receivingTouchdowns + line.passingTouchdowns,
  }));

  return { weeks, pointsPerGame, pointsPerGamePercentile, log, totals: totalsFromLog(log) };
}

/** Whether the point-in-time store has at least one recorded week for `gsisId` in `season` — the
 *  cheap presence check `availableSeasons` runs per candidate season, before anything pays for a
 *  whole position's peer population. One player id in the filter, so this is a primary-key-bounded
 *  read regardless of how big the season's own table has grown. */
async function priorSeasonHasData(db: Db, gsisId: string, season: number, asOf: Date): Promise<boolean> {
  const mine = await statLinesAsOfForLiveSurface(db, { season, week: { from: 1, to: finalWeekOf(season) }, asOf, playerIds: [gsisId] });
  return mine.length > 0;
}

/**
 * THE ACTUAL ROOKIE SIGNAL (fix round 1, CRITICAL) — never inferred from `availableSeasons` being
 * empty. Absence of data and rookie status are different facts: a real veteran the crosswalk has
 * not placed also has an empty `availableSeasons`, and answering him with "his first NFL season"
 * would be a biography claim this function has no way to back up. `nfl_players.rookie_season` is
 * fixed at the universe's own ingestion and is the authoritative "which season did this man enter
 * the league" fact this product carries — there is no product-side rookie flag on `players` itself
 * (checked: `players` has no draft-class column), so this is the one honest source, and it is
 * reachable ONLY through the crosswalk, which is exactly why a crosswalk miss must be its own
 * state rather than folded into this one.
 */
async function isConfirmedRookie(db: Db, gsisId: string, season: number): Promise<boolean> {
  const [row] = await db.select({ rookieSeason: nflPlayers.rookieSeason }).from(nflPlayers).where(eq(nflPlayers.id, gsisId));
  return row?.rookieSeason === season;
}

/**
 * A PRIOR season's stats, scored under THIS league's rules from the projection engine's own
 * point-in-time store — the same read `draft-service/player-history.ts`'s peek card makes
 * (`statLinesAsOfForLiveSurface`), never the live product's single-season table (which cannot even
 * name this season).
 *
 * The population is every historical person nflverse lists at this position, UNIONED WITH THE
 * PLAYER'S OWN id so he can never rank outside his own population — `player-history.ts`'s own
 * guarantee, carried over here for the identical reason. `week` runs `1..finalWeekOf(season)`: a
 * finished NFL season's own regular-season length, not this league's — the current season's own
 * `weeks` list is capped by the LEAGUE's schedule because a league week is a fact about matchups
 * that have not been played yet, and a prior season has no such future to cap against.
 */
async function priorSeasonStats(db: Db, gsisId: string, season: number, position: Position, rules: ScoringRules, asOf: Date): Promise<PlayerSeasonStats> {
  const positionPeers = await db.select({ id: nflPlayers.id }).from(nflPlayers).where(eq(nflPlayers.position, position));
  const peerIds = [...new Set([gsisId, ...positionPeers.map((peer) => peer.id)])];
  const lastWeek = finalWeekOf(season);
  const peerLines: readonly SeasonStatLine[] = await statLinesAsOfForLiveSurface(db, { season, week: { from: 1, to: lastWeek }, asOf, playerIds: peerIds });
  const lines = peerLines.map((row) => row.line);
  const everyWeek = Array.from({ length: lastWeek }, (_, index) => index + 1);

  const weeks = weekViews(lines, everyWeek, gsisId, position, rules);
  const mine = weeks.flatMap((week) => (week.points === null ? [] : [week.points]));
  const pointsPerGame = mine.length === 0 ? null : roundPoints(mine.reduce((sum, points) => sum + points, 0) / mine.length);
  const pointsPerGamePercentile = pointsPerGame === null ? null : percentileOf(pointsPerGame, peerPointsPerGame(lines, position, rules), "higher");

  const myLines = lines.filter((line) => line.playerId === gsisId).sort((a, b) => b.week - a.week);
  const log: PlayerGameLogRow[] = myLines.map((line) => ({
    week: line.week,
    points: computeFantasyPoints(line, position, rules),
    // THE STORE NEVER CARRIES THESE — see `PlayerGameLogRow`'s own docblock. `null`, not `0`.
    carries: null,
    rushingYards: line.rushingYards,
    targets: null,
    receptions: line.receptions,
    receivingYards: line.receivingYards,
    passingYards: line.passingYards,
    touchdowns: line.rushingTouchdowns + line.receivingTouchdowns + line.passingTouchdowns,
  }));

  return { weeks, pointsPerGame, pointsPerGamePercentile, log, totals: totalsFromLog(log) };
}

/**
 * The two preseason readings for one man: where the experts had him, where our board had him.
 *
 * ONE CROSSWALK LOOKUP GATES BOTH. A league player the crosswalk could not place has no gsis id,
 * and both stores are keyed on one, so there is nothing to look up and the honest answer to both
 * questions is `null`. There is no fallback by name here and there must never be one: the only
 * thing worse than a dash on a player's screen is another man's number on it.
 *
 * `asOf` is the caller's `now` and it is passed to both reads. That is the same `as_of <=` gate a
 * backtest uses, standing in the present rather than in 2023, which is what lets one store serve
 * the harness and the product without either of them holding a special case for the other.
 */
async function preseasonReadings(
  db: Db,
  playerId: string,
  asOf: Date,
): Promise<{ readonly expertRank: number | null; readonly modelRank: number | null; readonly reasons: readonly BoardReason[] }> {
  const nflPlayerId = await nflPlayerIdFor(db, playerId);
  if (nflPlayerId === null) return { expertRank: null, modelRank: null, reasons: [] };

  const season = PRODUCT_SEASON;
  // THE LOUD READ: refuses a board stitched together from more than one live generation, the same
  // way the writer's own retire discipline promises there never is one. See `assertSingleGeneration`.
  await assertSingleGeneration(db, { season, source: BOARD_SOURCE, asOf });
  const [consensus] = await preseasonRankingsFor(db, { season, source: BENCHMARK_SOURCES.ecr, asOf }, [nflPlayerId]);
  const [ours] = await preseasonProjectionsFor(db, { season, source: BOARD_SOURCE, asOf }, [nflPlayerId]);
  // Task 8's own Outlook section. `boardReasons` reads every reason the CURRENT season's board
  // stored (no `playerId` narrowing exists on that reader yet — see `board-store.ts`), so this
  // costs one whole-board read per player-season request rather than one row; acceptable for a
  // bottom-sheet peek opened one player at a time, flagged rather than "fixed" here since a
  // narrowed reader is outside this task's file list.
  const reasons = (await boardReasons(db, BOARD_SOURCE, season)).get(nflPlayerId) ?? [];
  return { expertRank: consensus?.rank ?? null, modelRank: ours?.rank ?? null, reasons };
}

/** His designation off the latest harvested injuries snapshot; `null` when the feed does not
 *  name him. One small read, latest row only. */
async function injuryDesignationFor(db: Db, playerId: string): Promise<string | null> {
  const [snapshot] = await db
    .select({ payload: captureSnapshots.payload })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, "tank01_injuries_by_date"))
    .orderBy(desc(captureSnapshots.capturedAt))
    .limit(1);
  const body = snapshot?.payload as Record<string, unknown> | undefined;
  const list = body?.injList;
  if (!Array.isArray(list)) return null;
  for (const raw of list) {
    const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    if (entry.playerID === playerId && typeof entry.designation === "string" && entry.designation !== "") return entry.designation;
  }
  return null;
}

/**
 * A player's whole season on one screen, read under one league's scoring rules.
 *
 * WHY THE LEAGUE IS A PARAMETER AND NOT A CONVENIENCE. A fantasy point is not a property of a
 * player, it is a property of a player inside a rule set: the same catch is 1.0 points in this
 * league and 0.5 in the one next door. There is no honest league-free version of this page, which
 * is why it lives under `/leagues/[leagueId]/` and why this function reads the league's own
 * `scoring_settings` row (falling back to the same `PPR_SCORING` default `matchupWeek` already
 * falls back to, for a league whose row has not been written) — for EVERY season this body can
 * show, a prior one included: see `priorSeasonStats`.
 *
 * ONLY WEEKS THAT HAPPENED. For the current season the gate is `stat_weeks.status`, never the
 * presence of a stat line, and the difference is not academic in this dataset: `player_stat_lines`
 * carries rows for all seventeen weeks while `stat_weeks` says thirteen have been played. A chart
 * built on the rows would draw four weeks of the future as results. The list is then capped by the
 * LEAGUE's own season length, so a fourteen-week league never draws a week it does not play. A
 * prior season has no such future to cap against and is instead bounded by the NFL's own finished
 * regular season (`finalWeekOf`) — see `priorSeasonStats`'s own docblock.
 *
 * SEASON SELECTION (2026-09-04 widening): `requestedSeason` is honoured only when it names a
 * season `availableSeasons` actually offers; otherwise the newest available season answers, which
 * is `PRODUCT_SEASON` once the league has played a week and the most recent PRIOR season for as
 * long as it has not — see `PlayerSeasonBody`'s own docblock for the full account.
 *
 * FOUR READS FOR THE DRAFT-OUTLOOK CELLS, and the one that could have been expensive is bounded:
 * for the CURRENT season, the peer stat lines are fetched by an id list at his position (four
 * hundred receivers, never sixteen hundred players) crossed with the played weeks, and BOTH
 * populations — every week at his position, and every peer's points per game — are folded out of
 * that single result rather than queried twice. A prior season pays the same shape of cost against
 * the observation store instead (`priorSeasonStats`), plus one cheap presence check per candidate
 * season while building `availableSeasons` (`priorSeasonHasData`, a single-id-bounded read).
 *
 * THE RANKING READS ARE BOUNDED TO ONE MAN BY CONSTRUCTION: the crosswalk is a primary-key
 * lookup and both `preseasonRankingsFor`/`preseasonProjectionsFor` reads take his single gsis id,
 * so nothing here loads a five-hundred-name board to find one row on it. Skipped entirely for a
 * player the crosswalk could not place, which is the cheap case as well as the correct one — and
 * the same crosswalk miss means he can offer no prior season either, by construction.
 * `boardReasons` (Task 8's Outlook read) is the one exception: it has no per-player narrowing
 * yet, so it reads every reason the season's board stored and this function keeps only his own —
 * see `preseasonReadings`'s own inline note.
 */
export async function playerSeason(
  db: Db,
  leagueId: string,
  playerId: string,
  clock: Clock = systemClock,
  requestedSeason?: number,
): Promise<PlayerSeasonBody | null> {
  const [row] = await db.select().from(players).where(eq(players.id, playerId));
  if (row === undefined) return null;
  const player: Player = {
    id: row.id,
    name: row.name,
    position: row.position,
    nflTeam: row.nflTeam,
    headshotUrl: row.headshotUrl,
    adp: row.adp,
  };
  const adp = player.adp;
  const now = new Date(clock.now());

  // Task 4 (context honesty): one cheap primary-key-bounded read, alongside every other
  // per-league fact this function already reads (`scoringSettings`, `matchups`).
  const [leagueRow] = await db.select({ isMock: leagues.isMock }).from(leagues).where(eq(leagues.id, leagueId));
  const isMockLeague = leagueRow?.isMock ?? false;

  const fixtures = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  const { totalWeeks } = seasonProgress(fixtures, LEAGUE_CONFIG.regularSeasonWeeks);
  const weekRows = await db.select({ week: statWeeks.week }).from(statWeeks).where(ne(statWeeks.status, "scheduled"));
  const played = weekRows.map((week) => week.week).filter((week) => week <= totalWeeks).sort((a, b) => a - b);

  const [settingsRow] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  const settings: ScoringSettings = settingsRow ?? { leagueId, ...PPR_SCORING };
  const rules: ScoringRules = settings;

  const everyone = await db.select({ id: players.id, position: players.position, adp: players.adp }).from(players);
  const peers = everyone.filter((other) => other.position === player.position);
  const rankedAll = everyone.flatMap((other) => (other.adp === null ? [] : [other.adp]));
  const peerIds = peers.map((peer) => peer.id);

  // SEASON AVAILABILITY. The current season counts once the league has played a week; a prior
  // season counts once the crosswalk places him AND the observation store has at least one
  // recorded week for him there — see `PlayerSeasonBody`'s own docblock for the full rule.
  const gsisId = (await nflPlayerIdsFor(db, [playerId])).get(playerId) ?? null;
  const priorCandidates = Array.from({ length: HISTORY_SEASONS }, (_, back) => PRODUCT_SEASON - (back + 1));
  const priorSeasonsWithData: number[] = [];
  if (gsisId !== null) {
    for (const candidate of priorCandidates) {
      if (await priorSeasonHasData(db, gsisId, candidate, now)) priorSeasonsWithData.push(candidate);
    }
  }
  const availableSeasons = [...(played.length > 0 ? [PRODUCT_SEASON] : []), ...priorSeasonsWithData];
  // `isRookie` is TRUE ROOKIE STATUS, not "nothing to show" — see `isConfirmedRookie`'s own
  // docblock. Only asked when there is nothing to show in the first place: a rookie who has
  // already played a week this season has a normal `availableSeasons` and needs no special
  // handling. A crosswalk miss with nothing to show falls through to neither branch, which is
  // the third, honest state ("no prior seasons on record") the body's own docblock describes.
  const isRookie = availableSeasons.length === 0 && gsisId !== null && (await isConfirmedRookie(db, gsisId, PRODUCT_SEASON));
  const season = requestedSeason !== undefined && availableSeasons.includes(requestedSeason) ? requestedSeason : (availableSeasons[0] ?? PRODUCT_SEASON);

  // `gsisId === null` is folded into this condition (rather than a non-null assertion below) so
  // TypeScript, not just this file's own logic, can see why `priorSeasonStats` never runs unplaced:
  // a season only ever reaches `priorSeasonsWithData` — and so only ever becomes `season` — once
  // the crosswalk has already placed him.
  const stats: PlayerSeasonStats =
    season === PRODUCT_SEASON || gsisId === null
      ? await currentSeasonStats(db, playerId, player.position, peerIds, played, rules)
      : await priorSeasonStats(db, gsisId, season, player.position, rules, now);

  const preseason = await preseasonReadings(db, playerId, now);

  const [holder] = await db
    .select({ teamName: teams.name })
    .from(rosterSlots)
    .innerJoin(teams, eq(teams.id, rosterSlots.teamId))
    .where(and(eq(teams.leagueId, leagueId), eq(rosterSlots.playerId, playerId)))
    .limit(1);
  const [injuryDesignation, news, capsule] = await Promise.all([injuryDesignationFor(db, playerId), newsFor(db, player.name), getPlayerCapsule(db, playerId)]);

  return {
    capsule,
    ownedBy: holder?.teamName ?? null,
    isMockLeague,
    injuryDesignation,
    log: stats.log,
    totals: stats.totals,
    news,
    player,
    availableSeasons,
    season,
    isRookie,
    positionRank: adp === null ? null : 1 + peers.filter((peer) => peer.adp !== null && peer.adp < adp).length,
    adpPercentile: adp === null ? null : percentileOf(adp, rankedAll, "lower"),
    expertRank: preseason.expertRank,
    modelRank: preseason.modelRank,
    pointsPerGame: stats.pointsPerGame,
    pointsPerGamePercentile: stats.pointsPerGamePercentile,
    weeks: stats.weeks,
    reasons: preseason.reasons,
    // Chip-eligible only (IMPORTANT 3 RULING, fix round; widened Task 8) — every tribal law plus
    // every CONFIRMED discovered one; see `chipEligibleLaws`'s own docblock.
    laws: chipEligibleLaws(registry()),
  };
}
