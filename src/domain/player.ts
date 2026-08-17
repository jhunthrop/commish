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
}
