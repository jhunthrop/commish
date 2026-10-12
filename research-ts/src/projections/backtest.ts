import type { ReadonlyDb } from "@research-ts/db/client";
import { nflPlayers } from "@research-ts/db/schema";
import type { Position, StatLine } from "@research-ts/domain/player";
import { projectedPosition } from "./nflverse/players";
import { computeFantasyPoints, type ScoringRules } from "@research-ts/scoring/compute";
import { statLinesAsOf, type SeasonStatLine } from "./lines";
import { predictOpportunity, type OpportunityPriors } from "./model/opportunity";
import { firstRosterSeasonsThrough } from "./preseason/store";
import { observationsAsOf, LAST_POSSIBLE_WEEK, type PlayerWeekObservation } from "./store";
import { playerTeamsAsOf, teamObservationsAsOf } from "./team-store";
import { latestTeams, type TeamContext } from "./team-context";
import { usageAsOf, type PlayerWeekUsage } from "./usage";
import { INJURY_SOURCE } from "./news/retrieve";
import { rankBandFor, scoreCard, RANK_BANDS, type Observation, type RankBandName, type ScoreCard } from "./metrics";

/**
 * THE BACKTEST. Replays a season a week at a time, showing a projection source only what existed
 * before that week's games, and scores what it said against what happened.
 *
 * This is the instrument the whole phase exists to build. Everything the engine will ever claim —
 * that a feature earns its place, that the news pass adds something, that we beat the market — is
 * answered here or it is not answered. And the single way this instrument can lie is by letting
 * the future in: one stray column stamped after kickoff and the model looks brilliant and is
 * worthless, and by the time anyone notices, every measurement ever taken is suspect.
 *
 * So there is exactly one path from the store into a source's hands — `statLinesAsOf`, carrying
 * the `as_of <= …` predicate — and this module never queries observations any other way. The
 * ACTUALS are read separately and deliberately without that gate, because an outcome is what
 * really happened, including a correction published afterwards; those two reads are the only two,
 * and they are a few lines apart so the difference between them is visible rather than buried.
 */

/** Everything a source is allowed to know when projecting one week. */
export interface ProjectionInput {
  readonly season: number;
  readonly week: number;
  /** The replay moment. Nothing stamped after this reached `history`, by construction. */
  readonly asOf: Date;
  /** Every outcome knowable at `asOf`, this season and the seasons before it. */
  readonly history: readonly SeasonStatLine[];
  /**
   * Every player's OPPORTUNITY knowable at `asOf`, over the same span — snap, target, carry and
   * pass-attempt shares beside the team volumes they were taken against.
   *
   * Read here rather than by the source, and through `usageAsOf`, so that the single as-of gate
   * still governs everything a source can see. A source that opened its own connection would be a
   * second path from the store into a projection, and a leak on a second path looks exactly like a
   * very good model.
   */
  readonly usage: readonly PlayerWeekUsage[];
  /** From `nfl_players`, narrowed. A player absent here is one the engine cannot score. */
  readonly positions: ReadonlyMap<string, Position>;
  /**
   * Everything KNOWABLE ABOUT THE TEAMS at `asOf` — Phase 3's context layers and nothing else reads
   * it. Read here, through the same two point-in-time functions, for the same reason `usage` is: a
   * source that opened its own connection would be a second path from the store into a projection.
   */
  readonly teamContext: TeamContext;
  /**
   * PLAYER-LEVEL FACTS ABOUT THE WEEK BEING PREDICTED that a publisher filed before it — the news
   * pass reads this and nothing else reads it.
   *
   * The only place in this instrument where a source is shown a row carrying the TARGET week's own
   * number, and the justification is exactly the one `teamContext.teamObservations` already relies
   * on: an injury designation is a fact ABOUT the coming game, published before it, and the `as_of`
   * gate is what separates that from a fact produced BY it. Bounded by the gate alone, with no week
   * bound, because a week bound would hide the only rows that make the feature possible.
   *
   * Narrowed to the injury feed rather than left open. Every other player-level source in the store
   * is a record of a game that has been played, and admitting them here without a week bound would
   * be a second path for a result to reach a projection — the one failure this module exists to make
   * impossible.
   */
  readonly news: readonly PlayerWeekObservation[];
  /**
   * A player's first season with a stamped week-one roster row (Task 1's historical backfill),
   * OPTIONAL: only the weekly model's experience term (`model/efficiency.ts`) reads it, and only
   * where `priors.efficiency.experienceMultiplier` is also set. Omitted, that term is a no-op. Never
   * gated by `asOf` — see `firstRosterSeasonsThrough`'s own docblock for why a debut season carries
   * no later, truer version to prefer.
   */
  readonly firstRosterSeason?: ReadonlyMap<string, number>;
}

