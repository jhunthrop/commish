import type { Position, StatLine } from "@/domain/player";
import type { ScoringSettings } from "@/domain/scoring";

export type ScoringRules = Omit<ScoringSettings, "leagueId">;

/**
 * The product's one rounding rule for fantasy points: two decimal places. Exported because
 * standings sum already-rounded weekly scores and must round the total identically — two
 * helpers is how a standings page ends up disagreeing with the matchup page it links to.
 */
export function roundPoints(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * THE DEFENSE TIER TABLES (the scoring-vocabulary widening, 2026-08-30): points and yards
 * allowed are scored in the industry's own fixed brackets, not per-unit weights. Applied to DEF
 * lines ONLY — a skill player's zero pointsAllowed is "not a defense", never a shutout — and
 * the tables are the standard sheet every incumbent ships. A configurable tier editor is a
 * later commissioner feature; the shape lives here so the values have exactly one spelling.
 */
const POINTS_ALLOWED_TIERS: readonly (readonly [number, number])[] = [
  [0, 5], [6, 4], [13, 3], [17, 1], [27, 0], [34, -1], [45, -3], [Infinity, -5],
];
const YARDS_ALLOWED_TIERS: readonly (readonly [number, number])[] = [
  [99, 5], [199, 3], [299, 2], [349, 0], [399, -1], [449, -3], [499, -5], [549, -6], [Infinity, -7],
];

function tierPoints(value: number, tiers: readonly (readonly [number, number])[]): number {
  for (const [ceiling, points] of tiers) if (value <= ceiling) return points;
  return 0;
}

/** Pure. Every stat category is weighted by the league's configurable settings — no magic numbers here. */
export function computeFantasyPoints(statLine: StatLine, position: Position, rules: ScoringRules): number {
  const receptionPoints = statLine.receptions * (rules.pointsPerReception + (position === "TE" ? rules.teReceptionBonus : 0));
  // DEF only, and only when the category was RECORDED: a line predating the widening carries no
  // pointsAllowed/yardsAllowed at all (undefined), and scoring an absence as a shutout would be
  // an invented +10. The optional-field absence IS the "not recorded" signal.
  const defenseTierPoints =
    position !== "DEF"
      ? 0
      : (statLine.pointsAllowed === undefined ? 0 : tierPoints(statLine.pointsAllowed, POINTS_ALLOWED_TIERS)) +
        (statLine.yardsAllowed === undefined ? 0 : tierPoints(statLine.yardsAllowed, YARDS_ALLOWED_TIERS));
  const total =
    statLine.passingYards * rules.pointsPerPassingYard +
    statLine.passingTouchdowns * rules.pointsPerPassingTouchdown +
    statLine.interceptions * rules.pointsPerInterception +
    statLine.rushingYards * rules.pointsPerRushingYard +
    statLine.rushingTouchdowns * rules.pointsPerRushingTouchdown +
    statLine.receivingYards * rules.pointsPerReceivingYard +
    statLine.receivingTouchdowns * rules.pointsPerReceivingTouchdown +
    receptionPoints +
    statLine.fumblesLost * rules.pointsPerFumbleLost +
    statLine.fieldGoalsMade * rules.pointsPerFieldGoal +
    statLine.extraPointsMade * rules.pointsPerExtraPoint +
    statLine.sacks * rules.pointsPerSack +
    statLine.defensiveInterceptions * rules.pointsPerDefensiveInterception +
    statLine.defensiveTouchdowns * rules.pointsPerDefensiveTouchdown +
    (statLine.twoPointConversions ?? 0) * rules.pointsPerTwoPointConversion +
    (statLine.fieldGoalsMissed ?? 0) * rules.pointsPerFieldGoalMissed +
    (statLine.extraPointsMissed ?? 0) * rules.pointsPerExtraPointMissed +
    ((statLine.kickReturnTouchdowns ?? 0) + (statLine.puntReturnTouchdowns ?? 0)) * rules.pointsPerReturnTouchdown +
    (statLine.defensiveFumblesRecovered ?? 0) * rules.pointsPerDefensiveFumbleRecovery +
    (statLine.safeties ?? 0) * rules.pointsPerSafety +
    defenseTierPoints;
  return roundPoints(total);
}

export interface Starter {
  readonly playerId: string;
  readonly position: Position;
}

export interface ScoreLineupInput {
  readonly starters: readonly Starter[];
  readonly statLinesByPlayerId: ReadonlyMap<string, StatLine>;
  readonly settings: ScoringRules;
}

export interface LineupScore {
  readonly total: number;
  readonly byPlayer: ReadonlyMap<string, number>;
}

/**
 * A starter with no stat line (bye week / did not play) scores 0 — never throws.
 *
 * `starters` is assumed to contain no duplicate `playerId` (upstream validation enforces
 * this). If it did, `total` would count that player's points once per occurrence while
 * `byPlayer` — keyed by playerId — would keep only the last write.
 */
export function scoreLineup({ starters, statLinesByPlayerId, settings }: ScoreLineupInput): LineupScore {
  const byPlayer = new Map<string, number>();
  let total = 0;
  for (const starter of starters) {
    const line = statLinesByPlayerId.get(starter.playerId);
    const pts = line === undefined ? 0 : computeFantasyPoints(line, starter.position, settings);
    byPlayer.set(starter.playerId, pts);
    total += pts;
  }
  return { total: roundPoints(total), byPlayer };
}
