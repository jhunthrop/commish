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
  /** The one place the "no money" promise is worded, so a card and a page cannot disagree.
   *  Read verbatim while `moneyIsLive()` (`@/money/states`) is false — every league that exists
   *  today. */
  stakeDisclosure: "Stake tiers are labels only in this preview. No money changes hands.",
  /**
   * Phase 4, Task 13: the disclosure's live half, read ONLY once `moneyIsLive()` is true and
   * a league is actually paid (`leagueTerms`, `@/league/terms`) — `stakeDisclosure` above stays
   * the word for every free league, live season or dark. The one place THIS sentence is worded,
   * for the same "a card and a page cannot disagree" reason `stakeDisclosure` already is.
   */
  liveStakeDisclosure:
    "This league charges a real entry fee. The prize table is fixed in advance and paid out when the season settles.",
  /**
   * 2026-08-25, the absolutism sweep's carried finding (Phase 4, Task 13's steps-live report):
   * `OpenLeagueShelf` prints ONE sentence below a MERGED list of every house and member league on
   * the shelf, never a single league's own terms — `stakeDisclosure`'s "No money changes hands"
   * is a true claim about that whole list only while every league on it is free, and stops being
   * one the moment `moneyIsLive()` lets a single listed league carry a real fee. Rather than
   * retry the blanket claim for a mixed list, this sentence defers: the per-league truth already
   * lives in the Entry column (`entryFeeLabel`, `@/league-room/components/open-league-shared`),
   * so the shelf states that fact about itself instead of re-asserting a number it does not
   * itself compute. Read ONLY once `moneyIsLive()` is true, the same derived-switch idiom
   * `liveStakeDisclosure` above and `FrontDoorHero`'s money line already hold to.
   */
  liveShelfStakeDisclosure: "Entry fees are listed per league. Free leagues stay free.",
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
   * Phase 3.6, Task 6: `POST /api/public/leagues/[leagueId]/hold`'s own per-IP ceiling — a WRITE,
   * unlike `browseRateLimit`'s read, so it stays tighter. Generous enough that nobody who lands
   * on the interstitial once (or refreshes it, re-claiming the same live hold) ever notices it;
   * tight enough to bound a script that tries to exhaust a league's seats with holds nobody signs
   * in to redeem. See `browseRateLimit`'s own docblock for what a single-process fixed window is
   * and is not.
   */
  holdRateLimit: { maxRequests: 20, windowMs: 60_000 },
  /**
   * Phase 3.5, Task 7: the sit-and-go trigger's own tunable. `graceSeconds` is how long after a
   * public matchmade league's last seat fills its draft's `kickoff_at` is set to
   * (`fireWhenFullInTx`, `@/league-service/fill-trigger`) — never zero. Underdog fires instantly;
   * this product does not, because a pod's members joined a MANAGED league possibly hours
   * earlier and are not necessarily sitting at a lobby screen. Five minutes is long enough for a
   * notice to land and a tab to open, short enough that nobody who is present feels stalled.
   */
  sitAndGo: { graceSeconds: 300 },
  /**
   * Phase 3.6, Task 7 (the founder's "roll until full" ruling): how far forward
   * `nextKickoffAfter` (`@/matchmaking/roll`) pushes a `'scheduled'` draft's kickoff once its
   * target time arrives with an open seat still in the room. A whole day, not the sit-and-go
   * grace's five minutes: a scheduled league's time is a time somebody planned their evening
   * around, so the roll gives the room another full day to fill before it re-asks the same
   * question, rather than nagging the room every few minutes with a clock nobody chose.
   */
  roll: { cadenceHours: 24 },
  /**
   * Phase 3.6, Task 4: the front door's proof strip — three numbers a stranger can check, each
   * hidden below its own credibility floor rather than printed small (`proofStats`,
   * `@/league-service/proof`). Founder ruling: no fabricated number, no placeholder, no
   * rounded-up substitute — a stat that has not earned belief yet is absent, not dressed up.
   */
  proof: {
    floors: {
      /** Below this, "N leagues filled this season" reads as a startup counting its friends. */
      leaguesFilled: 25,
      /** Below this, "drafts in the next 48 hours" is a schedule, not a signal. */
      draftsNext48h: 3,
      /** Below this, an average rating is one person's mood. */
      reviewCount: 20,
    },
    /**
     * Phase 3.7, Task 7 (self-ruled: 24 hours): how far ahead the scoreboard's "next draft"
     * chip is allowed to look (`nextDraftAtQuery`, `@/league-service/proof`). Inside the
     * window, a coarse "hours until the next draft" is a fact a visitor can act on tonight;
     * beyond it, "next draft on Thursday" is a schedule wearing a scoreboard chip, so the chip
     * is omitted instead — the same real-or-absent ruling as the floors above.
     */
    nextDraftWithinMs: 24 * 60 * 60 * 1000,
    /**
     * Phase 3.6, Task 5 (P4 review, binding CARRY): the front door is the product's
     * highest-traffic unauthenticated read, and `proofStats` runs three aggregate queries
     * (`leaguesFilledQuery`, `draftsNext48hQuery`, `reviewAggregate`) — cheap individually, but
     * paid on every render of the one page every stranger lands on first. `createProofCache`
     * (`@/stats-pipeline/proof-cache.ts`) wraps it in a blind TTL, the same seam
     * `ScoringSettings`'s belt-and-braces TTL uses (`STATS_INGESTION_CONFIG.ttlSeconds.
     * scoringSettings`) rather than `ReferenceCache`'s write-through invalidation: nothing ever
     * writes an explicit invalidation for this key (there is no "a league just filled, bust the
     * cache" event this page's own correctness depends on — the three numbers are a strapline,
     * not a fact anyone acts on with a stale value in hand), so a TTL alone is the honest,
     * simplest cache for it.
     *
     * 60 seconds: short enough that a founder watching the number climb after a marketing push
     * sees it move inside a minute, long enough that a stampede of concurrent front-door renders
     * (this page has no session to key a per-visitor cache on) shares one set of three queries
     * instead of running them per request. The strip's own credibility floors already gate away
     * anything that would make staleness visible to begin with — a number that only appears once
     * it has cleared 25/3/20 does not flicker across a floor inside one minute.
     */
    cacheTtlSeconds: 60,
  },
  /**
   * Phase 3.7, Task 8: the wire — the ticker of real product events under the public nav
   * (`listWireItems`, `@/league-service/wire`; rendered by `Wire`, `@/league-room/components/
   * wire`). Request-time truth with coarse timestamps (deferral D4: no anonymous SSE), so both
   * numbers here describe what ONE page render reads, never a stream.
   */
  wire: {
    /**
     * How far the wire looks — BACK for claimed seats, FORWARD for scheduled kickoffs. One
     * day, the same horizon `proof.nextDraftWithinMs` above already rules for the same
     * register: inside it, "a seat was claimed · 3 hours ago" still reads as activity and a
     * kickoff is a fact a visitor can act on tonight; beyond it, one is history and the other
     * is a schedule, and the real-or-absent ruling omits both rather than dressing them up.
     */
    windowMs: 24 * 60 * 60 * 1000,
    /**
     * The most items one wire render carries, and each source read's own LIMIT. Twelve fills
     * the marquee's loop at desktop width without the track becoming a minutes-long read; the
     * component separately renders nothing at all below `UI_CONFIG.wire.minItems`, so this cap
     * only ever trims a busy product, never pads a quiet one.
     */
    maxItems: 12,
  },
} as const;

