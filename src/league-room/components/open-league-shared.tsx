"use client";

import type { ReactElement } from "react";
import { Badge, buttonClassName } from "@/components/ui";
import { LiveMarker } from "@/components/ui/live-marker";
import { UI_CONFIG } from "@/components/ui/config";
import { Countdown, useCountdown, type CountdownSize } from "@/components/ui/countdown";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import { rollNoticeSentence } from "@/matchmaking/roll";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { stakeTierLabel } from "@/matchmaking/filter";
import { formatUsd } from "@/money/config";
import { prizePotCents } from "@/money/prize-table";
import { JoinPublicLeagueButton } from "./join-public-league-button";

/**
 * THE ONE SOURCE both open-league forms consume (Phase 3.7, Task 13, founder-ordered): the shelf
 * renders `LeagueRow` on lg+ viewports and `OpenLeagueCard` below, and every derived fact they
 * share — the ledger clock, the live chip, badge authority (E3), the CTA's names and emphasis —
 * lives HERE, extracted from the card rather than copied into the row, so the two renderings of
 * one league can never disagree about what is true.
 */

const FORMAT_LABEL: Readonly<Record<string, string>> = { snake: "Snake", auction: "Auction" };

/**
 * Whether `league` names the LAST open seat — the exact remaining count, never accounting for a
 * live hold: a hold is a fact about who is CLAIMING the seat, not about how many are left to be
 * claimed, and the two never agree on the wire in a way this label needs to second-guess.
 */
function isLastSeat(league: PublicLeagueSummary): boolean {
  return league.teamCount - league.filledTeams === 1;
}

/**
 * The one CTA accessible name every open-league form uses (Phase 3.6, Task 5): "Take the last
 * seat in Median #13. Newer players only." or "Take a seat in Half-PPR #241." — a stranger who
 * lands on this control by voice or screen reader hears what they are about to do and who it is
 * for, in the one sentence rather than a bare "Join" that says neither. Fed into BOTH the signed-
 * out `SignInLink`'s `aria-label` and (via the visible half alone) a signed-in `Button`'s own
 * label — see `ctaVisibleText` below for the shorter half a sighted visitor actually reads.
 */
function ctaAccessibleName(league: PublicLeagueSummary): string {
  const who = league.experienceTier === "beginner" ? " Newer players only." : "";
  return `Take ${isLastSeat(league) ? "the last seat" : "a seat"} in ${league.name}.${who}`;
}

function ctaVisibleText(league: PublicLeagueSummary): string {
  return isLastSeat(league) ? "Take the last seat" : "Take a seat";
}

/** The format line's `·`, decoration for eyes only — the words on either side already read as a
 *  list without it. */
function Dot() {
  return <span aria-hidden="true">·</span>;
}

/**
 * The storefront's live marker — now the ONE `LiveMarker` primitive, which the season track
 * built after finding this exact shape hand-rolled here (its own docblock names this file). The
 * label is still DERIVED on every render from facts already on the wire, never a stored flag.
 */
export function LiveChip({ label }: { readonly label: string }) {
  return <LiveMarker className="shrink-0">{label}</LiveMarker>;
}

export interface OpenLeagueLive {
  readonly remainingSeats: number;
  /** Ms until a SCHEDULED kickoff, `null` for `when_full` (the placeholder never reaches the
   *  clock) or when the summary carries no instant. */
  readonly remainingMs: number | null;
  /** Rule 6: the Drafts value ticks (and "On deck" may show) only inside
   *  `UI_CONFIG.openLeagueCard.clockWithinMs` of a real, chosen kickoff. */
  readonly onDeck: boolean;
  /** "On deck" outranks "Filling" — one chip, and a draft about to start is the more imminent
   *  fact than seats running low on the way to it. `null` when nothing is genuinely live. */
  readonly liveChipLabel: "On deck" | "Filling" | null;
}

