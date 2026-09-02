import type { ReadonlyDb } from "@/db/client";
import type { Position } from "@/domain/player";
import type { ScoringRules } from "@/scoring/compute";
import { NFLVERSE_SOURCE, PARTICIPATION_METRICS } from "../nflverse/map";
import { PBP_METRICS, PBP_SOURCE } from "../nflverse/pbp";
import {
  regularSeasonGamesPerTeam,
  SCHEDULE_METRICS,
  SCHEDULE_SOURCE,
  schedulePublishedAsOf,
} from "../nflverse/schedule";
import { ageAtSeason } from "../preseason/availability";
import { LAST_POSSIBLE_WEEK, observationsAsOf } from "../store";
import { teamObservationsAsOf } from "../team-store";
import { VEGAS_METRICS, VEGAS_SOURCE } from "../vegas/ingest";
import { usageAsOf, type PlayerWeekUsage } from "../usage";
import { isSkillPosition, pointsPerGame, seasonContext, targetShareOf, type LawPosition } from "./populations";

/**
 * THE DISCOVERY CANDIDATE QUANTITIES — a SIBLING to `populations.ts`'s `LawConditionFacts`/
 * `factsForSeason`, not an edit to either, and kept in its own module (fix round: `populations.ts`
 * had grown past the 800-line file cap once this block was inline there). The six tribal laws'
 * antecedents are hand-picked and fixed; a candidate generator (`discovery/templates.ts`) instead
 * needs a wider, uniform vocabulary of quantities it can cross with quantile thresholds and
 * position, without touching what the tribal harness or the live board (`board-reasons.ts`)
 * already reads.
 *
 * Every field below is read through the SAME as-of-gated store functions `factsForSeason` uses —
 * bundled together, for the two of them, as `populations.ts`'s exported `seasonContext` — plus two
 * new aggregates over stores the laws harness had not read from before (`usageAsOf` for
 * snap/red-zone/target-depth, `teamObservationsAsOf` for the team's own pace), never a new raw
 * ingestion path.
 *
 * TRI-STATE, EXACTLY AS EVERYWHERE ELSE: a quantity with no underlying evidence is `null`, never a
 * zero or a false. `discovery/generate.ts`'s threshold and delta conditions read these fields and
 * propagate that `null` straight through — a missing quantity makes a candidate's condition unknown,
 * not false, including inside an AND-pair (Kleene logic: `false AND unknown = false`, but
 * `true AND unknown = unknown`).
 */
