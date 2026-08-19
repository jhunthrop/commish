export type DraftFormat = "snake" | "auction";

/**
 * A team as a room renders it: the team plus its owner's public profile. Pure DTO — no
 * secrets, no email, nothing a leaguemate should not see.
 */
export interface TeamCard {
  readonly id: string;
  readonly name: string;
  readonly ownerDisplayName: string;
  /** The owner's STORED avatar ref (`users.avatar_url`), not a URL — `parseAvatarRef`
   *  (`@/identity/avatars`) decides what it is. The field keeps its original name because
   *  every caller already reads it as a prop named `ownerAvatarUrl`; only its meaning changed. */
  readonly ownerAvatarUrl: string | null;
}
