import type { ReadonlyDb } from "@/db/client";
import { STAT_FIELDS, type Position, type StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@/scoring/compute";
import { statLinesAsOf, statMetricName, STAT_LINE_SOURCE, type SeasonStatLine } from "../lines";
import { spearman, type Observation } from "../metrics";
import type { ObservationQuery, PlayerWeekObservation } from "../store";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";
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

/** The columns this aggregation adds to the stream `pbp.ts`/`pbp-players.ts` already ask for. */
export const DERIVED_STAT_LINE_COLUMNS: readonly string[] = [
  "passer_player_id",
  "passing_yards",
  "pass_touchdown",
  "interception",
  "rusher_player_id",
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
 */
export function deriveStatLines(
  lines: readonly DerivedPlayerWeekLine[],
  asOfFor: (line: DerivedPlayerWeekLine) => Date,
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
    statLines.push({ season: tally.season, asOf: asOfFor(tally), line });
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
 * `statLinesAsOf` itself is untouched: every other caller (preseason, `projection-fit.ts`, the
 * report scripts) keeps reading exactly what it always read — nothing, for a gap season, because
 * nflverse published nothing there. That is deliberate: derived rows exist for MEASUREMENT and must
 * never render on a product surface, so the fallback is opt-in, one function, one caller
 * (`laws/populations.ts`'s `seasonScoring`) — not a change to the shared reader every surface goes
 * through.
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
 */
export interface SeasonPointsAgreement {
  readonly rankCorrelation: number | null;
  readonly sampleSize: number;
}

interface SeasonPoints {
  readonly points: number;
  readonly games: number;
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
  for (const [playerId, derivedEntry] of derived) {
    const publishedEntry = published.get(playerId);
    if (publishedEntry === undefined) continue;
    if (Math.min(derivedEntry.games, publishedEntry.games) < minGames) continue;
    observations.push({ predicted: derivedEntry.points, actual: publishedEntry.points });
  }
  return { rankCorrelation: spearman(observations), sampleSize: observations.length };
}
