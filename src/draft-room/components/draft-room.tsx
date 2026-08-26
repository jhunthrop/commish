"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClientDraftAction } from "@/draft-engine";
import { Button, ButtonLink, ErrorState, Skeleton, useToast } from "@/components/ui";
import { LeagueChat } from "@/chat-room/components/league-chat";
import type { HelpLevel } from "@/identity/preferences";
import { useDraftRoom } from "../hooks/use-draft-room";
import { useDraftRoomDeps } from "../hooks/deps";
import { actionLabelFor, playersById as buildPlayersById } from "../lib/lookups";
import { MockResults } from "./mock-results";
import { PracticeBanner } from "./practice-banner";
import { RoomTour } from "./room-tour";
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

/** E4 (2026-08-26 design review): `xl`, one step up from the `lg:w-88`/`lg:w-12` band the
 *  chat's own width classes already key off — see `chatOpen`'s docblock below. */
export const CHAT_OPEN_QUERY = "(min-width: 1280px)";

export interface DraftRoomProps {
  readonly draftId: string;
  /**
   * The signed-in caller's preference row, read server-side by `DraftRoomPage`
   * (`readPreferences`) before this component ever mounts — no client-side fetch sits on the
   * room's critical path just to decide whether to show `RoomTour`.
   */
  readonly dismissedAt: string | null;
  /** Same read, forwarded to `RoomRail`'s `InfoTip`s via `SnakeRoom`/`AuctionRoom`/`RoomShell`. */
  readonly helpLevel?: HelpLevel;
}

/**
 * The client entry point. Owns the three page-level states (loading / error / ready) and the
 * one place a rejected action becomes a toast — components below never talk to the server.
 */
export function DraftRoom({ draftId, dismissedAt, helpLevel }: DraftRoomProps) {
  const room = useDraftRoom(draftId);
  const deps = useDraftRoomDeps();
  const { show } = useToast();
  const playersById = useMemo(() => buildPlayersById(room.players), [room.players]);
  /**
   * E4 (2026-08-26 design review): the review's own alternative fix for the laptop-width board
   * squeeze — "auto-collapse chat under a width threshold" — so the board gets its columns
   * back below `xl` without anybody having to find the "Hide chat" button first. Below `xl`
   * the chat starts collapsed; at `xl+` there is room for both, so it starts open. Read ONCE,
   * in a mount effect — NEVER during render: reading `matchMedia` in the render pass is the
   * exact hydration trap `usePrefersReducedMotion`'s own docblock documents (and the
   * `LeagueRow`/`useNow` incident already cost a founder-reported bug to learn). The state
   * starts `true` (the widest, SSR-safe answer) on server and hydrating client alike, and the
   * effect corrects a narrower viewport immediately after mount. Today `DraftRoom` paints only
   * its loading skeleton on first render, which would mask a render-time read — but that is a
   * coincidence of the loading gate, not an invariant, and the hydration regression test
   * (`draft-room.test.tsx`, hydrateSurface) exists so nobody gets to rediscover why.
   *
   * The user's own toggle (`setChatOpen` below) wins from the first paint on: the effect runs
   * once at mount, before any human can reach the toggle, so it never overwrites a choice.
   */
  const [chatOpen, setChatOpen] = useState<boolean>(true);
  useEffect(() => {
    setChatOpen(window.matchMedia(CHAT_OPEN_QUERY).matches);
  }, []);

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
  // Collapsible on the founder's ask: closed, the band shrinks to a slim reopen strip so the
  // board gets the width back; the closed chat unmounts (its SSE messages are server history,
  // nothing is lost) — reopening refetches, which is the hook's normal mount path.
  const chat = chatOpen ? (
    <div className="flex h-full min-h-0 flex-col lg:w-88">
      <div className="flex shrink-0 justify-end px-3 pt-2">
        <Button variant="ghost" size="sm" aria-expanded="true" onClick={() => setChatOpen(false)}>
          Hide chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 px-3 pb-3">
        <LeagueChat leagueId={room.view.leagueId} />
      </div>
    </div>
  ) : (
    <div className="flex justify-center p-2 lg:h-full lg:w-12 lg:items-start">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded="false"
        onClick={() => setChatOpen(true)}
        className="lg:mt-2 lg:[writing-mode:vertical-rl]"
      >
        Show chat
      </Button>
    </div>
  );

  // Task 8: a mock room's own honest chrome. `room.mock` is null for every real draft, so none
  // of this branch ever runs there — the real room's own DOM is untouched by this addition.
  return (
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
      {room.mock?.results ? (
        // Step 2: the board yields entirely to the results panel once a mock finishes — the
        // room's every next action lives here, never a dead end.
        <MockResults
          view={room.view}
          players={room.players}
          myTeamId={room.myTeamId}
          copy={room.mock.results}
          actions={{
            runAgain: (
              <ButtonLink href={`${MOCK_LOBBY_PATH}?create=solo`} variant="secondary">
                {room.mock.results.runAgainLabel}
              </ButtonLink>
            ),
            openLobby: (
              <ButtonLink href={MOCK_LOBBY_PATH} variant="secondary">
                {room.mock.results.openLobbyLabel}
              </ButtonLink>
            ),
            browseLeagues: (
              <ButtonLink href="/browse" variant="secondary">
                {room.mock.results.browseLeaguesLabel}
              </ButtonLink>
            ),
          }}
        />
      ) : (
        <>
          <RoomTour dismissedAt={dismissedAt} onDismiss={dismissTour} actionLabel={actionLabelFor(room.view.format)} />
          {room.view.format === "auction" ? (
            <AuctionRoom room={room} playersById={playersById} onAct={act} aside={chat} helpLevel={helpLevel} />
          ) : (
            <SnakeRoom room={room} playersById={playersById} onAct={act} aside={chat} helpLevel={helpLevel} />
          )}
        </>
      )}
    </>
  );
}