export interface DiscoveryQuantityValues {
  /** Carries + receptions, the season in question. Meaningful for RB. */
  readonly touches: number | null;
  /** Years old at that season's opener. */
  readonly age: number | null;
  /** Share of the team's targets claimed. Meaningful for RB/WR/TE. */
  readonly targetShare: number | null;
  /** Share of own fantasy points that came from touchdowns. */
  readonly touchdownPointsShare: number | null;
  /** Share of the player's OWN carries+targets (the play-by-play's own counts, never the box
   *  score's) that were inside the twenty. Meaningful for RB/WR/TE. */
  readonly redZoneTouchShare: number | null;
  /** Average depth of target, in yards — air yards over the targets that carried a readable one.
   *  Meaningful for WR/TE. */
  readonly targetDepth: number | null;
  /** Share of the team's offensive snaps played. */
  readonly snapShare: number | null;
  /** The team's incoming (season+1) play-caller's own tenure with that team, in seasons; zero is a
   *  coaching change. Raw count, unlike `LawConditionFacts.incomingCoachTenureIsZero`. */
  readonly incomingCoachTenureSeasons: number | null;
  /** That incoming play-caller's own prior pass-rate-over-expected, at the teams he ran before. */
  readonly incomingCoachPriorPassRateOverExpected: number | null;
  /** Seasons in the league, counting the season itself — `season - draftYear + 1`. */
  readonly experienceYear: number | null;
  /** The player's OWN team's situation-neutral seconds per offensive play, that season — distinct
   *  from the incoming coach's PRIOR pace, which this generator does not surface as its own
   *  quantity (the team's own current pace is the one the brief names "team pace"). */
  readonly teamPaceSecondsPerPlay: number | null;
  /**
   * The Vegas regular-season win total published for the season BEING PREDICTED (season+1), for the
   * team this player finished season N with — the market's own preseason judgment of a TEAM, which
   * is a different quantity from anything else in this list (every other entry is a fact about the
   * player or about his team's completed season).
   *
   * SAME SHAPE AS THE INCOMING-COACH PAIR ABOVE, deliberately: a season+1 context fact, knowable
   * before season+1 kicks off, attached to season N's facts row and keyed by season N's team. It
   * inherits that shape's own known approximation with it — a player who CHANGES teams in the
   * offseason is credited with his old team's incoming context, because who he will play for next
   * season is not knowable at all from a store that ends with season N. `incomingCoachTenureSeasons`
   * has always had exactly this property; a second, different answer for the same question would be
   * worse than one consistent one.
   */
  readonly incomingTeamWinTotal: number | null;
  /**
   * That win total minus the team's ACTUAL regular-season wins in season N, both halves store-read:
   * the market's judgment of the season ahead against what the team just did. Negative means the
   * market expects a fall (the founder's Achane case is a large negative); positive, a rise.
   *
   * TRI-STATE ON BOTH HALVES: `null` when the team-season carries no published line, and `null`
   * when season N's record is not fully derivable from the store (see `seasonActualWinsByTeam` —
   * a season the store holds no schedule for, or a team whose completed-game count falls short of
   * the season's own full complement, which is the same completeness rule
   * `scripts/validate-win-totals.ts`'s `computeSeasonWins` applies against the raw file).
   */
  readonly incomingTeamWinTotalDelta: number | null;
  /**
   * Share of the player's OWN carries and targets (the play-by-play's own counts, the same
   * numerator/denominator discipline `redZoneTouchShare` keeps) that came INSIDE THE TEN — the
   * goal-line half of the red-zone story, which the twenty-yard line's version cannot separate from
   * a fifteen-yard-out target. Meaningful for RB/WR/TE.
   */
  readonly insideTenTouchShare: number | null;
  /**
   * Share of his TEAM's air yards that the player accounted for, both halves from the play-by-play
   * feed. Distinct from `targetShare` (how many balls came his way) and from `targetDepth` (how far
   * each one travelled): this is the product of the two, the share of the offence's downfield intent
   * pointed at one man.
   *
   * THE DENOMINATOR IS THE TEAM'S PLAY-BY-PLAY AIR YARDS SUMMED OVER THE PLAYERS THIS MODULE CAN
   * PLACE ON THAT TEAM — `seasonTeams`' own mapping, the same one `teamPaceSecondsPerPlay` and the
   * win-total pair are keyed by. A receiver the team map cannot place contributes to no team's
   * denominator, so a team with an unplaceable target-earner has a slightly small denominator and a
   * slightly large share for everyone else. Stated rather than worked around: the alternative is a
   * team air-yard total from a different feed than the numerator, which is the exact mismatch
   * `usage.ts`'s "both halves from the same file" rule exists to prevent.
   */
  readonly teamAirYardsShare: number | null;
  /** Games he was scored in that season — the availability fact, and the denominator the outcome's
   *  own points per game is taken over. Never null on a row that exists at all (a row is only built
   *  for a player with a computable points per game, which needs at least one game). */
  readonly gamesPlayed: number | null;
  /**
   * His OVERALL DRAFT PICK, from the same preseason roster row `experienceYear`'s draft year and
   * `age`'s birth date come off. `null` for an undrafted player and for any season the roster
   * backfill does not reach, exactly as those two are.
   *
   * RUNS BACKWARDS AGAINST EVERY OTHER QUANTITY HERE: a bigger number is a worse pick. The quantity
   * itself is stored raw rather than inverted into a "capital" score, because a raw pick number is
   * the thing a reader already knows about a player; the direction is carried in the noun the claim
   * renders with (`QUANTITY_DEFS`).
   */
  readonly draftPick: number | null;
  /**
   * His OWN points per game that season, under the same scoring rules and the same gate every other
   * quantity here is read at.
   *
   * THIS IS THE MATCHED DESIGN'S MATCH KEY, NOT MERELY SOMETHING LIKE IT. `discovery/measure.ts`
   * builds each population point with `matchKey: row.pointsPerGame`, taken from `factsForSeason`'s
   * season-N read at `schedulePublishedAsOf(season + 1)`; this field is `pointsPerGame(scored)` over
   * `seasonContext`'s scoring at the identical gate with the identical rules, so the two are the same
   * number and not an approximation of each other. That identity is what makes a LEVEL condition on
   * it unmeasurable under this design and a CROSSING condition perfectly sound — the whole argument
   * lives on `QuantityDef.isMatchKeyQuantity` (`discovery/templates.ts`), which is where the
   * generator reads the consequence from.
   */
  readonly pointsPerGame: number | null;
}

