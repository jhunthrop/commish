"use client";

import type { ReactElement } from "react";
import { Badge, InfoTip, buttonClassName } from "@/components/ui";
import { UI_CONFIG } from "@/components/ui/config";
import { Countdown, useCountdown } from "@/components/ui/countdown";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import type { DraftFormat } from "@/domain/league";
import type { TermKey } from "@/help/glossary";
import type { HelpLevel } from "@/identity/preferences";
import { describeStartTiming, rollNoticeSentence } from "@/matchmaking/roll";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { stakeTierLabel } from "@/matchmaking/filter";
import { JoinPublicLeagueButton } from "./join-public-league-button";

/**
 * THE ONE SOURCE both open-league forms consume (Phase 3.7, Task 13, founder-ordered): the shelf
 * renders `LeagueRow` on lg+ viewports and `OpenLeagueCard` below, and every derived fact they
 * share — the ledger clock, the live chip, badge authority (E3), the CTA's names and emphasis —
 * lives HERE, extracted from the card rather than copied into the row, so the two renderings of
 * one league can never disagree about what is true.
 */

const FORMAT_LABEL: Readonly<Record<string, string>> = { snake: "Snake", auction: "Auction" };
const FORMAT_TERM: Readonly<Record<DraftFormat, TermKey>> = { snake: "snake-draft", auction: "auction-draft" };

/** `scoringLabel` is a derived string (`describeScoring`), not a `TermKey` — every label but
 *  "Standard" gets an `InfoTip`. */
const SCORING_LABEL_TERM: Readonly<Record<string, TermKey>> = {
  PPR: "ppr",
  "Half PPR": "half-ppr",
  "PPR, TE premium": "te-premium",
  Custom: "custom-scoring",
};

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
 * The mock's live chip (rule 6): a pulsing dot beside one word, in the live family, rendered
 * only while something on this league is genuinely live — the label is DERIVED on every render
 * from facts already on the wire, never a stored flag. Static under reduced motion: the state
 * still shows, only the pulse stops.
 */
export function LiveChip({ label }: { readonly label: string }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-negative">
      <span aria-hidden="true" className={`size-1.5 rounded-pill bg-negative${reducedMotion ? "" : " animate-pulse-live"}`} />
      {label}
    </span>
  );
}

export interface OpenLeagueLive {
  /** E3's deciding fact: a house league's title carries its rung by construction. */
  readonly authority: "house" | "member";
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
    authority: league.houseRung === null ? "member" : "house",
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
 * F1: ONE muted format line, dot-separated — a separator between items on one line separates
 * something again. Who folds in here (S7): the beginner tier is a fact about the league's
 * format, said once, quietly. `helpLevel` stays the CALLER's call (D1/E7) — the card threads
 * the surface's preference through, and `LeagueRow` pins `"standard"` because guided captions
 * never print inline in a row (founder-ordered, Task 13).
 */
export function FormatLine({ league, helpLevel }: { readonly league: PublicLeagueSummary; readonly helpLevel: HelpLevel }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-text-muted">
      <span>{league.teamCount} teams</span>
      <Dot />
      <span className="inline-flex items-center gap-1">
        {FORMAT_LABEL[league.format] ?? league.format}
        <InfoTip term={FORMAT_TERM[league.format]} helpLevel={helpLevel} />
      </span>
      <Dot />
      <span className="inline-flex items-center gap-1">
        {league.scoringLabel}
        {SCORING_LABEL_TERM[league.scoringLabel] === undefined ? null : (
          <InfoTip term={SCORING_LABEL_TERM[league.scoringLabel]!} helpLevel={helpLevel} />
        )}
      </span>
      {/* Deciding a week is a fact about the league, not about anyone in it — the same
          reasoning `PublicLeagueSummary.medianGame`'s own docblock carries. */}
      {league.medianGame ? (
        <>
          <Dot />
          <span className="inline-flex items-center gap-1">
            Median
            <InfoTip term="median-game" helpLevel={helpLevel} />
          </span>
        </>
      ) : null}
      {league.experienceTier === "beginner" ? (
        <>
          <Dot />
          <span>newer players only</span>
        </>
      ) : null}
    </p>
  );
}

/**
 * The Drafts VALUE for a scheduled league — the ticking `Countdown` (tone `hot`) inside the
 * clock window, the absolute `draftAt` sentence outside it — and `null` for a `when_full`
 * league, whose placeholder kickoff is never rendered as though somebody chose it
 * (`DraftTimingNotes` below says what is true instead). `className` is the caller's alignment
 * on the absolute span only (the card right-aligns its ledger value; the row reads left).
 */
export function ScheduledDraftValue({
  league,
  onDeck,
  remainingMs,
  className = "",
}: {
  readonly league: PublicLeagueSummary;
  readonly onDeck: boolean;
  readonly remainingMs: number | null;
  readonly className?: string;
}) {
  if (league.startTrigger !== "scheduled") return null;
  return onDeck && remainingMs !== null ? (
    <Countdown remainingMs={remainingMs} size="sm" tone="hot" data-testid="draft-clock" />
  ) : (
    <span className={`min-w-0 font-medium tabular-nums text-text-primary ${className}`}>{league.draftAt}</span>
  );
}

/**
 * The Drafts value's two muted footnotes, one source for both forms:
 *
 * The when-full commitment is `describeStartTiming`'s own sentence (F9), quoted rather than
 * restated, in `text-text-muted` (E5: `warning` is reserved for a tightening clock, and this
 * sentence is reassurance). It REPLACES the value for a `when_full` league — never both a date
 * and the sentence.
 *
 * F12/F21: `kickoffRolls` is `PublicLeagueSummary`'s own field, read here rather than silently
 * showing a different date than the one a visitor is comparing against their own calendar —
 * only a SCHEDULED league can ever roll, so a `when_full` form never renders this line.
 */
export function DraftTimingNotes({
  league,
  authority,
}: {
  readonly league: PublicLeagueSummary;
  readonly authority: "house" | "member";
}) {
  return (
    <>
      {league.startTrigger === "when_full" ? (
        <p className="mt-1 text-text-muted">{describeStartTiming({ startTrigger: "when_full", authority })}</p>
      ) : null}
      {league.startTrigger === "scheduled" && league.kickoffRolls > 0 ? (
        <p className="mt-1 text-xs text-text-muted">{rollNoticeSentence(league.kickoffRolls)}</p>
      ) : null}
    </>
  );
}

/**
 * The one action, both forms, both auth states. Signed in: the real join button. Signed out:
 * the HOLD interstitial for THIS league (Task 6, F6), never a generic `/app` — the parent seats
 * a visitor who comes back still holding a live token. Quiet pill unless the PARENT grants this
 * league the view's one ink action (rule 5 — `featuredLeagueId` decides, per rendering).
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
  const variant = emphasis === "ink" ? ("primary" as const) : ("secondary" as const);
  return signedIn ? (
    <JoinPublicLeagueButton leagueId={league.id} leagueName={league.name} variant={variant} />
  ) : (
    <SignInLink intent={`/join/${league.id}/hold`} aria-label={ctaAccessibleName(league)} className={buttonClassName(variant, "md")}>
      {ctaVisibleText(league)}
    </SignInLink>
  );
}
