import type { ReadonlyDb } from "@/db/client";
import type { Position } from "@/domain/player";
import type { ScoringRules } from "@/scoring/compute";
import { NFLVERSE_SOURCE, PARTICIPATION_METRICS } from "../nflverse/map";
import { PBP_METRICS, PBP_SOURCE } from "../nflverse/pbp";
import { schedulePublishedAsOf } from "../nflverse/schedule";
import { ageAtSeason } from "../preseason/availability";
import { LAST_POSSIBLE_WEEK, observationsAsOf } from "../store";
import { teamObservationsAsOf } from "../team-store";
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

function redZoneTouchShareOf(usage: SeasonUsageAggregate | undefined): number | null {
  if (usage === undefined || !usage.hasPbpEvidence) return null;
  const denominator = usage.pbpCarries + usage.pbpTargets;
  return denominator > 0 ? usage.redZoneTouches / denominator : null;
}

function targetDepthOf(usage: SeasonUsageAggregate | undefined): number | null {
  if (usage === undefined || !usage.hasPbpEvidence) return null;
  return usage.airYardTargets > 0 ? usage.airYards / usage.airYardTargets : null;
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
 */
async function discoveryQuantitiesForSeason(
  db: ReadonlyDb, targetSeason: number, asOf: Date, positions: ReadonlyMap<string, Position>, rules: ScoringRules, admitDerived: boolean,
): Promise<Map<string, DiscoveryQuantityValues>> {
  const { scoring, participation, teams, roster, coachFacts, birthDates } = await seasonContext(db, targetSeason, asOf, positions, rules, admitDerived);
  const usage = await seasonUsageAggregates(db, targetSeason, asOf);
  const snapCounts = await seasonSnapCounts(db, targetSeason, asOf);
  const pace = await seasonTeamPaceByTeam(db, targetSeason, asOf);
  const draftYears = new Map(roster.map((row) => [row.playerId, row.draftYear] as const));

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
    out.set(playerId, {
      touches: participated === undefined ? null : participated.carries + scored.receptions,
      age: ageAtSeason(birthDates.get(playerId) ?? null, targetSeason),
      targetShare: targetShareOf(participated),
      touchdownPointsShare: scored.points > 0 ? scored.touchdownPoints / scored.points : null,
      redZoneTouchShare: redZoneTouchShareOf(usageAgg),
      targetDepth: targetDepthOf(usageAgg),
      snapShare: snapShareOf(snapCounts.get(playerId)),
      incomingCoachTenureSeasons: coach?.tenureSeasons ?? null,
      incomingCoachPriorPassRateOverExpected: coach?.priorPassRateOverExpected ?? null,
      experienceYear: draftYear === null ? null : targetSeason - draftYear + 1,
      teamPaceSecondsPerPlay: team === undefined ? null : (pace.get(team) ?? null),
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
 */
export async function discoveryFactsForSeason(
  db: ReadonlyDb, season: number, positions: ReadonlyMap<string, Position>, rules: ScoringRules, admitDerived: boolean,
): Promise<Map<string, DiscoveryFacts>> {
  const asOf = schedulePublishedAsOf(season + 1);
  const current = await discoveryQuantitiesForSeason(db, season, asOf, positions, rules, admitDerived);
  const prior = await discoveryQuantitiesForSeason(db, season - 1, asOf, positions, rules, admitDerived);

  const out = new Map<string, DiscoveryFacts>();
  for (const [playerId, values] of current) {
    const position = positions.get(playerId);
    if (position === undefined || !isSkillPosition(position)) continue;
    out.set(playerId, { position, current: values, prior: prior.get(playerId) ?? null });
  }
  return out;
}