/**
 * Every derived-live fact a league form renders, from `PublicLeagueSummary` and nothing else.
 * The clock ticks only against a real, chosen instant — a `when_full` league's `draftAtIso` is
 * the same placeholder its `draftAt` is, so it never reaches `useCountdown` at all (the
 * identical gate every reader of `draftAt` holds). "Filling" reads the seat meter's own
 * low-seats threshold; "On deck" reads the clock's own window.
 *
 * Hydration-safe for free: `remainingMs` is null on the server render and the hydrating render
 * (`useNow`'s contract — this hook reaches SSR'd pages via / and /browse, where the founder's
 * 2026-08-24 mismatch report originated), so `onDeck` is false there and
 * `ScheduledDraftValue` serves the absolute `draftAt` string both renders agree on;
 * the ticking clock and the "On deck" chip are post-hydration upgrades.
 */
export function useOpenLeagueLive(league: PublicLeagueSummary): OpenLeagueLive {
  const { remainingMs } = useCountdown(league.startTrigger === "scheduled" ? (league.draftAtIso ?? null) : null);
  const onDeck = remainingMs !== null && remainingMs < UI_CONFIG.openLeagueCard.clockWithinMs;
  const remainingSeats = league.teamCount - league.filledTeams;
  const filling = remainingSeats > 0 && remainingSeats < UI_CONFIG.seatMeter.lowSeatsThreshold;
  return {
    remainingSeats,
    remainingMs,
    onDeck,
    liveChipLabel: onDeck ? "On deck" : filling ? "Filling" : null,
  };
}

/**
 * E3, review-ruled (Task 5 fix round 1): the badge carries only what the title does not —
 * decided by AUTHORITY, never by inspecting user text. A house league's title carries its rung
 * BY CONSTRUCTION (`houseLeagueName`, `@/matchmaking/house-catalog`, is the one namer of house
 * leagues and prefixes `HOUSE_RUNG_LABEL` verbatim), so a rung badge is always redundant and
 * never renders. A member league's name is the member's own arbitrary text, so its stake badge
 * ALWAYS renders — substring matching on names was rejected outright ("Free For All League").
 */
export function stakeBadge(league: PublicLeagueSummary): ReactElement | null {
  return league.houseRung === null ? <Badge tone="neutral">{stakeTierLabel(league.stakeTier)}</Badge> : null;
}

/**
 * Phase 4, Task 13: the Entry ledger row's value — the league's REAL entry fee, `formatUsd`'d,
 * when it carries one; `"Free"` otherwise, which is every league today (`league.entryFeeCents`
 * is `0` for every league that exists while `moneyIsLive()` gates paid creation dark,
 * `leagueMoneyOrRefuse`, `@/league-service/creation`). Replaces the old `stakeTierLabel` reading
 * on this one row — `stakeBadge` above still reads the cosmetic tier for the badge beside the
 * name; this row now states the one fact a member actually pays, THE ONE SOURCE both the card
 * and the row consume so they can never disagree.
 */
export function entryFeeLabel(league: PublicLeagueSummary): string {
  return league.entryFeeCents > 0 ? formatUsd(league.entryFeeCents) : "Free";
}

/**
 * The two money sentences the storefront's one money line can render — moved here from
 * `front-door-hero.tsx` (front door blueprint, 2026-09-02) because the join sheet now needs the
 * SAME derived sentence, and two hand-typed copies of "free this season" is exactly how one goes
 * stale the week money goes live. Same `moneyIsLive()` switch, read by every caller through
 * `moneySentence(live)`.
 */
export const FREE_SEASON_SENTENCE = "Every league is free this season.";
export const LIVE_MONEY_SENTENCE = "Play free everywhere, or play for real money where your state allows.";

export function moneySentence(live: boolean): string {
  return live ? LIVE_MONEY_SENTENCE : FREE_SEASON_SENTENCE;
}

/** What a paid league's pot cell says, derived once from the STORED table for every reader. */
export interface PotFacts {
  /** The pot the table actually pays — `prizePotCents` of the stored table, `formatUsd`'d. */
  readonly potUsd: string;
  /** "pays $300.00 / $200.00 / $100.00" — the split, place order, the join sheet's register. */
  readonly splitLabel: string;
  /** "top 3 paid" / "winner takes all" — the row column's compact register. */
  readonly placesLabel: string;
}

