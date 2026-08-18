export const DEV_SEED = {
  teamCount: 12,
  /**
   * Hours from "now" to the seeded drafts' kickoff. Zero puts the seeded room straight into
   * the schedule's floor tier — live draft-night pace (1:30 per pick) — which is the
   * experience the dev leagues exist to demo. Raise it to walk the tightening tiers.
   */
  kickoffHoursFromNow: 0,
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
  /** Characterful names so a board of dev teams reads like a league, not a numbering bug. */
  teamNames: [
    "Bay Bandits",
    "Iron Owls",
    "Prairie Kings",
    "Neon Norsemen",
    "Dust Devils",
    "Harbor Hawks",
    "Midnight Mules",
    "Copper Coyotes",
    "Static Stallions",
    "Vault Vipers",
    "Grim Griffins",
    "Last Call Lions",
  ],
  snake: { leagueId: "dev_league_snake", draftId: "dev_draft_snake", name: "Dev Snake League" },
  auction: { leagueId: "dev_league_auction", draftId: "dev_draft_auction", name: "Dev Auction League", budget: 200 },
  season: { leagueId: "dev_league_season", draftId: "dev_draft_season", name: "Dev Season League" },
} as const;
