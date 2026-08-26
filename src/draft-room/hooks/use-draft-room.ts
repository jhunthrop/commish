"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { ClientDraftAction, CompletedPick, DraftStateView } from "@/draft-engine";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { DraftPlayersBody, DraftQueueBody, DraftSnapshotBody, MockRoomInfo } from "@/draft-room/contract";
import { applyDraftEvent } from "@/draft-room/state/apply-event";
import { optimisticView } from "@/draft-room/state/optimistic";
import { useDraftRoomDeps } from "./deps";

/** All seven event types this room consumes. Chat and scoring ride the same stream and are ignored. */
const DRAFT_EVENT_TYPES = [
  "draft.pick", "draft.nominate", "draft.bid", "draft.timer_expire", "draft.status", "draft.queue", "draft.nudge",
] as const;

const NETWORK_ERROR = "We couldn't reach the draft. Check your connection and try again.";

export type ConnectionStatus = "connecting" | "live" | "reconnecting";
export type SubmitOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface LandedPick {
  readonly pick: CompletedPick;
  readonly isMine: boolean;
}

export interface RoomNudge {
  readonly message: string;
  /** The turn it was about — the banner hides itself once the view's sequence passes it. */
  readonly sequence: number;
}

interface RoomState {
  readonly status: "loading" | "ready" | "error";
  readonly error: string | null;
  readonly view: DraftStateView | null;
  readonly players: readonly Player[];
  readonly teams: readonly TeamCard[];
  /** The league's display name, straight off the snapshot. */
  readonly leagueName: string;
  readonly myTeamId: string | null;
  readonly isCommissioner: boolean;
  readonly connection: ConnectionStatus;
  readonly pendingPlayerId: string | null;
  readonly submitting: boolean;
  readonly lastPick: LandedPick | null;
  /** The caller's own autopick queue. Never anybody else's. */
  readonly queue: readonly string[];
  readonly nudge: RoomNudge | null;
  /** Null for a real league. See `MockRoomInfo`'s own docblock (`../contract`) for why the mock
   *  lane's own words reach this room as data rather than a value import. */
  readonly mock: MockRoomInfo | null;
}

export interface DraftRoom extends RoomState {
  readonly submit: (action: ClientDraftAction) => Promise<SubmitOutcome>;
  readonly refresh: () => Promise<void>;
  readonly setQueue: (playerIds: readonly string[]) => Promise<SubmitOutcome>;
}

