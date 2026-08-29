"use client";

import { SeatMeter } from "@/components/ui";
import { MICRO_LABEL, UI_CONFIG } from "@/components/ui/config";
import { useValueChangeHighlight } from "@/design/use-value-change-highlight";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import {
  DraftTimingNotes,
  FormatLine,
  LiveChip,
  OpenLeagueCta,
  ScheduledDraftValue,
  stakeBadge,
  useOpenLeagueLive,
} from "./open-league-shared";

/**
 * The one grid template the column-header row and every league row share — six columns:
 * position · name+chip · format · drafts · seats · verb. `minmax(0, …)` on every fr column
 * for the same reason the card grid's items carry `min-w-0`: a grid track's default
 * `min-width: auto` otherwise lets a long league name widen its column past its share.
 *
 * SUNDAY v5 (founder, 2026-08-28: "this table is boring and feels stagnant"): the ENTRY column
 * is deleted — every league is free this season, and a column with zero variance carries no
 * information, which is the tower's own test for a column's existence. The stake disclosure
 * line under the board still says the money fact once. POSITION arrived in its place: the board
 * is ranked by seats remaining, so the room that fires next reads as P1, which is what makes a
 * list a leaderboard.
 *
 * The verb track stays 176px: it clears "Take the last seat" (`ctaVisibleText`) at the button's
 * own `md` padding, and a fixed track is what keeps the header aligned over two separate grid
 * containers (storefront review D2 — `max-content` resolves per container).
 */
export const LEAGUE_ROW_GRID =
  "grid grid-cols-[44px_minmax(0,2.2fr)_minmax(0,1.7fr)_minmax(0,1.7fr)_minmax(0,2fr)_176px] items-center gap-x-4";

/**
 * The column names, once, above the stack — the shouted micro-label register (the one register
 * a scoreboard has always shouted quietly). `aria-hidden`: every cell that needs a spoken key
 * carries its own, so this line is layout for eyes. The verb column names itself.
 */
export function LeagueRowsHeader() {
  return (
    <div aria-hidden="true" className={`${LEAGUE_ROW_GRID} pb-2 pl-2 ${MICRO_LABEL} text-text-faint`}>
      <span>#</span>
      <span>League</span>
      <span>Format</span>
      <span>Drafts</span>
      <span>Seats</span>
      <span />
    </div>
  );
}

export interface LeagueRowProps {
  readonly league: PublicLeagueSummary;
  readonly signedIn: boolean;
  /** The board's rank for this room — 1 is the room that fires next. The PARENT computes it
   *  over the whole ranked list, so a filtered rendering never renumbers. */
  readonly position: number;
  /** True on the board's leader — the row that wears the amber rail, the tower's own "your
   *  row" treatment spent on the room closest to firing. */
  readonly leader?: boolean;
  readonly emphasis?: "ink" | "quiet";
  /** The heading level this row's league name renders at — the PARENT's call (page-audit
   *  harness, 2026-08-27). Defaults to the front door's shape. */
  readonly headingLevel?: 2 | 3;
}

/**
 * THE open-league row as a timing-tower line (Sunday v5; founder, 2026-08-28: "make it feel
 * alive like the tower"). What changed from the ledger row it replaces, law by law:
 *
 * - LAW 1/2 — a POSITION numeral leads the row, and the board is ranked by the one number that
 *   varies: seats remaining. P1 is the room that fires next.
 * - LAW 3 — seats-left is the row's HERO number, display face at 2xl, not a micro caption. The
 *   pips read under it as the shape; the number is the fact.
 * - THE LIVE CHANNEL — a room inside `lowSeatsThreshold` of firing paints its numeral live-red.
 *   That is the real threshold every seat sentence already keys on, not a vibe.
 * - MOTION REPORTS — `useValueChangeHighlight` flashes the numeral amber for a beat when the
 *   live count actually changes (a claim landed while you were looking). Nothing animates on
 *   mount; a row is only ever seen moving because the world moved.
 * - The DRAFTS column leads with the relative fact ("In 2 days" / "When full" / the ticking
 *   countdown) and drops the absolute date to the faint line — the delta is the story, the
 *   date is the record.
 */
export function LeagueRow({ league, signedIn, position, leader = false, emphasis = "quiet", headingLevel = 3 }: LeagueRowProps) {
  const { remainingSeats, remainingMs, onDeck, liveChipLabel } = useOpenLeagueLive(league);
  const claimFlash = useValueChangeHighlight(remainingSeats);
  const NameHeading = headingLevel === 2 ? "h2" : "h3";

  const urgent = league.filledTeams > 0 && remainingSeats > 0 && remainingSeats < UI_CONFIG.seatMeter.lowSeatsThreshold;

  return (
    <div
      className={`${LEAGUE_ROW_GRID} border-l-[3px] py-3 pl-2 transition-colors hover:bg-surface-elevated ${
        leader ? "border-l-accent bg-gradient-to-r from-accent-glow via-transparent to-transparent" : "border-l-transparent"
      }`}
    >
      <span
        aria-hidden="true"
        className={`font-display text-2xl font-extrabold tabular-nums ${
          leader ? "text-accent" : urgent ? "text-live" : "text-text-faint"
        }`}
      >
        {position}
      </span>

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <NameHeading className="min-w-0 break-words font-display text-lg font-bold leading-display text-text-primary">
          {league.name}
        </NameHeading>
        {liveChipLabel === null ? null : <LiveChip label={liveChipLabel} />}
        {stakeBadge(league)}
      </div>

      <FormatLine league={league} />

      <div className="min-w-0 text-sm">
        <ScheduledDraftValue league={league} onDeck={onDeck} remainingMs={remainingMs} relativeFirst />
        <DraftTimingNotes league={league} />
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span
          className={`font-display text-2xl font-bold leading-none tabular-nums transition-colors duration-500 ${
            claimFlash ? "text-accent" : urgent ? "text-live" : "text-text-primary"
          }`}
        >
          {remainingSeats}
          <span className={`${MICRO_LABEL} ml-1.5 align-middle font-sans text-text-faint`}>
            {remainingSeats === 1 ? "seat left" : "left"} of {league.teamCount}
          </span>
        </span>
        <SeatMeter filled={league.filledTeams} total={league.teamCount} heldSeats={league.heldSeats} srOnlySentence />
      </div>

      <div className="justify-self-end">
        <OpenLeagueCta league={league} signedIn={signedIn} emphasis={emphasis} />
      </div>
    </div>
  );
}
