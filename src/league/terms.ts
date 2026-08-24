import type { DraftFormat } from "@/domain/league";
import { BENCH_SLOT, ROSTER_SHAPE_LABEL, type RosterSlotConfig } from "@/domain/roster";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { hasOpenSeat, stakeTierLabel } from "@/matchmaking/filter";
import { describeScoring, type ScoringRules } from "@/scoring";
import { describeRosterShape } from "./roster-shape";

/**
 * Everything a person decides whether to join with, in one pure value. Rendered by
 * `LeagueTermsPanel` (`@/league-room/components/league-terms-panel`) on the invite preview
 * page AND inside the league itself (Task 8) — the SAME shape, computed by this SAME function,
 * so a prospect reading the invite and a member reading the league home can never be told two
 * different things about the league they are both looking at.
 */
export interface LeagueTerms {
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly filledTeams: number;
  /** Derived from the league's scoring weights (`describeScoring`) — never the raw weights. */
  readonly scoringLabel: string;
  /** A roster shape a human can read — e.g. "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench". */
  readonly rosterLine: string;
  readonly stakeLabel: string;
  /**
   * The exact sentence `MATCHMAKING_CONFIG.stakeDisclosure` carries, never retyped here. Phase 1
   * wrote it once for `/browse`; this is the other place somebody decides to enter a league, and
   * two hand-written versions of "no money changes hands" is exactly how one goes stale the week
   * money starts changing hands.
   */
  readonly stakeDisclosure: string;
  readonly commissionerName: string;
  /** The commissioner's STORED avatar ref, not a URL — same contract as `Avatar`'s `avatar` prop. */
  readonly commissionerAvatar: string | null;
  /**
   * When the draft is scheduled to open — absolute time first, then relative, e.g. "Saturday 12
   * September, 7:00 PM UTC (in 3 days)". Computed HERE, server-side, by `formatDraftTime` below,
   * never in a component: `new Date()`/`Date.now()` reading the ambient clock must never appear
   * in a `.tsx` file (the one violating line Plan C's fix wave removed), and a prospect reading
   * the invite preview or a member reading league home must see the identical sentence either
   * way — one function, called once per render, not three copies that could drift.
   *
   * Phase 3.5, Task 8 fix round 1 (review HIGH). A `when_full` league still filling has no
   * chosen kickoff to report — `LeagueTermsInput.kickoffAt`'s own docblock — so THIS field reads
   * `WHEN_FULL_FILLING_NOTE` instead of a formatted date for exactly that case (`leagueTerms`'s
   * own branch, below), the same fills-truth sentence `PublicLeagueSummary`'s browse card
   * already renders for the identical reason. Once the fill trigger writes a real `kickoffAt`
   * (the league is full), this goes back to being a real formatted date — the placeholder is
   * only ever a placeholder while a seat is still open.
   */
  readonly draftAt: string;
  /**
   * Facts about how this league plays that a stakes/scoring/roster line alone doesn't say —
   * every note derived from a STORED column, never a remembered preset name, mirroring
   * `scoringLabel`'s and `rosterLine`'s own honesty. Empty for a league that opted into neither:
   * `LeagueTermsPanel` renders nothing at all rather than an empty "Notes" row. Order is fixed
   * (median first, roster shape second) so the invite preview and league home can never list the
   * same two facts in two different orders.
   */
  readonly formatNotes: readonly string[];
}

export interface LeagueTermsInput {
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly filledTeams: number;
  readonly scoring: ScoringRules;
  readonly rosterSlots: readonly RosterSlotConfig[];
  /** Cosmetic tier index only — see `MATCHMAKING_CONFIG.stakeTiers`. Never an amount of money. */
  readonly stakeTier: number;
  /** `leagues.median_game` (Task 2), straight through — every caller already has the league's
   *  own row in hand by the time it builds this input. */
  readonly medianGame: boolean;
  readonly commissioner: { readonly displayName: string; readonly avatarUrl: string | null };
  /** ISO instant — `drafts.kickoffAt`. For a `when_full` league still filling, this is a
   *  PLACEHOLDER (`createLeague`'s own default), not a chosen time — `startTrigger` below is
   *  what tells `leagueTerms` whether it may honestly format this as a date at all. */
  readonly kickoffAt: string;
  /** ISO instant — the caller's own clock reading, injected so `formatDraftTime`'s relative
   *  half ("in 3 days") is exactly as testable as everything else this function computes. */
  readonly now: string;
  /**
   * Phase 3.5, Task 8 fix round 1 (review HIGH). Which of the two ways this draft's `kickoffAt`
   * comes to be set — the SAME union `DraftScheduleBody.startTrigger` and
   * `PublicLeagueSummary.startTrigger` already carry. `leagueTerms` reads this, together with
   * `teamCount`/`filledTeams`, to decide whether `kickoffAt` is a real chosen time or still the
   * creation-time placeholder.
   */
  readonly startTrigger: "scheduled" | "when_full";
}

