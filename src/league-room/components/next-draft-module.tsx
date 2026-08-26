"use client";

import { SeatMeter } from "@/components/ui";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { OpenLeagueCta, ScheduledDraftValue, useOpenLeagueLive } from "./open-league-shared";

export interface NextDraftModuleProps {
  /** `page.tsx`'s own `featuredScheduledLeague(merged)` read — the SAME merged house-then-member
   *  list the shelf below renders, so this module and the shelf's featured row/card can never
   *  disagree about which league is next. */
  readonly league: PublicLeagueSummary;
  readonly signedIn: boolean;
}

/**
 * THE NEXT DRAFT (2026-08-25 founder finding, controller-ruled): the hero band's right half at
 * xl+ used to be a dead dark field once the headline went left-aligned — "does the hero
 * left-aligned help with visual hierarchy?" This module fills it with the shelf's own featured
 * league (`featuredScheduledLeague`, `./public-league-list`) rather than decoration: the league's
 * name, the SAME gated ticking clock the shelf's row and card render (`ScheduledDraftValue`,
 * extracted there rather than forked here — see its own docblock for the `size` it now threads),
 * the SAME seat bar and "{n} of {t} open" sentence (`LeagueRow`'s own Seats column shape), and
 * ONE join action.
 *
 * RULE-5 ACCOUNTING: this module's join action is QUIET (`emphasis="quiet"`) — the nav's "Take a
 * seat" already carries this page's one ink pill, and this module's own urgency is the red
 * countdown, never a second ink action. Because this module IS the featured league's rendering,
 * `page.tsx` also tells the shelf below to mark every row/card `emphasis="quiet"`
 * (`featuredInHero`) while this module is on screen — two inked renderings of the SAME league
 * would double the one-ink-per-view budget rule 5 sets.
 *
 * The league's name renders as a plain paragraph, deliberately NEVER a heading: the shelf below
 * renders its own `h3` for this exact league, on the SAME page, reading the identical accessible
 * name — a second heading of that name would be a strict-mode collision for any query keyed on
 * it. The simplest collision-proof shape is not being a heading at all.
 *
 * `page.tsx` decides WHETHER this renders at all (`featuredScheduledLeague` returning `null`
 * means nothing is scheduled and ticking, and the hero simply keeps its current shape — rule 6,
 * real or absent, never dressed up); this component itself decides only the xl+ visibility, since
 * below that width the shelf is one scroll away and a stacked duplicate of the same league would
 * be exactly the un-earned decoration rule 6 forbids.
 *
 * Register: `surfaceElevated` with a hairline border, `rounded-lg` — the scoreboard chip's own
 * register (`ProofStrip`'s `ScoreChip`), scaled up for a module rather than a heavy `Card`
 * (no `shadow-card`): the founder's ruling was explicit that this is a compact module, not
 * another box competing with the shelf's own cards.
 */
export function NextDraftModule({ league, signedIn }: NextDraftModuleProps) {
  const { remainingSeats, remainingMs, onDeck } = useOpenLeagueLive(league);

  return (
    <div
      data-testid="next-draft-module"
      className="hidden min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface-elevated px-5 py-5 xl:flex"
    >
      <p className="min-w-0 break-words font-display text-lg font-semibold leading-display text-text-primary">{league.name}</p>
      <ScheduledDraftValue league={league} onDeck={onDeck} remainingMs={remainingMs} size="lg" />
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium tabular-nums text-text-primary">
          {remainingSeats} of {league.teamCount} open
        </span>
        {/* F17 kept: the one product seat sentence still speaks (held seats included) — sr-only,
            because the tabular count above is this module's visible value, the identical idiom
            `LeagueRow`'s own Seats column already holds. */}
        <SeatMeter filled={league.filledTeams} total={league.teamCount} heldSeats={league.heldSeats} srOnlySentence />
      </div>
      <div>
        <OpenLeagueCta league={league} signedIn={signedIn} emphasis="quiet" />
      </div>
    </div>
  );
}
