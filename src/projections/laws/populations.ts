import type { ReadonlyDb } from "@/db/client";
import type { Position, StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@/scoring/compute";
import { allPositions } from "../backtest";
import { statLinesAsOf, STAT_LINE_SOURCE } from "../lines";
import { PARTICIPATION_METRICS } from "../nflverse/map";
import { COACH_METRICS } from "../nflverse/coaches";
import { schedulePublishedAsOf, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { ageAtSeason } from "../preseason/availability";
import { preseasonRostersAsOf } from "../preseason/store";
import { LAST_POSSIBLE_WEEK, observationsAsOf } from "../store";
import { playerTeamsAsOf, teamObservationsAsOf } from "../team-store";
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
 * TWO SIMPLIFICATIONS RECUR, both forced by one fact: nothing about a player's SEASON N+1 team is
 * knowable at that gate (transactions aren't a source this engine reads; N+1 week-one rosters aren't
 * filed until cutdown, months later). Builders that would want "his team next season" use his own
 * SEASON N team instead (`seasonTeams`), and every `claim` that relies on it says so.
 *
 * `PARTICIPATION_METRICS` (targets, carries, team denominators) are read through `observationsAsOf`
 * directly rather than `statLinesAsOf`, which deliberately filters them out ("not stat fields... an
 * outcome is not a feature") — a population that needs them reads the store's other half.
 */

const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

/** One law's static content plus the population its measurement is drawn from. */
export interface LawSpec {
  readonly id: string;
  readonly position: Law["position"];
  readonly claim: string;
  readonly expectedSign: -1 | 1;
  readonly caliper: number;
  readonly modelPath: string | null;
  readonly population: (db: ReadonlyDb, seasons: readonly number[]) => Promise<readonly PlayerSeasonPoint[]>;
}

/**
 * PER-PLAYER QUANTITIES every law's antecedent reads. Exported so a future board caller (Task 7)
 * can ask "does this law's condition hold for him" with the exact predicate it was measured with.
 */
export interface LawConditionFacts {
  /** Carries + receptions, season N (rb_workload_cliff). */
  readonly touches: number;
  /** Years old at season N's opener, or null if unknown (rb_age_curve). */
  readonly age: number | null;
  /** Share of the team's WR/TE targets claimed by teammates, season N (wr_target_competition). */
  readonly otherWrTeTargetShare: number | null;
  /** The season-N team's season-N+1 coach — zero tenure and a positive prior PROE (play_caller_fingerprint). */
  readonly incomingCoachTenureIsZero: boolean;
  readonly incomingCoachPriorPassRateOverExpected: number | null;
  /** Share of the team's targets claimed, season N (target_share_persistence). */
  readonly targetShare: number | null;
  /** Share of own points from touchdowns, and 1.5x the position-season median (td_regression). */
  readonly touchdownPointsShare: number | null;
  readonly touchdownPointsShareThreshold: number | null;
}

const WORKLOAD_CLIFF_TOUCHES = 300;
const AGE_CLIFF_YEARS = 28;
const TARGET_COMPETITION_SHARE = 0.6;
const TARGET_SHARE_PERSISTENCE_MIN = 0.24;
const TD_REGRESSION_MULTIPLIER = 1.5;
/** Points/game — the band within which two player-seasons count as "otherwise similar". */
const POINTS_PER_GAME_CALIPER = 2;
const SKILL_POSITIONS: ReadonlySet<Position> = new Set(["QB", "RB", "WR", "TE"]);

export function rbWorkloadCliffCondition(facts: LawConditionFacts): boolean {
  return facts.touches >= WORKLOAD_CLIFF_TOUCHES;
}
export function rbAgeCurveCondition(facts: LawConditionFacts): boolean {
  return facts.age !== null && facts.age >= AGE_CLIFF_YEARS;
}
export function wrTargetCompetitionCondition(facts: LawConditionFacts): boolean {
  return facts.otherWrTeTargetShare !== null && facts.otherWrTeTargetShare > TARGET_COMPETITION_SHARE;
}
export function playCallerFingerprintCondition(facts: LawConditionFacts): boolean {
  return (
    facts.incomingCoachTenureIsZero &&
    facts.incomingCoachPriorPassRateOverExpected !== null &&
    facts.incomingCoachPriorPassRateOverExpected > 0
  );
}
export function targetSharePersistenceCondition(facts: LawConditionFacts): boolean {
  return facts.targetShare !== null && facts.targetShare >= TARGET_SHARE_PERSISTENCE_MIN;
}
export function tdRegressionCondition(facts: LawConditionFacts): boolean {
  return (
    facts.touchdownPointsShare !== null &&
    facts.touchdownPointsShareThreshold !== null &&
    facts.touchdownPointsShare >= facts.touchdownPointsShareThreshold
  );
}

const isRb = (position: Position): boolean => position === "RB";
const isWr = (position: Position): boolean => position === "WR";
const isWrOrTe = (position: Position): boolean => position === "WR" || position === "TE";
const isTdRegressionEligible = (position: Position): boolean => SKILL_POSITIONS.has(position);

// Shared season-aggregation helpers.

interface SeasonScoring {
  readonly points: number;
  readonly games: number;
  readonly touchdownPoints: number;
  readonly receptions: number;
}

const EMPTY_SEASON_SCORING: SeasonScoring = { points: 0, games: 0, touchdownPoints: 0, receptions: 0 };

function touchdownPointsOf(line: StatLine, rules: ScoringRules): number {
  return (
    line.passingTouchdowns * rules.pointsPerPassingTouchdown +
    line.rushingTouchdowns * rules.pointsPerRushingTouchdown +
    line.receivingTouchdowns * rules.pointsPerReceivingTouchdown
  );
}

/** Points, games and touchdown points per player, summed over one season as of one moment. */
async function seasonScoring(
  db: ReadonlyDb, season: number, asOf: Date, positions: ReadonlyMap<string, Position>, rules: ScoringRules,
): Promise<Map<string, SeasonScoring>> {
  const rows = await statLinesAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf });
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

/** THE UNGATED READ — a season's real outcome, corrections included, at `FINAL_OUTCOME`. */
async function actualPointsPerGame(
  db: ReadonlyDb, season: number, positions: ReadonlyMap<string, Position>, rules: ScoringRules,
): Promise<Map<string, number>> {
  const scoring = await seasonScoring(db, season, FINAL_OUTCOME, positions, rules);
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
const PARTICIPATION_SEASON_METRICS: readonly string[] = [
  PARTICIPATION_METRICS.targets,
  PARTICIPATION_METRICS.teamTargets,
  PARTICIPATION_METRICS.carries,
];

/** Targets, team targets and carries per player, summed over one season as of one moment. */
async function seasonParticipation(db: ReadonlyDb, season: number, asOf: Date): Promise<Map<string, SeasonParticipation>> {
  const rows = await observationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, source: STAT_LINE_SOURCE });
  const out = new Map<string, SeasonParticipation>();
  for (const row of rows) {
    if (!PARTICIPATION_SEASON_METRICS.includes(row.metric)) continue;
    const existing = out.get(row.playerId) ?? EMPTY_PARTICIPATION;
    out.set(row.playerId, {
      targets: existing.targets + (row.metric === PARTICIPATION_METRICS.targets ? row.value : 0),
      teamTargets: existing.teamTargets + (row.metric === PARTICIPATION_METRICS.teamTargets ? row.value : 0),
      carries: existing.carries + (row.metric === PARTICIPATION_METRICS.carries ? row.value : 0),
    });
  }
  return out;
}

/** Each player's LATEST team of a season — the proxy for "his team" the module docblock explains. */
async function seasonTeams(db: ReadonlyDb, season: number, asOf: Date): Promise<Map<string, string>> {
  const rows = await playerTeamsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf });
  const latest = new Map<string, { week: number; team: string }>();
  for (const row of rows) {
    const existing = latest.get(row.playerId);
    if (existing === undefined || row.week > existing.week) latest.set(row.playerId, { week: row.week, team: row.team });
  }
  return new Map([...latest].map(([playerId, { team }]) => [playerId, team]));
}

