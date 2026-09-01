import type { ReadonlyDb } from "@/db/client";
import type { Position, StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@/scoring/compute";
import { allPositions } from "../backtest";
import { statLinesAsOf, STAT_LINE_SOURCE } from "../lines";
import { statLinesAsOfForMeasurement } from "../nflverse/derived-stat-lines";
import { NFLVERSE_SOURCE, PARTICIPATION_METRICS } from "../nflverse/map";
import { COACH_METRICS } from "../nflverse/coaches";
import { PBP_METRICS, PBP_SOURCE } from "../nflverse/pbp";
import { schedulePublishedAsOf, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { ageAtSeason } from "../preseason/availability";
import { preseasonRostersAsOf } from "../preseason/store";
import { LAST_POSSIBLE_WEEK, observationsAsOf } from "../store";
import { playerTeamsAsOf, teamObservationsAsOf } from "../team-store";
import { usageAsOf, type PlayerWeekUsage } from "../usage";
import type { Law, PlayerSeasonPoint } from "./types";

/**
 * THE SIX LAW POPULATIONS — turning a plain-words claim into the covariate/outcome pairs the
 * harness measures, without ever letting a population see the season it is predicting.
 *
 * `backtest.ts`'s own docblock states the discipline this module inherits verbatim: "there is
 * exactly one path from the store into a source's hands... and this module never queries
 * observations any other way. The ACTUALS are read separately and deliberately without that gate,
 * because an outcome is what really happened... those two reads are the only two, and they are a
 * few lines apart so the difference between them is visible rather than buried." Every builder here
 * mirrors it: season N's covariate is read gated at `schedulePublishedAsOf(N + 1)` (`factsForSeason`),
 * and N+1's outcome is read ungated at `FINAL_OUTCOME` (`actualPointsPerGame`), two calls apart.
 *
 * THE ONE NAMED EXCEPTION is `allPositions` (reused from `backtest.ts`), which carries no as-of at
 * all — the same exception `backtest.ts` itself takes, and for the same reason: a player's POSITION
 * is not a fact a Sunday-night stat correction restates, so gating it would buy nothing and reading
 * it once, outside every season loop, is honest rather than a leak.
 *
 * NO-EVIDENCE IS NOT FALSE. Every `LawConditionFacts` field and every exported condition predicate
 * is tri-state (`boolean | null`, or the underlying quantity is `T | null`): a player with no
 * participation row, no team edge, or no roster row for a fact a law needs returns `null` from that
 * predicate, and `buildPopulations`/`buildPopulation` DROP that player-season from the population
 * entirely — from neither the condition pool nor the control pool. Collapsing "we don't know" to
 * `false` would publish an evidence gap as a matched control, which is a different and false claim.
 *
 * TWO SIMPLIFICATIONS RECUR, both forced by one fact: nothing about a player's SEASON N+1 team is
 * knowable at that gate (transactions aren't a source this engine reads; N+1 week-one rosters aren't
 * filed until cutdown, months later). `play_caller_fingerprint` wants "his team next season" and uses
 * his own SEASON N team instead (`seasonTeams`), stated in its `claim`.
 *
 * `PARTICIPATION_METRICS` (targets, carries, team denominators) are read through `observationsAsOf`
 * directly rather than `statLinesAsOf`, which deliberately filters them out ("not stat fields... an
 * outcome is not a feature") — a population that needs them reads the store's other half.
 */

const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

/** The four positions a law population ever emits a `PlayerSeasonPoint` for. Exported so the
 *  discovery candidate generator (`discovery/templates.ts`) can scope a quantity to the positions
 *  it is meaningful for without re-deriving this union. */
export type LawPosition = PlayerSeasonPoint["position"];

/** One law's static content plus the population its measurement is drawn from. */
export interface LawSpec {
  readonly id: string;
  readonly position: Law["position"];
  readonly claim: string;
  readonly expectedSign: -1 | 1;
  readonly caliper: number;
  /**
   * WHAT `modelPath` MEANS (controller ruling, this wave, 2026-08-31: annotate the existing model,
   * never build or re-fit one). `null` unless a CONFIRMED law's antecedent is already what an
   * existing fitted feature computes — in which case this names that feature as
   * `"<file path from repo root>#<exported symbol>"`, a string `populations.test.ts`'s registry
   * test resolves by importing the named symbol from the named file, so a rename of either half
   * breaks that test rather than silently orphaning the pointer.
   *
   * Wired this wave: `wr_target_competition` to the offseason share-redistribution feature
   * (`fitRedistributionPriors`), `target_share_persistence` to the opportunity model's own
   * target-share shrinkage (`predictOpportunity`), `td_regression` to the efficiency model's
   * touchdown-rate regression handling (`TOUCHDOWN_RATES`) — the three laws `measured.json` called
   * `confirmed` at the time this wiring was decided.
   *
   * UPDATED, fix round (2026-08-31): `rb_age_curve` is now ALSO `confirmed` in `measured.json`
   * (sample 43 -> 171 across two later changes — see `nflverse/derived-stat-lines.ts`'s own docblock
   * and `scripts/measure-laws.ts`'s falsification run for the honest attribution of that growth), and
   * its `modelPath` stays `null` regardless: this wave's controller ruling was to ANNOTATE the model
   * that already existed, never to build or re-fit one, and no existing fitted feature happens to
   * compute `rb_age_curve`'s antecedent (raw age at season start) the way the other three laws'
   * antecedents already matched something `model/fit.ts` had built. `play_caller_fingerprint`
   * (debunked) and `rb_workload_cliff` (still weak) stay `null` for the ordinary reason: a law that
   * is not confirmed gates nothing, whatever feature might otherwise seem to fit its story. A future
   * law confirmed with no existing feature to point at — `rb_age_curve` included — gets one through
   * the normal feature/fit route (`model/fit.ts`) in a model round of its own; until then it is
   * content-only, exactly like a debunked or weak law's claim.
   */
  readonly modelPath: string | null;
  readonly population: (db: ReadonlyDb, seasons: readonly number[]) => Promise<readonly PlayerSeasonPoint[]>;
}

/**
 * PER-PLAYER QUANTITIES every law's antecedent reads, tri-state throughout — `null` means "no
 * evidence", never "condition false". Exported so a future board caller (Task 7) can ask "does this
 * law's condition hold for him" with the exact predicate it was measured with.
 */
export interface LawConditionFacts {
  /** Carries + receptions, season N; null with no participation row at all (rb_workload_cliff). */
  readonly touches: number | null;
  /** Years old at season N's opener; null if no birth date is known (rb_age_curve). */
  readonly age: number | null;
  /** Best individual season-N target share among his own WR/TE teammates; null with no team edge
   *  at all (wr_target_competition). */
  readonly bestTeammateTargetShare: number | null;
  /** The season-N team's season-N+1 play-caller has zero tenure with it; null with no team edge or
   *  no coach facts for that team at all (play_caller_fingerprint). */
  readonly incomingCoachTenureIsZero: boolean | null;
  /** That incoming play-caller's own prior pass-rate-over-expected; null if unmeasured. */
  readonly incomingCoachPriorPassRateOverExpected: number | null;
  /** Share of the team's targets claimed, season N; null with no participation row (target_share_persistence). */
  readonly targetShare: number | null;
  /** Share of own points from touchdowns, season N (td_regression). */
  readonly touchdownPointsShare: number | null;
  /** 1.5x his position's median touchdown-points share among regulars, season N (td_regression). */
  readonly touchdownPointsShareThreshold: number | null;
}

const WORKLOAD_CLIFF_TOUCHES = 300;
const AGE_CLIFF_YEARS = 28;
/** A teammate's own season-N target share, to count as "another primary receiver" (wr_target_competition). */
const TEAMMATE_PRIMARY_RECEIVER_SHARE = 0.2;
const TARGET_SHARE_PERSISTENCE_MIN = 0.24;
const TD_REGRESSION_MULTIPLIER = 1.5;
/** A player-season needs at least this many games to count toward the td_regression median — thin,
 *  low-usage seasons swing a median without representing what a "regular" typically does. */
const MIN_GAMES_FOR_TD_MEDIAN = 8;
/** Points/game — the band within which two player-seasons count as "otherwise similar". */
const POINTS_PER_GAME_CALIPER = 2;
const SKILL_POSITIONS: ReadonlySet<LawPosition> = new Set(["QB", "RB", "WR", "TE"]);

/** `null` propagates: a law's antecedent is unknown, never false, when its inputs are unknown. */
export function rbWorkloadCliffCondition(facts: LawConditionFacts): boolean | null {
  return facts.touches === null ? null : facts.touches >= WORKLOAD_CLIFF_TOUCHES;
}
export function rbAgeCurveCondition(facts: LawConditionFacts): boolean | null {
  return facts.age === null ? null : facts.age >= AGE_CLIFF_YEARS;
}
export function wrTargetCompetitionCondition(facts: LawConditionFacts): boolean | null {
  if (facts.targetShare === null || facts.bestTeammateTargetShare === null) return null;
  return facts.bestTeammateTargetShare >= TEAMMATE_PRIMARY_RECEIVER_SHARE && facts.bestTeammateTargetShare >= facts.targetShare;
}
export function playCallerFingerprintCondition(facts: LawConditionFacts): boolean | null {
  if (facts.incomingCoachTenureIsZero === null) return null;
  if (!facts.incomingCoachTenureIsZero) return false;
  return facts.incomingCoachPriorPassRateOverExpected === null ? null : facts.incomingCoachPriorPassRateOverExpected > 0;
}
export function targetSharePersistenceCondition(facts: LawConditionFacts): boolean | null {
  return facts.targetShare === null ? null : facts.targetShare >= TARGET_SHARE_PERSISTENCE_MIN;
}
export function tdRegressionCondition(facts: LawConditionFacts): boolean | null {
  if (facts.touchdownPointsShare === null || facts.touchdownPointsShareThreshold === null) return null;
  return facts.touchdownPointsShare >= facts.touchdownPointsShareThreshold;
}

function isSkillPosition(position: Position): position is LawPosition {
  return SKILL_POSITIONS.has(position as LawPosition);
}
const isRb = (position: Position): position is LawPosition => position === "RB";
const isWr = (position: Position): position is LawPosition => position === "WR";
const isWrOrTe = (position: Position): position is LawPosition => position === "WR" || position === "TE";

// Shared season-aggregation helpers.

interface SeasonScoring {
  readonly points: number;
  readonly games: number;
  readonly touchdownPoints: number;
  readonly receptions: number;
}

const EMPTY_SEASON_SCORING: SeasonScoring = { points: 0, games: 0, touchdownPoints: 0, receptions: 0 };

/** Points from a scoring play: passing/rushing/receiving TDs, return TDs and two-point conversions —
 *  every scoring-play term `computeFantasyPoints` (the denominator) also counts (MINOR 1). */
function touchdownPointsOf(line: StatLine, rules: ScoringRules): number {
  return (
    line.passingTouchdowns * rules.pointsPerPassingTouchdown +
    line.rushingTouchdowns * rules.pointsPerRushingTouchdown +
    line.receivingTouchdowns * rules.pointsPerReceivingTouchdown +
    ((line.kickReturnTouchdowns ?? 0) + (line.puntReturnTouchdowns ?? 0)) * rules.pointsPerReturnTouchdown +
    (line.twoPointConversions ?? 0) * rules.pointsPerTwoPointConversion
  );
}

/**
 * Points, games and touchdown points per player, summed over one season as of one moment.
 *
 * `admitDerived` is the EXPLICIT gate a fix round closed (C2): `factsForSeason`, this function's
 * caller, is used by TWO consumers, not one — `buildPopulations` (the laws harness) AND
 * `preseason/source.ts`'s `loadPreseason` (a PRODUCT SURFACE). Before this parameter existed,
 * `seasonScoring` called `statLinesAsOfForMeasurement` unconditionally, so BOTH consumers silently
 * got the pbp-derived fallback for a gap season — including the preseason board, which is exactly
 * the "must never render a row nflverse did not itself publish" rule this whole design exists to
 * keep. `admitDerived: true` calls `statLinesAsOfForMeasurement` (admits a derived row for a
 * `STAT_LINE_GAPS` season); `admitDerived: false` calls the bare `statLinesAsOf` (published only,
 * nothing for a gap season, exactly what every OTHER `statLinesAsOf` reader already sees). The laws
 * harness passes `true` from both `factsForSeason` and `actualPointsPerGame`; `loadPreseason` passes
 * `false` — see that call site's own comment.
 */
async function seasonScoring(
  db: ReadonlyDb, season: number, asOf: Date, positions: ReadonlyMap<string, Position>, rules: ScoringRules,
  admitDerived: boolean,
): Promise<Map<string, SeasonScoring>> {
  const rows = admitDerived
    ? await statLinesAsOfForMeasurement(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf })
    : await statLinesAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf });
  const out = new Map<string, SeasonScoring>();
  for (const { line } of rows) {
    const position = positions.get(line.playerId);
    if (position === undefined) continue;
    const existing = out.get(line.playerId) ?? EMPTY_SEASON_SCORING;
    out.set(line.playerId, {
      points: roundPoints(existing.points + computeFantasyPoints(line, position, rules)),
      games: existing.games + 1,
      touchdownPoints: roundPoints(existing.touchdownPoints + touchdownPointsOf(line, rules)),
      receptions: existing.receptions + line.receptions,
    });
  }
  return out;
}