/** One player's discovery quantities for one season, plus the SAME quantities one season earlier —
 *  the shape the delta template (`discovery/templates.ts`) needs to ask "did this cross a quantile
 *  from last season to this one". `prior: null` means no evidence AT ALL for the earlier season (he
 *  did not play it, or nothing about him is in the store for it) — distinct from `prior` being
 *  present with an individual field still `null`. */
export interface DiscoveryFacts {
  readonly position: LawPosition;
  readonly current: DiscoveryQuantityValues;
  readonly prior: DiscoveryQuantityValues | null;
}

/** One player's offensive-snap participation, summed over a season — a RATIO OF SUMS taken from the
 *  snap-counts file alone (`NFLVERSE_SOURCE.snapCounts`), the same source `usageAsOf`'s own
 *  `snapShare` is built from, read here directly because `usageAsOf`'s per-week SHARE is what it
 *  exposes rather than the raw counts a season total needs. */
interface SeasonSnapCounts {
  readonly snaps: number;
  readonly teamSnaps: number;
}

async function seasonSnapCounts(db: ReadonlyDb, season: number, asOf: Date): Promise<Map<string, SeasonSnapCounts>> {
  const rows = await observationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, source: NFLVERSE_SOURCE.snapCounts });
  const out = new Map<string, SeasonSnapCounts>();
  for (const row of rows) {
    if (row.metric !== PARTICIPATION_METRICS.offensiveSnaps && row.metric !== PARTICIPATION_METRICS.teamOffensiveSnaps) continue;
    const existing = out.get(row.playerId) ?? { snaps: 0, teamSnaps: 0 };
    out.set(row.playerId, {
      snaps: existing.snaps + (row.metric === PARTICIPATION_METRICS.offensiveSnaps ? row.value : 0),
      teamSnaps: existing.teamSnaps + (row.metric === PARTICIPATION_METRICS.teamOffensiveSnaps ? row.value : 0),
    });
  }
  return out;
}

function snapShareOf(counts: SeasonSnapCounts | undefined): number | null {
  return counts !== undefined && counts.teamSnaps > 0 ? counts.snaps / counts.teamSnaps : null;
}

/** One player's play-by-play touches, aggregated over a season, from `usageAsOf`'s own touches
 *  group — present only for the weeks the play-by-play stream has been ingested for. Kept as
 *  running sums rather than shares so a season spanning a mid-year trade adds correctly before any
 *  ratio is taken, and every numerator/denominator pair below is taken from THIS one feed
 *  (`usage.ts`'s own "both halves from the same file" discipline). */
interface SeasonUsageAggregate {
  readonly pbpCarries: number;
  readonly pbpTargets: number;
  readonly redZoneTouches: number;
  /** The same shape as `redZoneTouches` one band tighter in: carries plus targets inside the ten. */
  readonly insideTenTouches: number;
  readonly airYards: number;
  readonly airYardTargets: number;
  /** Whether the play-by-play stream has seen this player at all, any week. `redZoneTouchShare` and
   *  `targetDepth` are `null` rather than zero when this is `false` — no evidence, not no usage. */
  readonly hasPbpEvidence: boolean;
}