export interface ProjectionSource {
  /** How this source appears on a scoreboard. */
  readonly name: string;
  project(input: ProjectionInput): readonly StatLine[] | Promise<readonly StatLine[]>;
}

export interface ReplayOptions {
  readonly season: number;
  readonly weeks: readonly number[];
  readonly source: ProjectionSource;
  /** The league's real scoring. A projection is components; points are a composition of them. */
  readonly rules: ScoringRules;
  /**
   * The moment week W is replayed from — everything stamped later is invisible to the source.
   *
   * REQUIRED and injected, never derived in here. The honest moment is a fact about the real
   * world (when did the previous week's numbers land) and the caller holds it, having ingested the
   * data. A default computed from the store would be a guess dressed as a guarantee, and this is
   * the one parameter in the engine where a plausible-looking guess is worse than no answer.
   */
  readonly asOfForWeek: (week: number) => Date;
  /**
   * THE PER-PLAYER MOMENT, optional: when HIS OWN game kicks off, by the club he plays for.
   *
   * `asOfForWeek` above gates the history — the completed weeks a source reasons from — and one
   * instant is the right shape for that, because week W-1's numbers land on the Tuesday and every
   * player in week W sees the same ones. It is the wrong shape for a fact filed DURING the week.
   * A whole-week moment must precede Thursday night's kickoff, the league files most of its injury
   * report on the Friday, and `docs/research/2026-08-27-model-v3.md` measured what that costs: four
   * fifths of the wire is unreachable by any whole-week moment whatsoever.
   *
   * So the pre-game feeds are gated per player instead, at the morning of the game HE plays in.
   * Nothing stamped after that instant reaches his projection, which is the same guarantee as
   * before, drawn where the real world draws it. Omitted, every player is gated at the week moment
   * and the harness behaves exactly as it did.
   *
   * A club with no game that week returns null and its players fall back to the week moment, and
   * the player moment is never allowed to be EARLIER than the week moment, so no arm of an ablation
   * can be made worse off by turning this on.
   */
  readonly asOfForPlayerGame?: (week: number, team: string) => Date | null;
  /** How many seasons back a source may look, counting the season being replayed. Default 2. */
  readonly historySeasons?: number;
}

export interface BandedScore {
  readonly overall: ScoreCard;
  /** Every band, always — an empty one reports a zero sample rather than going missing. */
  readonly byRankBand: Readonly<Record<RankBandName, ScoreCard>>;
}

export interface WeekReplay extends BandedScore {
  readonly week: number;
  readonly asOf: Date;
}

export interface ReplayResult extends BandedScore {
  readonly source: string;
  readonly weeks: readonly WeekReplay[];
}

/**
 * The moment the actuals are read at: far past any real correction.
 *
 * The actual is what a player REALLY did, which includes a stat correction published a week later.
 * A backtest that scored against the numbers briefly believed on Sunday night would be measuring
 * how well a projection predicted a typo. This is the one read in the module that intentionally
 * has no as-of gate, and it is a named constant so that is impossible to miss.
 */
const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

const DEFAULT_HISTORY_SEASONS = 2;

/** One scored player, carrying the band its projected rank put it in. */
interface BandedObservation extends Observation {
  readonly band: RankBandName;
}

function emptyCard(): ScoreCard {
  return { rankCorrelation: null, meanAbsoluteError: null, rootMeanSquaredError: null, sampleSize: 0 };
}