const INITIAL: RoomState = {
  status: "loading",
  error: null,
  view: null,
  players: [],
  teams: [],
  leagueName: "",
  myTeamId: null,
  isCommissioner: false,
  connection: "connecting",
  pendingPlayerId: null,
  submitting: false,
  lastPick: null,
  queue: [],
  nudge: null,
  mock: null,
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
  // Mirrors `state.queue` the same way `viewRef` mirrors `state.view` — long-lived closures
  // (the SSE handler, `setQueue`'s own rollback) need today's queue without re-subscribing.
  const queueRef = useRef<readonly string[]>([]);
  // Single-flight + staleness guards for `refresh()`. `refreshPromiseRef` lets N gapped
  // frames arriving back-to-back share ONE in-flight fetch pair instead of firing N; a
  // resync fires it fire-and-forget (`void refresh()`), so nothing else awaits the promise
  // this returns. `generationRef` is bumped only when `draftId` changes — it is what stops a
  // request issued for the OLD draft, however late it resolves, from ever writing into the
  // NEW draft's state (see the draftId-change effect below).
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const generationRef = useRef(0);
  // Monotonic id for each `refresh()` call, mirroring `generationRef`'s idiom: a call knows
  // its own id before it starts, so its `finally` can tell — without any indirection through
  // the promise it is itself in the middle of constructing — whether it is still the most
  // recent call and therefore still owns `refreshPromiseRef`.
  const refreshCallIdRef = useRef(0);
  // The player dictionary never changes during a draft, so it's fetched once per `draftId`,
  // not on every resync. Holds the `draftId` it was last fetched for; a mismatch (including
  // the initial `null`) means the next `refresh()` must fetch it again.
  const playersLoadedForRef = useRef<string | null>(null);

  const refresh = useCallback((): Promise<void> => {
    // Synchronous on purpose, with no `await` above this line: two `refresh()` calls made
    // back-to-back in the same tick (the common case — a burst of gapped SSE frames each
    // asking for a resync) are guaranteed to see the same `refreshPromiseRef.current`, so
    // only the first actually issues a fetch.
    const inFlight = refreshPromiseRef.current;
    if (inFlight !== null) return inFlight;

    const generation = generationRef.current;
    const callId = ++refreshCallIdRef.current;
    const needsPlayers = playersLoadedForRef.current !== draftId;
    const run = (async () => {
      try {
        const [snapshotResponse, playersResponse] = await Promise.all([
          deps.fetchJson(`/api/drafts/${draftId}`),
          needsPlayers ? deps.fetchJson(`/api/drafts/${draftId}/players`) : null,
        ]);
        const snapshot = (await snapshotResponse.json()) as ApiEnvelope<DraftSnapshotBody>;
        // A newer generation has already taken over (a draftId change while we were
        // fetching) — this response is stale and must never be applied, even though it's
        // the one resolving right now.
        if (generation !== generationRef.current) return;
        if (!snapshot.ok) {
          setState((prev) => ({ ...prev, status: "error", error: snapshot.error }));
          return;
        }

        let fetchedPlayers: readonly Player[] | null = null;
        if (needsPlayers && playersResponse !== null) {
          const players = (await playersResponse.json()) as ApiEnvelope<DraftPlayersBody>;
          if (generation !== generationRef.current) return;
          if (!players.ok) {
            setState((prev) => ({ ...prev, status: "error", error: players.error }));
            return;
          }
          fetchedPlayers = players.data.players;
          playersLoadedForRef.current = draftId;
        }

        viewRef.current = snapshot.data.draft;
        teamRef.current = snapshot.data.teamId;
        queueRef.current = snapshot.data.queue;
        setLeagueId(snapshot.data.draft.leagueId);
        setState((prev) => ({
          ...prev,
          status: "ready",
          error: null,
          view: snapshot.data.draft,
          players: fetchedPlayers ?? prev.players,
          teams: snapshot.data.teams,
          leagueName: snapshot.data.leagueName,
          myTeamId: snapshot.data.teamId,
          isCommissioner: snapshot.data.isCommissioner,
          pendingPlayerId: null,
          queue: snapshot.data.queue,
          mock: snapshot.data.mock,
        }));
      } catch {
        if (generation === generationRef.current) {
          setState((prev) => ({ ...prev, status: "error", error: NETWORK_ERROR }));
        }
      } finally {
        // Only release the slot if it's still ours — a stale run settling late must not
        // erase a newer refresh's in-flight tracking and cause a spurious duplicate fetch.
        if (refreshCallIdRef.current === callId) refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = run;
    return run;
  }, [deps, draftId]);

  // A `draftId` change is a hard reset, not a revalidation: bump the generation so a fetch
  // still in flight for the OLD draft can never write into the new one's state (the
  // in-flight promise itself is abandoned here too, so the new draft's own refresh below
  // isn't blocked waiting on it), and drop the old view/team/league immediately rather than
  // showing the previous draft while the new one loads.
  useEffect(() => {
    generationRef.current += 1;
    refreshPromiseRef.current = null;
    viewRef.current = null;
    teamRef.current = null;
    queueRef.current = [];
    playersLoadedForRef.current = null;
    setLeagueId(null);
    setState(INITIAL);
  }, [draftId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (leagueId === null) return;
    const source = deps.openEventSource(`/api/leagues/${leagueId}/events`);

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
        // A nudge names exactly one team. Everybody on the league stream receives the frame;
        // only that team's manager is shown it.
        nudge:
          result.nudge !== null && result.nudge.teamId === teamRef.current
            ? { message: result.nudge.message, sequence: result.nudge.sequence }
            : prev.nudge,
      }));
    };

    const onOpen = () => {
      setState((prev) => ({ ...prev, connection: "live" }));
      // Every open resyncs — the first one included. The stream only carries events
      // published after it opens, and it opens after the mount snapshot has already
      // resolved; an event published in that gap would otherwise sit unseen until the next
      // one arrives. A reconnect's open covers the analogous gap beyond stream retention.
      // Players are cached per `draftId` (see `refresh()`), so this is one extra state
      // fetch, not a full re-fetch pair.
      void refresh();
    };

    const onError = () => {
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
        const current = viewRef.current;
        // SSE can carry the view past `before` while our POST is still in flight — an
        // auction bid war rejecting a stale bid with a 409 is the routine case. Restoring
        // `before` in that situation would rewind past events we've already confirmed
        // (another team's pick vanishes, along with the money/lot state it produced), so
        // once the view has moved on we ask the server for the truth instead of guessing
        // backwards. Only a submit that landed with NOTHING else having happened in the
        // meantime gets the cheap, synchronous plain restore.
        if (current !== null && current.sequence !== before.sequence) {
          setState((prev) => ({ ...prev, pendingPlayerId: null, submitting: false }));
          void refresh();
          return;
        }
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
    [deps, draftId, refresh],
  );

  // A queue edit is not a draft action: it never touches `pendingPlayerId`, `submitting`,
  // `optimisticView` or the view at all — only `queue` moves, optimistically, then settles on
  // the server's own answer (or rolls back on rejection).
  const setQueue = useCallback(
    async (playerIds: readonly string[]): Promise<SubmitOutcome> => {
      const before = queueRef.current;
      queueRef.current = playerIds;
      setState((prev) => ({ ...prev, queue: playerIds }));
      const restore = (): void => {
        queueRef.current = before;
        setState((prev) => ({ ...prev, queue: before }));
      };
      try {
        const response = await deps.fetchJson(`/api/drafts/${draftId}/queue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerIds }),
        });
        const body = (await response.json()) as ApiEnvelope<DraftQueueBody>;
        if (!body.ok) {
          restore();
          return { ok: false, reason: body.error };
        }
        queueRef.current = body.data.queue;
        setState((prev) => ({ ...prev, queue: body.data.queue }));
        return { ok: true };
      } catch {
        restore();
        return { ok: false, reason: NETWORK_ERROR };
      }
    },
    [deps, draftId],
  );

  return { ...state, submit, refresh, setQueue };
}
