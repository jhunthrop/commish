import type { ReadonlyDb } from "@/db/client";
import { STAT_FIELDS, type Position, type StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@/scoring/compute";
import { statLinesAsOf, statMetricName, STAT_LINE_SOURCE, type SeasonStatLine } from "../lines";
import { meanAbsoluteError, spearman, type Observation } from "../metrics";
import type { ObservationQuery, PlayerWeekObservation } from "../store";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";
import { kickoffAsOf } from "./schedule";
import { STAT_LINE_GAPS } from "./stat-lines";

/**
 * THE GAP FILL — stat-line OUTCOMES derived from play-by-play, for the one season (2019) nflverse
 * never published a weekly stats file for.
 *
 * A SEPARATE aggregator from `pbp-players.ts`'s touches, on purpose, even though both read the same
 * stream: that file's docblock is explicit that carries/targets/red-zone share are FEATURES, built
 * on a "designed carry" definition (no scrambles) chosen for the O-line composite's sake. A
 * `StatLine` is an OUTCOME — the same distinction `stat-lines.ts`'s own docblock draws for the
 * published mapper — and outcomes use the REAL definition of a rushing attempt, scrambles included,
 * because a scrambling quarterback's fifteen yards count in every scoring rule set and every box
 * score there is. Mixing the two conventions into one aggregator would either flatter the line
 * composite with credit for a broken pass play or shortchange a scrambling quarterback's own line,
 * and there would be no way to tell from the numbers alone which mistake had been made.
 *
 * ONLY THE NINE FIELDS PBP CAN ATTRIBUTE TO A PERSON. `fieldGoalsMade`, `extraPointsMade`, `sacks`,
 * `defensiveInterceptions` and `defensiveTouchdowns` are left at zero here for exactly the reason
 * `stat-lines.ts`'s own `NFLVERSE_COLUMN` leaves them at zero for the published mapper: Phase 1
 * projects `QB/RB/WR/TE` only, and this product's defensive scoring is a team `DEF`, not a person a
 * play-by-play row ever names. A derived line and a published line therefore have IDENTICAL zero
 * fields, which is exactly what makes the season-points comparison below a fair one — neither side
 * is missing a component the other has.
 */

/** The second source id — never mixed with `STAT_LINE_SOURCE` rows. See `stat-lines.ts`'s docblock
 *  on `STAT_LINE_GAPS` for why this file, not `laws/config.ts`, owns the gap-season list too. */
export const DERIVED_STAT_LINE_SOURCE = "nflverse_pbp_derived";

/**
 * EVERY COLUMN `DerivedStatLineAggregator.add` READS, SELF-SUFFICIENT — not a delta against
 * `pbp.ts`/`pbp-players.ts`'s own column lists.
 *
 * A fix-round review caught the bug this shape exists to prevent: the first version of this list
 * omitted `two_point_attempt` because `pbp.ts`'s `PBP_COLUMNS` (unioned in by `ingest.ts`) happened
 * to cover most of what `add()` needed, so the gap went unnoticed by both the code and its own unit
 * tests — the tests built `CsvRow`s by hand with every field present, which cannot catch a column
 * the real stream never requests. Declaring the FULL list here, on the aggregator itself
 * (`DerivedStatLineAggregator.COLUMNS`, aliased below for callers that only want the array), makes
 * "does the stream carry everything `add()` reads" answerable by reading one array instead of
 * cross-referencing three files, and lets a test build rows from exactly this list to prove it.
 */
const READ_COLUMNS: readonly string[] = [
  "season",
  "week",
  "season_type",
  "game_date",
  "play_type",
  "two_point_attempt",
  "passer_player_id",
  "passing_yards",
  "pass_touchdown",
  "interception",
  "rusher_player_id",
  "rush_attempt",
  "qb_kneel",
  "rushing_yards",
  "rush_touchdown",
  "receiver_player_id",
  "receiving_yards",
  "complete_pass",
  "fumble_lost",
  "fumbled_1_player_id",
];

/** One player's accumulated stat-line components for one week, before the universe gates it. */
interface DerivedTally {
  season: number;
  week: number;
  playerId: string;
  passingYards: number;
  passingTouchdowns: number;
  interceptions: number;
  rushingYards: number;
  rushingTouchdowns: number;
  receivingYards: number;
  receivingTouchdowns: number;
  receptions: number;
  fumblesLost: number;
  gameDate: string;
}

/** The player-week components the store holds, once the tallies are finished. */
export interface DerivedPlayerWeekLine {
  readonly season: number;
  readonly week: number;
  readonly playerId: string;
  readonly passingYards: number;
  readonly passingTouchdowns: number;
  readonly interceptions: number;
  readonly rushingYards: number;
  readonly rushingTouchdowns: number;
  readonly receivingYards: number;
  readonly receivingTouchdowns: number;
  readonly receptions: number;
  readonly fumblesLost: number;
  /** `YYYY-MM-DD` of the game, which the caller turns into an `as_of`. */
  readonly gameDate: string;
}

function flag(row: CsvRow, column: string): boolean {
  return row[column] === "1";
}

function numberOrNull(row: CsvRow, column: string): number | null {
  const raw = row[column];
  if (raw === undefined || raw.trim() === "" || raw === "NA") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function identifier(row: CsvRow, column: string): string | null {
  const raw = row[column];
  if (raw === undefined || raw.trim() === "" || raw === "NA") return null;
  return raw;
}

/**
 * Accumulates streamed plays into one tally per player-week. Feed it every row; it keeps nothing
 * else. The ids are GSIS ids, the same identity `pbp-players.ts` joins on — see that file's own
 * docblock for why nothing here consults the crosswalk.
 */
export class DerivedStatLineAggregator {
  /** The aggregator's own declaration of what it reads from the stream — see `READ_COLUMNS`'s
   *  docblock for why this lives on the class rather than as a hand-maintained list elsewhere. */
  static readonly COLUMNS: readonly string[] = READ_COLUMNS;

  private readonly tallies = new Map<string, DerivedTally>();

  private tallyFor(season: number, week: number, playerId: string, gameDate: string): DerivedTally {
    const key = `${season}|${week}|${playerId}`;
    const existing = this.tallies.get(key);
    if (existing !== undefined) return existing;
    const fresh: DerivedTally = {
      season,
      week,
      playerId,
      passingYards: 0,
      passingTouchdowns: 0,
      interceptions: 0,
      rushingYards: 0,
      rushingTouchdowns: 0,
      receivingYards: 0,
      receivingTouchdowns: 0,
      receptions: 0,
      fumblesLost: 0,
      gameDate,
    };
    this.tallies.set(key, fresh);
    return fresh;
  }

  add(row: CsvRow): void {
    if (row.season_type !== NFLVERSE_CONFIG.seasonType) return;
    const season = numberOrNull(row, "season");
    const week = numberOrNull(row, "week");
    if (season === null || week === null) return;
    // Two-point conversions are tracked as their own stat upstream and are not part of any
    // `STAT_FIELDS` this domain scores (see `StatLine.twoPointConversions`, deliberately outside
    // that list) — excluding them keeps a derived rushing/receiving/passing total on the same
    // convention the published weekly file uses.
    if (flag(row, "two_point_attempt")) return;

    const gameDate = row.game_date ?? "";

    const passer = identifier(row, "passer_player_id");
    if (passer !== null) {
      const tally = this.tallyFor(season, week, passer, gameDate);
      tally.passingYards += numberOrNull(row, "passing_yards") ?? 0;
      if (flag(row, "pass_touchdown")) tally.passingTouchdowns += 1;
      if (flag(row, "interception")) tally.interceptions += 1;
    }

    // Every rush attempt, SCRAMBLES INCLUDED, and never a kneel — the real definition of a rushing
    // attempt, not `pbp-players.ts`'s "designed carry" one. See this file's own docblock.
    const rusher = identifier(row, "rusher_player_id");
    if (rusher !== null && flag(row, "rush_attempt") && !flag(row, "qb_kneel")) {
      const tally = this.tallyFor(season, week, rusher, gameDate);
      tally.rushingYards += numberOrNull(row, "rushing_yards") ?? 0;
      if (flag(row, "rush_touchdown")) tally.rushingTouchdowns += 1;
    }

    const receiver = identifier(row, "receiver_player_id");
    if (receiver !== null && row.play_type === "pass") {
      const tally = this.tallyFor(season, week, receiver, gameDate);
      tally.receivingYards += numberOrNull(row, "receiving_yards") ?? 0;
      if (flag(row, "complete_pass")) tally.receptions += 1;
      // A passing touchdown is always a completion, so the receiver on this same play is the one
      // who scored it.
      if (flag(row, "pass_touchdown")) tally.receivingTouchdowns += 1;
    }

    if (flag(row, "fumble_lost")) {
      const fumbler = identifier(row, "fumbled_1_player_id");
      if (fumbler !== null) {
        const tally = this.tallyFor(season, week, fumbler, gameDate);
        tally.fumblesLost += 1;
      }
    }
  }

  /** The finished tallies, sorted so a store write is deterministic. */
  lines(): readonly DerivedPlayerWeekLine[] {
    return [...this.tallies.values()]
      .sort((a, b) => a.season - b.season || a.week - b.week || a.playerId.localeCompare(b.playerId))
      .map((tally) => ({ ...tally }));
  }
}

/**
 * Callers that just want the array without touching the class — `ingest.ts` streams these into
 * `client.streamCsv`. Identical to `DerivedStatLineAggregator.COLUMNS` (same array reference).
 */
export const DERIVED_STAT_LINE_COLUMNS: readonly string[] = DerivedStatLineAggregator.COLUMNS;

/**
 * WEEK-MAX AS-OF — mirroring `map.ts`'s `weekAsOfFromSnapCounts`, not stamping from each play's own
 * game date (I6, fix round: "stand-ins mirror the thing they stand in for").
 *
 * A derived row stands in for a row the published weekly file would have carried, and that file is
 * released once a week, after the week's LAST game finishes — `weekAsOfFromSnapCounts`'s own
 * docblock: "a week's stats are not complete until its Monday night game is over — dating the week
 * from its Thursday opener would make four days of results visible to a replay before they
 * existed." Stamping each player from his OWN game's kickoff (this function's first version) broke
 * that discipline: a Thursday-night player's derived line would have become visible to a replay up
 * to four days before the equivalent published file ever would have, which is a leak in miniature —
 * earlier than the source it stands in for, not merely a different one.
 */
export function weekAsOfFromDerivedLines(
  lines: readonly DerivedPlayerWeekLine[],
  lagHours: number = NFLVERSE_CONFIG.publicationLagHours,
): ReadonlyMap<number, Date> {
  const byWeek = new Map<number, Date>();
  for (const line of lines) {
    const stamp = kickoffAsOf(line.gameDate, lagHours);
    const known = byWeek.get(line.week);
    if (known === undefined || stamp > known) byWeek.set(line.week, stamp);
  }
  return byWeek;
}

export interface DeriveStatLinesResult {
  readonly statLines: readonly SeasonStatLine[];
  /** Everyone the play-by-play attributed a stat to that the universe does not project. Named and
   *  counted, never silently dropped — the same discipline `playerTouchObservations` uses. */
  readonly unknownPlayers: readonly string[];
}

/**
 * Tallies to `SeasonStatLine`s, gated by the universe.
 *
 * A `StatLine` is a total map over `STAT_FIELDS` — `stat-lines.ts`'s own mapper is written that way
 * so a new stat field fails to compile there instead of silently arriving as zero, and this mirrors
 * it: the five fields play-by-play cannot attribute to a person are spelled out at zero rather than
 * left to a spread's default.
 *
 * `weekAsOf` takes a MAP rather than a per-line callback — `weekAsOfFromDerivedLines`'s own
 * docblock explains why every player in a week must share one stamp, on `stat-lines.ts`'s
 * `mapStatLines` precedent: a fact whose as-of cannot be found THROWS rather than defaulting to a
 * stamp of its own, because a week this function is given a tally for but no as-of for is a caller
 * bug (the map was not built from the same `lines`), not a legitimately-unknowable moment.
 */
export function deriveStatLines(
  lines: readonly DerivedPlayerWeekLine[],
  weekAsOf: ReadonlyMap<number, Date>,
  /** GSIS ids the store knows about. A stat attributed to anybody else is reported, never stored. */
  known: ReadonlySet<string>,
): DeriveStatLinesResult {
  const unknown = new Set<string>();
  const statLines: SeasonStatLine[] = [];
  for (const tally of lines) {
    if (!known.has(tally.playerId)) {
      unknown.add(tally.playerId);
      continue;
    }
    const asOf = weekAsOf.get(tally.week);
    if (asOf === undefined) {
      throw new Error(
        `No as-of is known for week ${tally.week}; weekAsOf must come from weekAsOfFromDerivedLines built on these same lines.`,
      );
    }
    const line: StatLine = {
      playerId: tally.playerId,
      week: tally.week,
      passingYards: tally.passingYards,
      passingTouchdowns: tally.passingTouchdowns,
      interceptions: tally.interceptions,
      rushingYards: tally.rushingYards,
      rushingTouchdowns: tally.rushingTouchdowns,
      receivingYards: tally.receivingYards,
      receivingTouchdowns: tally.receivingTouchdowns,
      receptions: tally.receptions,
      fumblesLost: tally.fumblesLost,
      fieldGoalsMade: 0,
      extraPointsMade: 0,
      sacks: 0,
      defensiveInterceptions: 0,
      defensiveTouchdowns: 0,
    };
    statLines.push({ season: tally.season, asOf, line });
  }
  return { statLines, unknownPlayers: [...unknown].sort() };
}

/**
 * Flattens derived lines into store rows, exactly on `stat-lines.ts`'s `statLineObservations`
 * pattern — every stat field, zeros included — but stamped under `DERIVED_STAT_LINE_SOURCE` so a
 * reader can never mistake one for a published fact.
 */
export function derivedStatLineObservations(rows: readonly SeasonStatLine[]): readonly PlayerWeekObservation[] {
  return rows.flatMap(({ season, line, asOf }) =>
    STAT_FIELDS.map((field) => ({
      season,
      week: line.week,
      playerId: line.playerId,
      source: DERIVED_STAT_LINE_SOURCE,
      metric: statMetricName(field),
      value: line[field],
      asOf,
    })),
  );
}

/**
 * THE ADMISSION WRAPPER — the one seam where a pbp-derived row is allowed to stand in for a
 * published one, and the only one.
 *
 * `statLinesAsOf` itself is untouched: every caller that never invokes this wrapper (preseason's
 * outcome reads, `projection-fit.ts`, the report scripts) keeps reading exactly what it always
 * read — nothing, for a gap season, because nflverse published nothing there.
 *
 * FIX ROUND, C2: this function is NOT gated to one caller by construction — anything that calls it
 * gets the fallback. The gate that matters lives one level up, at `laws/populations.ts`'s
 * `seasonScoring`, which takes an explicit `admitDerived: boolean` and calls this function only when
 * `true`. `buildPopulations` (the laws harness) passes `true` for both the predictor and the outcome
 * read. An earlier version of this file's docblock claimed "one caller" as if that were still true
 * after `factsForSeason` was reused outside the laws harness; it was not, and the explicit boolean is
 * what makes the claim true again — by construction, not by every future caller happening to
 * remember.
 *
 * `preseason/source.ts`'s `loadPreseason` is the OTHER consumer, and what it passes is CONDITIONAL,
 * not `false` (this docblock said `false` unconditionally until the final fix round, which was true
 * of every board built before the live arm existed and false afterwards). It passes
 * `admitsDerivedPriorSeason(momentKind, priorSeason)` — `false` on every replay board and on every
 * prior season outside `LIVE_ADMITTED_DERIVED_SEASONS`, so a replay board still never mixes a derived
 * row into a history it is otherwise reading published-only; `true` for a LIVE board whose prior
 * season nflverse never published at all, where the alternative is not a published number but no
 * number. `loadPreseason` calls this function DIRECTLY for that season's outcome history as well,
 * through the same predicate.
 *
 * For a non-gap season this returns precisely what `statLinesAsOf` alone would have; a published row
 * always wins over a derived one for the same week and player, though in practice the two sources
 * never overlap (nflverse either published a season or it did not).
 */
export async function statLinesAsOfForMeasurement(
  db: ReadonlyDb,
  query: Omit<ObservationQuery, "source">,
): Promise<readonly SeasonStatLine[]> {
  const published = await statLinesAsOf(db, query, STAT_LINE_SOURCE);
  if (!STAT_LINE_GAPS.includes(query.season)) return published;
  const derived = await statLinesAsOf(db, query, DERIVED_STAT_LINE_SOURCE);
  const publishedKeys = new Set(published.map((row) => `${row.line.week}|${row.line.playerId}`));
  return [...published, ...derived.filter((row) => !publishedKeys.has(`${row.line.week}|${row.line.playerId}`))];
}

/**
 * THE VALIDATION BAR — season points from a derivation, ranked against season points from the
 * published line it is trying to replace, restricted to players with real sample size.
 *
 * Fewer than `minGames` and one flukey week (a garbage-time score, a single mis-attributed fumble)
 * can swing a season total enough to reorder two players who otherwise agree completely — the
 * correlation would then be measuring noise in the shallow end of the pool rather than the
 * derivation's own accuracy. Restricting to real starters is what makes 0.99 a meaningful bar rather
 * than an easy one: the players it is measured over are exactly the ones a law's population — and a
 * manager's lineup — actually cares about ordering correctly.
 *
 * Pure and I/O-free like every function in `metrics.ts`, on purpose: the spec requires this exact
 * comparison to run twice — once against fixtures in a test, once for real inside the backfill
 * script — and a function that needed a database could only be the second of those.
 *
 * FIX ROUND, I1: the rank correlation alone answers "does the ORDER agree" but not "how far off is a
 * given player's total" or "is the derivation finding the same GAMES the published file found" — both
 * of which a 0.9999 correlation can hide (a correlation is insensitive to a constant per-player bias,
 * and to games found or missed as long as the ranking survives it). `meanAbsoluteError` (points) and
 * `gamesDelta` (derived games played minus published games played, over the same matched,
 * `minGames`-filtered player set the correlation is measured over) are reported alongside it so the
 * backfill script's validation run has more than one number to judge the derivation by.
 */
export interface SeasonPointsAgreement {
  readonly rankCorrelation: number | null;
  readonly sampleSize: number;
  /** Points, same units as `effect` on `/player-laws` — how far a derived season's total strayed
   *  from the published one, on average, over the matched sample. */
  readonly meanAbsoluteError: number | null;
  /** `derivedGames - publishedGames`, over the matched sample. Zero everywhere means the derivation
   *  found a stat line in exactly the weeks the published file did; a nonzero mean means it is
   *  finding (or missing) games the published file does not (or does). */
  readonly gamesDelta: { readonly min: number; readonly max: number; readonly mean: number; readonly exactMatches: number };
}

interface SeasonPoints {
  readonly points: number;
  readonly games: number;
}

/**
 * THE SANITY REPORT — for a gap season with no published twin of its own (2025, and any future live
 * season nflverse has not yet published `stats_player_week_<season>.csv` for). `seasonPointsAgreement`
 * above answers "does the derivation agree with a published season" and needs a published line to
 * agree WITH; a live gap season has none, so asking that question of it can only ever produce either
 * a refusal or a fabricated number standing in for one. This reports SHAPE instead: how many derived
 * rows landed each week, what the games-per-player distribution looks like against a real published
 * season's own distribution, and how the derived rows split by position. None of it is an agreement
 * bar — nothing here is scored against a threshold, and there is deliberately no field a caller could
 * mistake for a correlation or a pass/fail (see the docstring on the type itself).
 *
 * Pure, like every function in this file: `scripts/projection-backfill.ts` builds `comparisonLines`
 * from a published season already in the store and passes both seasons' lines straight through.
 */
export interface PositionMixEntry {
  readonly position: Position;
  readonly rows: number;
  readonly share: number;
}

/**
 * Fixed bucket edges rather than data-derived quantiles: a season's real range is well known (a
 * seventeen-game regular season, playoffs excluded by `NFLVERSE_CONFIG.seasonType`), so two
 * different seasons' distributions can be read side by side in identical buckets, and a season with
 * zero players still reports a full, legible shape instead of an empty list.
 */
const GAMES_BUCKETS: ReadonlyArray<{ readonly label: string; readonly min: number; readonly max: number }> = [
  { label: "1-4", min: 1, max: 4 },
  { label: "5-8", min: 5, max: 8 },
  { label: "9-12", min: 9, max: 12 },
  { label: "13-17", min: 13, max: 17 },
  { label: "18+", min: 18, max: Infinity },
];

export interface GamesDistribution {
  readonly playerCount: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
  readonly buckets: ReadonlyArray<{ readonly label: string; readonly count: number }>;
}

function gamesPerPlayer(lines: readonly SeasonStatLine[]): number[] {
  const counts = new Map<string, number>();
  for (const { line } of lines) {
    counts.set(line.playerId, (counts.get(line.playerId) ?? 0) + 1);
  }
  return [...counts.values()].sort((a, b) => a - b);
}

function gamesDistribution(lines: readonly SeasonStatLine[]): GamesDistribution {
  const counts = gamesPerPlayer(lines);
  const playerCount = counts.length;
  if (playerCount === 0) {
    return { playerCount: 0, min: 0, max: 0, mean: 0, median: 0, buckets: GAMES_BUCKETS.map(({ label }) => ({ label, count: 0 })) };
  }
  const total = counts.reduce((sum, games) => sum + games, 0);
  const mid = Math.floor(playerCount / 2);
  const median = playerCount % 2 === 0 ? (counts[mid - 1]! + counts[mid]!) / 2 : counts[mid]!;
  return {
    playerCount,
    min: counts[0]!,
    max: counts[playerCount - 1]!,
    mean: total / playerCount,
    median,
    buckets: GAMES_BUCKETS.map(({ label, min, max }) => ({
      label,
      count: counts.filter((games) => games >= min && games <= max).length,
    })),
  };
}

/** Sorted by row count descending, so the printed report reads most-represented position first. A
 *  stat-taker the position map does not carry is dropped rather than counted under an invented
 *  position — the same discipline `seasonPointsByPlayer` already applies. */
function positionMix(lines: readonly SeasonStatLine[], positions: ReadonlyMap<string, Position>): readonly PositionMixEntry[] {
  const counts = new Map<Position, number>();
  let total = 0;
  for (const { line } of lines) {
    const position = positions.get(line.playerId);
    if (position === undefined) continue;
    counts.set(position, (counts.get(position) ?? 0) + 1);
    total += 1;
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([position, rows]) => ({ position, rows, share: rows / total }));
}

function weeklyRowCounts(lines: readonly SeasonStatLine[]): ReadonlyArray<{ readonly week: number; readonly rows: number }> {
  const counts = new Map<number, number>();
  for (const { line } of lines) {
    counts.set(line.week, (counts.get(line.week) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([week, rows]) => ({ week, rows }));
}

/**
 * NO AGREEMENT FIELD, BY CONSTRUCTION. This type has no `rankCorrelation`, no `meanAbsoluteError`, no
 * pass/fail — unlike `SeasonPointsAgreement` above, which exists to hold exactly those. A gap season
 * with no published twin has nothing to be scored against, and adding a field here that LOOKED like
 * one would be the fabrication this report exists to refuse.
 */
export interface DerivedSeasonSanityReport {
  readonly season: number;
  /** The published season the games-distribution SHAPE is read beside — never averaged or diffed
   *  against `season`'s own rows, since the two describe different players. */
  readonly comparisonSeason: number;
  readonly weeklyRowCounts: ReadonlyArray<{ readonly week: number; readonly rows: number }>;
  readonly positionMix: readonly PositionMixEntry[];
  readonly gamesDistribution: GamesDistribution;
  readonly comparisonGamesDistribution: GamesDistribution;
}

export function derivedSeasonSanityReport(
  season: number,
  derivedLines: readonly SeasonStatLine[],
  comparisonSeason: number,
  comparisonLines: readonly SeasonStatLine[],
  positions: ReadonlyMap<string, Position>,
): DerivedSeasonSanityReport {
  return {
    season,
    comparisonSeason,
    weeklyRowCounts: weeklyRowCounts(derivedLines),
    positionMix: positionMix(derivedLines, positions),
    gamesDistribution: gamesDistribution(derivedLines),
    comparisonGamesDistribution: gamesDistribution(comparisonLines),
  };
}

function seasonPointsByPlayer(
  lines: readonly SeasonStatLine[],
  positions: ReadonlyMap<string, Position>,
  rules: ScoringRules,
): Map<string, SeasonPoints> {
  const out = new Map<string, SeasonPoints>();
  for (const { line } of lines) {
    const position = positions.get(line.playerId);
    if (position === undefined) continue;
    const existing = out.get(line.playerId) ?? { points: 0, games: 0 };
    out.set(line.playerId, {
      points: roundPoints(existing.points + computeFantasyPoints(line, position, rules)),
      games: existing.games + 1,
    });
  }
  return out;
}

const DEFAULT_MINIMUM_GAMES = 8;

export function seasonPointsAgreement(
  derivedLines: readonly SeasonStatLine[],
  publishedLines: readonly SeasonStatLine[],
  positions: ReadonlyMap<string, Position>,
  options?: { readonly rules?: ScoringRules; readonly minGames?: number },
): SeasonPointsAgreement {
  const rules = options?.rules ?? PPR_SCORING;
  const minGames = options?.minGames ?? DEFAULT_MINIMUM_GAMES;
  const derived = seasonPointsByPlayer(derivedLines, positions, rules);
  const published = seasonPointsByPlayer(publishedLines, positions, rules);

  const observations: Observation[] = [];
  const gameDeltas: number[] = [];
  for (const [playerId, derivedEntry] of derived) {
    const publishedEntry = published.get(playerId);
    if (publishedEntry === undefined) continue;
    if (Math.min(derivedEntry.games, publishedEntry.games) < minGames) continue;
    observations.push({ predicted: derivedEntry.points, actual: publishedEntry.points });
    gameDeltas.push(derivedEntry.games - publishedEntry.games);
  }
  return {
    rankCorrelation: spearman(observations),
    sampleSize: observations.length,
    meanAbsoluteError: meanAbsoluteError(observations),
    gamesDelta:
      gameDeltas.length === 0
        ? { min: 0, max: 0, mean: 0, exactMatches: 0 }
        : {
            min: Math.min(...gameDeltas),
            max: Math.max(...gameDeltas),
            mean: gameDeltas.reduce((sum, delta) => sum + delta, 0) / gameDeltas.length,
            exactMatches: gameDeltas.filter((delta) => delta === 0).length,
          },
  };
}
