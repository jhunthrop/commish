"use client";

import { SeatMeter } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
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
 *
 * Entry and action are FIXED pixel tracks, never `max-content` (storefront review D2, fixed
 * rather than left as the finding's second option): `LeagueRowsHeader` and `LeagueRow` are TWO
 * SEPARATE grid containers sharing this one class string, and `max-content` resolves PER
 * CONTAINER — the header's own Entry cell ("Entry", ~34px) and a data row's own Entry cell
 * ("Free" or a real fee, ~27–70px) sized to two different widths, which pushed every column to
 * its right out of alignment by exactly that difference (measured: up to 80px at Entry/Seats).
 * A fixed track resolves to the identical width in both containers regardless of either one's
 * content, which is what makes the header sit over its columns rather than merely near them. 96px
 * clears every entry-fee string this product renders today (`entryFeeLabel`, up to `$9,999.00`);
 * 176px clears the row's longest CTA text, "Take the last seat" (`ctaVisibleText`), at the
 * button's own `md` padding.
 */
export const LEAGUE_ROW_GRID =
  "grid grid-cols-[minmax(0,2.1fr)_minmax(0,2fr)_minmax(0,1.7fr)_96px_minmax(0,1.9fr)_176px] items-center gap-x-4";

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
    // Sunday v5: column heads take the shouted micro-label register — the one register a
    // scoreboard has always shouted quietly, and the timing-tower render's own head row.
    <div aria-hidden="true" className={`${LEAGUE_ROW_GRID} pb-2 ${MICRO_LABEL} text-text-faint`}>
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
  /**
   * The heading level this row's league name renders at — the PARENT's call, because only the
   * shelf knows what heading sits above it (page-audit harness, 2026-08-27: `/browse` renders
   * the shelf under an `<h1>` and every row's hardcoded `<h3>` skipped a level, eleven axe
   * `heading-order` violations on one page; the front door's shelf sits under an `<h2>`, where
   * `h3` was right all along). Defaults to the front door's shape.
   */
  readonly headingLevel?: 2 | 3;
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
export function LeagueRow({ league, signedIn, emphasis = "quiet", headingLevel = 3 }: LeagueRowProps) {
  const { remainingSeats, remainingMs, onDeck, liveChipLabel } = useOpenLeagueLive(league);
  const NameHeading = headingLevel === 2 ? "h2" : "h3";

  return (
    <div className={`${LEAGUE_ROW_GRID} py-3`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {/* The ledger-card register (16.5/600, sentence case) — the same heading element the
            card renders, so every heading-role read of the shelf survives the form change. */}
        {/* The tower's name register: the display face at its earned 700 (law 3). */}
        <NameHeading className="min-w-0 break-words font-display text-lg font-bold leading-display text-text-primary">
          {league.name}
        </NameHeading>
        {liveChipLabel === null ? null : <LiveChip label={liveChipLabel} />}
        {stakeBadge(league)}
      </div>

      <FormatLine league={league} />

      <div className="min-w-0 text-sm">
        <ScheduledDraftValue league={league} onDeck={onDeck} remainingMs={remainingMs} />
        <DraftTimingNotes league={league} />
      </div>

      <div className="text-sm">
        {/* The row's only spoken key: "Free" alone, mid-row, would answer a question a screen
            reader was never asked. Money green is what green means (rule 1). */}
        <span className="sr-only">Entry</span>{" "}
        {/* A price is a FACT (law 1), so it wears ink. v3 painted it money-green; v5's green is
            gone and cyan is the verdict channel, which a price has no claim on. */}
        <span className="font-display font-semibold text-text-primary">{entryFeeLabel(league)}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span className={`${MICRO_LABEL} tabular-nums text-text-faint`}>
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