/**
 * "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench" — every slot's count and name, in the
 * league's own configured order, with the one rename this product's slot type needs: the raw
 * slot value is already the right word for every position slot (`QB`, `RB`, `FLEX`, ...), and
 * `BENCH_SLOT` is the one value that reads better lower-cased than shouted.
 */
function rosterLine(slots: readonly RosterSlotConfig[]): string {
  return slots.map((slot) => `${slot.count} ${slot.slot === BENCH_SLOT ? "bench" : slot.slot}`).join(", ");
}

/**
 * The two sentences `formatNotesFor` can produce, verbatim per the brief — and the ONE place
 * either is written. `src/league-room/components/public-league-list.tsx` cannot import this
 * constant (the client boundary: `@/league` is server-only, `eslint.config.mjs`'s
 * `SERVER_ONLY_MODULE_GROUPS`), so its browse-card label is a short noun ("Median") rather than
 * this full sentence — the two surfaces name the same fact in the words each one's own contract
 * affords, the identical reasoning `SCORING_LABEL_TERM`'s deliberate duplication between this
 * panel and that list already documents.
 */
const MEDIAN_GAME_NOTE = "Every team also plays the league median each week.";
const SUPERFLEX_NOTE = "Superflex: you can start a second quarterback.";

/**
 * Phase 3.5, Task 8 fix round 1 (review HIGH). The EXACT sentence `public-league-list.tsx`
 * already renders for the identical case (a `when_full` league with an open seat) —
 * duplicated rather than shared, for the same reason `SCORING_LABEL_TERM`'s own docblock in
 * `league-terms-panel.tsx` gives for its own deliberate duplication: `src/league-room/**` is
 * client-boundary code and cannot value-import `@/league` (`eslint.config.mjs`'s
 * `SERVER_ONLY_MODULE_GROUPS`), so a single shared constant isn't reachable from both call
 * sites. Keeping the WORDS identical is what this constant is for; keeping the import graph
 * legal is why it can't also be the SAME binding.
 */
const WHEN_FULL_FILLING_NOTE = "Starts as soon as it fills";

/**
 * Every fact this league's format doesn't already say through `scoringLabel`/`rosterLine` alone.
 * Median first, roster shape second — a fixed order, not an accident of which `if` runs first,
 * so the invite preview and league home render the identical list in the identical order.
 *
 * `describeRosterShape` (`./roster-shape`) is Task 1's fix-round adjudication landing exactly
 * where its own docblock named: the superflex note fires off the SAME slot-row comparison
 * `rosterLine` above already reads its words from, never a remembered preset name — a
 * commissioner who edits a superflex league's slots away from the shipped shape loses the note
 * the same honest way `rosterLine` itself would stop reading "Superflex".
 */
function formatNotesFor(medianGame: boolean, rosterSlots: readonly RosterSlotConfig[]): readonly string[] {
  const notes: string[] = [];
  if (medianGame) notes.push(MEDIAN_GAME_NOTE);
  if (describeRosterShape(rosterSlots) === ROSTER_SHAPE_LABEL.superflex) notes.push(SUPERFLEX_NOTE);
  return notes;
}

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** "Saturday", "12", "September", "7:00 PM" — four independent formatters rather than one
 *  combined one, because no single `Intl.DateTimeFormat` option set produces this product's
 *  weekday-day-month word order (`en-US` gives "September 12"; `en-GB` gives "at 7:00 pm"
 *  lower-cased). `timeZone: "UTC"` on every one of them, deliberately: there is no per-visitor
 *  timezone anywhere in this product (a sibling plan's own ruling explicitly declines to add a
 *  client timezone beacon), so a FIXED, honestly-labelled zone is what keeps this sentence true
 *  for every reader rather than silently reading the rendering SERVER's own zone. */
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" });
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const CLOCK_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });

/** "in 3 days" / "in 5 hours" / "in 20 minutes" / "starting now" — never negative: a draft this
 *  function is ever asked to describe is either still ahead of `nowMs` or, once Task 7's own
 *  auto-start has run, no longer `scheduled` at all, so there is no "3 days ago" a caller here
 *  needs worded. */
function relativeDraftTime(kickoffMs: number, nowMs: number): string {
  const diffMs = kickoffMs - nowMs;
  if (diffMs <= 0) return "starting now";
  if (diffMs < MS_PER_HOUR) {
    const minutes = Math.max(1, Math.round(diffMs / MS_PER_MINUTE));
    return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (diffMs < MS_PER_DAY) {
    const hours = Math.round(diffMs / MS_PER_HOUR);
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(diffMs / MS_PER_DAY);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * "Saturday 12 September, 7:00 PM UTC" — the absolute half of `formatDraftTime`, factored out
 * (Phase 3.6, Task 5) so a caller that has a plain instant to name and no relative comparison to
 * make (the browse shelf's own "Seat counts as of {time}" header, F20) can render the identical
 * words rather than growing a second, parallel formatter. `formatDraftTime` below is now this
 * function plus its own relative clause.
 */
export function formatAbsoluteTime(iso: string): string {
  const instant = new Date(iso);
  return `${WEEKDAY_FORMAT.format(instant)} ${DAY_FORMAT.format(instant)} ${MONTH_FORMAT.format(instant)}, ${CLOCK_FORMAT.format(instant)} UTC`;
}

/**
 * The one sentence every surface that names a draft's scheduled time renders — absolute first,
 * because a relative-only string ("in 3 days") is useless to somebody who doesn't yet know what
 * day that even is; relative second, because "Saturday 12 September, 7:00 PM UTC" alone makes a
 * reader do their own arithmetic to learn how soon that is. Pure: both timestamps are parameters,
 * never read from the ambient clock, so this is exactly as testable as every other field
 * `leagueTerms` computes.
 */
export function formatDraftTime(kickoffAtIso: string, nowIso: string): string {
  const kickoffMs = new Date(kickoffAtIso).getTime();
  const nowMs = new Date(nowIso).getTime();
  return `${formatAbsoluteTime(kickoffAtIso)} (${relativeDraftTime(kickoffMs, nowMs)})`;
}

/**
 * Pure. Turns raw league facts into the terms a human reads before joining — the one place
 * that assembly happens, so the invite preview and the in-league panel can only ever agree.
 *
 * Phase 3.5, Task 8 fix round 1 (review HIGH). `draftAt` is `WHEN_FULL_FILLING_NOTE` rather than
 * a formatted date exactly when this league is BOTH `when_full` AND still has an open seat
 * (`hasOpenSeat`, the SAME predicate `browseQuery`'s own `HAVING` and `WaitingRoom`'s own `full`
 * check use) — `kickoffAt` is a placeholder for exactly that window and only that window
 * (`LeagueTermsInput.kickoffAt`'s own docblock): once the fill trigger writes the real kickoff
 * (the league is full), `kickoffAt` is a real chosen instant again and this renders the honest
 * date like every other league's terms do.
 */
export function leagueTerms(input: LeagueTermsInput): LeagueTerms {
  const stillFillingWhenFull = input.startTrigger === "when_full" && hasOpenSeat(input);
  return {
    name: input.name,
    format: input.format,
    teamCount: input.teamCount,
    filledTeams: input.filledTeams,
    scoringLabel: describeScoring(input.scoring),
    rosterLine: rosterLine(input.rosterSlots),
    stakeLabel: stakeTierLabel(input.stakeTier),
    stakeDisclosure: MATCHMAKING_CONFIG.stakeDisclosure,
    commissionerName: input.commissioner.displayName,
    commissionerAvatar: input.commissioner.avatarUrl,
    draftAt: stillFillingWhenFull ? WHEN_FULL_FILLING_NOTE : formatDraftTime(input.kickoffAt, input.now),
    formatNotes: formatNotesFor(input.medianGame, input.rosterSlots),
  };
}
