"use client";

import { BigNumber, SeatStack } from "@/components/ui";
import { seatSentence } from "@/components/ui/seat-meter";
import { MICRO_LABEL } from "@/components/ui/config";
import { useValueChangeHighlight } from "@/design/use-value-change-highlight";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { Button } from "@/components/ui";
import { moneyIsLive } from "@/money/states";
import {
  ctaAccessibleName,
  ctaVisibleText,
  entryFeeLabel,
  FormatLine,
  LiveChip,
  OpenLeagueCta,
  potFacts,
  ScheduledDraftValue,
  seatedLine,
  stakeBadge,
  useOpenLeagueLive,
} from "./open-league-shared";

/**
 * The one grid template the column-header row and every league row share — five columns:
 * who · format · drafts · seats · verb. `minmax(0, …)` on every fr column for the same reason
 * the card grid's items carry `min-w-0`: a grid track's default `min-width: auto` otherwise lets
 * a long league name widen its column past its share. Five columns, inside P10's cap of five
 * and with the fifth being the verb.
 *
 * SIDELINE (2026-09-10): the POSITION numeral is deleted. P1 rules out "rows that begin with a
 * rank numeral in display type" by name, and the tower's leaderboard reading was the numeral's
 * whole justification — the ordering is still the ranking, it simply no longer shouts an index
 * at the reader before it has said whose room this is. What leads the row now is WHO IS IN IT
 * (`SeatStack` and the seated line, `seatedLine`), which is P1's own instruction.
 *
 * SUNDAY v5 (founder, 2026-08-28: "this table is boring and feels stagnant"): the ENTRY column
 * stays deleted — every league is free this season, and a column with zero variance carries no
 * information. The stake disclosure line under the board still says the money fact once.
 *
 * The verb track stays 176px: it clears "Take the last seat" (`ctaVisibleText`) at the button's
 * own `md` padding, and a fixed track is what keeps the header aligned over two separate grid
 * containers (storefront review D2 — `max-content` resolves per container).
 */
export const LEAGUE_ROW_GRID =
  "grid grid-cols-[minmax(0,2.3fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_150px_176px] items-center gap-x-4";

/**
 * The LIVE-MONEY template (front door blueprint, 2026-09-02): BUY-IN and THE POT ride between
 * seats and the verb, and they exist AT ALL only while `moneyIsLive()` — the free season's
 * zero-variance money columns stay deleted (the ruling that removed the Entry column stands;
 * the derived free-season sentence under the board says the money fact once). Buy-in is a
 * fixed right-aligned track (a price is short and comparison wants a shared right edge); the
 * pot takes a fr share for its split note.
 *
 * Seven columns is past P10's cap and the money round owns that reckoning, not this one: the
 * template is unreachable while `moneyIsLive()` is dark, which is every render today.
 */
export const LEAGUE_ROW_GRID_LIVE =
  "grid grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_140px_88px_minmax(0,1.4fr)_176px] items-center gap-x-4";

/** The one place the live/free template fork happens, for the header and every row alike. */
export function leagueRowGrid(live: boolean): string {
  return live ? LEAGUE_ROW_GRID_LIVE : LEAGUE_ROW_GRID;
}

/**
 * The column names, once, above the stack — the shouted micro-label register (the one register
 * a scoreboard has always shouted quietly). `aria-hidden`: every cell that needs a spoken key
 * carries its own, so this line is layout for eyes. The verb column names itself.
 */
export function LeagueRowsHeader({ live = moneyIsLive() }: { readonly live?: boolean }) {
  return (
    <div aria-hidden="true" className={`${leagueRowGrid(live)} pb-2 pl-2 ${MICRO_LABEL} text-text-faint`}>
      <span>Who is in</span>
      <span>Format</span>
      <span>Drafts</span>
      {/* `text-right`: the seat figure is `items-end` in its own fixed track, so a left-set
          header floated a label away from the numbers it names (fix round 1, M2). */}
      <span className="text-right">Seats</span>
      {live ? (
        <>
          <span className="text-right">Buy-in</span>
          <span>The pot</span>
        </>
      ) : null}
      <span />
    </div>
  );
}

export interface LeagueRowProps {
  readonly league: PublicLeagueSummary;
  readonly signedIn: boolean;
  /** True on the board's featured room — the row that wears the amber wash. */
  readonly leader?: boolean;
  readonly emphasis?: "ink" | "quiet";
  /** The heading level this row's league name renders at — the PARENT's call (page-audit
   *  harness, 2026-08-27). Defaults to the front door's shape. */
  readonly headingLevel?: 2 | 3;
  /** Defaults to the real `moneyIsLive()` — injectable so a test can exercise the live columns
   *  without editing shipped state, the `FrontDoorHero` idiom. */
  readonly live?: boolean;
  /**
   * Front door blueprint (2026-09-02): tapping the row opens the JOIN SHEET, where the whole
   * contract is read and the sheet's own verb rides the holds machinery. When provided, the
   * row's verb becomes the sheet opener (same visible text, same accessible name) and the row
   * surface itself is a pointer convenience onto the same act; when absent the row keeps the
   * direct `OpenLeagueCta`.
   */
  readonly onOpen?: () => void;
}