/**
 * Phase 3.6, Task 6: the seat hold's own tunable, standalone rather than nested inside
 * `MATCHMAKING_CONFIG` — the front door's own "ten minute" promise is the one number every
 * caller (`claimSeatHold`, the interstitial's `Countdown`, `src/matchmaking/seat-hold.ts`'s
 * refusal copy) has to agree on, and a bare `SEAT_HOLD.minutes` is what keeps a future reader
 * from mistaking it for one more field on the matchmaking grab-bag. Ten minutes is long enough
 * to complete WorkOS hosted sign-in without feeling rushed, short enough that a seat a visitor
 * abandoned mid-flow is back in circulation before the next visitor gives up waiting for it.
 */
export const SEAT_HOLD = { minutes: 10 } as const;

/**
 * `MATCHMAKING_CONFIG.sitAndGo.graceSeconds` in whole minutes — the ONE place that arithmetic
 * happens, so `CreateLeagueForm`'s own "Draft start" hint (`@/league-room/components/
 * create-league-form`) and the `sit-and-go` glossary entry (`@/help/glossary`) can never drift
 * to two different numbers of minutes for the same tunable. Both are pure, browser-safe modules
 * that already value-import `MATCHMAKING_CONFIG` directly, so this is a third value from the
 * same import, not a new cross-module dependency.
 */
export const SIT_AND_GO_GRACE_MINUTES = MATCHMAKING_CONFIG.sitAndGo.graceSeconds / 60;

/**
 * `MATCHMAKING_CONFIG.roll.cadenceHours`, re-exported standalone — the one place
 * `nextKickoffAfter` (`@/matchmaking/roll`) and its tests read the roll's own cadence, on the
 * identical "one place the arithmetic happens" precedent `SIT_AND_GO_GRACE_MINUTES` sets.
 */
export const ROLL_CADENCE_HOURS = MATCHMAKING_CONFIG.roll.cadenceHours;
