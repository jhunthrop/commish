import type { DraftFormat } from "@/domain/league";
import { STANDARD_ROSTER_SLOTS, type RosterShapeName } from "@research/domain/roster";
import type { ScoringPresetName } from "@research/domain/scoring";
import { SEASON_CONFIG } from "@research/domain/season";

/** Every tunable the season has. No service, route or component may inline one of these. */
export const LEAGUE_CONFIG = {
  /**
   * What a commissioner gets by accepting every default. The whole point is that the create
   * form is completable without opening the advanced disclosure at all.
   */
  defaults: {
    teamCount: 12,
    format: "snake" as DraftFormat,
    /**
     * Half-PPR, not full PPR (founder decision, §4.2's launch canon: "half-PPR default with PPR
     * / TE-premium / superflex toggles") — the trend-consensus scoring rule, one tap away from
     * full PPR in the same select. Every preset stays reachable; only which one is preselected
     * changed.
     */
    scoringPreset: "half_ppr" as ScoringPresetName,
    auctionBudget: 200,
    rosterSlots: STANDARD_ROSTER_SLOTS,
    /** The roster shape a league gets when nobody names one — superflex stays one toggle away. */
    rosterShape: "standard" as RosterShapeName,
    /** How far out a new league's draft is scheduled, so the clock starts in a slow tier. */
    draftDaysFromCreation: 7,
    /**
     * The furthest out a commissioner may schedule (or reschedule) a draft's kickoff, measured
     * from `now` AT THE MOMENT THEY SET IT — never from the league's creation, unlike this
     * object's sibling `draftDaysFromCreation` above, which is why this field has its own name
     * (fix round 1, LOW: renamed from `maxDraftDaysFromCreation`, which claimed the wrong
     * anchor — `setDraftKickoff`, `@/league-service/draft-schedule.ts`, measures it against
     * `clock.now()` at reschedule time, which can be long after creation). `DRAFT_CLOCK_SCHEDULE`'s
     * widest tier (`@/draft-engine/config`) is 168 hours (7 days) before kickoff — a draft
     * scheduled a year out is not wrong, but the pick clock would sit at its slowest tier for
     * months before draft night got close, describing a tier nobody experiences. 60 days is
     * generous room to plan a season around without letting the clock schedule become decorative.
     */
    maxDraftDaysAhead: 60,
  },
  minTeams: 4,
  maxTeams: 16,
  maxNameLength: 60,
  /** Regular-season length. The mock dataset carries 17 weeks, so this fits inside it. */
  regularSeasonWeeks: SEASON_CONFIG.fantasyRegularSeasonWeeks,
  maxWeeks: 18,
  playoffTeams: 6,
  /** Trade governance (roadmap item 5): no proposing or accepting after this week's trades are
   *  in — the incumbent-standard late-season deadline, two weeks before the playoff cut. */
  tradeDeadlineWeek: 12,
  /** How long an accepted trade sits under league review before it executes unvetoed. */
  tradeReviewHours: 24,
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
  /**
   * Phase 3.6, Task 4: THE ONE PLACE "this season" means a specific instant. Every league on
   * this platform today belongs to the single season that started on this date — there is no
   * season-rollover mechanic yet (`leagues.season_completed_at`'s own docblock in `@research/db/schema`:
   * no league here has finished one), so this is a fixed boundary, not a computed one. `proofStats`
   * (`@/league-service/proof`) reads it to decide whether "N leagues filled this season" counts a
   * given league; nothing else may re-derive "this season" from `now()`, a league's own age, or
   * an NFL calendar rule. When season rollover ships, this becomes the field that rolls.
   *
   * SETTLED (founder delegated-decision directive, 2026-08-24): this constant was a Task 4
   * DEVIATION, not a plan value — the plan assumed a season boundary already existed here and
   * none did, so the implementer chose the platform's launch month. The founder has since
   * verified 2026-08-01 as the intended boundary: it captures the draft season and predates
   * every real league on the platform. No further verification is pending; this value rolls
   * forward only when season rollover ships (see this docblock's opening paragraph).
   */
  season: {
    startedAt: SEASON_CONFIG.startedAt,
  },
  /**
   * The rival card's head-to-head read (`headToHeadRecords`), cached per league and week.
   *
   * THE WEEK IS IN THE KEY, not a version in the value, which is the opposite of
   * `STATS_INGESTION_CONFIG.keys.score` and for the opposite reason: a score is invalidated by a
   * lineup edit that names no week of its own, while this answer changes only when a WEEK settles,
   * and settlement already knows exactly which week it settled. So the invalidation is a DEL of a
   * key the settler can name, and the key rolls forward on its own as the league's week advances.
   *
   * The TTL is the backstop for the settle path never running (a correction, a restore), not the
   * mechanism: an hour of staleness on "you are 4 and 1 against Rey" is a record that was true an
   * hour ago, which is a different kind of wrong from a live score being an hour old.
   */
  headToHead: {
    cacheKey: (leagueId: string, week: number): string => `h2h:${leagueId}:${week}`,
    cacheTtlSeconds: 3600,
  },
} as const;