function pointsPerGame(entry: SeasonScoring | undefined): number | null {
  return entry !== undefined && entry.games > 0 ? roundPoints(entry.points / entry.games) : null;
}

/** THE UNGATED READ — a season's real outcome, corrections included, at `FINAL_OUTCOME`. `admitDerived`
 *  passes straight through to `seasonScoring` — see that function's own docblock. */
async function actualPointsPerGame(
  db: ReadonlyDb, season: number, positions: ReadonlyMap<string, Position>, rules: ScoringRules,
  admitDerived: boolean,
): Promise<Map<string, number>> {
  const scoring = await seasonScoring(db, season, FINAL_OUTCOME, positions, rules, admitDerived);
  const out = new Map<string, number>();
  for (const [playerId, entry] of scoring) {
    const ppg = pointsPerGame(entry);
    if (ppg !== null) out.set(playerId, ppg);
  }
  return out;
}

interface SeasonParticipation {
  readonly targets: number;
  readonly teamTargets: number;
  readonly carries: number;
}

const EMPTY_PARTICIPATION: SeasonParticipation = { targets: 0, teamTargets: 0, carries: 0 };
const PARTICIPATION_SEASON_METRICS: ReadonlySet<string> = new Set([
  PARTICIPATION_METRICS.targets,
  PARTICIPATION_METRICS.teamTargets,
  PARTICIPATION_METRICS.carries,
]);