function scoreBanded(entries: readonly BandedObservation[]): BandedScore {
  const byRankBand = Object.fromEntries(
    RANK_BANDS.map((band) => {
      const inBand = entries.filter((entry) => entry.band === band.name);
      return [band.name, inBand.length === 0 ? emptyCard() : scoreCard(inBand)];
    }),
  ) as Record<RankBandName, ScoreCard>;
  return { overall: entries.length === 0 ? emptyCard() : scoreCard(entries), byRankBand };
}

/**
 * Which band a scored player counts in: the band its own PROJECTED rank put it in.
 *
 * Banding by projected rank answers the question a manager actually acts on — "of the players this
 * source called deep, how well did it order them?" — and it is knowable before the games, which
 * banding by outcome would not be. The cost is that two sources' bands hold different players, so
 * a band-by-band comparison between sources is indicative rather than exact. The fix is to band by
 * a COMMON prior (ADP), and that arrives with the ADP benchmark; until then this is the honest
 * approximation and this note is the record that it is one.
 */
function bandByProjectedRank(projections: readonly { playerId: string; points: number }[]): ReadonlyMap<string, RankBandName> {
  return new Map(
    [...projections]
      .sort((a, b) => b.points - a.points)
      .map((projection, index) => [projection.playerId, rankBandFor(index + 1)] as const),
  );
}

/**
 * Position comes from the HISTORICAL universe (`nfl_players`), not from `players`.
 *
 * `players` is a current roster snapshot, so scoring a 2021 replay through it would silently drop
 * every player who has since retired — the same defect that made a Phase 1 backfill lose ten points
 * of coverage per season going backwards (Phase 2, Task 1). A player whose universe position does
 * not narrow to one this product scores (a centre, a linebacker) is omitted rather than guessed at,
 * and omission here means excluded from BOTH the projections and the actuals, so the comparison
 * stays over the same set of people.
 */
export async function allPositions(db: ReadonlyDb): Promise<ReadonlyMap<string, Position>> {
  const rows = await db.select({ id: nflPlayers.id, position: nflPlayers.position }).from(nflPlayers);
  return new Map(
    rows
      .map((row) => [row.id, projectedPosition(row.position)] as const)
      .filter((entry): entry is readonly [string, Position] => entry[1] !== null),
  );
}

/** One replayed week, before any scoring: what each source said, and what really happened. */
interface WeekOutcome {
  readonly week: number;
  readonly asOf: Date;
  /** Projected points per player, one map per source, in the order the sources were given. */
  readonly projected: readonly ReadonlyMap<string, number>[];
  readonly actual: ReadonlyMap<string, number>;
  /**
   * The players this week that a SEGMENT restricts scoring to, or `null` for all of them.
   *
   * Computed once per week from the same `ProjectionInput` every source was handed, never per
   * source: a segment that saw different data from the sources it is dividing would be selecting
   * on something other than the situation it claims to name.
   */
  readonly segment: ReadonlySet<string> | null;
}

/**
 * THE TARGET WEEK'S TEAM FACTS, gated per CLUB at that club's own kickoff.
 *
 * The other half of the per-player moment, and the half that makes the closing line measurable at
 * all. `schedule.ts` stamps a line at the instant its game kicks off, so a whole-week moment — which
 * must precede the week's earliest kickoff — can never see ANY line for the week it is projecting.
 * Phase 3 recorded the betting line as unmeasurable for exactly that reason and refused to fake a
 * date rather than move the moment.
 *
 * Gated per club rather than per player because a line is a fact about a GAME, and every player in
 * that game shares its kickoff. What a reader should hold against this: the list handed to a source
 * is flat, so a club whose game kicks off on Thursday can in principle see a Sunday club's line
 * inside it. No layer reads another club's kickoff fact — the game-context layer reads the player's
 * own line and the opponent's defensive rating, and the latter is built from completed weeks — but
 * the bound is stated rather than assumed away.
 */
