export type DraftFormat = "snake" | "auction";

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
