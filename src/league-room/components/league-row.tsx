"use client";

import { SeatMeter } from "@/components/ui";
import { EYEBROW } from "@/components/ui/config";
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

/**
 * The one grid template the column-header row and every league row share — six columns:
 * name+chip · format line · Drafts · Entry · Seats · action. `minmax(0, …)` on every fr column
 * for the same reason the card grid's items carry `min-w-0`: a grid track's default
 * `min-width: auto` otherwise lets a long league name widen its column past its share.
 */
export const LEAGUE_ROW_GRID =
  "grid grid-cols-[minmax(0,2.1fr)_minmax(0,2fr)_minmax(0,1.7fr)_max-content_minmax(0,1.9fr)_max-content] items-center gap-x-4";

/**
 * The five column names, once, above the stack — EYEBROW register (sentence case, mono, quiet;
 * the caps charter applies to headers too). `aria-hidden`: a bare run of five nouns read in
 * sequence tells a screen reader nothing a row does not already say better — every cell that
 * needs a spoken key carries its own (`sr-only` "Entry", the full seat sentence, the CTA's
 * accessible name), so this line is layout for eyes, like the seat segments beside their
 * sentence. The sixth (action) column deliberately has no name: a pill names itself.
 */
export function LeagueRowsHeader() {
  return (
    <div aria-hidden="true" className={`${LEAGUE_ROW_GRID} pb-2 ${EYEBROW} text-text-muted`}>
      <span>League</span>
      <span>Format</span>
      <span>Drafts</span>
      <span>Entry</span>
      <span>Seats</span>
      <span />
    </div>
  );
}

export interface LeagueRowProps {
  readonly league: PublicLeagueSummary;
  readonly signedIn: boolean;
  /** Rule 5, one ink action per view — which row, if any, earns it is the PARENT's call
   *  (`featuredLeagueId`), exactly as on the card. Quiet by default. */
  readonly emphasis?: "ink" | "quiet";
}

/**
 * THE open-league row (Phase 3.7, Task 13 — FOUNDER-ORDERED, 2026-08-24 live-page feedback:
 * "horizontal row elements instead of these cards - my eyes don't know where to focus"): one
 * league per horizontal row on lg+ viewports, in a hairline-separated stack (rule 4 — the
 * hairline lives on the parent's `<li>`, no boxes), the six columns above. Below lg the shelf
 * renders `OpenLeagueCard` instead — a six-column row cannot fit 360px; the card IS the mobile
 * form. Every derived fact comes from `open-league-shared.tsx`, the ONE source both forms
 * consume, so a row and a card can never disagree about the same league.
 *
 * Deliberately NOT here, per the founder's six columns: the card's Roster and Playoffs ledger
 * rows and the beginner escape-hatch paragraph — the format line's "newer players only" still
 * says who a beginner row is for, and the CTA's accessible name still says it to a screen
 * reader, verbatim. There is no `helpLevel` prop at all: guided captions never print inline in
 * a row, regardless of the member's stored preference — the InfoTips stay click-only.
 */
export function LeagueRow({ league, signedIn, emphasis = "quiet" }: LeagueRowProps) {
  const { authority, remainingSeats, remainingMs, onDeck, liveChipLabel } = useOpenLeagueLive(league);

  return (
    <div className={`${LEAGUE_ROW_GRID} py-3`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {/* The ledger-card register (16.5/600, sentence case) — the same heading element the
            card renders, so every heading-role read of the shelf survives the form change. */}
        <h3 className="min-w-0 break-words font-display text-lg font-semibold leading-display text-text-primary">
          {league.name}
        </h3>
        {liveChipLabel === null ? null : <LiveChip label={liveChipLabel} />}
        {stakeBadge(league)}
      </div>

      <FormatLine league={league} helpLevel="standard" />

      <div className="min-w-0 text-sm">
        <ScheduledDraftValue league={league} onDeck={onDeck} remainingMs={remainingMs} />
        <DraftTimingNotes league={league} authority={authority} />
      </div>

      <div className="text-sm">
        {/* The row's only spoken key: "Free" alone, mid-row, would answer a question a screen
            reader was never asked. Money green is what green means (rule 1). */}
        <span className="sr-only">Entry</span>{" "}
        <span className="font-semibold text-positive">{entryFeeLabel(league)}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="font-medium tabular-nums text-text-primary">
          {remainingSeats} of {league.teamCount} open
        </span>
        {/* F17 kept: the one product seat sentence still speaks (held seats included) — sr-only,
            because the tabular count above is this column's visible value. */}
        <SeatMeter filled={league.filledTeams} total={league.teamCount} heldSeats={league.heldSeats} srOnlySentence />
      </div>

      <div className="justify-self-end">
        <OpenLeagueCta league={league} signedIn={signedIn} emphasis={emphasis} />
      </div>
    </div>
  );
}