/** Targets, team targets and carries per player, summed over one season as of one moment. A player
 *  with NO row here has no participation evidence at all, distinct from a player whose row sums to
 *  zero — callers must keep that distinction (see `factsForSeason`'s `touches`/`targetShare`). */
async function seasonParticipation(db: ReadonlyDb, season: number, asOf: Date): Promise<Map<string, SeasonParticipation>> {
  const rows = await observationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, source: STAT_LINE_SOURCE });
  const out = new Map<string, SeasonParticipation>();
  for (const row of rows) {
    if (!PARTICIPATION_SEASON_METRICS.has(row.metric)) continue;
    const existing = out.get(row.playerId) ?? EMPTY_PARTICIPATION;
    out.set(row.playerId, {
      targets: existing.targets + (row.metric === PARTICIPATION_METRICS.targets ? row.value : 0),
      teamTargets: existing.teamTargets + (row.metric === PARTICIPATION_METRICS.teamTargets ? row.value : 0),
      carries: existing.carries + (row.metric === PARTICIPATION_METRICS.carries ? row.value : 0),
    });
  }
  return out;
}

/** A player's own season target share: his own targets over his own team_targets, summed across
 *  weeks. Self-consistent even for a traded player — each week's row already carries THAT week's
 *  actual team's totals, so no team-of-record grouping is needed here (unlike teammate grouping). */
