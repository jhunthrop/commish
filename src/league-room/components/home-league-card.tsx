"use client";

import Link from "next/link";
import { useState } from "react";
import { BigNumber, ButtonLink, Card, Crest, LiveChip, ManagerStack, SeatMeter } from "@/components/ui";
import { Avatar } from "@/components/ui/avatar";
import { RoomTour } from "@/draft-room/components/room-tour";
import { actionLabelFor } from "@/draft-room/lib/lookups";
import type { HomeLeagueCard as HomeLeagueCardData } from "../contract";
import { figureFor, momentLine, needFor, stackCaption, verbFor } from "../lib/home-card";
import { LEAGUE_VERB, MOCK_DRAFT_HREF } from "../lib/verbs";
import { FormatLine } from "./open-league-shared";

/**
 * ONE LEAGUE, AS A CARD (Sideline, 2026-09-11, built to the approved mock at
 * `docs/design/mocks/2026-09-11/signed-in-home/`). This replaced the rail-at-full-page row list,
 * which answered "which of my leagues needs me" correctly and said nothing at all about the
 * people in them.
 *
 * Principle by principle:
 * - P1, the people first: the crest and the name, then the manager stack with a sentence naming
 *   who is in. A member may see members (the reader is in this league); a stranger on the public
 *   shelf may not, which is why the lobby rows below this list draw an anonymous seat stack
 *   instead (`SeatStack`'s own docblock, and `PublicLeagueSummary`'s privacy boundary).
 * - P2, one figure with its basis: `BigNumber` in the rail, and nothing else on the card is
 *   larger than body text. A league with no honest number holds the dash and says why.
 * - P3, one solid verb per viewport: `solid` is true for exactly one card on the page, decided by
 *   the list (`HomeCards`), never by a card about itself.
 * - P5, the room is a place: "since you were here" is the newest thing the reader may see, the
 *   actor's face first, linking into that league's own stream.
 * - P7: every sentence is the league talking, never the system. No tips and no explainers.
 */
export interface HomeLeagueCardProps {
  readonly league: HomeLeagueCardData;
  /** True on the ONE card that carries the page's solid verb and the amber wash. */
  readonly solid: boolean;
}

export function HomeLeagueCard({ league, solid }: HomeLeagueCardProps) {
  const [tourOpen, setTourOpen] = useState(false);
  const need = needFor(league);
  const verb = verbFor(league);
  const figure = figureFor(league);
  const preDraft = league.draftStatus === "scheduled";
  const seatsOpen = league.filledTeams < league.teamCount;

  return (
    <Card
      as="article"
      aria-label={league.name}
      data-testid="home-league-card"
      data-solid={solid ? "" : undefined}
      // The amber wash is "this one is yours to deal with", never "press this" — Court blue is
      // the verb (P3), and spending it on the card's own furniture would put the page's loudest
      // pigment behind a surface that is not a control.
      className={`grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_13rem] sm:gap-x-8 ${solid ? "bg-self-glow" : ""}`.trimEnd()}
    >
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-4">
          <Crest id={league.id} name={league.name} size={56} />
          <div className="min-w-0">
            <h2 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/app/leagues/${league.id}`} className="min-w-0 break-words font-display text-2xl font-bold leading-display text-text-primary">
                {league.name}
              </Link>
              {preDraft && seatsOpen ? <LiveChip>Filling</LiveChip> : null}
            </h2>
            <FormatLine league={league} />
          </div>
        </div>

        <ManagerStack people={league.members} caption={stackCaption(league)} className="mt-4" />

        <p className="mt-4 font-display text-lg font-semibold leading-display text-text-primary">{momentLine(league)}</p>

        {league.since === null ? null : (
          <p className="mt-2 flex min-w-0 items-center gap-2.5 text-sm text-text-muted">
            {league.since.actor === null ? null : (
              <Avatar name={league.since.actor.name} avatar={league.since.actor.avatar} size="sm" aria-hidden="true" />
            )}
            <Link href={`/app/leagues/${league.id}/activity`} className="min-w-0">
              <span className="font-medium text-text-primary">{league.since.headline}</span>
              {league.since.detail === null ? null : ` ${league.since.detail}`}
            </Link>
          </p>
        )}

        {preDraft ? <SeatMeter filled={league.filledTeams} total={league.teamCount} srOnlySentence className="mt-4 max-w-sm" /> : null}

        {preDraft ? (
          <p className="mt-4 flex flex-wrap items-center gap-5">
            {/* Whichever of the two pre-draft doors the verb did not take stays as a quiet link,
                on the card of the league it belongs to, never as a standing panel. */}
            {verb.href === MOCK_DRAFT_HREF ? null : (
              <Link href={MOCK_DRAFT_HREF} className="text-sm font-semibold text-accent">
                {LEAGUE_VERB.mockDraft}
              </Link>
            )}
            <button type="button" onClick={() => setTourOpen(true)} className="text-sm font-semibold text-accent">
              {LEAGUE_VERB.previewRoom}
            </button>
          </p>
        ) : null}
      </div>

      <div className="flex flex-col items-stretch gap-5 sm:items-end">
        <BigNumber value={figure.value} basis={figure.basis} size="lg" align="start" className="sm:items-end sm:text-right" />
        <ButtonLink
          href={verb.href}
          variant={solid ? "verb" : "secondary"}
          aria-label={`${verb.label} for ${league.name}`}
          className="justify-center sm:self-end"
        >
          {verb.label}
        </ButtonLink>
      </div>

      {tourOpen ? <RoomTour dismissedAt={null} onDismiss={() => setTourOpen(false)} actionLabel={actionLabelFor(league.format)} /> : null}
      {/* The need is what ordered this card on the page; stated in the DOM so the spec that
          guards the order reads the same word the sort did. */}
      <span hidden data-need={need} />
    </Card>
  );
}