const EMPTY_USAGE_AGGREGATE: SeasonUsageAggregate = {
  pbpCarries: 0,
  pbpTargets: 0,
  redZoneTouches: 0,
  insideTenTouches: 0,
  airYards: 0,
  airYardTargets: 0,
  hasPbpEvidence: false,
};

function accumulateUsage(existing: SeasonUsageAggregate, row: PlayerWeekUsage): SeasonUsageAggregate {
  const touches = row.touches;
  return {
    pbpCarries: existing.pbpCarries + (touches === null ? 0 : touches.carries),
    pbpTargets: existing.pbpTargets + (touches === null ? 0 : touches.targets),
    redZoneTouches: existing.redZoneTouches + (touches === null ? 0 : touches.redZoneCarries + touches.redZoneTargets),
    insideTenTouches: existing.insideTenTouches + (touches === null ? 0 : touches.insideTenCarries + touches.insideTenTargets),
    airYards: existing.airYards + (touches === null ? 0 : touches.airYards),
    airYardTargets: existing.airYardTargets + (touches === null ? 0 : touches.airYardTargets),
    hasPbpEvidence: existing.hasPbpEvidence || touches !== null,
  };
}

/** The play-by-play's own red-zone/air-yard breakdown, summed per player over one season as of one
 *  moment. Rides on `usageAsOf`'s OWN row, which it only emits for a player-week that ALSO has a
 *  snap-count team denominator (`usage.ts`'s "a row without the snap denominator is not a usable
 *  week") — so a week with play-by-play touches but no matching snap-count file is invisible here
 *  too, the same way it would be to `usageAsOf`'s own callers. */
async function seasonUsageAggregates(db: ReadonlyDb, season: number, asOf: Date): Promise<Map<string, SeasonUsageAggregate>> {
  const rows = await usageAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf });
  const out = new Map<string, SeasonUsageAggregate>();
  for (const row of rows) out.set(row.playerId, accumulateUsage(out.get(row.playerId) ?? EMPTY_USAGE_AGGREGATE, row));
  return out;
}

/** The share of a player's own play-by-play touches that fell inside a given band, `null` where the
 *  play-by-play never saw him or where he had no touches to take a share of — the one rule
 *  `redZoneTouchShare` and `insideTenTouchShare` both read, so the two bands can never drift apart
 *  on what counts as evidence. */
function touchBandShareOf(usage: SeasonUsageAggregate | undefined, inBand: (usage: SeasonUsageAggregate) => number): number | null {
  if (usage === undefined || !usage.hasPbpEvidence) return null;
  const denominator = usage.pbpCarries + usage.pbpTargets;
  return denominator > 0 ? inBand(usage) / denominator : null;
}

function targetDepthOf(usage: SeasonUsageAggregate | undefined): number | null {
  if (usage === undefined || !usage.hasPbpEvidence) return null;
  return usage.airYardTargets > 0 ? usage.airYards / usage.airYardTargets : null;
}

/**
 * Each team's own play-by-play air yards for a season, summed over the players this module can place
 * on that team — `teamAirYardsShare`'s denominator, and the ONE place that sum is taken, so every
 * player on a team divides by the identical number. See `DiscoveryQuantityValues.teamAirYardsShare`
 * for what an unplaceable player does to it.
 */
function seasonTeamAirYards(
  usage: ReadonlyMap<string, SeasonUsageAggregate>, teams: ReadonlyMap<string, string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [playerId, aggregate] of usage) {
    const team = teams.get(playerId);
    if (team === undefined || !aggregate.hasPbpEvidence) continue;
    out.set(team, (out.get(team) ?? 0) + aggregate.airYards);
  }
  return out;
}

/** One player's share of his team's air yards, `null` on the same no-evidence rule every other
 *  play-by-play quantity here applies, and `null` again where the team's own total is not positive
 *  (a share of nothing, or of a negative total, is not a share). */
