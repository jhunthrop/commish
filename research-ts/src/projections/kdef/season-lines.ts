import type { ReadonlyDb } from "@research-ts/db/client";
import type { StatLine } from "@research-ts/domain/player";
import { computeFantasyPoints, pointsAllowedBandIndex, pointsAllowedBands, roundPoints, type ScoringRules } from "@research-ts/scoring";
import { TANK01_CONFIG } from "@research-ts/stats/tank01/config";
import { nflPlayerIdsFor } from "@research-ts/projections/crosswalk";
import { kickingWeekRowsForSeasons, type KickingWeekRow } from "@research-ts/projections/nflverse/kicking-weeks";
import { productTeamCode, sourceTeamCode } from "@research-ts/projections/nflverse/team-codes";
import { teamDefenseWeekRowsForSeasons, type TeamDefenseWeekRow } from "@research-ts/projections/nflverse/team-defense-weeks";

/**
 * LAST SEASON FOR A KICKER AND A TEAM DEFENSE, SCORED UNDER ONE LEAGUE'S OWN RULES.
 *
 * WHY THIS MODULE EXISTS. Neither position ships a projection: both failed their preregistered
 * gates on 2025 (`docs/research/2026-09-05-kicker-defense-preregistration-results.md`, and
 * `KDEF_DECISION`), so the engine publishes nothing for either and every projection cell on their
 * board rows is honestly blank. That is the right answer to "what will he do". It is not an answer
 * to "what DID he do", and this product holds thirteen seasons of weekly history for both positions
 * (`nflverse_kicking_weeks`, `nflverse_team_defense_weeks`) that no surface was reading. A drafter
 * looking at a kicker tab of dashes learns nothing at all, when the archive can tell him exactly
 * what every one of those kickers scored last year under his own league's rules.
 *
 * IT IS A MEASUREMENT, NOT A PREDICTION, and every surface that renders it must say so. A season
 * total here is a record of games that were played. It carries no claim whatever about next season,
 * which is precisely the claim the preregistered gates refused to let this product make.
 *
 * ONE SCORING PATH, THE SAME ONE EVERY OTHER POINT ON THIS PRODUCT TAKES. A week becomes a
 * `StatLine` and the league's own `ScoringSettings` turn it into points through
 * `computeFantasyPoints`. There is no second arithmetic here and there must never be one: a kicker
 * whose season total on his card disagreed with the same season replayed through a lineup would be
 * two products.
 *
 * ABSENCE IS ABSENCE, three times over:
 *
 * - A week with NO ROW is not a week of zero. He was hurt, or on nobody's roster, or the club was on
 *   bye. `weeks` carries only the weeks the archive actually holds, and `games` counts those.
 * - A defense week whose `points_allowed` is NULL is scored WITHOUT the points-allowed tier
 *   (`computeFantasyPoints` reads an absent `pointsAllowed` as "not recorded", never as a shutout),
 *   and `weeksMissingPointsAllowed` says how many weeks that was, so a caller can state the gap
 *   rather than quietly serving a total built on fewer facts than it looks like.
 * - A player the archive holds nothing for gets NO ENTRY in the returned map, rather than an entry
 *   of zero points across zero games.
 *
 * TWO KEY SPACES MEET HERE, and neither is guessed at. A kicker is keyed by gsis id in the archive
 * and by the stats provider's id in the product, and `player_crosswalk` is the only edge between
 * them. A team defense has no person and therefore no gsis id at all: the archive keys it by
 * nflverse's team code and the product by `DST-<product code>`, so `team-codes.ts` folds the
 * archive's spelling onto the product's, which is also what makes a relocated franchise's old rows
 * land on today's club.
 */

/** One week of a kicker's or a team defense's season, scored. */
export interface KdefWeekLine {
  readonly week: number;
  readonly points: number;
  /** The raw line the points were computed from — so a surface can show the kicks and takeaways
   *  behind the number rather than only the number. */
  readonly line: StatLine;
}