/** Share of a team's WR/TE target volume claimed by everyone EXCEPT the player himself. */
function otherWrTeTargetShares(
  participation: ReadonlyMap<string, SeasonParticipation>, positions: ReadonlyMap<string, Position>, teams: ReadonlyMap<string, string>,
): Map<string, number> {
  const byTeam = new Map<string, { playerId: string; targets: number }[]>();
  for (const [playerId, position] of positions) {
    if (!isWrOrTe(position)) continue;
    const team = teams.get(playerId);
    if (team === undefined) continue;
    const list = byTeam.get(team) ?? [];
    list.push({ playerId, targets: participation.get(playerId)?.targets ?? 0 });
    byTeam.set(team, list);
  }
  const shares = new Map<string, number>();
  for (const list of byTeam.values()) {
    const total = list.reduce((sum, entry) => sum + entry.targets, 0);
    if (total === 0) continue;
    for (const entry of list) shares.set(entry.playerId, (total - entry.targets) / total);
  }
  return shares;
}

/** Season-N+1 coaching facts by team, stamped at N+1's own schedule publication (see `coaches.ts`). */
async function incomingCoachFactsByTeam(
  db: ReadonlyDb, nextSeason: number, asOf: Date,
): Promise<Map<string, { tenureIsZero: boolean; priorPassRateOverExpected: number | null }>> {
  const rows = await teamObservationsAsOf(db, { season: nextSeason, week: 1, asOf, source: SCHEDULE_SOURCE.schedule });
  const out = new Map<string, { tenureIsZero: boolean; priorPassRateOverExpected: number | null }>();
  for (const row of rows) {
    if (row.metric !== COACH_METRICS.tenureSeasons && row.metric !== COACH_METRICS.priorPassRateOverExpected) continue;
    const existing = out.get(row.team) ?? { tenureIsZero: false, priorPassRateOverExpected: null };
    out.set(row.team, {
      tenureIsZero: row.metric === COACH_METRICS.tenureSeasons ? row.value === 0 : existing.tenureIsZero,
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

/** 1.5x the position-season median touchdown-points share, over the skill positions only. */
function tdShareThresholds(scoring: ReadonlyMap<string, SeasonScoring>, positions: ReadonlyMap<string, Position>): Map<Position, number> {
  const sharesByPosition = new Map<Position, number[]>();
  for (const [playerId, entry] of scoring) {
    const position = positions.get(playerId);
    if (position === undefined || !isTdRegressionEligible(position) || entry.points <= 0) continue;
    const list = sharesByPosition.get(position) ?? [];
    list.push(entry.touchdownPoints / entry.points);
    sharesByPosition.set(position, list);
  }
  return new Map([...sharesByPosition].map(([position, shares]) => [position, TD_REGRESSION_MULTIPLIER * median(shares)]));
}

interface SeasonFacts {
  readonly position: Position;
  readonly pointsPerGame: number;
  readonly facts: LawConditionFacts;
}

/** Every antecedent quantity, for every player active in season N, at N+1's schedule-publication gate. */
async function factsForSeason(
  db: ReadonlyDb, season: number, positions: ReadonlyMap<string, Position>, rules: ScoringRules,
): Promise<Map<string, SeasonFacts>> {
  const asOf = schedulePublishedAsOf(season + 1);
  const scoring = await seasonScoring(db, season, asOf, positions, rules);
  const participation = await seasonParticipation(db, season, asOf);
  const teams = await seasonTeams(db, season, asOf);
  const roster = await preseasonRostersAsOf(db, { season, asOf });
  const coachFacts = await incomingCoachFactsByTeam(db, season + 1, asOf);

  const birthDates = new Map(roster.map((row) => [row.playerId, row.birthDate] as const));
  const otherShares = otherWrTeTargetShares(participation, positions, teams);
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
        touches: (participated?.carries ?? 0) + scored.receptions,
        age: ageAtSeason(birthDates.get(playerId) ?? null, season),
        otherWrTeTargetShare: otherShares.get(playerId) ?? null,
        incomingCoachTenureIsZero: coach?.tenureIsZero ?? false,
        incomingCoachPriorPassRateOverExpected: coach?.priorPassRateOverExpected ?? null,
        targetShare:
          participated !== undefined && participated.teamTargets > 0 ? participated.targets / participated.teamTargets : null,
        touchdownPointsShare: scored.points > 0 ? scored.touchdownPoints / scored.points : null,
        touchdownPointsShareThreshold: thresholds.get(position) ?? null,
      },
    });
  }
  return out;
}

