import type { DraftFormat } from "@/domain/league";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import type { ScoringPresetName } from "@/domain/scoring";

/** Every tunable the season has. No service, route or component may inline one of these. */
export const LEAGUE_CONFIG = {
  /**
   * What a commissioner gets by accepting every default. The whole point is that the create
   * form is completable without opening the advanced disclosure at all.
   */
  defaults: {
    teamCount: 12,
    format: "snake" as DraftFormat,
    scoringPreset: "ppr" as ScoringPresetName,
    auctionBudget: 200,
    rosterSlots: STANDARD_ROSTER_SLOTS,
    /** How far out a new league's draft is scheduled, so the clock starts in a slow tier. */
    draftDaysFromCreation: 7,
    /**
     * The furthest out a commissioner may schedule (or reschedule) a draft's kickoff, in days
     * from the moment they set it. `DRAFT_CLOCK_SCHEDULE`'s widest tier
     * (`@/draft-engine/config`) is 168 hours (7 days) before kickoff — a draft scheduled a year
     * out is not wrong, but the pick clock would sit at its slowest tier for months before draft
     * night got close, describing a tier nobody experiences. 60 days is generous room to plan a
     * season around without letting the clock schedule become decorative.
     */
    maxDraftDaysFromCreation: 60,
  },
  minTeams: 4,
  maxTeams: 16,
  maxNameLength: 60,
  /** Regular-season length. The mock dataset carries 17 weeks, so this fits inside it. */
  regularSeasonWeeks: 14,
  maxWeeks: 18,
  playoffTeams: 6,
  invite: {
    codeLength: 8,
    /** No I, L, O, 0 or 1 — a short code gets read aloud and typed by hand. */
    alphabet: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
    expiryDays: 14,
    maxUses: 32,
    /** Attempts to find an unused code before giving up with a plain-language error. */
    maxCodeAttempts: 5,
    /**
     * `GET /api/invites/[code]`'s per-IP ceiling. Same shape and same rationale as
     * `MATCHMAKING_CONFIG.browseRateLimit`: the preview is reachable by anyone holding the link,
     * with no session required, so it is keyed on the forwarded-for header rather than a caller
     * id — see that constant's own docblock, and `src/app/api/public/leagues/_shared.ts`, for
     * exactly what a per-IP ceiling does and does not guarantee.
     */
    previewRateLimit: { maxRequests: 60, windowMs: 60_000 },
  },
  /**
   * The spec's exit criterion, made testable: signed in → created, invitable league in a
   * small number of interactions by accepting defaults. Asserted in Task 10.
   */
  maxCreateInteractions: 3,
} as const;
