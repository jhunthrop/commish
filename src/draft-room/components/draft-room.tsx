"use client";

import { useMemo, useState } from "react";
import type { ClientDraftAction } from "@/draft-engine";
import { Button, ButtonLink, ErrorState, Skeleton, useToast } from "@/components/ui";
import { LeagueChat } from "@/chat-room/components/league-chat";
import { useDraftRoom } from "../hooks/use-draft-room";
import { useDraftRoomDeps } from "../hooks/deps";
import { actionLabelFor, playersById as buildPlayersById } from "../lib/lookups";
import { DraftBoard } from "./draft-board";
import { MockResults } from "./mock-results";
import { PickWire } from "./pick-wire";
import { PracticeBanner } from "./practice-banner";
import { RoomTour } from "./room-tour";
import { RoomRail } from "./room-rail";
import { RosterRail } from "./roster-rail";
import { ShareLinkPanel } from "./share-link-panel";
import { SnakeRoom } from "./snake-room";
import { AuctionRoom } from "./auction-room";

/**
 * Task 9's own contract with this one (recorded here since it created no page of its own yet):
 * the practice lobby lives at `/app/mock-drafts`, and `?create=solo` is this room's own request
 * to open straight into creating another one rather than browsing first — "Run it again" below
 * hands the lobby that query param; "Open the lobby" hands it none.
 */
const MOCK_LOBBY_PATH = "/app/mock-drafts";

export interface DraftRoomProps {
  readonly draftId: string;
  /**
   * The signed-in caller's preference row, read server-side by `DraftRoomPage`
   * (`readPreferences`) before this component ever mounts — no client-side fetch sits on the
   * room's critical path just to decide whether to show `RoomTour`.
   */
  readonly dismissedAt: string | null;
}

/**
 * The client entry point. Owns the three page-level states (loading / error / ready) and the
 * one place a rejected action becomes a toast — components below never talk to the server.
 */
