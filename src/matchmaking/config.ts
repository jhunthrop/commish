import type { DraftFormat } from "@/domain/league";
import type { ExperienceTier } from "@/domain/user";

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
} as const;