/**
 * The pot a league advertises, or `null` when it publishes no prize table — which is every
 * league while `moneyIsLive()` is dark, and any free league after. Derived from
 * `PublicLeagueSummary.payoutTable` (the stored `leagues.payout_table`, straight through) and
 * NEVER from `entryFeeCents * teamCount` recomputed here: what the card promises must be exactly
 * what settlement pays (`prizePotCents`'s own docblock).
 */
export function potFacts(league: PublicLeagueSummary): PotFacts | null {
  const table = league.payoutTable ?? null;
  if (table === null || table.length === 0) return null;
  return {
    potUsd: formatUsd(prizePotCents(table)),
    splitLabel: `pays ${table.map((entry) => formatUsd(entry.amountCents)).join(" / ")}`,
    placesLabel: table.length === 1 ? "winner takes all" : `top ${table.length} paid`,
  };
}

/**
 * F1: ONE muted format line, dot-separated — a separator between items on one line separates
 * something again. Who folds in here (S7): the beginner tier is a fact about the league's
 * format, said once, quietly.
 *
 * NO TIPS (founder ruling, 2026-08-28): "the UX should explain itself - we shouldn't need
 * tips." Every ⓘ this line used to carry was a confession that a label failed. Where a term
 * needed a plainer word it got one ("Median" reads "Median game" now); the full definitions
 * survive at `/league-rules`, one press away behind the nav's How it works, which is where a
 * curious reader goes and an uncurious one never has to.
 */
export function FormatLine({ league }: { readonly league: PublicLeagueSummary }) {
  // Each separator lives INSIDE the span of the word it introduces, so a wrap can never leave a
  // dot dangling at the end of a line (visible on every beginner row at 1440 before this).
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-text-muted">
      <span className="whitespace-nowrap">{league.teamCount} teams</span>
      <span className="whitespace-nowrap">
        <Dot /> {FORMAT_LABEL[league.format] ?? league.format}
      </span>
      <span className="whitespace-nowrap">
        <Dot /> {league.scoringLabel}
      </span>
      {/* Deciding a week is a fact about the league, not about anyone in it — the same
          reasoning `PublicLeagueSummary.medianGame`'s own docblock carries. */}
      {league.medianGame ? (
        <span className="whitespace-nowrap">
          <Dot /> Median game
        </span>
      ) : null}
      {league.experienceTier === "beginner" ? (
        <span className="whitespace-nowrap">
          <Dot /> newer players only
        </span>
      ) : null}
    </p>
  );
}

/**
 * The Drafts VALUE, both triggers (storefront review E1) — a scheduled league's ticking
 * `Countdown` (tone `hot`) inside the clock window, its absolute `draftAt` sentence outside it,
 * and now a `when_full` league's OWN compact value: "Drafts when full" beside the click-only
 * `InfoTip` that carries the full commitment (the `sit-and-go` glossary entry, the same term the
 * waiting room and the create-league form already quote). Before this, a `when_full` row's
 * Drafts column returned `null` here and let `DraftTimingNotes` print `describeStartTiming`'s
 * whole 30-word sentence as the column's only content — honest, but on a shelf that is now
 * entirely `when_full` that sentence repeated on every row, under a header naming a value that
 * was never there (E1, measured: 21 of 29 browse rows, 1,218px of one repeated paragraph). The
 * column now always carries a short VALUE; the longer commitment is one press away, exactly the
 * way every other glossary-backed fact on this shelf already works (D1's own legend line: "Press
 * any ⓘ for a plain answer").
 *
 * `className` is the caller's alignment on the absolute span only (the card right-aligns its
 * ledger value; the row reads left) — the `when_full` value is left-set for both, matching the
 * row's own reading direction; the card's `LedgerRow` wrapper right-aligns its children
 * regardless of this component's own class, so no caller needs a second branch.
 *
 * `size` defaults to `"sm"` — the card/row's own ledger-row register, unchanged for both
 * existing callers — and is threaded straight to `Countdown` for a caller that needs the SAME
 * gated clock at a larger register (the front door hero's "Next draft" module, `size="lg"`)
 * rather than forking a second ticking clock with its own onDeck gate.
 */