export function DraftRoom({ draftId, dismissedAt }: DraftRoomProps) {
  const room = useDraftRoom(draftId);
  const deps = useDraftRoomDeps();
  const { show } = useToast();
  const playersById = useMemo(() => buildPlayersById(room.players), [room.players]);
  /**
   * FOUNDER DIRECTIVE 2026-08-26 (room-product pass): "the chat feature should be much
   * smaller. People aren't usually actively chatting during the draft much. The right hand
   * side should be your roster and what positions you have filled." This supersedes E4's own
   * xl-open default (2026-08-26 design review) outright — chat starts collapsed at EVERY
   * width now, never just below `xl`, and there is no `matchMedia` read to make that decision:
   * a plain `useState(false)` is both the SSR-safe answer and the permanent one. The aside's
   * default content is `RosterRail` below; the user's own toggle (`setChatOpen`) is what ever
   * brings chat forward, and it wins from the first paint on since nothing else writes this
   * state after mount.
   */
  const [chatOpen, setChatOpen] = useState<boolean>(false);

  const act = (action: ClientDraftAction): void => {
    void room.submit(action).then((outcome) => {
      if (!outcome.ok) show({ message: outcome.reason, tone: "error" });
    });
  };

  /**
   * Fire-and-forget, by design: `RoomTour` closes on click no matter what this promise does,
   * and swallows even a synchronous throw from it. A failed preference write must never be the
   * thing standing between a manager and a live draft — see `RoomTour`'s own docblock.
   */
  const dismissTour = (): void => {
    void deps
      .fetchJson("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dismissDraftTour: true }),
      })
      .catch(() => {});
  };

  // Loading and error are the only two states that are a PAGE rather than a room, so they are
  // the only two that carry their own padding — the room itself is full-bleed by construction.
  if (room.status === "loading") {
    return (
      <div className="p-4">
        <Skeleton lines={6} />
      </div>
    );
  }
  if (room.status === "error" || room.view === null) {
    return (
      <div className="p-4">
        <ErrorState
          title="We couldn't open this draft"
          description={room.error ?? "Something went wrong on our side."}
          action={<Button onClick={() => void room.refresh()}>Try again</Button>}
        />
      </div>
    );
  }

  // Built here, not inside RoomShell: DraftRoom is the one component that knows the league id
  // and the only one whose test renders a fully-loaded room, so the chat's dependencies enter
  // the tree in exactly one place — the same reason `bidConsole` and `poolFooter` are props.
  //
  // FOUNDER DIRECTIVE 2026-08-26 (room-product pass): the aside is no longer chat-first. Its
  // width contract never moves (`lg:w-88`, same as `RoomLayout`'s own pool rail) — only its
  // CONTENT swaps, one panel at a time: `RosterRail` by default, chat on demand via the strip
  // below. A commissioner has no roster of their own to show (the "nothing to say" law), so
  // for them chat IS the panel — no strip, nothing to toggle back to.
  const aside =
    room.myTeamId === null ? (
      <div className="flex h-full min-h-0 flex-col lg:w-72">
        <div className="min-h-0 flex-1 px-3 pb-3 pt-2">
          <LeagueChat leagueId={room.view.leagueId} />
        </div>
      </div>
    ) : (
      <div className="flex h-full min-h-0 flex-col lg:w-72">
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
          {chatOpen ? (
            <LeagueChat leagueId={room.view.leagueId} />
          ) : (
            <RosterRail view={room.view} myTeamId={room.myTeamId} playersById={playersById} slotConfig={room.view.slotConfig} />
          )}
        </div>
        {/* The one toggle, hairline-topped: it never invents an unread count, and its label
            says what clicking it does, not where it goes ("League chat" opens chat; "Back to
            your roster" returns) — founder directive 2026-08-26, room-product pass. */}
        <div className="shrink-0 border-t border-line px-3 py-2">
          <Button variant="ghost" size="sm" aria-expanded={chatOpen} onClick={() => setChatOpen((open) => !open)}>
            {chatOpen ? "Back to your roster" : "League chat"}
          </Button>
        </div>
      </div>
    );

  // Task 8: a mock room's own honest chrome. `room.mock` is null for every real draft, so none
  // of this branch ever runs there — the real room's own DOM is untouched by this addition.
  // The mock room's honest chrome, composed ONCE and placed per branch: results pages scroll
  // normally, so it rides plain flow there; the LIVE room owns the viewport, so it rides
  // INSIDE the frame below — a band above an h-dvh frame is exactly the scroll bug the
  // founder's screenshot caught (2026-08-26).
  const mockChrome = (
    <>
      {room.mock ? <PracticeBanner message={room.mock.practiceBanner} /> : null}
      {room.mock?.share ? (
        <ShareLinkPanel
          path={room.mock.share.path}
          shareCode={room.mock.share.shareCode}
          seatsFilled={room.mock.share.seatsFilled}
          seatsTotal={room.mock.share.teamCount}
          startsAt={room.mock.share.startsAt}
        />
      ) : null}
    </>
  );

  return (
    <>
      {room.mock?.results ? (
        <>
          {mockChrome}
          {/* The debrief (results review, 2026-08-26): the room's own chrome answers D4 — the
              rail's complete-phase state says "Draft complete", the wire closes the story with
              the room's last picks (R4) — and the panel below composes the team sheet, the
              honest pick log, the ONE ink way out (E4: the rematch is the act this page exists
              to produce), and the finished board itself (R3). */}
          <RoomRail
            leagueName={room.leagueName}
            view={room.view}
            teams={room.teams}
            myTeamId={room.myTeamId}
            playersById={playersById}
            connection={room.connection}
            waiting={null}
          />
          <PickWire view={room.view} teams={room.teams} playersById={playersById} players={room.players} />
          <MockResults
            view={room.view}
            teams={room.teams}
            players={room.players}
            byeWeeks={room.byeWeeks ?? new Map()}
            myTeamId={room.myTeamId}
            results={room.mock.results}
            board={
              <DraftBoard
                view={room.view}
                teams={room.teams}
                playersById={playersById}
                myTeamId={room.myTeamId}
                landedPickNumber={null}
                mock={{ botMarkerLabel: room.mock.botMarkerLabel, botBadge: room.mock.botBadge }}
                reasons={room.reasons}
                laws={room.laws}
              />
            }
          />
        </>
      ) : (
        // THE ROOM VIEWPORT — owned exactly once (founder screenshot, 2026-08-26): every band
        // the live room wears (the practice banner, the share panel) lives INSIDE this frame,
        // and `RoomLayout` flexes into what remains. A sibling above an h-dvh frame scrolls
        // the page by its own height; a child inside it never can.
        <div data-testid="room-viewport" className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
          {mockChrome}
          <RoomTour dismissedAt={dismissedAt} onDismiss={dismissTour} actionLabel={actionLabelFor(room.view.format)} />
          {room.view.format === "auction" ? (
            <AuctionRoom room={room} playersById={playersById} onAct={act} aside={aside} />
          ) : (
            <SnakeRoom room={room} playersById={playersById} onAct={act} aside={aside} />
          )}
        </div>
      )}
    </>
  );
}
