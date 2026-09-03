"use client";

import Link from "next/link";
import { Card, LedgerRow, SeatMeter } from "@/components/ui";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { Button } from "@/components/ui";
import { moneyIsLive } from "@/money/states";
import {
  ctaAccessibleName,
  ctaVisibleText,
  DraftTimingNotes,
  FormatLine,
  LiveChip,
  OpenLeagueCta,
  potFacts,
  ScheduledDraftValue,
  entryFeeLabel,
  stakeBadge,
  useOpenLeagueLive,
} from "./open-league-shared";

/** "Weeks 15, 16 and 17" / "Weeks 15 and 16" / "Week 15" — the one place a raw week-number list
 *  becomes a sentence, so `PublicLeagueSummary.playoffWeeks` stays raw data on the wire (its own
 *  docblock) and every reader of it says "and" the same way. Card-only: the founder's six row
 *  columns (Task 13) do not carry Playoffs, so the row never formats one. */
function formatPlayoffWeeks(weeks: readonly number[]): string {
  if (weeks.length === 0) return "Not scheduled yet";
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  const last = weeks[weeks.length - 1];
  const rest = weeks.slice(0, -1);
  return `Weeks ${rest.join(", ")} and ${last}`;
}

export interface OpenLeagueCardProps {
  readonly league: PublicLeagueSummary;
  readonly signedIn: boolean;
  /**
   * Rule 5, one ink action per view — and which card, if any, earns it is the PARENT's call
   * (Task 6 computes the shelf's single featured card). Quiet by default: a card in a shelf of
   * twenty is never the view's one ink action on its own authority.
   */
  readonly emphasis?: "ink" | "quiet";
  /** Defaults to the real `moneyIsLive()` — injectable, the `FrontDoorHero` idiom. Adds the
   *  pot ledger row (front door blueprint, 2026-09-02) only when live: the free season's Entry
   *  row already says "Free" and a second money row with zero variance would say nothing. */
  readonly live?: boolean;
  /** Same contract as `LeagueRow.onOpen`: the card's verb opens the join sheet instead of
   *  acting directly. */
  readonly onOpen?: () => void;
}

/**
 * THE open-league card — v3's ledger card (Phase 3.7, Task 5, from the founder-approved
 * "Sunday Standard" mock), since Task 13 the shelf's SUB-LG form only: on lg+ viewports the
 * shelf renders `LeagueRow` instead (founder-ordered), and every derived fact the two share —
 * clock, chip, badge authority, the CTA contract — moved to `open-league-shared.tsx`, the one
 * source both consume. What stays card-only is the card's own shape: sentence-case name at card
 * size, one quiet dot-separated format line (F1), five hairline-topped ledger rows (S7: Drafts,
 * Entry, Seats, Roster, Playoffs), the segment seat bar with its visible sentence, the beginner
 * escape hatch, and one action. Every fact on it comes from `PublicLeagueSummary` and nothing
 * else — see that contract for what a stranger is and is not told.
 *
 * The when-full commitment (F9) is one press away: `ScheduledDraftValue` renders the compact
 * "Drafts when full" value plus the `sit-and-go` glossary `InfoTip` (storefront review E1
 * retired the 30-word paragraph this row used to print inline, in place of the Drafts value,
 * on every `when_full` card).
 */
export function OpenLeagueCard({ league, signedIn, emphasis = "quiet", live = moneyIsLive(), onOpen }: OpenLeagueCardProps) {
  const { remainingSeats, remainingMs, onDeck, liveChipLabel } = useOpenLeagueLive(league);
  const isBeginnerOnly = league.experienceTier === "beginner";
  const badge = stakeBadge(league);
  const pot = live ? potFacts(league) : null;

  return (
    // `interactive` (the fun pass, Task 12): rule 4's amended test names this exact surface — "a
    // thing you act on or compare against its neighbours may be a card", and a shelf of open
    // leagues is both. The variant has existed since Task 2 and was spent on nothing, which is a
    // real part of what "it feels like a legal website" was describing: a shelf a manager is
    // meant to compare and then join sat as still as a page of terms. Depth only — the card takes
    // no role and no tabindex, so `OpenLeagueCta` below stays the only thing on it you can press
    // and rule 5's one-ink-action accounting is untouched.
    <Card as="article" interactive className="flex h-full flex-col gap-3">
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

      <FormatLine league={league} />

      {/* The five ledger rows (S7): dense, comparable, hairline-topped. */}
      <div className="flex flex-col">
        <div className="border-t border-line py-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="shrink-0 text-text-muted">Drafts</span>
            <ScheduledDraftValue league={league} onDeck={onDeck} remainingMs={remainingMs} className="text-right" />
          </div>
          <DraftTimingNotes league={league} />
        </div>
        <LedgerRow label="Entry">
          {/* Real, not promotional: `entryFeeLabel` reads the league's REAL entry fee. A price
              is a fact and wears ink (v5 law 1) — money green is gone, and cyan is the verdict
              channel a price has no claim on. */}
          <span className="font-semibold text-text-primary">{entryFeeLabel(league)}</span>
        </LedgerRow>
        <LedgerRow label="Seats">
          <span className="font-medium tabular-nums text-text-primary">
            {remainingSeats} of {league.teamCount} open
          </span>
        </LedgerRow>
        {pot === null ? null : (
          <LedgerRow label="The pot">
            <span className="font-medium tabular-nums text-text-primary">{`${pot.potUsd} · ${pot.placesLabel}`}</span>
          </LedgerRow>
        )}
        <LedgerRow label="Roster">
          <span className="font-medium text-text-primary">{league.rosterSummary}</span>
        </LedgerRow>
        {/* No tip (founder ruling, 2026-08-28): "Playoffs" beside "Weeks 15 to 17" explains
            itself; the bracket rules live at /league-rules. */}
        <LedgerRow label="Playoffs">
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
        {onOpen === undefined ? (
          <OpenLeagueCta league={league} signedIn={signedIn} emphasis={emphasis} />
        ) : (
          <Button
            variant={emphasis === "ink" ? "verb" : "secondary"}
            onClick={onOpen}
            aria-label={ctaAccessibleName(league)}
            aria-haspopup="dialog"
          >
            {ctaVisibleText(league)}
          </Button>
        )}
      </div>
    </Card>
  );
}