async function teamFactsForTargetWeek(
  db: ReadonlyDb,
  season: number,
  week: number,
  weekMoment: Date,
  asOfForPlayerGame: ((week: number, team: string) => Date | null) | undefined,
): Promise<readonly TeamContext["teamObservations"][number][]> {
  const span = { season, week: { from: week, to: week } } as const;
  const atWeekMoment = await teamObservationsAsOf(db, { ...span, asOf: weekMoment });
  if (asOfForPlayerGame === undefined) return atWeekMoment;

  // Every club with a game this week is already visible here: the schedule half of its row was
  // published in May, months before any replay moment.
  const momentOf = (team: string): number => {
    const kickoff = asOfForPlayerGame(week, team);
    return kickoff === null ? weekMoment.getTime() : Math.max(weekMoment.getTime(), kickoff.getTime());
  };
  const moments = new Set(atWeekMoment.map((row) => momentOf(row.team)));

  const facts: TeamContext["teamObservations"][number][] = [];
  for (const moment of [...moments].sort((a, b) => a - b)) {
    const rows = await teamObservationsAsOf(db, { ...span, asOf: new Date(moment) });
    for (const row of rows) {
      if (momentOf(row.team) !== moment) continue;
      if (row.asOf.getTime() > moment) {
        throw new Error(
          `A ${season} week ${week} projection would see a ${row.team} fact stamped ${row.asOf.toISOString()}, after that club's own kickoff ${new Date(moment).toISOString()}.`,
        );
      }
      facts.push(row);
    }
  }
  return facts;
}

/**
 * THE INJURY WIRE, GATED PER PLAYER at the morning of his own game.
 *
 * Read once per DISTINCT moment rather than once at the latest of them and filtered afterwards, and
 * the difference is not an optimisation. `observationsAsOf` returns the latest statement of a fact
 * at or before the moment it is given: reading at Sunday and discarding a row for a Thursday player
 * would discard his SUNDAY statement and leave him with nothing, when the honest answer is his
 * Thursday one. There are at most a handful of distinct kickoff days in a week, so this is a
 * handful of queries and the only construction that is correct.
 *
 * A player's club is the latest one his own history carries, which is what every other layer here
 * uses and the only answer knowable before kickoff — this season's week-`week` team row is stamped
 * from the game that has not been played yet.
 */
async function newsPerPlayer(
  db: ReadonlyDb,
  season: number,
  week: number,
  weekMoment: Date,
  asOfForPlayerGame: ((week: number, team: string) => Date | null) | undefined,
  teamContext: TeamContext,
): Promise<readonly PlayerWeekObservation[]> {
  if (asOfForPlayerGame === undefined) {
    return observationsAsOf(db, { season, week, asOf: weekMoment, source: INJURY_SOURCE });
  }

  const teams = latestTeams(teamContext);
  const momentOf = (playerId: string): number => {
    const team = teams.get(playerId);
    const kickoff = team === undefined ? null : asOfForPlayerGame(week, team);
    // Never earlier than the whole-week moment, so switching this on cannot take data away from an
    // arm that had it. A club with no game this week has no kickoff of its own to be gated at.
    return kickoff === null ? weekMoment.getTime() : Math.max(weekMoment.getTime(), kickoff.getTime());
  };

  const moments = new Set<number>([weekMoment.getTime()]);
  for (const playerId of teams.keys()) moments.add(momentOf(playerId));

  const wire: PlayerWeekObservation[] = [];
  for (const moment of [...moments].sort((a, b) => a - b)) {
    const rows = await observationsAsOf(db, { season, week, asOf: new Date(moment), source: INJURY_SOURCE });
    for (const row of rows) {
      if (momentOf(row.playerId) !== moment) continue;
      // The guarantee, asserted rather than argued: nothing a player is shown may be stamped after
      // his own kickoff. `observationsAsOf` already enforces it; this is the second lock, because a
      // leak here would not fail anything, it would simply make the news pass look better.
      if (row.asOf.getTime() > moment) {
        throw new Error(
          `A ${season} week ${week} projection for ${row.playerId} would see a designation stamped ${row.asOf.toISOString()}, after his own game moment ${new Date(moment).toISOString()}.`,
        );
      }
      wire.push(row);
    }
  }
  return wire;
}

/**
 * Replays every week once, showing EVERY source the identical history.
 *
 * One pass rather than one pass per source, and that is not only an optimisation: two sources
 * scored from two separate passes could in principle be shown different data — a store written
 * between the passes, a clock read twice — and the whole point of a head-to-head is that the only
 * difference between the two columns is the model.
 */