function targetShareOf(participated: SeasonParticipation | undefined): number | null {
  return participated !== undefined && participated.teamTargets > 0 ? participated.targets / participated.teamTargets : null;
}

/** Each player's LATEST team of a season — the proxy for "his team" `play_caller_fingerprint` uses. */
async function seasonTeams(db: ReadonlyDb, season: number, asOf: Date): Promise<Map<string, string>> {
  const rows = await playerTeamsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf });
  const latest = new Map<string, { week: number; team: string }>();
  for (const row of rows) {
    const existing = latest.get(row.playerId);
    if (existing === undefined || row.week > existing.week) latest.set(row.playerId, { week: row.week, team: row.team });
  }
  return new Map([...latest].map(([playerId, { team }]) => [playerId, team]));
}

/**
 * The best individual target share among a WR/TE's own teammates, grouped WEEK BY WEEK rather than
 * by a single season-of-record team — a traded player's early-season targets belong to his OLD
 * team's roster and his late-season ones to his NEW team's, and a single "his team" grouping would
 * misattribute one or the other. Two players count as teammates if they shared a team in ANY week.
 * A player present in `playerTeamsAsOf` for at least one week (has SOME team edge) is a key in the
 * returned map even when he has zero qualifying teammates (a real, known zero); a player absent from
 * `playerTeamsAsOf` entirely is absent from the map (unknown, not zero — see `factsForSeason`).
 */
