"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import { PageTitle } from "@/components/ui";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import type { HomeBody } from "../contract";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { useLeagueRoomDeps } from "../hooks/deps";
import { isHomeBody } from "../lib/home-body";
import { isOwed, needFor, orderByNeed } from "../lib/home-card";
import { CreateLeagueDoor } from "./create-league-door";
import { HomeLeagueCard } from "./home-league-card";
import { OpenRooms, roomsOpenTo } from "./open-rooms";

/**
 * THE SIGNED-IN HOME (Sideline, 2026-09-11), built to the founder-approved mock at
 * `docs/design/mocks/2026-09-11/signed-in-home/`. One card per league, ordered by what needs this
 * manager first, then the lobby.
 *
 * What it replaced, and why. The page was three components deep in answers to one question: a
 * rail-at-full-page row list (`LeagueRows`) that ordered leagues by urgency and said nothing about
 * the people in them, a pre-draft hero that re-stated one of those rows as a bordered box with
 * four standing grey panels under it (team name, rank slots, notices, see how the room works),
 * and an open-seats panel with no order and no way through to the lobby. The four panels are gone
 * here; the two of them that were real doors ("Run a mock draft", "Preview the room") survive as
 * quiet links on the card of the league they belong to, and "Team name" became an actual control
 * on that league's own My team page (`TeamNameField`) rather than a sentence about a name with
 * nothing to press. `WaitingChecklist` and `checklistItems` themselves still stand: the league
 * room's own waiting stage (`waiting-room.tsx`) renders them, which is the surface they were
 * written for.
 *
 * P3 IS DECIDED HERE, once for the whole page: the first card whose need is an open one-time task
 * takes the solid verb and the amber wash. If nothing is owed, the solid verb goes nowhere at all
 * rather than being handed to whatever happens to sort first — a page with nothing to do should
 * not shout. With no leagues at all the lobby IS the page, and its featured room carries the one
 * solid verb instead.
 *
 * The refresh loop is unchanged from the board this replaced, including its two conditions: the
 * document must be VISIBLE (a backgrounded tab polling all Sunday is somebody's battery for
 * nothing they can see) and at least one league's week must actually be `in_progress` (on a
 * Tuesday nothing here can change, so nothing here should ask). Both are re-checked on every tick
 * against the latest held state, so a week that goes final between ticks stops polling on the
 * next one and a tab returning to view resumes on its own. This is deliberately not a second
 * real-time transport: Redis Streams over SSE stays the one mechanism, per-league, and every card
 * links into the league page where that stream lives.
 */
export function HomeBoard({
  initial,
  openLeagues = [],
}: {
  readonly initial: HomeBody;
  /** The house shelf's own leagues (`listPublicLeagues`), server-read once by `AppHome` — this
   *  board never fetches them itself. Defaults to `[]` (renders no lobby at all) so a caller that
   *  has none to give keeps working. */
  readonly openLeagues?: readonly PublicLeagueSummary[];
}) {
  const [body, setBody] = useState<HomeBody>(initial);
  const deps = useLeagueRoomDeps();
  const bodyRef = useRef(body);
  bodyRef.current = body;

  useEffect(() => {
    let cancelled = false;

    async function tick(): Promise<void> {
      if (document.visibilityState !== "visible") return;
      if (!bodyRef.current.leagues.some((league) => league.weekStatus === "in_progress")) return;
      try {
        const response = await deps.fetchJson("/api/home");
        const envelope = (await response.json()) as ApiEnvelope<unknown>;
        if (cancelled || !envelope.ok || !isHomeBody(envelope.data)) return;
        setBody(envelope.data);
      } catch {
        // A failed background refresh leaves the last-known state on screen — the page already
        // rendered real data from the server, and this loop exists to keep it moving, not to be
        // the thing that can break the page.
      }
    }

    const interval = setInterval(() => void tick(), LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [deps]);

  const ordered = orderByNeed(body.leagues);
  // ONE CREATE DOOR PER PAGE (founder ruling, fix round 3). The lobby's heading owns it whenever
  // the lobby renders, because that is where the mock puts it and where a commissioner scanning
  // rooms already is. When there is no lobby — an empty house shelf, or every open room already
  // joined — the page's own heading takes it, so the door and its `#create-league` anchor are
  // never both absent and never both present. Decided HERE because this is the one place that
  // knows the manager's leagues and the open rooms at the same time.
  const openRooms = roomsOpenTo(openLeagues, ordered.map((league) => league.id));
  // The ONE card that may be solid: the first one that is genuinely owed something. `-1` when
  // nothing is owed, and then no card is solid at all.
  const solidIndex = ordered.findIndex((league) => isOwed(needFor(league)));

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageTitle>Your leagues</PageTitle>
        {openRooms.length === 0 ? <CreateLeagueDoor /> : null}
      </div>
      {ordered.length === 0 ? null : (
        <ul aria-label="Your leagues" data-testid="home-league-cards" className="flex flex-col gap-4">
          {ordered.map((league, index) => (
            <li key={league.id} className="min-w-0">
              <HomeLeagueCard league={league} solid={index === solidIndex} />
            </li>
          ))}
        </ul>
      )}
      <OpenRooms leagues={openRooms} featured={ordered.length === 0} />
    </div>
  );
}