function teamAirYardsShareOf(usage: SeasonUsageAggregate | undefined, teamAirYards: number | undefined): number | null {
  if (usage === undefined || !usage.hasPbpEvidence || teamAirYards === undefined || teamAirYards <= 0) return null;
  return usage.airYards / teamAirYards;
}

/** Each team's mean situation-neutral seconds per play over a season, from the play-by-play's own
 *  team-week facts — the TEAM's own pace that season, distinct from `populations.ts`'s
 *  `incomingCoachFactsByTeam` (inside `seasonContext`), which is the incoming play-caller's PRIOR
 *  pace at other teams. */
async function seasonTeamPaceByTeam(db: ReadonlyDb, season: number, asOf: Date): Promise<Map<string, number>> {
  const rows = await teamObservationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, source: PBP_SOURCE });
  const sums = new Map<string, { total: number; weeks: number }>();
  for (const row of rows) {
    if (row.metric !== PBP_METRICS.paceSecondsPerPlay) continue;
    const existing = sums.get(row.team) ?? { total: 0, weeks: 0 };
    sums.set(row.team, { total: existing.total + row.value, weeks: existing.weeks + 1 });
  }
  return new Map([...sums].map(([team, { total, weeks }]) => [team, total / weeks]));
}

/**
 * The published win total for one season, by team, read at the moment that season's PRESEASON was
 * knowable rather than at the previous season's schedule-publication gate.
 *
 * WEEK ONE, EXACTLY — `vegas/ingest.ts` writes one row per team per season at week 1 and does not
 * replicate it across the season (see that module's `OBSERVATION_WEEK` docblock). An exact-week read
 * at any other week would return nothing and this quantity would be silently null everywhere, which
 * is why the week is named here rather than inherited from a range: `incomingCoachFactsByTeam`
 * (`populations.ts`) reads its own season+1 facts at `week: 1` for the same reason.
 *
 * WHY A SEPARATE `asOf` FROM EVERY OTHER READ IN THIS MODULE, and why that is not a carve-out. A win
 * total is published in AUGUST of the season it prices; every other read here is gated at
 * `schedulePublishedAsOf(season + 1)`, the twentieth of May, because that is when the schedule and
 * the incoming play-caller became knowable. Reading a market line stamped in August at a May gate
 * returns nothing at all, for every team, in every season. The honest gate for a preseason market
 * fact is the moment a PRESEASON BOARD for that season would be built, which is what callers pass:
 * `preseason/source.ts` passes its own `BoardMoment` (the replay arm is one millisecond before the
 * earliest thing season+1's games produced; the live arm is the clock, guaranteed before kickoff),
 * and the two harness scripts pass `preseasonMomentFor(season + 1)`, the identical derivation. No
 * outcome of the season being predicted is reachable at either, which is the property that matters;
 * the read itself is `teamObservationsAsOf` like every other one in this file.
 */
async function incomingWinTotalByTeam(db: ReadonlyDb, nextSeason: number, incomingAsOf: Date): Promise<Map<string, number>> {
  const rows = await teamObservationsAsOf(db, { season: nextSeason, week: 1, asOf: incomingAsOf, source: VEGAS_SOURCE });
  const out = new Map<string, number>();
  for (const row of rows) if (row.metric === VEGAS_METRICS.winTotal) out.set(row.team, row.value);
  return out;
}

/**
 * Each team's ACTUAL regular-season wins in one season, summed from the schedule store's own
 * per-game result rows (`SCHEDULE_METRICS.gameResult`, a win 1, a tie 0.5, a loss 0).
 *
 * COMPLETE SEASONS ONLY. A team whose visible completed games fall short of the season's own full
 * complement (`regularSeasonGamesPerTeam`) is ABSENT from the returned map rather than credited with
 * a partial record: a running total taken mid-season is not a record, and the reader downstream
 * treats absence as unknown, never as zero wins. This is the same rule, on the same constant, that
 * `scripts/validate-win-totals.ts`'s `computeSeasonWins` applies to the raw file — which is what
 * makes the CSV's own `actual_wins` column and this store-derived number provably the same fact
 * (Task 1 validated the column against that derivation, 0 mismatches over all 479 verifiable
 * team-seasons). Two documented consequences, both honest rather than worked around: a season the
 * store holds no schedule for yields no records at all, and 2022 BUF/CIN, whose seventeenth game was
 * cancelled and never made up, are unknown for that season exactly as they are blank in the CSV.
 */