/** A kicker's season in the terms a kicker is judged in. Every figure is a count of real kicks. */
export interface KickerSeasonFacts {
  readonly kind: "K";
  readonly fieldGoalsMade: number;
  readonly fieldGoalsAttempted: number;
  readonly extraPointsMade: number;
  readonly extraPointsAttempted: number;
  /** Makes and attempts inside each distance band, longest band last. */
  readonly distanceBands: readonly KickerDistanceBand[];
  /** The longest band he made a kick in, or `null` when he made none all season. NOT a longest
   *  make in yards: the archive publishes bands, not distances, and a single yardage figure here
   *  would be a precision this product does not hold. */
  readonly longestMadeBand: string | null;
}

export interface KickerDistanceBand {
  readonly label: string;
  readonly made: number;
  readonly attempted: number;
}

/** A team defense's season in the terms a team defense is judged in. */
export interface DefenseSeasonFacts {
  readonly kind: "DEF";
  readonly sacks: number;
  readonly interceptions: number;
  readonly fumbleRecoveries: number;
  /** Interceptions plus fumble recoveries, the one figure a manager calls takeaways. */
  readonly takeaways: number;
  readonly defensiveTouchdowns: number;
  readonly specialTeamsTouchdowns: number;
  readonly safeties: number;
  /** NET yards allowed (the opponent's passing yards minus their sack yardage, plus rushing), summed
   *  over the weeks that carry the sack-yardage term; `gamesWithYardsAllowed` says how many. */
  readonly yardsAllowed: number;
  readonly gamesWithYardsAllowed: number;
  /** Summed over the weeks that HAVE a points-allowed figure, and `null` when none do. */
  readonly pointsAllowed: number | null;
  readonly gamesWithPointsAllowed: number;
  /** How many of those games landed in each `pointsAllowedBands()` bracket, in the table's own
   *  order. Empty when no week carried a points-allowed figure. */
  readonly pointsAllowedBandGames: readonly PointsAllowedBandGames[];
}

export interface PointsAllowedBandGames {
  readonly label: string;
  readonly games: number;
}

/** One player's or one club's whole season, scored under the caller's rules. */
export interface KdefSeasonLine {
  /** The PRODUCT's id — the stats provider's id for a kicker, `DST-<code>` for a team defense. */
  readonly playerId: string;
  readonly position: "K" | "DEF";
  readonly season: number;
  readonly weeks: readonly KdefWeekLine[];
  readonly points: number;
  readonly games: number;
  readonly pointsPerGame: number;
  /** Team defenses only, and 0 for a kicker: weeks scored without the points-allowed tier because
   *  the archive holds no scoreline for them. See the module docblock. */
  readonly weeksMissingPointsAllowed: number;
  readonly facts: KickerSeasonFacts | DefenseSeasonFacts;
}

export interface KdefSeasonQuery {
  readonly season: number;
  /** Product ids. A kicker's provider id, a defense's `DST-<code>`, mixed freely. */
  readonly playerIds: readonly string[];
  readonly rules: ScoringRules;
}

/** The distance bands a kicker's season is reported in, and which archive columns feed each. */
const DISTANCE_BANDS: readonly { readonly label: string; readonly made: readonly (keyof KickingWeekRow)[]; readonly missed: readonly (keyof KickingWeekRow)[] }[] = [
  {
    label: "0 to 39",
    made: ["fieldGoalsMade0To19", "fieldGoalsMade20To29", "fieldGoalsMade30To39"],
    missed: ["fieldGoalsMissed0To19", "fieldGoalsMissed20To29", "fieldGoalsMissed30To39"],
  },
  { label: "40 to 49", made: ["fieldGoalsMade40To49"], missed: ["fieldGoalsMissed40To49"] },
  { label: "50 or more", made: ["fieldGoalsMade50To59", "fieldGoalsMade60Plus"], missed: ["fieldGoalsMissed50To59", "fieldGoalsMissed60Plus"] },
];

