"use client";

import { Button, ButtonLink } from "@/components/ui";
import { ChapterBand } from "@/components/ui/chapter-band";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { openCreateLeagueSheet } from "./create-league-sheet";
import { LeagueRow, LeagueRowsHeader } from "./league-row";
import { OpenLeagueCard } from "./open-league-card";

/** How many rooms the signed-in home shows before "See every open league". Three is a glance;
 *  the lobby itself is one tap away and is where a manager who wants to compare goes. */
const ROOMS_SHOWN = 3;

/**
 * SOONEST DRAFT FIRST. A `when_full` room sorts ahead of every dated kickoff because it can start
 * the moment its last seat lands, which is a nearer fact than any clock — the same ordering
 * `nearestPreDraft` used on the board this section replaced, so the two never disagreed and now
 * there is only one of them. Ties keep the caller's order. A new array, never a mutation.
 */
export function bySoonestDraft(leagues: readonly PublicLeagueSummary[]): readonly PublicLeagueSummary[] {
  return [...leagues].sort((a, b) => {
    const aWhenFull = a.startTrigger === "when_full";
    const bWhenFull = b.startTrigger === "when_full";
    if (aWhenFull !== bWhenFull) return aWhenFull ? -1 : 1;
    const at = a.draftAtIso === undefined ? Number.POSITIVE_INFINITY : Date.parse(a.draftAtIso);
    const bt = b.draftAtIso === undefined ? Number.POSITIVE_INFINITY : Date.parse(b.draftAtIso);
    return at - bt;
  });
}

export interface OpenRoomsProps {
  readonly leagues: readonly PublicLeagueSummary[];
  /** League ids this manager already has a seat in — never offered a seat they are sitting in. */
  readonly alreadyIn?: readonly string[];
  /**
   * True when this section carries the PAGE's one solid verb (P3) — which happens on exactly one
   * page state, a manager with no leagues at all, where the lobby IS the page and the featured
   * room's "Take a seat" is the only thing worth doing. With leagues above it, every row here is
   * quiet: the page's solid verb belongs to the league that needs this manager first.
   */
  readonly featured?: boolean;
}

/**
 * THE LOBBY, ON THE SIGNED-IN HOME (Sideline, 2026-09-11) — the founder's core ruling ("the house
 * always has a game") on the page a manager already lives on. It replaces `OpenSeatsPanel`, which
 * said the same thing without an order, without a way out to the full lobby, and with the create
 * door stranded at the top of the page above the leagues rather than beside the rooms it makes
 * one of.
 *
 * The ROWS ARE THE FRONT DOOR'S OWN (`LeagueRow` on lg+, `OpenLeagueCard` below, the Task 13
 * split) — an anonymous seat stack, the seats left as a `BigNumber` with its basis, and a quiet
 * "Take a seat". A signed-in reader is still a stranger to these rooms, so nothing here names
 * anybody: `PublicLeagueSummary` discloses a count and never a member.
 */
export function OpenRooms({ leagues, alreadyIn = [], featured = false }: OpenRoomsProps) {
  // A ROOM THIS MANAGER IS ALREADY IN IS NOT AN OPEN ROOM (persona walk, 2026-09-11). A house
  // league with seats left is public and still filling, so the same room would otherwise appear
  // once as this manager's own card and again below it offering them a seat they are sitting in.
  const mine = new Set(alreadyIn);
  const open = leagues.filter((league) => !mine.has(league.id));
  if (open.length === 0) return null;
  const ordered = bySoonestDraft(open);
  const shown = ordered.slice(0, ROOMS_SHOWN);
  const more = ordered.length - shown.length;
  const emphasisFor = (index: number) => (featured && index === 0 ? ("ink" as const) : ("quiet" as const));

  return (
    <section aria-label="Open rooms" data-testid="open-rooms" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-xl font-bold leading-display text-text-primary">Open rooms</h2>
        {/* The create door, quiet, beside the rooms it makes one of (the founder's own placement
            in the mock) rather than standing above the manager's own leagues. */}
        <Button variant="secondary" size="sm" onClick={() => openCreateLeagueSheet()}>
          Create a league
        </Button>
      </div>
      <ChapterBand name="Next up" consequence="soonest draft first" />

      <div data-testid="league-rows" className="hidden lg:block">
        <LeagueRowsHeader />
        <ul className="flex flex-col">
          {shown.map((league, index) => (
            <li key={league.id}>
              <LeagueRow league={league} signedIn emphasis={emphasisFor(index)} leader={featured && index === 0} />
            </li>
          ))}
        </ul>
      </div>
      {/* Below lg the ledger card IS the form (Task 13) — a five-column row cannot fit 360px. */}
      <ul data-testid="league-cards" className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {shown.map((league, index) => (
          <li key={league.id} className="min-w-0">
            <OpenLeagueCard league={league} signedIn emphasis={emphasisFor(index)} />
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
        <p className="text-sm text-text-muted">
          {more > 0 ? `${more} more ${more === 1 ? "room is" : "rooms are"} open right now` : "The house always has a game."}
        </p>
        <ButtonLink href="/browse" variant="secondary" size="sm">
          See every open league
        </ButtonLink>
      </div>
    </section>
  );
}
