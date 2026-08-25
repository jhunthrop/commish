"use client";

import Link from "next/link";
import { Card, InfoTip, LedgerRow, SeatMeter } from "@/components/ui";
import type { HelpLevel } from "@/identity/preferences";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import {
  DraftTimingNotes,
  FormatLine,
  LiveChip,
  OpenLeagueCta,
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
 * "Sunday Standard" mock), since Task 13 the shelf's SUB-LG form only: on lg+ viewports the
 * shelf renders `LeagueRow` instead (founder-ordered), and every derived fact the two share —
 * clock, chip, badge authority, the CTA contract — moved to `open-league-shared.tsx`, the one
 * source both consume. What stays card-only is the card's own shape: sentence-case name at card
 * size, one quiet dot-separated format line (F1), five hairline-topped ledger rows (S7: Drafts,
 * Entry, Seats, Roster, Playoffs), the segment seat bar with its visible sentence, the beginner
 * escape hatch, and one action. Every fact on it comes from `PublicLeagueSummary` and nothing
 * else — see that contract for what a stranger is and is not told.
 *
 * The when-full commitment is `describeStartTiming`'s own sentence (F9), quoted rather than
 * restated, in `text-text-muted` (E5: `warning` is reserved for a tightening clock, and this
 * sentence is reassurance) — `DraftTimingNotes` renders it in place of the Drafts value, never
 * both a date and the sentence.
 */
export function OpenLeagueCard({ league, signedIn, helpLevel, emphasis = "quiet" }: OpenLeagueCardProps) {
  const { authority, remainingSeats, remainingMs, onDeck, liveChipLabel } = useOpenLeagueLive(league);
  const isBeginnerOnly = league.experienceTier === "beginner";
  const badge = stakeBadge(league);

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

      <FormatLine league={league} helpLevel={helpLevel} />

      {/* The five ledger rows (S7): dense, comparable, hairline-topped. */}
      <div className="flex flex-col">
        <div className="border-t border-line py-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="shrink-0 text-text-muted">Drafts</span>
            <ScheduledDraftValue league={league} onDeck={onDeck} remainingMs={remainingMs} className="text-right" />
          </div>
          <DraftTimingNotes league={league} authority={authority} />
        </div>
        <LedgerRow label="Entry">
          {/* Real, not promotional: `entryFeeLabel` reads the league's REAL entry fee — "Free"
              for every league today, because every league is free this season — and money
              green is what green means (rule 1). */}
          <span className="font-semibold text-positive">{entryFeeLabel(league)}</span>
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
        <OpenLeagueCta league={league} signedIn={signedIn} emphasis={emphasis} />
      </div>
    </Card>
  );
}