/** THE ONE BUILDER every `LawSpec` composes: gated N facts paired with N+1's ungated actual. */
async function buildPopulation(
  db: ReadonlyDb, seasons: readonly number[], eligible: (position: Position) => boolean, condition: (facts: LawConditionFacts) => boolean,
): Promise<readonly PlayerSeasonPoint[]> {
  const positions = await allPositions(db);
  const points: PlayerSeasonPoint[] = [];
  for (const season of seasons) {
    const seasonFacts = await factsForSeason(db, season, positions, PPR_SCORING);
    const nextActual = await actualPointsPerGame(db, season + 1, positions, PPR_SCORING);
    for (const [playerId, entry] of seasonFacts) {
      if (!eligible(entry.position)) continue;
      points.push({
        playerId,
        season,
        pointsPerGame: entry.pointsPerGame,
        nextPointsPerGame: nextActual.get(playerId) ?? null,
        matchKey: entry.pointsPerGame,
        condition: condition(entry.facts),
      });
    }
  }
  return points;
}

export const LAW_SPECS: readonly LawSpec[] = [
  {
    id: "rb_workload_cliff",
    position: "RB",
    claim: "A running back who racks up 300 or more combined carries and receptions in a season loses points per game the next season — the workload cliff.",
    expectedSign: -1,
    caliper: POINTS_PER_GAME_CALIPER,
    modelPath: null,
    population: (db, seasons) => buildPopulation(db, seasons, isRb, rbWorkloadCliffCondition),
  },
  {
    id: "rb_age_curve",
    position: "RB",
    claim: "A running back who is 28 or older at the season opener produces fewer points per game the following season than an otherwise similar younger back — the running back age curve.",
    expectedSign: -1,
    caliper: POINTS_PER_GAME_CALIPER,
    modelPath: null,
    population: (db, seasons) => buildPopulation(db, seasons, isRb, rbAgeCurveCondition),
  },
  {
    id: "wr_target_competition",
    position: "WR",
    claim: "A wide receiver whose teammates at WR/TE combined for more than 60% of the team's target volume among that group loses points per game the following season — target competition. SIMPLIFIED: this measures competition already on the roster in the measured season (teammates' share of the team's own WR/TE targets), not a predicted season-N+1 arrival, because no store this engine reads can see next season's roster before it exists. The effect is measured on the incumbent receiver.",
    expectedSign: -1,
    caliper: POINTS_PER_GAME_CALIPER,
    modelPath: null,
    population: (db, seasons) => buildPopulation(db, seasons, isWr, wrTargetCompetitionCondition),
  },
  {
    id: "play_caller_fingerprint",
    position: "all",
    claim: "A pass-catcher (WR or TE) whose team enters a season with a first-year head coach whose own history elsewhere shows a positive pass-rate-over-expected gains points per game — the play-caller fingerprint. SIMPLIFIED: 'his team' is the player's own team as of the measured season, since the following season's actual roster is not knowable at the schedule-publication gate; a player traded before the coaching change is measured against his old team.",
    expectedSign: 1,
    caliper: POINTS_PER_GAME_CALIPER,
    modelPath: null,
    population: (db, seasons) => buildPopulation(db, seasons, isWrOrTe, playCallerFingerprintCondition),
  },
  {
    id: "target_share_persistence",
    position: "WR",
    claim: "A wide receiver commanding 24% or more of his team's targets in a season sustains stronger points per game the following season than his raw scoring alone predicts — target share persistence.",
    expectedSign: 1,
    caliper: POINTS_PER_GAME_CALIPER,
    modelPath: null,
    population: (db, seasons) => buildPopulation(db, seasons, isWr, targetSharePersistenceCondition),
  },
  {
    id: "td_regression",
    position: "all",
    claim: "A player whose touchdown points make up at least 1.5x his position's typical share of a player's own points in a season loses points per game the following season as touchdown luck reverts — touchdown regression. Covers QB, RB, WR and TE; kickers and defenses are excluded because a touchdown-points share is not a meaningful quantity for them.",
    expectedSign: -1,
    caliper: POINTS_PER_GAME_CALIPER,
    modelPath: null,
    population: (db, seasons) => buildPopulation(db, seasons, isTdRegressionEligible, tdRegressionCondition),
  },
];