function sumOf<T>(rows: readonly T[], read: (row: T) => number): number {
  return rows.reduce((total, row) => total + read(row), 0);
}

/** A `StatLine` of all zeros for one week, which each position's own mapper then fills. Kept here
 *  so neither mapper can forget a field the scoring engine reads. */
function emptyLine(playerId: string, week: number): StatLine {
  return {
    playerId,
    week,
    passingYards: 0,
    passingTouchdowns: 0,
    interceptions: 0,
    rushingYards: 0,
    rushingTouchdowns: 0,
    receivingYards: 0,
    receivingTouchdowns: 0,
    receptions: 0,
    fumblesLost: 0,
    fieldGoalsMade: 0,
    extraPointsMade: 0,
    sacks: 0,
    defensiveInterceptions: 0,
    defensiveTouchdowns: 0,
  };
}

/** One archived kicking week as the scoring engine's own shape. */
function kickerLine(playerId: string, row: KickingWeekRow): StatLine {
  return {
    ...emptyLine(playerId, row.week),
    fieldGoalsMade: row.fieldGoalsMade,
    fieldGoalsMissed: row.fieldGoalsMissed,
    fieldGoalsAttempted: row.fieldGoalsAttempted,
    extraPointsMade: row.extraPointsMade,
    extraPointsMissed: row.extraPointsMissed,
  };
}

/**
 * One archived defense week as the scoring engine's own shape.
 *
 * `pointsAllowed` is OMITTED (not zeroed) when the archive has none — the optional field's absence
 * is exactly the "not recorded" signal `computeFantasyPoints` reads, and the tier goes unscored.
 *
 * THE COMBINED RETURN TOUCHDOWN. The release publishes one `special_teams_tds` figure while the
 * `StatLine` carries a kick-return and a punt-return field. The rules weight the two identically
 * (`pointsPerReturnTouchdown` multiplies their sum), so the combined figure rides on the kick-return
 * field and the punt-return field stays 0. The SUM, which is the only thing scoring reads, is exact;
 * the split, which nothing reads, is not claimed. Known asymmetry, on the record: the in-season
 * box-score mapper (`stats/tank01/map.ts`) writes no return-touchdown field for a team defense at
 * all, so the same event scores here and not in a live week until that mapper learns it.
 *
 * YARDS ALLOWED IS NET, the way a box score states it: the opponent's gross passing yards minus the
 * yards they lost to sacks, plus their rushing yards. A row written before the archive carried the
 * sack term (`sackYardsLostAllowed` null) OMITS the field, so the yards-allowed tier goes unscored
 * rather than scored off a gross figure that lands a bracket too high.
 */
function netYardsAllowed(row: TeamDefenseWeekRow): number | null {
  if (row.sackYardsLostAllowed === null) return null;
  return row.passingYardsAllowed - row.sackYardsLostAllowed + row.rushingYardsAllowed;
}

function defenseLine(playerId: string, row: TeamDefenseWeekRow): StatLine {
  const yardsAllowed = netYardsAllowed(row);
  return {
    ...emptyLine(playerId, row.week),
    sacks: row.sacks,
    defensiveInterceptions: row.interceptions,
    defensiveFumblesRecovered: row.fumbleRecoveries,
    defensiveTouchdowns: row.defensiveTouchdowns,
    safeties: row.safeties,
    kickReturnTouchdowns: row.specialTeamsTouchdowns,
    ...(yardsAllowed === null ? {} : { yardsAllowed }),
    ...(row.pointsAllowed === null ? {} : { pointsAllowed: row.pointsAllowed }),
  };
}