async function seasonActualWinsByTeam(db: ReadonlyDb, season: number, asOf: Date): Promise<Map<string, number>> {
  const rows = await teamObservationsAsOf(db, {
    season,
    week: { from: 1, to: LAST_POSSIBLE_WEEK },
    asOf,
    source: SCHEDULE_SOURCE.kickoff,
  });
  const tallies = new Map<string, { wins: number; games: number }>();
  for (const row of rows) {
    if (row.metric !== SCHEDULE_METRICS.gameResult) continue;
    const existing = tallies.get(row.team) ?? { wins: 0, games: 0 };
    tallies.set(row.team, { wins: existing.wins + row.value, games: existing.games + 1 });
  }
  const required = regularSeasonGamesPerTeam(season);
  const out = new Map<string, number>();
  for (const [team, { wins, games }] of tallies) if (games === required) out.set(team, wins);
  return out;
}

/**
 * Every discovery quantity, for every player active in ONE season, at that season's OWN N+1
 * schedule-publication gate — the same `asOf` `factsForSeason` would use for THIS season, so a
 * caller building both a season's `current` and its `prior` half (`discoveryFactsForSeason`) reads
 * the earlier season at a strictly later-than-necessary but still perfectly safe gate: everything
 * about `targetSeason` is already history by `schedulePublishedAsOf(targetSeason + 1)` regardless of
 * whether `targetSeason` is this candidate's "current" season or its "prior" one.
 *
 * `admitDerived` passes straight through to `seasonContext` (and so to `seasonScoring`) — see
 * `discoveryFactsForSeason`'s own docblock for why this is an explicit parameter rather than a
 * hardcoded policy.
 *
 * `incomingAsOf` gates the ONE fact class this module reads that is published after May of the
 * predicted season: the win total (see `incomingWinTotalByTeam`). Everything else, the incoming
 * play-caller included, stays on `asOf`.
 */
async function discoveryQuantitiesForSeason(
  db: ReadonlyDb, targetSeason: number, asOf: Date, incomingAsOf: Date, positions: ReadonlyMap<string, Position>, rules: ScoringRules,
  admitDerived: boolean,
): Promise<Map<string, DiscoveryQuantityValues>> {
  const { scoring, participation, teams, roster, coachFacts, birthDates } = await seasonContext(db, targetSeason, asOf, positions, rules, admitDerived);
  const usage = await seasonUsageAggregates(db, targetSeason, asOf);
  const snapCounts = await seasonSnapCounts(db, targetSeason, asOf);
  const pace = await seasonTeamPaceByTeam(db, targetSeason, asOf);
  const winTotals = await incomingWinTotalByTeam(db, targetSeason + 1, incomingAsOf);
  const actualWins = await seasonActualWinsByTeam(db, targetSeason, asOf);
  const teamAirYards = seasonTeamAirYards(usage, teams);
  const draftYears = new Map(roster.map((row) => [row.playerId, row.draftYear] as const));
  const draftPicks = new Map(roster.map((row) => [row.playerId, row.draftPick] as const));

  const out = new Map<string, DiscoveryQuantityValues>();
  for (const playerId of positions.keys()) {
    const scored = scoring.get(playerId);
    const ppg = pointsPerGame(scored);
    if (scored === undefined || ppg === null) continue;
    const participated = participation.get(playerId);
    const team = teams.get(playerId);
    const coach = team === undefined ? undefined : coachFacts.get(team);
    const usageAgg = usage.get(playerId);
    const draftYear = draftYears.get(playerId) ?? null;
    const winTotal = team === undefined ? null : (winTotals.get(team) ?? null);
    const wins = team === undefined ? null : (actualWins.get(team) ?? null);
    out.set(playerId, {
      touches: participated === undefined ? null : participated.carries + scored.receptions,
      age: ageAtSeason(birthDates.get(playerId) ?? null, targetSeason),
      targetShare: targetShareOf(participated),
      touchdownPointsShare: scored.points > 0 ? scored.touchdownPoints / scored.points : null,
      redZoneTouchShare: touchBandShareOf(usageAgg, (u) => u.redZoneTouches),
      targetDepth: targetDepthOf(usageAgg),
      snapShare: snapShareOf(snapCounts.get(playerId)),
      incomingCoachTenureSeasons: coach?.tenureSeasons ?? null,
      incomingCoachPriorPassRateOverExpected: coach?.priorPassRateOverExpected ?? null,
      experienceYear: draftYear === null ? null : targetSeason - draftYear + 1,
      teamPaceSecondsPerPlay: team === undefined ? null : (pace.get(team) ?? null),
      incomingTeamWinTotal: winTotal,
      // Tri-state on BOTH halves: unknown either side makes the gap unknown, never a zero gap.
      incomingTeamWinTotalDelta: winTotal === null || wins === null ? null : winTotal - wins,
      insideTenTouchShare: touchBandShareOf(usageAgg, (u) => u.insideTenTouches),
      teamAirYardsShare: teamAirYardsShareOf(usageAgg, team === undefined ? undefined : teamAirYards.get(team)),
      gamesPlayed: scored.games,
      draftPick: draftPicks.get(playerId) ?? null,
      // Already computed above, and non-null by the `continue` this loop opens with.
      pointsPerGame: ppg,
    });
  }
  return out;
}

