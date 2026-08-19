export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  readonly nflTeam: string;
}

export interface StatLine {
  readonly playerId: string;
  readonly week: number;
  readonly passingYards: number;
  readonly passingTouchdowns: number;
  readonly interceptions: number;
  readonly rushingYards: number;
  readonly rushingTouchdowns: number;
  readonly receivingYards: number;
  readonly receivingTouchdowns: number;
  readonly receptions: number;
  readonly fumblesLost: number;
  readonly fieldGoalsMade: number;
  readonly extraPointsMade: number;
  readonly sacks: number;
  readonly defensiveInterceptions: number;
  readonly defensiveTouchdowns: number;
}

/**
 * Canonical order of every numeric stat field on a `StatLine`. One list, two readers:
 * `src/stats-pipeline/digest.ts` joins values in this order to build a player's per-tick digest,
 * and the `StatsProvider` contract suite (`src/stats/test-support.ts`) walks it field by field to
 * assert every provider returns a finite number for each one. Keeping a single canonical list is
 * what stops the digest and the contract suite from silently drifting apart when a stat field is
 * added or renamed.
 */
export const STAT_FIELDS = [
  "passingYards",
  "passingTouchdowns",
  "interceptions",
  "rushingYards",
  "rushingTouchdowns",
  "receivingYards",
  "receivingTouchdowns",
  "receptions",
  "fumblesLost",
  "fieldGoalsMade",
  "extraPointsMade",
  "sacks",
  "defensiveInterceptions",
  "defensiveTouchdowns",
] as const satisfies readonly (keyof Omit<StatLine, "playerId" | "week">)[];