function kickerFacts(rows: readonly KickingWeekRow[]): KickerSeasonFacts {
  const distanceBands = DISTANCE_BANDS.map((band) => {
    const made = sumOf(rows, (row) => sumOf(band.made, (column) => Number(row[column])));
    const missed = sumOf(rows, (row) => sumOf(band.missed, (column) => Number(row[column])));
    return { label: band.label, made, attempted: made + missed };
  });
  const longest = [...distanceBands].reverse().find((band) => band.made > 0);
  return {
    kind: "K",
    fieldGoalsMade: sumOf(rows, (row) => row.fieldGoalsMade),
    fieldGoalsAttempted: sumOf(rows, (row) => row.fieldGoalsAttempted),
    extraPointsMade: sumOf(rows, (row) => row.extraPointsMade),
    extraPointsAttempted: sumOf(rows, (row) => row.extraPointsAttempted),
    distanceBands,
    longestMadeBand: longest?.label ?? null,
  };
}

function defenseFacts(rows: readonly TeamDefenseWeekRow[]): DefenseSeasonFacts {
  const scored = rows.flatMap((row) => (row.pointsAllowed === null ? [] : [row.pointsAllowed]));
  const bands = pointsAllowedBands();
  const counts = bands.map(() => 0);
  for (const pointsAllowed of scored) counts[pointsAllowedBandIndex(pointsAllowed)] += 1;
  const interceptions = sumOf(rows, (row) => row.interceptions);
  const fumbleRecoveries = sumOf(rows, (row) => row.fumbleRecoveries);
  return {
    kind: "DEF",
    sacks: roundPoints(sumOf(rows, (row) => row.sacks)),
    interceptions,
    fumbleRecoveries,
    takeaways: interceptions + fumbleRecoveries,
    defensiveTouchdowns: sumOf(rows, (row) => row.defensiveTouchdowns),
    specialTeamsTouchdowns: sumOf(rows, (row) => row.specialTeamsTouchdowns),
    safeties: sumOf(rows, (row) => row.safeties),
    yardsAllowed: sumOf(rows, (row) => netYardsAllowed(row) ?? 0),
    gamesWithYardsAllowed: rows.filter((row) => netYardsAllowed(row) !== null).length,
    pointsAllowed: scored.length === 0 ? null : scored.reduce((total, points) => total + points, 0),
    gamesWithPointsAllowed: scored.length,
    pointsAllowedBandGames: scored.length === 0 ? [] : bands.map((band, index) => ({ label: band.label, games: counts[index]! })),
  };
}

/** The season line one player's or one club's weeks add up to, once each week is scored. */
function seasonLineOf(
  playerId: string,
  position: "K" | "DEF",
  season: number,
  weeks: readonly KdefWeekLine[],
  weeksMissingPointsAllowed: number,
  facts: KickerSeasonFacts | DefenseSeasonFacts,
): KdefSeasonLine {
  const points = roundPoints(weeks.reduce((total, week) => total + week.points, 0));
  const games = weeks.length;
  return {
    playerId,
    position,
    season,
    weeks: [...weeks].sort((a, b) => a.week - b.week),
    points,
    games,
    pointsPerGame: roundPoints(points / games),
    weeksMissingPointsAllowed,
    facts,
  };
}

/** Product ids to gsis ids, for the kickers among `playerIds` — a team defense never resolves one
 *  and never needs to. */
async function kickerGsisIds(db: ReadonlyDb, playerIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const prefix = TANK01_CONFIG.defensePlayerIdPrefix;
  const candidates = playerIds.filter((playerId) => !playerId.startsWith(prefix));
  if (candidates.length === 0) return new Map();
  return nflPlayerIdsFor(db, candidates);
}