async function replayWeeks(
  db: ReadonlyDb,
  season: number,
  weeks: readonly number[],
  sources: readonly ProjectionSource[],
  rules: ScoringRules,
  asOfForWeek: (week: number) => Date,
  asOfForPlayerGame: ((week: number, team: string) => Date | null) | undefined,
  historySeasons: number,
  segment?: (input: ProjectionInput) => ReadonlySet<string>,
): Promise<readonly WeekOutcome[]> {
  // Ascending, whatever order the caller listed them in: a replay that ran week 3 before week 2
  // would still be leak-free (each week's own as-of gate holds) but the scoreboard would read as
  // though the season happened out of order, and a stateful source would be shown history backwards.
  const inOrder = [...weeks].sort((a, b) => a - b);
  const earliestSeason = season - historySeasons + 1;
  // Read once, outside the loop. Position is the one fact in this instrument that carries no as-of
  // and never will: a man's position is not restated by a Sunday-night stat correction, and reading
  // it per week would be eighteen identical queries pretending to be a point-in-time read.
  const positions = await allPositions(db);
  // Also read once, outside the loop, and for the same reason: a debut season does not move once it
  // has happened, so re-reading it per week would be eighteen identical queries.
  const firstRosterSeason = await firstRosterSeasonsThrough(db, season);
  const outcomes: WeekOutcome[] = [];

  for (const week of inOrder) {
    const asOf = asOfForWeek(week);
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
      throw new Error(`No replay moment is known for ${season} week ${week}; a week cannot be replayed from a guessed date.`);
    }

    // History: every season the source may see, up to the week BEFORE the one being projected,
    // and nothing stamped after the replay moment. Both bounds matter — the as-of gate alone would
    // still admit a pre-kickoff fact about this week, which is not what "history" means.
    const history: SeasonStatLine[] = [];
    const usage: PlayerWeekUsage[] = [];
    const playerTeams: TeamContext["playerTeams"][number][] = [];
    const teamObservations: TeamContext["teamObservations"][number][] = [];
    for (let historySeason = earliestSeason; historySeason <= season; historySeason += 1) {
      const upTo = historySeason === season ? week - 1 : LAST_POSSIBLE_WEEK;
      if (upTo >= 1) {
        const span = { season: historySeason, week: { from: 1, to: upTo }, asOf } as const;
        history.push(...(await statLinesAsOf(db, span)));
        usage.push(...(await usageAsOf(db, span)));
        playerTeams.push(...(await playerTeamsAsOf(db, span)));
      }
      // Team facts reach into the week being predicted and are bounded by the as-of gate alone.
      // The schedule half of them was published in May and is genuinely knowable; the kickoff half
      // is gated per club by `teamFactsForTargetWeek`. See `TeamContext` for why a week bound here
      // would have hidden both.
      if (historySeason === season) {
        if (week > 1) {
          teamObservations.push(
            ...(await teamObservationsAsOf(db, { season, week: { from: 1, to: week - 1 }, asOf })),
          );
        }
        teamObservations.push(...(await teamFactsForTargetWeek(db, season, week, asOf, asOfForPlayerGame)));
      } else {
        teamObservations.push(
          ...(await teamObservationsAsOf(db, { season: historySeason, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf })),
        );
      }
    }
    const teamContext: TeamContext = { playerTeams, teamObservations };

    const pointsOf = (line: StatLine): number | null => {
      const position = positions.get(line.playerId);
      return position === undefined ? null : computeFantasyPoints(line, position, rules);
    };
    const asPoints = (lines: readonly StatLine[]): ReadonlyMap<string, number> => {
      const points = new Map<string, number>();
      for (const line of lines) {
        const value = pointsOf(line);
        if (value !== null) points.set(line.playerId, value);
      }
      return points;
    };

    const news = await newsPerPlayer(db, season, week, asOf, asOfForPlayerGame, teamContext);
    const input: ProjectionInput = { season, week, asOf, history, usage, positions, teamContext, news, firstRosterSeason };
    const projected: ReadonlyMap<string, number>[] = [];
    for (const source of sources) {
      projected.push(asPoints(await source.project(input)));
    }
    const actuals = await statLinesAsOf(db, { season, week, asOf: FINAL_OUTCOME });
    outcomes.push({
      week,
      asOf,
      projected,
      actual: asPoints(actuals.map((row) => row.line)),
      segment: segment?.(input) ?? null,
    });
  }
  return outcomes;
}

