"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, InfoTip, SeatMeter, buttonClassName } from "@/components/ui";
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
import { HOUSE_RUNG_LABEL } from "@/matchmaking/house-catalog";
import { JoinPublicLeagueButton } from "./join-public-league-button";

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

/** "Weeks 15, 16 and 17" / "Weeks 15 and 16" / "Week 15" — the one place a raw week-number list
 *  becomes a sentence, so `PublicLeagueSummary.playoffWeeks` stays raw data on the wire (its own
 *  docblock) and every reader of it says "and" the same way. */
function formatPlayoffWeeks(weeks: readonly number[]): string {
  if (weeks.length === 0) return "Not scheduled yet";
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  const last = weeks[weeks.length - 1];
  const rest = weeks.slice(0, -1);
  return `Weeks ${rest.join(", ")} and ${last}`;
}

/**
 * Whether `league` names the LAST open seat — the exact remaining count, never accounting for a
 * live hold: a hold is a fact about who is CLAIMING the seat, not about how many are left to be
 * claimed, and the two never agree on the wire in a way this label needs to second-guess.
 */
function isLastSeat(league: PublicLeagueSummary): boolean {
  return league.teamCount - league.filledTeams === 1;
}

/**
 * The one CTA accessible name every card on the shelf uses (Phase 3.6, Task 5): "Take the last
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
 * only while something on this card is genuinely live — the label is DERIVED on every render
 * from facts already on the wire, never a stored flag. Static under reduced motion: the state
 * still shows, only the pulse stops.
 */
function LiveChip({ label }: { readonly label: string }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-negative">
      <span aria-hidden="true" className={`size-1.5 rounded-pill bg-negative${reducedMotion ? "" : " animate-pulse-live"}`} />
      {label}
    </span>
  );
}

/** One hairline-topped ledger row: quiet key left, value right (S7, rule 4 — structure from
 *  thin rules and space, never boxes). */
