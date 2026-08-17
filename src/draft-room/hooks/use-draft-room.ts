"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { ClientDraftAction, CompletedPick, DraftStateView } from "@/draft-engine";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { DraftPlayersBody, DraftSnapshotBody } from "@/draft-room/contract";
import { applyDraftEvent } from "@/draft-room/state/apply-event";
import { optimisticView } from "@/draft-room/state/optimistic";
import { useDraftRoomDeps } from "./deps";

/** The five event types this room consumes. Chat and scoring ride the same stream and are ignored. */
const DRAFT_EVENT_TYPES = ["draft.pick", "draft.nominate", "draft.bid", "draft.timer_expire", "draft.status"] as const;

const NETWORK_ERROR = "We couldn't reach the draft. Check your connection and try again.";

export type ConnectionStatus = "connecting" | "live" | "reconnecting";
export type SubmitOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface LandedPick {
  readonly pick: CompletedPick;
  readonly isMine: boolean;
}

interface RoomState {
  readonly status: "loading" | "ready" | "error";
  readonly error: string | null;
  readonly view: DraftStateView | null;
  readonly players: readonly Player[];
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly isCommissioner: boolean;
  readonly connection: ConnectionStatus;
  readonly pendingPlayerId: string | null;
  readonly submitting: boolean;
  readonly lastPick: LandedPick | null;
}

export interface DraftRoom extends RoomState {
  readonly submit: (action: ClientDraftAction) => Promise<SubmitOutcome>;
  readonly refresh: () => Promise<void>;
}

const INITIAL: RoomState = {
  status: "loading",
  error: null,
  view: null,
  players: [],
  teams: [],
  myTeamId: null,
  isCommissioner: false,
  connection: "connecting",
  pendingPlayerId: null,
  submitting: false,
  lastPick: null,
};

/**
 * The draft room's one data layer. Fetch the view, subscribe to the league stream, fold
 * events in by sequence, refetch on a gap or a reconnect, and submit actions optimistically.
 *
 * Reconnect is the browser's: a native `EventSource` retries on its own and replays
 * `Last-Event-ID` automatically. There is deliberately no retry loop, backoff timer or poll
 * in here — only the full-state refetch the conventions name as the fallback.
 */
export function useDraftRoom(draftId: string): DraftRoom {
  const deps = useDraftRoomDeps();
  const [state, setState] = useState<RoomState>(INITIAL);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  // Event handlers are long-lived closures; refs give them today's view without re-subscribing.
  const viewRef = useRef<DraftStateView | null>(null);
  const teamRef = useRef<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [snapshotResponse, playersResponse] = await Promise.all([
        deps.fetchJson(`/api/drafts/${draftId}`),
        deps.fetchJson(`/api/drafts/${draftId}/players`),
      ]);
      const snapshot = (await snapshotResponse.json()) as ApiEnvelope<DraftSnapshotBody>;
      if (!snapshot.ok) {
        setState((prev) => ({ ...prev, status: "error", error: snapshot.error }));
        return;
      }
      const players = (await playersResponse.json()) as ApiEnvelope<DraftPlayersBody>;
      if (!players.ok) {
        setState((prev) => ({ ...prev, status: "error", error: players.error }));
        return;
      }
      viewRef.current = snapshot.data.draft;
      teamRef.current = snapshot.data.teamId;
      setLeagueId(snapshot.data.draft.leagueId);
      setState((prev) => ({
        ...prev,
        status: "ready",
        error: null,
        view: snapshot.data.draft,
        players: players.data.players,
        teams: snapshot.data.teams,
        myTeamId: snapshot.data.teamId,
        isCommissioner: snapshot.data.isCommissioner,
        pendingPlayerId: null,
      }));
    } catch {
      setState((prev) => ({ ...prev, status: "error", error: NETWORK_ERROR }));
    }
  }, [deps, draftId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (leagueId === null) return;
    const source = deps.openEventSource(`/api/leagues/${leagueId}/events`);
    let dropped = false;

    const onDraftEvent = (event: MessageEvent) => {
      const current = viewRef.current;
      if (current === null) return;
      const result = applyDraftEvent(current, String(event.data));
      if (!result.ok) {
        if (result.outcome === "resync") void refresh();
        return;
      }
      const landed = result.view.picks.length > current.picks.length ? (result.view.picks[result.view.picks.length - 1] ?? null) : null;
      viewRef.current = result.view;
      setState((prev) => ({
        ...prev,
        view: result.view,
        lastPick: landed === null ? prev.lastPick : { pick: landed, isMine: landed.teamId === teamRef.current },
      }));
    };

    const onOpen = () => {
      setState((prev) => ({ ...prev, connection: "live" }));
      // Only a reconnect needs a refetch: the browser has already replayed whatever the
      // stream still held, and a gap beyond retention is exactly what this covers.
      if (dropped) {
        dropped = false;
        void refresh();
      }
    };

    const onError = () => {
      dropped = true;
      setState((prev) => ({ ...prev, connection: "reconnecting" }));
    };

    for (const type of DRAFT_EVENT_TYPES) source.addEventListener(type, onDraftEvent);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);

    return () => source.close();
  }, [deps, leagueId, refresh]);

  const submit = useCallback(
    async (action: ClientDraftAction): Promise<SubmitOutcome> => {
      const before = viewRef.current;
      if (before === null) return { ok: false, reason: "The draft isn't loaded yet." };

      const patch = optimisticView(before, action, teamRef.current);
      viewRef.current = patch.view;
      setState((prev) => ({ ...prev, view: patch.view, pendingPlayerId: patch.pendingPlayerId, submitting: true }));

      const rollback = (): void => {
        viewRef.current = before;
        setState((prev) => ({ ...prev, view: before, pendingPlayerId: null, submitting: false }));
      };

      try {
        const response = await deps.fetchJson(`/api/drafts/${draftId}/actions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action),
        });
        const body = (await response.json()) as ApiEnvelope<{ readonly draft: DraftStateView }>;
        if (!body.ok) {
          rollback();
          return { ok: false, reason: body.error };
        }
        // SSE may already have carried us past this response; never move the view backwards.
        const held = viewRef.current;
        const settled = held !== null && held.sequence > body.data.draft.sequence ? held : body.data.draft;
        viewRef.current = settled;
        setState((prev) => ({ ...prev, view: settled, pendingPlayerId: null, submitting: false }));
        return { ok: true };
      } catch {
        rollback();
        return { ok: false, reason: NETWORK_ERROR };
      }
    },
    [deps, draftId],
  );

  return { ...state, submit, refresh };
}