async function bestTeammateTargetShares(
  db: ReadonlyDb, season: number, asOf: Date, positions: ReadonlyMap<string, Position>, participation: ReadonlyMap<string, SeasonParticipation>,
): Promise<Map<string, number>> {
  const rows = await playerTeamsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf });
  const byWeekTeam = new Map<string, string[]>();
  for (const row of rows) {
    const position = positions.get(row.playerId);
    if (position === undefined || !isWrOrTe(position)) continue;
    const key = `${row.week}|${row.team}`;
    const list = byWeekTeam.get(key) ?? [];
    list.push(row.playerId);
    byWeekTeam.set(key, list);
  }
  const teammates = new Map<string, Set<string>>();
  for (const roster of byWeekTeam.values()) {
    for (const playerId of roster) {
      const set = teammates.get(playerId) ?? new Set<string>();
      for (const other of roster) if (other !== playerId) set.add(other);
      teammates.set(playerId, set);
    }
  }
  const best = new Map<string, number>();
  for (const [playerId, teammateIds] of teammates) {
    let max = 0;
    for (const id of teammateIds) {
      const share = targetShareOf(participation.get(id));
      if (share !== null && share > max) max = share;
    }
    best.set(playerId, max);
  }
  return best;
}

/** One team's incoming-play-caller facts, RAW rather than pre-collapsed to a boolean — the discovery
 *  generator wants the tenure count itself (`incomingCoachTenureSeasons`), not just "is it zero". */
interface IncomingCoachFacts {
  readonly tenureSeasons: number | null;
  readonly priorPassRateOverExpected: number | null;
}

/** Season-N+1 play-caller facts by team, stamped at N+1's own schedule publication (see `coaches.ts`).
 *  A team absent here — no row at all — is unknown, not a non-new coach with no history. */