function LedgerRow({ label, children }: { readonly label: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-t border-line py-1.5 text-sm">
      <span className="inline-flex shrink-0 items-center gap-1 text-text-muted">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

export interface OpenLeagueCardProps {
  readonly league: PublicLeagueSummary;
  readonly signedIn: boolean;
  /**
   * D1/E7: how much inline explanation this card's `InfoTip`s volunteer is the CALLER's call,
   * never a constant — public pages pass `"standard"` (the definition stays one click away,
   * beneath Task 6's one legend line), and a signed-in surface passes the member's own stored
   * preference (`readPreferences`) so guided remains a preference behavior, not a surface one.
   */
  readonly helpLevel: HelpLevel;
  /**
   * Rule 5, one ink action per view — and which card, if any, earns it is the PARENT's call
   * (Task 6 computes the shelf's single featured card). Quiet by default: a card in a shelf of
   * twenty is never the view's one ink action on its own authority.
   */
  readonly emphasis?: "ink" | "quiet";
}

/**
 * THE open-league card — v3's ledger card (Phase 3.7, Task 5, from the founder-approved
 * "Sunday Standard" mock): sentence-case name at card size, one quiet dot-separated format line
 * (F1 — the stacked `basis-full` term list and its orphanable separators are gone), five
 * hairline-topped ledger rows (S7: Drafts, Entry, Seats, Roster, Playoffs — the mock's three
 * plus the audit's veteran shopping facts, with Who folded into the format line), the segment
 * seat bar, a live chip only when something is genuinely live, and one action. Every fact on it
 * comes from `PublicLeagueSummary` and nothing else — see that contract for what a stranger is
 * and is not told.
 *
 * The when-full commitment is `describeStartTiming`'s own sentence (F9), quoted rather than
 * restated, in `text-text-muted` (E5: `warning` is reserved for a tightening clock, and this
 * sentence is reassurance). It REPLACES the Drafts row's value for a `when_full` league — never
 * both a date and the sentence, and never the placeholder kickoff `startTrigger`'s own docblock
 * warns every other reader away from rendering as though somebody chose it.
 */
export function OpenLeagueCard({ league, signedIn, helpLevel, emphasis = "quiet" }: OpenLeagueCardProps) {
  const authority: "house" | "member" = league.houseRung === null ? "member" : "house";
  const isBeginnerOnly = league.experienceTier === "beginner";

  // The ledger clock (rule 6): tick only against a real, chosen instant — a `when_full`
  // league's `draftAtIso` is the same placeholder its `draftAt` is, so it never reaches the
  // hook at all (the identical gate every reader of `draftAt` holds).
  const { remainingMs } = useCountdown(league.startTrigger === "scheduled" ? (league.draftAtIso ?? null) : null);
  const onDeck = remainingMs !== null && remainingMs < UI_CONFIG.openLeagueCard.clockWithinMs;

  // The live chip's two derived-only states, one source of truth each: "Filling" reads the seat
  // meter's own low-seats threshold, "On deck" reads the clock's own window. On deck outranks
  // Filling — one chip, and a draft about to start is the more imminent fact than seats running
  // low on the way to it.
  const remainingSeats = league.teamCount - league.filledTeams;
  const filling = remainingSeats > 0 && remainingSeats < UI_CONFIG.seatMeter.lowSeatsThreshold;
  const liveChipLabel = onDeck ? "On deck" : filling ? "Filling" : null;

  // E3: the badge carries only what the title does not, made literal — a factory-named house
  // league is "Open 12-team League 3", so a rung badge beside it repeats the title's own first
  // words and dies; a member league's name never states its stake, so the stake badge stands.
  const badgeLabel = league.houseRung === null ? stakeTierLabel(league.stakeTier) : HOUSE_RUNG_LABEL[league.houseRung];
  const badgeTone = league.houseRung === null ? ("neutral" as const) : ("accent" as const);
  const badge = league.name.includes(badgeLabel) ? null : <Badge tone={badgeTone}>{badgeLabel}</Badge>;

  const ctaVariant = emphasis === "ink" ? ("primary" as const) : ("secondary" as const);

  return (
    <Card as="article" className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        {/* `min-w-0 break-words`: see `HomeLeagueCard`'s identical heading — a grid item's
            default `min-width: auto` otherwise lets a long league name widen the item past its
            column at 360px. `text-lg`: the mock's card register (16.5/600), never the old
            display-2xl shout. */}
        <h3 className="min-w-0 break-words font-display text-lg font-semibold leading-display text-text-primary">
          {league.name}
        </h3>
        {liveChipLabel === null && badge === null ? null : (
          <span className="flex shrink-0 items-center gap-2 pt-0.5">
            {liveChipLabel === null ? null : <LiveChip label={liveChipLabel} />}
            {badge}
          </span>
        )}
      </div>

      {/* F1: ONE muted format line, dot-separated — a separator between items on one line
          separates something again. Who folds in here (S7): the beginner tier is a fact about
          the league's format, said once, quietly. */}
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
        {isBeginnerOnly ? (
          <>
            <Dot />
            <span>newer players only</span>
          </>
        ) : null}
      </p>

      {/* The five ledger rows (S7): dense, comparable, hairline-topped. */}
      <div className="flex flex-col">
        <div className="border-t border-line py-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="shrink-0 text-text-muted">Drafts</span>
            {league.startTrigger === "scheduled" ? (
              onDeck && remainingMs !== null ? (
                <Countdown remainingMs={remainingMs} size="sm" tone="hot" data-testid="draft-clock" />
              ) : (
                <span className="min-w-0 text-right font-medium tabular-nums text-text-primary">{league.draftAt}</span>
              )
            ) : null}
          </div>
          {league.startTrigger === "when_full" ? (
            <p className="mt-1 text-text-muted">{describeStartTiming({ startTrigger: "when_full", authority })}</p>
          ) : null}
          {/* F12/F21: `kickoffRolls` is `PublicLeagueSummary`'s own field, read here rather than
              silently showing a different date than the one a visitor is comparing against their
              own calendar — only a SCHEDULED league can ever roll, so a `when_full` card never
              renders this line. */}
          {league.startTrigger === "scheduled" && league.kickoffRolls > 0 ? (
            <p className="mt-1 text-xs text-text-muted">{rollNoticeSentence(league.kickoffRolls)}</p>
          ) : null}
        </div>
        <LedgerRow label="Entry">
          {/* Real, not promotional: every league is free this season — `stakeTierLabel` is the
              one place that says what a stake tier costs, and money green is what green means
              (rule 1). */}
          <span className="font-semibold text-positive">{stakeTierLabel(league.stakeTier)}</span>
        </LedgerRow>
        <LedgerRow label="Seats">
          <span className="font-medium tabular-nums text-text-primary">
            {remainingSeats} of {league.teamCount} open
          </span>
        </LedgerRow>
        <LedgerRow label="Roster">
          <span className="font-medium text-text-primary">{league.rosterSummary}</span>
        </LedgerRow>
        <LedgerRow
          label={
            <>
              Playoffs
              {/* `standard`, not this card's `helpLevel`, only here: a guided caption stacking
                  between a ledger key and its value would break the one row out of line with its
                  four siblings — the definition stays one click away, same as everywhere
                  `InfoTip` is not the always-visible kind. */}
              <InfoTip term="playoffs" helpLevel="standard" />
            </>
          }
        >
          <span className="font-medium text-text-primary">{formatPlayoffWeeks(league.playoffWeeks)}</span>
        </LedgerRow>
      </div>

      {/* F17: the seat sentence is `SeatMeter`'s, everywhere, held seats included — and the
          segment bar beside it fills money-green, seat by seat (rule 1). */}
      <SeatMeter filled={league.filledTeams} total={league.teamCount} heldSeats={league.heldSeats} />

      {isBeginnerOnly ? (
        <p className="text-sm text-text-muted">
          Reserved for players newer to Commish so everyone starts even. Played here before?{" "}
          <Link href="/browse?experienceTier=experienced" className="font-medium text-accent underline">
            Browse leagues open to everyone
          </Link>
          .
        </p>
      ) : null}

      <div className="mt-auto">
        {signedIn ? (
          <JoinPublicLeagueButton leagueId={league.id} leagueName={league.name} variant={ctaVariant} />
        ) : (
          // The HOLD interstitial for THIS league (Task 6, F6), not a generic `/app` — the
          // parent's Task 6 seats a visitor who comes back still holding a live token.
          <SignInLink intent={`/join/${league.id}/hold`} aria-label={ctaAccessibleName(league)} className={buttonClassName(ctaVariant, "md")}>
            {ctaVisibleText(league)}
          </SignInLink>
        )}
      </div>
    </Card>
  );
}
