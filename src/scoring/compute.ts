import type { Position, StatLine } from "@/domain/player";
import type { ScoringSettings } from "@/domain/scoring";

export type ScoringRules = Omit<ScoringSettings, "leagueId">;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pure. Every stat category is weighted by the league's configurable settings — no magic numbers here. */
export function computeFantasyPoints(s: StatLine, position: Position, r: ScoringRules): number {
  const receptionPoints = s.receptions * (r.pointsPerReception + (position === "TE" ? r.teReceptionBonus : 0));
  const total =
    s.passingYards * r.pointsPerPassingYard +
    s.passingTouchdowns * r.pointsPerPassingTouchdown +
    s.interceptions * r.pointsPerInterception +
    s.rushingYards * r.pointsPerRushingYard +
    s.rushingTouchdowns * r.pointsPerRushingTouchdown +
    s.receivingYards * r.pointsPerReceivingYard +
    s.receivingTouchdowns * r.pointsPerReceivingTouchdown +
    receptionPoints +
    s.fumblesLost * r.pointsPerFumbleLost +
    s.fieldGoalsMade * r.pointsPerFieldGoal +
    s.extraPointsMade * r.pointsPerExtraPoint +
    s.sacks * r.pointsPerSack +
    s.defensiveInterceptions * r.pointsPerDefensiveInterception +
    s.defensiveTouchdowns * r.pointsPerDefensiveTouchdown;
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

/** A starter with no stat line (bye week / did not play) scores 0 — never throws. */
export function scoreLineup({ starters, statLinesByPlayerId, settings }: ScoreLineupInput): LineupScore {
  const byPlayer = new Map<string, number>();
  let total = 0;
  for (const st of starters) {
    const line = statLinesByPlayerId.get(st.playerId);
    const pts = line === undefined ? 0 : computeFantasyPoints(line, st.position, settings);
    byPlayer.set(st.playerId, pts);
    total += pts;
  }
  return { total: round2(total), byPlayer };
}