async function incomingCoachFactsByTeam(db: ReadonlyDb, nextSeason: number, asOf: Date): Promise<Map<string, IncomingCoachFacts>> {
  const rows = await teamObservationsAsOf(db, { season: nextSeason, week: 1, asOf, source: SCHEDULE_SOURCE.schedule });
  const out = new Map<string, IncomingCoachFacts>();
  for (const row of rows) {
    if (row.metric !== COACH_METRICS.tenureSeasons && row.metric !== COACH_METRICS.priorPassRateOverExpected) continue;
    const existing = out.get(row.team) ?? { tenureSeasons: null, priorPassRateOverExpected: null };
    out.set(row.team, {
      tenureSeasons: row.metric === COACH_METRICS.tenureSeasons ? row.value : existing.tenureSeasons,
      priorPassRateOverExpected:
        row.metric === COACH_METRICS.priorPassRateOverExpected ? row.value : existing.priorPassRateOverExpected,
    });
  }
  return out;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** 1.5x the position-season median touchdown-points share, over skill-position REGULARS only —
 *  `MIN_GAMES_FOR_TD_MEDIAN` games, so a handful of one-game flukes cannot swing the whole median. */
function tdShareThresholds(scoring: ReadonlyMap<string, SeasonScoring>, positions: ReadonlyMap<string, Position>): Map<Position, number> {
  const sharesByPosition = new Map<Position, number[]>();
  for (const [playerId, entry] of scoring) {
    const position = positions.get(playerId);
    if (position === undefined || !isSkillPosition(position) || entry.points <= 0 || entry.games < MIN_GAMES_FOR_TD_MEDIAN) continue;
    const list = sharesByPosition.get(position) ?? [];
    list.push(entry.touchdownPoints / entry.points);
    sharesByPosition.set(position, list);
  }
  return new Map([...sharesByPosition].map(([position, shares]) => [position, TD_REGRESSION_MULTIPLIER * median(shares)]));
}

/** One player's law-condition inputs for one season, alongside the position and per-game scoring
 *  that pinned them. Exported so a live caller (a preseason board assembling `BoardCandidate`s, not
 *  just `buildPopulations`'s backtest) can ask the same question `lawReasonsFor` answers with. */
export interface SeasonFacts {
  readonly position: Position;
  readonly pointsPerGame: number;
  readonly facts: LawConditionFacts;
}

/**
 * Every antecedent quantity, for every player active in season N, at N+1's schedule-publication
 * gate. Exported for two callers now: `buildPopulations`, which calls this once per season across
 * every law in one pass, and `source.ts`'s `loadPreseason`, which calls it ONCE for the completed
 * season immediately before the board's own season — the exact "season N" a board for season N+1
 * needs — so a live board's law reasons and this module's own measurement read the identical gate.
 *
 * `admitDerived` is what keeps those two callers from silently sharing MORE than the gate (fix
 * round, C2): `buildPopulations` passes `true` (the laws harness is exactly where a pbp-derived
 * gap-season stat line belongs), `loadPreseason` passes `false` (the board reads published history
 * only, forever — see that call site's own comment for what a `true` there would have meant: a
 * 2020-season board's rb_age_curve chip partly computed from 2019 play-by-play, never checked by the
 * validation bar that gates the LAWS harness's own use of it).
 */
export async function factsForSeason(
  db: ReadonlyDb, season: number, positions: ReadonlyMap<string, Position>, rules: ScoringRules,
  admitDerived: boolean,
): Promise<Map<string, SeasonFacts>> {
  const asOf = schedulePublishedAsOf(season + 1);
  const scoring = await seasonScoring(db, season, asOf, positions, rules, admitDerived);
  const participation = await seasonParticipation(db, season, asOf);
  const teams = await seasonTeams(db, season, asOf);
  const roster = await preseasonRostersAsOf(db, { season, asOf });
  const coachFacts = await incomingCoachFactsByTeam(db, season + 1, asOf);
  const teammateShares = await bestTeammateTargetShares(db, season, asOf, positions, participation);

  const birthDates = new Map(roster.map((row) => [row.playerId, row.birthDate] as const));
  const thresholds = tdShareThresholds(scoring, positions);

  const out = new Map<string, SeasonFacts>();
  for (const [playerId, position] of positions) {
    const scored = scoring.get(playerId);
    const ppg = pointsPerGame(scored);
    if (scored === undefined || ppg === null) continue;
    const participated = participation.get(playerId);
    const team = teams.get(playerId);
    const coach = team === undefined ? undefined : coachFacts.get(team);
    out.set(playerId, {
      position,
      pointsPerGame: ppg,
      facts: {
        touches: participated === undefined ? null : participated.carries + scored.receptions,
        age: ageAtSeason(birthDates.get(playerId) ?? null, season),
        bestTeammateTargetShare: teammateShares.get(playerId) ?? null,
        incomingCoachTenureIsZero: coach?.tenureSeasons === undefined || coach.tenureSeasons === null ? null : coach.tenureSeasons === 0,
        incomingCoachPriorPassRateOverExpected: coach?.priorPassRateOverExpected ?? null,
        targetShare: targetShareOf(participated),
        touchdownPointsShare: scored.points > 0 ? scored.touchdownPoints / scored.points : null,
        touchdownPointsShareThreshold: thresholds.get(position) ?? null,
      },
    });
  }
  return out;
}

/**
 * THE DISCOVERY CANDIDATE QUANTITIES — a SIBLING to `LawConditionFacts`/`factsForSeason`, not an
 * edit to either. The six tribal laws' antecedents are hand-picked and fixed; a candidate generator
 * (`discovery/templates.ts`) instead needs a wider, uniform vocabulary of quantities it can cross
 * with quantile thresholds and position, without touching what the tribal harness or the live board
 * (`board-reasons.ts`) already reads. Every field below is read through the SAME as-of-gated store
 * functions `factsForSeason` uses — `seasonScoring`, `seasonParticipation`, `seasonTeams`,
 * `preseasonRostersAsOf`, `incomingCoachFactsByTeam` — plus two new aggregates over stores the laws
 * harness had not read from before (`usageAsOf` for snap/red-zone/target-depth, `teamObservationsAsOf`
 * for the team's own pace), never a new raw ingestion path.
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
 *  team-week facts — the TEAM's own pace that season, distinct from `incomingCoachFactsByTeam`'s
 *  incoming play-caller's PRIOR pace at other teams. */
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
 */
async function discoveryQuantitiesForSeason(
  db: ReadonlyDb, targetSeason: number, asOf: Date, positions: ReadonlyMap<string, Position>, rules: ScoringRules,
): Promise<Map<string, DiscoveryQuantityValues>> {
  const scoring = await seasonScoring(db, targetSeason, asOf, positions, rules, true);
  const participation = await seasonParticipation(db, targetSeason, asOf);
  const teams = await seasonTeams(db, targetSeason, asOf);
  const roster = await preseasonRostersAsOf(db, { season: targetSeason, asOf });
  const coachFacts = await incomingCoachFactsByTeam(db, targetSeason + 1, asOf);
  const usage = await seasonUsageAggregates(db, targetSeason, asOf);
  const snapCounts = await seasonSnapCounts(db, targetSeason, asOf);
  const pace = await seasonTeamPaceByTeam(db, targetSeason, asOf);

  const birthDates = new Map(roster.map((row) => [row.playerId, row.birthDate] as const));
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
 */
export async function discoveryFactsForSeason(
  db: ReadonlyDb, season: number, positions: ReadonlyMap<string, Position>, rules: ScoringRules,
): Promise<Map<string, DiscoveryFacts>> {
  const asOf = schedulePublishedAsOf(season + 1);
  const current = await discoveryQuantitiesForSeason(db, season, asOf, positions, rules);
  const prior = await discoveryQuantitiesForSeason(db, season - 1, asOf, positions, rules);

  const out = new Map<string, DiscoveryFacts>();
  for (const [playerId, values] of current) {
    const position = positions.get(playerId);
    if (position === undefined || !isSkillPosition(position)) continue;
    out.set(playerId, { position, current: values, prior: prior.get(playerId) ?? null });
  }
  return out;
}

interface LawEntry {
  readonly id: string;
  readonly position: Law["position"];
  readonly claim: string;
  readonly expectedSign: -1 | 1;
  readonly eligible: (position: Position) => position is LawPosition;
  readonly condition: (facts: LawConditionFacts) => boolean | null;
  /** See `LawSpec.modelPath`'s own docblock for what this means and why most laws leave it `null`. */
  readonly modelPath: string | null;
}

const LAW_ENTRIES: readonly LawEntry[] = [
  {
    id: "rb_workload_cliff",
    position: "RB",
    claim: "The workload cliff: a running back who racks up 300 or more combined carries and receptions in a season loses points per game the next season.",
    expectedSign: -1,
    eligible: isRb,
    condition: rbWorkloadCliffCondition,
    modelPath: null,
  },
  {
    id: "rb_age_curve",
    position: "RB",
    claim: "The running back age curve: a running back who is 28 or older at the season opener produces fewer points per game the following season than an otherwise similar younger back.",
    expectedSign: -1,
    eligible: isRb,
    condition: rbAgeCurveCondition,
    modelPath: null,
  },
  {
    id: "wr_target_competition",
    position: "WR",
    claim: "Another primary receiver on his team: a wide receiver with a WR/TE teammate whose own target share that same season is at least 20% and at least as large as the receiver's own share loses points per game the following season. Simplified: teammates are read from the season being measured, not from a predicted next-season arrival, because next season's roster is not knowable yet when the measurement is taken.",
    expectedSign: -1,
    eligible: isWr,
    condition: wrTargetCompetitionCondition,
    modelPath: "src/projections/model/redistribution-fit.ts#fitRedistributionPriors",
  },
  {
    id: "play_caller_fingerprint",
    position: "all",
    claim: "The play-caller fingerprint: a pass-catcher (WR or TE) whose team enters a season with a first-year play-caller (the coordinator or head coach who calls the offense's plays) whose own history elsewhere shows a positive pass-rate-over-expected gains points per game. Simplified: 'his team' means the team he played for in the season being measured, because next season's actual roster is not knowable at the time the measurement is taken; a player traded before the coaching change is still measured against his old team.",
    expectedSign: 1,
    eligible: isWrOrTe,
    condition: playCallerFingerprintCondition,
    modelPath: null,
  },
  {
    id: "target_share_persistence",
    position: "WR",
    claim: "Target share persistence: a wide receiver commanding 24% or more of his team's targets in a season sustains stronger points per game the following season than his raw scoring alone predicts.",
    expectedSign: 1,
    eligible: isWr,
    condition: targetSharePersistenceCondition,
    modelPath: "src/projections/model/opportunity.ts#predictOpportunity",
  },
  {
    id: "td_regression",
    position: "all",
    claim: "Touchdown regression: a player whose touchdown points make up at least 1.5x his position's typical share of a regular's own points (players with at least 8 games) in a season loses points per game the following season as touchdown luck reverts. Covers QB, RB, WR and TE; kickers and defenses are excluded because a touchdown-points share is not a meaningful quantity for them.",
    expectedSign: -1,
    eligible: isSkillPosition,
    condition: tdRegressionCondition,
    modelPath: "src/projections/model/efficiency.ts#TOUCHDOWN_RATES",
  },
];

/**
 * EVERY LAW'S CONDITION PREDICATE, KEYED BY ID — the one place a caller outside this module (Task
 * 7's `lawReasonsFor`, in `laws/board-reasons.ts`) reaches for "does this law's antecedent hold for
 * him", so a live board and this module's own `buildPopulations` measurement can never drift apart
 * by each re-deriving the same condition differently. Built from `LAW_ENTRIES`, never hand-listed.
 */
export const LAW_CONDITIONS: ReadonlyMap<string, (facts: LawConditionFacts) => boolean | null> = new Map(
  LAW_ENTRIES.map((entry) => [entry.id, entry.condition] as const),
);

/**
 * THE DETERMINISM ANCHOR — the one place every law's population is put into a canonical order
 * before any caller (matching, bootstrap) ever sees it.
 *
 * `buildPopulations` pushes rows in whatever order `allPositions`'s un-`ORDER BY`ed select and
 * `factsForSeason`'s `Map` iteration happen to hand back, and Postgres makes NO promise that order
 * is stable across a table rewrite, a `VACUUM FULL`, or a version upgrade — none of which touch a
 * single byte of DATA. That raw order flows all the way through `matchedPairsStratified`'s greedy
 * nearest-neighbor tie-breaks and `bootstrapCi`'s seeded, INDEXED resampling (`harness.ts`) into the
 * committed `measured.json`'s own bytes: a re-ingest that changed nothing about who played or what
 * they scored could still change a confidence interval's last few digits, which would make
 * `npm run laws:measure -- --check` a check on incidental storage order rather than on evidence.
 * Sorting by `(season, position, playerId)` — fields that exist for every point and together
 * identify it uniquely — makes every downstream step a pure function of the DATA. Every real caller
 * reaches this sort by calling `buildPopulations` (or `LawSpec.population`, which calls it too), so
 * this is the only place the order needs fixing.
 */
export function canonicalPointOrder(a: PlayerSeasonPoint, b: PlayerSeasonPoint): number {
  if (a.season !== b.season) return a.season - b.season;
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  if (a.playerId !== b.playerId) return a.playerId < b.playerId ? -1 : 1;
  return 0;
}

/**
 * EVERY LAW'S POPULATION, IN ONE PASS — `factsForSeason`/`actualPointsPerGame` run ONCE per season
 * regardless of how many of the six laws are being built, rather than once per (law, season) pair.
 * A null condition (see `LawConditionFacts`) drops that player-season from the returned population
 * entirely, for that law only — a player can be dropped from one law's population and present in
 * another's the same season.
 *
 * `admitDerived: true` on BOTH calls — the laws harness is exactly where a pbp-derived gap-season
 * stat line belongs (`factsForSeason`'s own docblock explains why `loadPreseason`, `factsForSeason`'s
 * other caller, passes `false` instead).
 */
export async function buildPopulations(db: ReadonlyDb, seasons: readonly number[]): Promise<ReadonlyMap<string, readonly PlayerSeasonPoint[]>> {
  const positions = await allPositions(db);
  const out = new Map<string, PlayerSeasonPoint[]>(LAW_ENTRIES.map((entry) => [entry.id, []]));
  for (const season of seasons) {
    const seasonFacts = await factsForSeason(db, season, positions, PPR_SCORING, true);
    const nextActual = await actualPointsPerGame(db, season + 1, positions, PPR_SCORING, true);
    for (const [playerId, entry] of seasonFacts) {
      const { position } = entry;
      for (const law of LAW_ENTRIES) {
        if (!law.eligible(position)) continue;
        const condition = law.condition(entry.facts);
        if (condition === null) continue;
        out.get(law.id)!.push({
          playerId,
          season,
          position,
          pointsPerGame: entry.pointsPerGame,
          nextPointsPerGame: nextActual.get(playerId) ?? null,
          matchKey: entry.pointsPerGame,
          condition,
        });
      }
    }
  }
  for (const points of out.values()) points.sort(canonicalPointOrder);
  return out;
}

/** One law's population, implemented over the shared batch path — kept for tests and for `LawSpec`'s
 *  narrower contract; a caller building all six should use `buildPopulations` directly instead. */
async function populationFor(db: ReadonlyDb, seasons: readonly number[], lawId: string): Promise<readonly PlayerSeasonPoint[]> {
  const all = await buildPopulations(db, seasons);
  return all.get(lawId) ?? [];
}

export const LAW_SPECS: readonly LawSpec[] = LAW_ENTRIES.map((entry) => ({
  id: entry.id,
  position: entry.position,
  claim: entry.claim,
  expectedSign: entry.expectedSign,
  caliper: POINTS_PER_GAME_CALIPER,
  modelPath: entry.modelPath,
  population: (db, seasons) => populationFor(db, seasons, entry.id),
}));