/**
 * `DiscoveryFacts` for every player active in season N, `current` at N's own gate and `prior` from
 * season N-1 read through the identical helper — see `discoveryQuantitiesForSeason`'s own docblock
 * for why one shared `asOf` is safe for both halves. Scoped to `LawPosition` (QB/RB/WR/TE) the same
 * way `factsForSeason`'s own consumers are; a K or DEF row from `positions` is silently excluded
 * here, the same "not a fact this engine's laws are about" reasoning `SKILL_POSITIONS` encodes.
 *
 * `admitDerived` is an EXPLICIT parameter, mirroring `factsForSeason`'s and `buildPopulations`'s own
 * discipline (fix round: this used to hardcode `true` internally, which is the "policy invisible at
 * the call site" failure `seasonContext`'s own docblock names). Its caller — Task 7's discovery
 * pipeline — passes `true`, the same choice `buildPopulations` makes: the laws harness (discovery
 * included) is exactly where a pbp-derived gap-season stat line belongs.
 *
 * `incomingAsOf` is EXPLICIT for the identical reason (Task 3): it is the moment season N+1's
 * PRESEASON was knowable, and it gates the one fact class here that a May-of-N+1 gate cannot see at
 * all (see `incomingWinTotalByTeam`). Both halves share it, exactly as both halves already share
 * `asOf` and for the same reason: the prior half's own incoming season is N, whose line was
 * published a year earlier, so a gate set at N+1's preseason is later than that half needs and still
 * admits nothing any season produced on the field. The two harness scripts pass
 * `preseasonMomentFor(season + 1)`; `loadPreseason` passes its own `BoardMoment`.
 */
export async function discoveryFactsForSeason(
  db: ReadonlyDb, season: number, positions: ReadonlyMap<string, Position>, rules: ScoringRules, admitDerived: boolean,
  incomingAsOf: Date,
): Promise<Map<string, DiscoveryFacts>> {
  const asOf = schedulePublishedAsOf(season + 1);
  const current = await discoveryQuantitiesForSeason(db, season, asOf, incomingAsOf, positions, rules, admitDerived);
  const prior = await discoveryQuantitiesForSeason(db, season - 1, asOf, incomingAsOf, positions, rules, admitDerived);

  const out = new Map<string, DiscoveryFacts>();
  for (const [playerId, values] of current) {
    const position = positions.get(playerId);
    if (position === undefined || !isSkillPosition(position)) continue;
    out.set(playerId, { position, current: values, prior: prior.get(playerId) ?? null });
  }
  return out;
}
