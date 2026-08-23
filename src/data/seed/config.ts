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
  /**
   * The open leagues the public browse page demonstrates. Chosen so every filter control
   * narrows something real: both formats, both experience tiers, four stake tiers, fill levels
   * from nearly empty to nearly full, plus one deliberately FULL league that must NOT appear in
   * a browse — that is what proves the open-seat rule with a real row instead of a unit test.
   */
  publicLeagues: [
    { leagueId: "dev_public_rookie_snake", draftId: "dev_public_rookie_snake_draft", name: "Rookie Snake Room", format: "snake" as const, experienceTier: "beginner" as const, stakeTier: 0, teamCount: 12, filled: 3 },
    { leagueId: "dev_public_sunday_snake", draftId: "dev_public_sunday_snake_draft", name: "Sunday Regulars", format: "snake" as const, experienceTier: "experienced" as const, stakeTier: 1, teamCount: 12, filled: 8 },
    { leagueId: "dev_public_first_auction", draftId: "dev_public_first_auction_draft", name: "First Auction, No Pressure", format: "auction" as const, experienceTier: "beginner" as const, stakeTier: 0, teamCount: 10, filled: 5 },
    { leagueId: "dev_public_sharks_auction", draftId: "dev_public_sharks_auction_draft", name: "Sharks Only Auction", format: "auction" as const, experienceTier: "experienced" as const, stakeTier: 3, teamCount: 10, filled: 9 },
    { leagueId: "dev_public_two_slots", draftId: "dev_public_two_slots_draft", name: "Backyard Brawl", format: "snake" as const, experienceTier: "experienced" as const, stakeTier: 2, teamCount: 8, filled: 6 },
    { leagueId: "dev_public_packed", draftId: "dev_public_packed_draft", name: "Packed House", format: "snake" as const, experienceTier: "beginner" as const, stakeTier: 1, teamCount: 8, filled: 8 },
    /**
     * Phase 3 Plan D, Task 10, Step 1: the beginner league the seed's own veteran identity
     * (manager A, via `claimUserId`) presses "Join" on. Its three seats never come from
     * `ensureDevUsers`' shared 12-identity pool at all — `seedTierDemoIdentities`
     * (`./seed-tier-demo.ts`) hands `seedPublicLeagues` three DEDICATED identities instead (two
     * that can never accumulate a completed season, one that already has three by construction),
     * which is what keeps this league refusing manager A's join AND reading "Mostly newcomers"
     * durably — see that module's own docblock for the aging-class incident this replaced (Phase
     * 3.5, Task 7.5). A brand-new league id, never seeded before Task 10: shifting an EXISTING
     * league's seat mapping (tried first, reverted) breaks `teams_league_user_idx` on any
     * database this seed already ran against under the old mapping — see `seedPublicLeagues`'s
     * own docblock for that incident.
     */
    {
      leagueId: "dev_public_tier_demo",
      draftId: "dev_public_tier_demo_draft",
      name: "Fresh Faces Only",
      format: "snake" as const,
      experienceTier: "beginner" as const,
      stakeTier: 0,
      teamCount: 12,
      filled: 3,
    },
  ],
} as const;
