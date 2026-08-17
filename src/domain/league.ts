export type DraftFormat = "snake" | "auction";

export interface League {
  readonly id: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly stakeTier: number;
  readonly isPublicMatchmade: boolean;
  readonly commissionerUserId: string;
  readonly createdAt: string;
}

export interface Team {
  readonly id: string;
  readonly leagueId: string;
  readonly userId: string;
  readonly name: string;
}
