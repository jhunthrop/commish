import type { Position, StatLine } from "@/domain/player";
import type { ScoringSettings } from "@/domain/scoring";

export type ScoringRules = Omit<ScoringSettings, "leagueId">;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pure. Every stat category is weighted by the league's configurable settings — no magic numbers here. */
export function computeFantasyPoints(statLine: StatLine, position: Position, rules: ScoringRules): number {
  const receptionPoints = statLine.receptions * (rules.pointsPerReception + (position === "TE" ? rules.teReceptionBonus : 0));
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
    statLine.defensiveTouchdowns * rules.pointsPerDefensiveTouchdown;
  return round2(total);
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
  return { total: round2(total), byPlayer };
}
