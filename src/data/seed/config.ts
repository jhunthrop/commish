export const DEV_SEED = {
  teamCount: 12,
  /** Hours from "now" to the seeded drafts' kickoff — far enough out to sit in a slow clock tier. */
  kickoffHoursFromNow: 26,
  /**
   * Dev-only local user ids. These are NOT WorkOS user ids: WorkOS owns real identity and
   * writes its own `users` rows from the AuthKit callback. These placeholder rows exist so a
   * seeded league has 12 owners to draft against locally, and nothing else.
   */
  userIdPrefix: "dev_user_",
  emailDomain: "dev.commish.local",
  /**
   * Set DEV_SEED_CLAIM_USER_ID to your real (WorkOS) user id after signing in once, and the
   * seed hands you team 1 and the commissioner's chair in both leagues — so you can actually
   * start and act in a seeded draft.
   */
  claimUserIdEnvVar: "DEV_SEED_CLAIM_USER_ID",
  snake: { leagueId: "dev_league_snake", draftId: "dev_draft_snake", inviteCode: "DEVSNAKE", name: "Dev Snake League" },
  auction: { leagueId: "dev_league_auction", draftId: "dev_draft_auction", inviteCode: "DEVAUCTION", name: "Dev Auction League", budget: 200 },
} as const;