/**
 * THE open-league row, SIDELINE (2026-09-10). What changed from the timing-tower line it
 * replaces, principle by principle:
 *
 * - P1 — WHO IS IN leads the row. The position numeral is gone (P1 names it as a thing ruled
 *   out), and in its place the seats themselves: `SeatStack` draws taken, held and open, and
 *   `seatedLine` says the count in people. A signed-out stranger may not be told WHICH people
 *   (`PublicLeagueSummary`'s privacy boundary, and `SeatStack`'s own docblock) — this is the
 *   most the product can honestly put before the number, and it is still a room rather than a
 *   capacity figure.
 * - P2 — one number larger than body text, with its basis in the same glance: `BigNumber` at
 *   the row step, "3" over "seats left of 12". The old row printed the figure and its caption as
 *   one hand-rolled span; the primitive owns both now.
 * - P3 — exactly one solid verb, and the featured row is the one that wears it.
 * - THE AMBER WASH — the featured room takes `self-wash`, the mock's treatment, replacing the
 *   blue left rail and blue gradient. Court blue is the VERB (P3): spending it on a row's
 *   furniture put the page's one loud pigment behind a row that already carries the button.
 * - P4 — `useValueChangeHighlight` still washes the figure when the live count actually changes
 *   (a claim landed while you were looking). Nothing animates on mount.
 * - The DRAFTS column still leads with the relative fact and drops the date to the faint line.
 */
export function LeagueRow({
  league,
  signedIn,
  leader = false,
  emphasis = "quiet",
  headingLevel = 3,
  live = moneyIsLive(),
  onOpen,
}: LeagueRowProps) {
  const { remainingSeats, remainingMs, onDeck, liveChipLabel } = useOpenLeagueLive(league);
  const claimFlash = useValueChangeHighlight(remainingSeats);
  const NameHeading = headingLevel === 2 ? "h2" : "h3";

  const pot = live ? potFacts(league) : null;

  return (
    // The row surface is a POINTER CONVENIENCE onto the same act the verb button carries: the
    // button is the accessible, focusable control (same name, same handler), so keyboard and AT
    // users lose nothing — the `Modal` primitive documents the identical pattern for its own
    // container.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      onClick={onOpen}
      className={`${leagueRowGrid(live)} rounded-md px-2 py-2.5 transition-colors ${
        onOpen === undefined ? "" : "cursor-pointer "
      }${
        // L5: the featured row keeps a hover response ON TOP of the wash. It used to trade one
        // for the other, which left the one row you most want pressed as the only row that did
        // not answer the pointer. A ring rather than a fill, because the fill is the wash.
        leader ? "self-wash hover:ring-2 hover:ring-self" : "hover:bg-surface-raised"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <SeatStack filled={league.filledTeams} total={league.teamCount} heldSeats={league.heldSeats} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <NameHeading className="min-w-0 break-words font-display text-lg font-bold leading-tight text-text-primary">
              {league.name}
            </NameHeading>
            {liveChipLabel === null ? null : <LiveChip label={liveChipLabel} />}
            {stakeBadge(league)}
          </span>
          <span className="truncate text-sm text-text-muted">{seatedLine(league)}</span>
        </div>
      </div>

      <FormatLine league={league} />

      {/* THE DRAFTS VALUE AND NOTHING ELSE (fix round 1, M3). The per-league roll sentence left
          this column: it repeated on six of eight rows as a two-line paragraph in the
          scheduler's voice, which is P7 failing twice. The consequence is said once, on the
          band above (`rollBandConsequence`); the per-league reconciliation lives on the join
          sheet and the schedule panel, where a visitor's written-down date is what is actually
          being corrected. */}
      <div className="min-w-0 text-sm">
        <ScheduledDraftValue league={league} onDeck={onDeck} remainingMs={remainingMs} relativeFirst />
      </div>

      <div className="flex min-w-0 flex-col items-end">
        <BigNumber
          value={String(remainingSeats)}
          basis={`${remainingSeats === 1 ? "seat" : "seats"} left of ${league.teamCount}`}
          size="sm"
          changed={claimFlash}
        />
        {/* The product's ONE seat sentence (F17), spoken only — held seats included. The stack
            in the who column already draws the same shape for eyes, so a second visible
            phrasing here would be the claim twice. */}
        <span className="sr-only">{seatSentence(league.filledTeams, league.teamCount, league.heldSeats)}</span>
      </div>

      {live ? (
        <>
          {/* A price is a fact and wears ink (v5 law 1) — `entryFeeLabel` reads the REAL fee. */}
          <span className="text-right font-display text-lg font-bold tabular-nums text-text-primary">{entryFeeLabel(league)}</span>
          <span className="min-w-0 text-sm tabular-nums text-text-muted">
            {pot === null ? "Bragging rights" : (
              <>
                <span className="font-medium text-text-primary">{pot.potUsd}</span>
                <span className="block text-xs text-text-faint">{pot.placesLabel}</span>
              </>
            )}
          </span>
        </>
      ) : null}

      <div className="justify-self-end">
        {onOpen === undefined ? (
          <OpenLeagueCta league={league} signedIn={signedIn} emphasis={emphasis} />
        ) : (
          <Button
            variant={emphasis === "ink" ? "verb" : "secondary"}
            onClick={(event) => {
              // The row surface shares this handler; stop the bubble so one tap is one open.
              event.stopPropagation();
              onOpen();
            }}
            aria-label={ctaAccessibleName(league)}
            aria-haspopup="dialog"
          >
            {ctaVisibleText(league)}
          </Button>
        )}
      </div>
    </div>
  );
}
