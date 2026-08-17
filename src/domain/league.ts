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

/**
 * A team as a room renders it: the team plus its owner's public profile. Pure DTO — no
 * secrets, no email, nothing a leaguemate should not see.
 */
export interface TeamCard {
  readonly id: string;
  readonly name: string;
  readonly ownerDisplayName: string;
  readonly ownerAvatarUrl: string | null;
}