/**
 * Scores one source over the weeks already replayed, optionally narrowed to a set of players.
 *
 * `eligible` is what makes a head-to-head fair. Without it, a source that has an opinion about more
 * players is scored over a different population than the one it is being compared to — and since
 * the extra players are overwhelmingly low scorers who are easy to order correctly, a broader source
 * can post a higher rank correlation on breadth alone. Both numbers are worth having, so both are
 * reported; neither is worth having on its own.
 */
function scoreSource(
  name: string,
  outcomes: readonly WeekOutcome[],
  index: number,
  eligible?: (outcome: WeekOutcome) => ReadonlySet<string>,
): ReplayResult {
  const weekReplays: WeekReplay[] = [];
  const pooled: BandedObservation[] = [];

  for (const outcome of outcomes) {
    const allowed = eligible?.(outcome);
    const projectedPoints = [...outcome.projected[index]!.entries()]
      .filter(([playerId]) => allowed === undefined || allowed.has(playerId))
      .map(([playerId, points]) => ({ playerId, points }));
    const bands = bandByProjectedRank(projectedPoints);

    // Only players with BOTH a projection and an outcome are scored, and `sampleSize` carries how
    // many that was. Scoring a source over the players it chose to have an opinion about is what
    // stops a narrow, cautious source looking better than a comprehensive one.
    const entries: BandedObservation[] = projectedPoints
      .filter((entry) => outcome.actual.has(entry.playerId))
      .map((entry) => ({
        predicted: entry.points,
        actual: outcome.actual.get(entry.playerId)!,
        band: bands.get(entry.playerId)!,
      }));

    pooled.push(...entries);
    weekReplays.push({ week: outcome.week, asOf: outcome.asOf, ...scoreBanded(entries) });
  }

  return { source: name, weeks: weekReplays, ...scoreBanded(pooled) };
}

export async function replay(
  db: ReadonlyDb,
  { season, weeks, source, rules, asOfForWeek, asOfForPlayerGame, historySeasons = DEFAULT_HISTORY_SEASONS }: ReplayOptions,
): Promise<ReplayResult> {
  const outcomes = await replayWeeks(db, season, weeks, [source], rules, asOfForWeek, asOfForPlayerGame, historySeasons);
  return scoreSource(source.name, outcomes, 0);
}

export interface HeadToHeadOptions extends Omit<ReplayOptions, "source"> {
  /** Two or more sources, shown identical history and scored by identical code. */
  readonly sources: readonly ProjectionSource[];
  /**
   * Narrows scoring to the players a SITUATION applies to — the post-transaction segment, the
   * rookies, the returning starters.
   *
   * The engine spec's learning loop asks "where are we wrong, and what would fix that segment?"
   * rather than "which feature matters most", and a pooled number cannot answer it. A feature that
   * fixes exactly the situation it was built for and is neutral everywhere else is a success whose
   * overall figure barely moves, and without this it would be discarded.
   */
  readonly segment?: (input: ProjectionInput) => ReadonlySet<string>;
}

export interface HeadToHead {
  /** Each source over the players IT had an opinion about — the number it earns on its own terms. */
  readonly full: readonly ReplayResult[];
  /** Each source over only the players EVERY source projected — the like-for-like comparison. */
  readonly common: readonly ReplayResult[];
}

/**
 * Two or more sources over one season, scored both on their own terms and like for like.
 *
 * The like-for-like column exists because breadth flatters rank correlation. A model that projects
 * every player who has taken a snap is scored over hundreds of extra low-scoring player-weeks that
 * are easy to order correctly, and posts a better number than a narrower source without being
 * better at anything a manager cares about. Restricting to the intersection removes that advantage
 * entirely; reporting only the restricted number would hide a real one (coverage IS worth
 * something). So both are computed, from one pass, and the difference between them is itself a
 * result worth reading.
 */
