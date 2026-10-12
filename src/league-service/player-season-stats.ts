// ONE SEASON OF A PLAYER'S CARD, AS PURE ARITHMETIC (peek document round, 2026-09-07).
//
// Extracted from `player.ts` unchanged. It has TWO readers now and that is the whole reason it
// moved: the peek document writer builds these numbers offline for every board player under every
// scoring hash in use, and the request path hydrates what the writer stored. A second copy of the
// percentile rule or of the "did not play is not a zero" rule would be a second answer to the same
// question, and nothing in the data would say which of the two a manager was looking at.
//
// NOTHING HERE TOUCHES A DATABASE. The caller hands over the lines it already read.
import type { Position, StatLine } from "@research-ts/domain/player";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@research-ts/scoring";
import type { KdefSeasonLine } from "@research-ts/projections/kdef/season-lines";

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

/** The five fields that vary by which season is being shown — everything else in
 *  `PlayerSeasonBody` (the draft outlook cells, ownership, injury, news) is season-independent.
 *  See `PlayerSeasonBody`'s own docblock. */
export interface PlayerSeasonStats {
  readonly weeks: readonly PlayerWeekView[];
  readonly pointsPerGame: number | null;
  readonly pointsPerGamePercentile: number | null;
  readonly log: readonly PlayerGameLogRow[];
  readonly totals: PlayerSeasonTotals | null;
  /** Set only on the kicker and team defense path — see `PlayerSeasonBody.kdefSeason`. */
  readonly kdefSeason?: KdefSeasonLine;
}

/**
 * Where `value` sits in `population`, 0..1, with 1 the best in the set.
 *
 * A population of fewer than two is not a population and returns `null` rather than a percentile
 * of 0.5 that would tint a number against nothing — the same refusal `Stat` makes for an unstated
 * comparison, kept here so the two cannot disagree.
 *
 * `better` decides which direction is up, because the caller has both: more fantasy points is
 * better and a LOWER draft position is better, and a single "higher wins" helper would have
 * silently ranked the best player in the league last.
 */
export function percentileOf(value: number, population: readonly number[], better: "higher" | "lower"): number | null {
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
 * `lines` are `StatLine`s rather than one store's own row shape, so this and `peerPointsPerGame`
 * below serve BOTH stat-store shapes the card reads from: the current season's DB rows (which
 * structurally satisfy `StatLine` — every optional harvest field present as a real, defaulted
 * number) and a prior season's `SeasonStatLine.line` read from the observation store (which does not
 * carry those optional fields at all). Neither function reads the optional fields, so the shape
 * difference is invisible to both.
 */
export function weekViews(lines: readonly StatLine[], played: readonly number[], playerId: string, position: Position, rules: ScoringRules): readonly PlayerWeekView[] {
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
export function peerPointsPerGame(lines: readonly StatLine[], position: Position, rules: ScoringRules): readonly number[] {
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
export function totalsFromLog(log: readonly PlayerGameLogRow[]): PlayerSeasonTotals | null {
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

/** The mean of the weeks he actually played, or `null` for a season with none. */
export function pointsPerGameOf(weeks: readonly PlayerWeekView[]): number | null {
  const played = weeks.flatMap((week) => (week.points === null ? [] : [week.points]));
  if (played.length === 0) return null;
  return roundPoints(played.reduce((sum, points) => sum + points, 0) / played.length);
}

export interface SeasonStatsFromLinesInput {
  /** Every line at this position for this season, his own included. */
  readonly lines: readonly StatLine[];
  /** The weeks the chart draws, in order. */
  readonly played: readonly number[];
  readonly playerId: string;
  readonly position: Position;
  readonly rules: ScoringRules;
  /**
   * Whether the source behind `lines` can honestly fill carries and targets. `true` for the current
   * season's `player_stat_lines` rows, whose columns are always present; `false` for the
   * point-in-time observation store, which never carries them for any season. See
   * `PlayerGameLogRow`'s own docblock.
   */
  readonly touchesKnown: boolean;
}

/**
 * ONE SEASON'S CHART, LOG AND TOTALS from lines the caller already holds.
 *
 * This is the shape both the current season's live table and a prior season's observation store
 * end up in, which is why it is one function: the two paths differ in WHERE the lines come from and
 * in whether the source knows a carry, and in nothing else at all.
 */
export function seasonStatsFromLines(input: SeasonStatsFromLinesInput): PlayerSeasonStats {
  const weeks = weekViews(input.lines, input.played, input.playerId, input.position, input.rules);
  const pointsPerGame = pointsPerGameOf(weeks);
  const pointsPerGamePercentile =
    pointsPerGame === null ? null : percentileOf(pointsPerGame, peerPointsPerGame(input.lines, input.position, input.rules), "higher");

  const mine = input.lines.filter((line) => line.playerId === input.playerId).sort((a, b) => b.week - a.week);
  const log: readonly PlayerGameLogRow[] = mine.map((line) => ({
    week: line.week,
    points: computeFantasyPoints(line, input.position, input.rules),
    carries: input.touchesKnown ? (line.carries ?? null) : null,
    rushingYards: line.rushingYards,
    targets: input.touchesKnown ? (line.targets ?? null) : null,
    receptions: line.receptions,
    receivingYards: line.receivingYards,
    passingYards: line.passingYards,
    touchdowns: line.rushingTouchdowns + line.receivingTouchdowns + line.passingTouchdowns,
  }));

  return { weeks, pointsPerGame, pointsPerGamePercentile, log, totals: totalsFromLog(log) };
}

/**
 * A KICKER'S OR A TEAM DEFENSE'S SEASON, from the archive that actually holds it.
 *
 * NO PERCENTILE, DELIBERATELY. Every other percentile on this screen is measured against a
 * population this path would have to build by reading every kicker's or every club's season, and a
 * comparison it cannot back with a real population is one it should not draw. A `null` percentile
 * renders as ordinary ink, which is `Stat`'s own "no comparison, no colour".
 *
 * NO GAME LOG, for the reason `PlayerSeasonBody.log` gives: its nine columns are offensive ones.
 * The season is told by `kdefSeason` and the role module built from it instead.
 */
export function kdefSeasonStatsFrom(line: KdefSeasonLine | undefined, finalWeek: number): PlayerSeasonStats {
  const everyWeek = Array.from({ length: finalWeek }, (_, index) => index + 1);
  const pointsByWeek = new Map((line?.weeks ?? []).map((week) => [week.week, week.points] as const));
  return {
    weeks: everyWeek.map((week) => ({ week, points: pointsByWeek.get(week) ?? null, percentile: null })),
    pointsPerGame: line?.pointsPerGame ?? null,
    pointsPerGamePercentile: null,
    log: [],
    totals: null,
    ...(line === undefined ? {} : { kdefSeason: line }),
  };
}
