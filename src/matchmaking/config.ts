import type { DraftFormat } from "@/domain/league";
import type { ExperienceTier } from "@/domain/user";
import { PARTICIPATION_TIERS } from "@/participation/tier";

/**
 * Every tunable public matchmaking has.
 *
 * This module is PURE and browser-safe — no I/O, no `Date.now()`, no Postgres — which is why
 * `src/league-room/**` may value-import it despite the client-boundary rule, exactly as
 * `src/chat-room/**` value-imports `@/chat`. The Postgres half of matchmaking lives in
 * `src/league-service/browse.ts`, which that rule still bans.
 */
export const MATCHMAKING_CONFIG = {
  /**
   * The sentinel a filter control submits for "don't narrow on this". A real value would have
   * to be one of the unions below, and an empty string is indistinguishable from an absent
   * parameter once it has been round-tripped through a query string.
   */
  anyValue: "any",
  /**
   * The only joinable formats. Dynasty and best-ball are deliberately absent: the draft engine
   * cannot run them yet, and advertising a league nobody can draft is a dead end wearing a card.
   */
  formats: ["snake", "auction"] as readonly DraftFormat[],
  experienceTiers: ["beginner", "experienced"] as readonly ExperienceTier[],
  /**
   * The default, always-visible filter Step 6 asks for — extending this same filter rather than
   * a parallel one. `PARTICIPATION_TIERS` (`@/participation/tier`) is the vocabulary's one source;
   * this re-exports it rather than copying the tuple, so a third participation tier (there is no
   * reason to expect one) would not require remembering a second list to update.
   */
  participationTiers: PARTICIPATION_TIERS,
  /**
   * COSMETIC ONLY. No entry fee is charged, no prize is paid and no balance exists anywhere in
   * this phase — a stake tier is a label on a card and nothing else. Real money arrives in a
   * later phase behind FBO/agent-of-payee handling, KYC/AML screening and tax reporting.
   */
  stakeTiers: [
    { tier: 0, label: "Free" },
    { tier: 1, label: "Friendly" },
    { tier: 2, label: "Competitive" },
    { tier: 3, label: "High stakes" },
  ],
  /** The one place the "no money" promise is worded, so a card and a page cannot disagree. */
  stakeDisclosure: "Stake tiers are labels only in this preview. No money changes hands.",
  /** Most open leagues one browse answers with. A list nobody can scan is not a shortlist. */
  maxResults: 48,
  /**
   * The anonymous browse read's per-IP ceiling (`src/app/api/public/leagues/route.ts`, the
   * app's only unauthenticated endpoint). Generous enough that nobody clicking through filters
   * by hand ever notices it, tight enough to bound one instance's blast radius against a
   * scripted scrape — see `createRateLimiter`'s own docblock for what this is (a single-process
   * fixed window) and is not (a distributed, spoof-proof quota).
   */
  browseRateLimit: { maxRequests: 60, windowMs: 60_000 },
  /**
   * Phase 3.5, Task 7: the sit-and-go trigger's own tunable. `graceSeconds` is how long after a
   * public matchmade league's last seat fills its draft's `kickoff_at` is set to
   * (`fireWhenFullInTx`, `@/league-service/fill-trigger`) — never zero. Underdog fires instantly;
   * this product does not, because a pod's members joined a MANAGED league possibly hours
   * earlier and are not necessarily sitting at a lobby screen. Five minutes is long enough for a
   * notice to land and a tab to open, short enough that nobody who is present feels stalled.
   */
  sitAndGo: { graceSeconds: 300 },
} as const;

/**
 * `MATCHMAKING_CONFIG.sitAndGo.graceSeconds` in whole minutes — the ONE place that arithmetic
 * happens, so `CreateLeagueForm`'s own "Draft start" hint (`@/league-room/components/
 * create-league-form`) and the `sit-and-go` glossary entry (`@/help/glossary`) can never drift
 * to two different numbers of minutes for the same tunable. Both are pure, browser-safe modules
 * that already value-import `MATCHMAKING_CONFIG` directly, so this is a third value from the
 * same import, not a new cross-module dependency.
 */
export const SIT_AND_GO_GRACE_MINUTES = MATCHMAKING_CONFIG.sitAndGo.graceSeconds / 60;