/** Every archived kicking week for the requested kickers, grouped by their PRODUCT id. */
async function kickerSeasonLines(db: ReadonlyDb, { season, playerIds, rules }: KdefSeasonQuery): Promise<readonly KdefSeasonLine[]> {
  const gsisByProductId = await kickerGsisIds(db, playerIds);
  if (gsisByProductId.size === 0) return [];
  const wanted = new Map([...gsisByProductId].map(([productId, gsisId]) => [gsisId, productId] as const));

  const rowsByProductId = new Map<string, KickingWeekRow[]>();
  for (const row of await kickingWeekRowsForSeasons(db, [season], [...wanted.keys()])) {
    const productId = wanted.get(row.playerId);
    if (productId === undefined) continue;
    const list = rowsByProductId.get(productId);
    if (list === undefined) rowsByProductId.set(productId, [row]);
    else list.push(row);
  }

  return [...rowsByProductId].map(([productId, rows]) => {
    const weeks = rows.map((row) => {
      const line = kickerLine(productId, row);
      return { week: row.week, points: computeFantasyPoints(line, "K", rules), line };
    });
    return seasonLineOf(productId, "K", season, weeks, 0, kickerFacts(rows));
  });
}

/** Every archived defense week for the requested clubs, grouped by their PRODUCT id. */
async function defenseSeasonLines(db: ReadonlyDb, { season, playerIds, rules }: KdefSeasonQuery): Promise<readonly KdefSeasonLine[]> {
  const prefix = TANK01_CONFIG.defensePlayerIdPrefix;
  const wanted = new Set(playerIds.filter((playerId) => playerId.startsWith(prefix)));
  if (wanted.size === 0) return [];

  const rowsByProductId = new Map<string, TeamDefenseWeekRow[]>();
  const sourceCodes = [...wanted].map((productId) => sourceTeamCode(productId.slice(prefix.length)));
  for (const row of await teamDefenseWeekRowsForSeasons(db, [season], sourceCodes)) {
    const productId = `${prefix}${productTeamCode(row.team)}`;
    if (!wanted.has(productId)) continue;
    const list = rowsByProductId.get(productId);
    if (list === undefined) rowsByProductId.set(productId, [row]);
    else list.push(row);
  }

  return [...rowsByProductId].map(([productId, rows]) => {
    const weeks = rows.map((row) => {
      const line = defenseLine(productId, row);
      return { week: row.week, points: computeFantasyPoints(line, "DEF", rules), line };
    });
    const missing = rows.filter((row) => row.pointsAllowed === null).length;
    return seasonLineOf(productId, "DEF", season, weeks, missing, defenseFacts(rows));
  });
}

/**
 * Which of `seasons` the archive holds at least one week of for ONE kicker or team defense, newest
 * first. One narrow, index-backed read per table rather than one whole-season scan per candidate
 * season, which is what the player page asks on every open.
 */
export async function kdefSeasonsHeld(db: ReadonlyDb, playerId: string, seasons: readonly number[]): Promise<readonly number[]> {
  const prefix = TANK01_CONFIG.defensePlayerIdPrefix;
  const rows = playerId.startsWith(prefix)
    ? await teamDefenseWeekRowsForSeasons(db, seasons, [sourceTeamCode(playerId.slice(prefix.length))])
    : await kickerRowsFor(db, playerId, seasons);
  return [...new Set(rows.map((row) => row.season))].sort((a, b) => b - a);
}

async function kickerRowsFor(db: ReadonlyDb, playerId: string, seasons: readonly number[]): Promise<readonly KickingWeekRow[]> {
  const gsisId = (await kickerGsisIds(db, [playerId])).get(playerId);
  return gsisId === undefined ? [] : kickingWeekRowsForSeasons(db, seasons, [gsisId]);
}

/**
 * One season of measured history for a set of kickers and team defenses, keyed by PRODUCT id.
 *
 * A player the archive holds no week for is simply absent from the map — see the module docblock's
 * absence rules. Kickers and team defenses may be asked for together; the two are read separately
 * because they live in different tables and different id spaces, and merged on the way out.
 */
export async function kdefSeasonLines(db: ReadonlyDb, query: KdefSeasonQuery): Promise<ReadonlyMap<string, KdefSeasonLine>> {
  if (query.playerIds.length === 0) return new Map();
  const [kickers, defenses] = await Promise.all([kickerSeasonLines(db, query), defenseSeasonLines(db, query)]);
  return new Map([...kickers, ...defenses].map((line) => [line.playerId, line] as const));
}