export function ScheduledDraftValue({
  relativeFirst = false,
  league,
  onDeck,
  remainingMs,
  className = "",
  size = "sm",
}: {
  readonly league: PublicLeagueSummary;
  readonly onDeck: boolean;
  readonly remainingMs: number | null;
  readonly className?: string;
  readonly size?: CountdownSize;
  /** Lead with the relative fact and drop the date to the faint line — the tower rows' mode. */
  readonly relativeFirst?: boolean;
}) {
  if (league.startTrigger === "when_full") {
    return (
      // "Drafts when full" is the self-explaining register the no-tips ruling asks for: the
      // sentence IS the commitment, and the fuller version lives at /league-rules.
      <span className={`min-w-0 font-medium text-text-primary ${className}`}>Drafts when full</span>
    );
  }
  if (onDeck && remainingMs !== null) {
    return <Countdown remainingMs={remainingMs} size={size} tone="hot" data-testid="draft-clock" />;
  }
  if (relativeFirst) {
    // The tower's reading order (Sunday v5, law 1): the RELATIVE fact leads, because "in 2
    // days" is the delta a visitor decides on, and the absolute date is the record. `draftAt`
    // arrives preformatted ("Sunday 30 August, 8:52 PM UTC (in 2 days)"); the split is on the
    // parenthetical the formatter itself appends, and a string without one renders whole
    // rather than being reformatted here — law 7, never restate a fact this component does
    // not own.
    const match = /^(.*?)\s*\((in [^)]+)\)$/.exec(league.draftAt);
    if (match !== null) {
      const [, absolute, relative] = match;
      return (
        <span className={`flex min-w-0 flex-col ${className}`}>
          <span className="font-medium text-text-primary first-letter:uppercase">{relative}</span>
          <span className="text-xs text-text-faint">{absolute}</span>
        </span>
      );
    }
  }
  return <span className={`min-w-0 font-medium tabular-nums text-text-primary ${className}`}>{league.draftAt}</span>;
}

/**
 * The Drafts value's one remaining footnote, one source for both forms (storefront review E1
 * retired the when-full paragraph that used to live here — `ScheduledDraftValue` above now
 * carries that fact as the column's own compact value plus an `InfoTip`, never both a value and
 * a footnote saying the same thing twice).
 *
 * F12/F21: `kickoffRolls` is `PublicLeagueSummary`'s own field, read here rather than silently
 * showing a different date than the one a visitor is comparing against their own calendar —
 * only a SCHEDULED league can ever roll, so a `when_full` form never renders this line.
 */
export function DraftTimingNotes({ league }: { readonly league: PublicLeagueSummary }) {
  return league.startTrigger === "scheduled" && league.kickoffRolls > 0 ? (
    <p className="mt-1 text-xs text-text-muted">{rollNoticeSentence(league.kickoffRolls)}</p>
  ) : null;
}

/**
 * The one action, both forms, both auth states. Signed in: the real join button. Signed out:
 * the HOLD interstitial for THIS league (Task 6, F6), never a generic `/app` — the parent seats
 * a visitor who comes back still holding a live token.
 *
 * SUNDAY v5: "ink" now renders the VERB variant — the amber fill law 4 gives the act — rather
 * than the v3 ink pill. The emphasis prop and the parent's featured-league decision survive
 * unchanged; what a granted row LOOKS like moved with the system. Under law 6 a board is free to
 * repeat its verb down every row, so `featuredLeagueId`'s one-per-view arithmetic is no longer a
 * cap the audit enforces — it is the shelf's own choice about which room leads.
 */
export function OpenLeagueCta({
  league,
  signedIn,
  emphasis,
}: {
  readonly league: PublicLeagueSummary;
  readonly signedIn: boolean;
  readonly emphasis: "ink" | "quiet";
}) {
  const variant = emphasis === "ink" ? ("verb" as const) : ("secondary" as const);
  return signedIn ? (
    <JoinPublicLeagueButton leagueId={league.id} leagueName={league.name} variant={variant} />
  ) : (
    <SignInLink intent={`/join/${league.id}/hold`} aria-label={ctaAccessibleName(league)} className={buttonClassName(variant, "md")}>
      {ctaVisibleText(league)}
    </SignInLink>
  );
}