export async function replayHeadToHead(
  db: ReadonlyDb,
  { season, weeks, sources, rules, asOfForWeek, asOfForPlayerGame, historySeasons = DEFAULT_HISTORY_SEASONS, segment }: HeadToHeadOptions,
): Promise<HeadToHead> {
  if (sources.length < 2) {
    throw new Error("A head-to-head needs at least two sources; one source is a replay.");
  }
  const outcomes = await replayWeeks(db, season, weeks, sources, rules, asOfForWeek, asOfForPlayerGame, historySeasons, segment);
  const intersection = (outcome: WeekOutcome): ReadonlySet<string> => {
    const [first, ...rest] = outcome.projected;
    return new Set(
      [...first!.keys()].filter(
        (playerId) =>
          rest.every((other) => other.has(playerId)) && (outcome.segment === null || outcome.segment.has(playerId)),
      ),
    );
  };
  return {
    full: sources.map((source, index) => scoreSource(source.name, outcomes, index)),
    common: sources.map((source, index) => scoreSource(source.name, outcomes, index, intersection)),
  };
}

/** The four shares the opportunity model predicts, as they are keyed on `PlayerWeekUsage`. */
export const SHARE_FIELDS = ["snapShare", "targetShare", "carryShare", "passAttemptShare"] as const;
export type ShareField = (typeof SHARE_FIELDS)[number];

export interface OpportunityReplayOptions {
  readonly season: number;
  readonly weeks: readonly number[];
  readonly asOfForWeek: (week: number) => Date;
  readonly priors: OpportunityPriors;
  readonly historySeasons?: number;
}

export interface OpportunityReplayResult {
  /** Predicted share against observed share, per share and pooled over all of them. */
  readonly byShare: Readonly<Record<ShareField, readonly Observation[]>>;
  readonly pooled: readonly Observation[];
}

/**
 * SCORING LAYER 1 ON ITS OWN TERMS, before it has touched a single fantasy point.
 *
 * This is the measurement that has to come first. If predicted target share is not better than
 * "whatever his share was last week", nothing composed on top of it can be — and the failure would
 * be invisible in a points scoreboard, where an efficiency error and an opportunity error look
 * identical. Separating them is the only way to know which half is wrong.
 *
 * Point-in-time throughout, exactly as `replay` is: each week's prediction is made from usage read
 * through the as-of gate at that week's replay moment, and scored against the FINAL, corrected
 * usage. Evaluating against a flat season-long read would let a stat correction published in
 * December inform an October prediction — a small leak, but the small ones are the ones that
 * survive review.
 */
export async function replayOpportunity(
  db: ReadonlyDb,
  { season, weeks, asOfForWeek, priors, historySeasons = DEFAULT_HISTORY_SEASONS }: OpportunityReplayOptions,
): Promise<OpportunityReplayResult> {
  const positions = await allPositions(db);
  const earliestSeason = season - historySeasons + 1;
  const byShare: Record<ShareField, Observation[]> = {
    snapShare: [],
    targetShare: [],
    carryShare: [],
    passAttemptShare: [],
  };

  for (const week of [...weeks].sort((a, b) => a - b)) {
    const asOf = asOfForWeek(week);
    const history: PlayerWeekUsage[] = [];
    for (let historySeason = earliestSeason; historySeason <= season; historySeason += 1) {
      const upTo = historySeason === season ? week - 1 : LAST_POSSIBLE_WEEK;
      if (upTo < 1) continue;
      history.push(...(await usageAsOf(db, { season: historySeason, week: { from: 1, to: upTo }, asOf })));
    }
    const predictions = predictOpportunity(history, { season, week, positions }, priors);
    const actuals = await usageAsOf(db, { season, week, asOf: FINAL_OUTCOME });

    for (const actual of actuals) {
      const predicted = predictions.get(actual.playerId);
      if (predicted === undefined) continue;
      for (const field of SHARE_FIELDS) {
        const observed = actual[field];
        if (observed === null) continue;
        byShare[field].push({ predicted: predicted[field], actual: observed });
      }
    }
  }

  return { byShare, pooled: SHARE_FIELDS.flatMap((field) => byShare[field]) };
}
