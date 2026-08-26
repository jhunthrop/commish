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
  /**
   * True for a seat filled by the mock lane's own named, seeded sampler (Phase 4.5, Task 8),
   * set from `users.is_bot` by `listTeamCards`. Optional, defaulting falsy everywhere a caller
   * reads it (`team.isBot === true`) — the same convention `DraftConfig.isMock` already uses
   * (`@/draft-engine`'s own docblock): every `TeamCard` a real league's own reads
   * (`@/league-service/read.ts`, `results.ts`, every existing fixture across `league-room` and
   * `draft-room`) never populates this field, and an absent field means "not a bot" exactly the
   * way it already means "not a mock" there. A real team is never a bot; a mock room's human
   * seats aren't either — only a mock room's bot-drafted seats set this `true`.
   */
  readonly isBot?: boolean;
}
