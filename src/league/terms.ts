import type { DraftFormat } from "@/domain/league";
import { BENCH_SLOT, type RosterSlotConfig } from "@/domain/roster";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { stakeTierLabel } from "@/matchmaking/filter";
import { describeScoring, type ScoringRules } from "@/scoring";

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
   */
  readonly draftAt: string;
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
  readonly commissioner: { readonly displayName: string; readonly avatarUrl: string | null };
  /** ISO instant — `drafts.kickoffAt`. */
  readonly kickoffAt: string;
  /** ISO instant — the caller's own clock reading, injected so `formatDraftTime`'s relative
   *  half ("in 3 days") is exactly as testable as everything else this function computes. */
  readonly now: string;
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
 * The one sentence every surface that names a draft's scheduled time renders — absolute first,
 * because a relative-only string ("in 3 days") is useless to somebody who doesn't yet know what
 * day that even is; relative second, because "Saturday 12 September, 7:00 PM UTC" alone makes a
 * reader do their own arithmetic to learn how soon that is. Pure: both timestamps are parameters,
 * never read from the ambient clock, so this is exactly as testable as every other field
 * `leagueTerms` computes.
 */
export function formatDraftTime(kickoffAtIso: string, nowIso: string): string {
  const kickoff = new Date(kickoffAtIso);
  const kickoffMs = kickoff.getTime();
  const nowMs = new Date(nowIso).getTime();
  const absolute = `${WEEKDAY_FORMAT.format(kickoff)} ${DAY_FORMAT.format(kickoff)} ${MONTH_FORMAT.format(kickoff)}, ${CLOCK_FORMAT.format(kickoff)} UTC`;
  return `${absolute} (${relativeDraftTime(kickoffMs, nowMs)})`;
}

/**
 * Pure. Turns raw league facts into the terms a human reads before joining — the one place
 * that assembly happens, so the invite preview and the in-league panel can only ever agree.
 */
export function leagueTerms(input: LeagueTermsInput): LeagueTerms {
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
    draftAt: formatDraftTime(input.kickoffAt, input.now),
  };
}
