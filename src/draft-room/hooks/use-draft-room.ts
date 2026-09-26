"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { ClientDraftAction, CompletedPick, DraftStateView } from "@/draft-engine";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import type { DraftPlayersBody, DraftQueueBody, DraftSnapshotBody, MockRoomInfo, WaitingInfo } from "@/draft-room/contract";
import { applyDraftFrame, parseDraftFrame, type NudgeNotice } from "@/draft-room/state/apply-event";
import { optimisticView } from "@/draft-room/state/optimistic";
import { parseFactsFrame, type DraftEventFrame } from "@/draft-room/state/payloads";
import { frameRevealAtMs, planReveal } from "@/draft-room/state/reveal";
import { useDraftRoomDeps } from "./deps";

/** All seven event types this room consumes. Chat and scoring ride the same stream and are ignored. */
const DRAFT_EVENT_TYPES = [
  "draft.pick", "draft.nominate", "draft.bid", "draft.timer_expire", "draft.status", "draft.queue", "draft.nudge",
] as const;

const NETWORK_ERROR = "We couldn't reach the draft. Check your connection and try again.";

export type ConnectionStatus = "connecting" | "live" | "reconnecting";
export type SubmitOutcome =
  /** `notice`: the league's own sentence when the action landed but the room was not told yet
   *  (the fail-fast publish, review finding 3); null when the room already knows. */
  | { readonly ok: true; readonly notice: string | null }
  | { readonly ok: false; readonly reason: string };

/** A queue edit's outcome: it is not a draft action, so it never carries the room's notice. */
export type QueueOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** The stream's cue that the room fell behind (a pick committed but its frame was lost). */
const RESYNC_EVENT_TYPE = "draft.resync";
/** The stream's word that the advisor's facts for a sequence are written (or failed). */
const FACTS_EVENT_TYPE = "draft.facts";

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
  /**
   * THE REVEALED VIEW (`state/reveal.ts`): what every surface renders. A bot pick committed in a
   * batch behind a human action is folded in here only at its own stamp; until then its player
   * is still on the board and its seat is on the clock.
   */
  readonly view: DraftStateView | null;
  /** THE COMMITTED VIEW: the log as the server holds it, every batched pick included, folded the
   *  moment its frame arrives. What the wire's sequence continuity and the advisor key on. */
  readonly committed: DraftStateView | null;
  /**
   * The newest committed sequence whose advisor facts the server has said are settled (written,
   * or their compute failed and a viewer should ask anyway): the `draft.facts` frame's sequence,
   * or a snapshot's own sequence on load (its facts were written with its last commit, or are
   * this viewer's to compute). The advisor asks `/assistant` only once this reaches the
   * committed sequence, so it never simulates alongside the writer (review M5).
   */
  readonly factsReadySequence: number | null;
  readonly players: readonly Player[];
  /**
   * Task 8: the pool's own law-backed reasons, keyed by `Player.id` — fetched and cached
   * alongside `players` (see `needsPlayers` below), never on a resync.
   *
   * Optional rather than required, matching `DraftPlayersBody.reasons`'s own docblock: the real
   * fetch path always populates it, but the room's own test fixtures hand-build this state and
   * are on the deferred UX ledger rather than reopened for this task. Every reader below treats
   * `undefined` exactly like an empty map.
   */
  readonly reasons?: ReadonlyMap<string, readonly BoardReason[]>;
  /** The law registry, cached alongside `players`/`reasons` for the same reason: it does not
   *  change during a draft. Optional for the same reason `reasons` is. */
  readonly laws?: readonly Law[];
  /** NFL team code → bye week (`DraftPlayersBody.byeWeeks`), cached alongside `players` for the
   *  same one-per-draft reason. Optional for the same fixture reason `reasons` is; `undefined`
   *  reads exactly like an empty map. */
  readonly byeWeeks?: ReadonlyMap<string, number>;
  readonly teams: readonly TeamCard[];
  /** The league's display name, straight off the snapshot. */
  readonly leagueName: string;
  readonly myTeamId: string | null;
  readonly isCommissioner: boolean;
  readonly connection: ConnectionStatus;
  readonly pendingPlayerId: string | null;
  readonly submitting: boolean;
  /** The last pick REVEALED, never one still waiting on its stamp. */
  readonly lastPick: LandedPick | null;
  /** The caller's own autopick queue. Never anybody else's. */
  readonly queue: readonly string[];
  readonly nudge: RoomNudge | null;
  /** Null for a real league. See `MockRoomInfo`'s own docblock (`../contract`) for why the mock
   *  lane's own words reach this room as data rather than a value import. */
  readonly mock: MockRoomInfo | null;
  /** R2: the scheduled room's waiting story, straight off the snapshot — null once live. */
  readonly waiting: WaitingInfo | null;
}

export interface DraftRoom extends RoomState {
  readonly submit: (action: ClientDraftAction) => Promise<SubmitOutcome>;
  readonly refresh: () => Promise<void>;
  readonly setQueue: (playerIds: readonly string[]) => Promise<QueueOutcome>;
}

const INITIAL: RoomState = {
  status: "loading",
  error: null,
  view: null,
  committed: null,
  factsReadySequence: null,
  players: [],
  reasons: new Map(),
  laws: [],
  byeWeeks: new Map(),
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
  waiting: null,
};

/** The publish stamp a stream frame's envelope carries, for the clock offset; null when absent. */
function publishedAtMs(data: string): number | null {
  try {
    const stamp = (JSON.parse(data) as { readonly timestamp?: unknown }).timestamp;
    return typeof stamp === "string" ? Date.parse(stamp) : null;
  } catch {
    return null;
  }
}

/**
 * The draft room's one data layer. Fetch the view, subscribe to the league stream, fold
 * events in by sequence, refetch on a gap or a reconnect, submit actions optimistically, and
 * REVEAL each committed pick at its own stamp (`state/reveal.ts`).
 *
 * Reconnect is the browser's: a native `EventSource` retries on its own and replays
 * `Last-Event-ID` automatically. There is deliberately no retry loop, backoff timer or poll
 * in here — only the full-state refetch the conventions name as the fallback.
 *
 * TWO CLOCKS, ONE OFFSET: a pick's stamp is the server's clock. Every answer the server gives
 * carries its own instant (a snapshot's and an action's `servedAt`, a stream frame's publish
 * stamp), and the smallest `Date.now() - serverInstant` seen this session is this browser's
 * offset from the server (the true skew plus the least network delay), measured whichever way
 * the two clocks differ (review H1: a browser AHEAD of the server measures a positive offset; a
 * floor of zero would have hidden it and revealed a batch as one burst). Unset until the first
 * answer, and unset reads as zero; the snapshot that opens the room is the first measurement,
 * so a tab reloaded mid-batch reveals on the seeded cadence before any frame arrives.
 */
export function useDraftRoom(draftId: string): DraftRoom {
  const deps = useDraftRoomDeps();
  const [state, setState] = useState<RoomState>(INITIAL);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  // Event handlers are long-lived closures; refs give them today's views without re-subscribing.
  // `viewRef` is the COMMITTED view (what the wire's sequence is checked against); `revealedRef`
  // the revealed one; `pendingRef` the frames committed but not yet revealed, in order.
  const viewRef = useRef<DraftStateView | null>(null);
  const revealedRef = useRef<DraftStateView | null>(null);
  const pendingRef = useRef<readonly DraftEventFrame[]>([]);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef = useRef<number | null>(null);
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

  /** A stamp on the server's clock, on this browser's. */
  const toLocalMs = useCallback((serverMs: number): number => serverMs + (offsetRef.current ?? 0), []);

  /** One more measurement of this browser's offset from the server: an instant the server
   *  stamped, seen now. The smallest wins (the least network delay on top of the true skew). */
  const noteServerInstant = useCallback((serverMs: number): void => {
    if (Number.isNaN(serverMs)) return;
    const measured = Date.now() - serverMs;
    offsetRef.current = offsetRef.current === null ? measured : Math.min(offsetRef.current, measured);
  }, []);

  /** The head of the reveal queue's instant on this clock, or null with nothing waiting. */
  const nextRevealAt = useCallback((): number | null => {
    const head = pendingRef.current[0];
    if (head === undefined) return null;
    const at = frameRevealAtMs(head);
    return at === null ? Date.now() : toLocalMs(at);
  }, [toLocalMs]);

  /**
   * Folds every pending frame whose instant has come into the revealed view, in order, and
   * publishes the result once. A non-pick frame behind a hidden pick reveals with it, never
   * before it (a `draft.status: complete` must not end the room before its last pick shows).
   */
  const drainReveals = useCallback((): void => {
    const now = Date.now();
    let revealed = revealedRef.current;
    let landed: CompletedPick | null = null;
    let nudge: NudgeNotice | null = null;
    let pending = pendingRef.current;
    while (revealed !== null && pending.length > 0) {
      const head = pending[0]!;
      const at = frameRevealAtMs(head);
      if (at !== null && toLocalMs(at) > now) break;
      pending = pending.slice(1);
      const result = applyDraftFrame(revealed, head);
      if (!result.ok) continue;
      if (result.view.picks.length > revealed.picks.length) landed = result.view.picks[result.view.picks.length - 1] ?? null;
      if (result.nudge !== null) nudge = result.nudge;
      revealed = result.view;
    }
    const changed = revealed !== revealedRef.current;
    pendingRef.current = pending;
    revealedRef.current = revealed;
    const view = revealed;
    const next = nextRevealAt();
    // One render per change of what is shown, never one per frame that only joined the queue
    // behind others (a batch is a dozen frames in one breath).
    if (changed) {
      setState((prev) => ({
        ...prev,
        view,
        lastPick: landed === null ? prev.lastPick : { pick: landed, isMine: landed.teamId === teamRef.current },
        // A nudge names exactly one team. Everybody on the league stream receives the frame;
        // only that team's manager is shown it.
        nudge: nudge !== null && nudge.teamId === teamRef.current ? { message: nudge.message, sequence: nudge.sequence } : prev.nudge,
      }));
    }
    if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = next === null ? null : setTimeout(drainReveals, Math.max(0, next - Date.now()));
  }, [nextRevealAt, toLocalMs]);

  /** Adopts a whole view from the server: the committed view as it is, the revealed view and
   *  the reveal queue derived from the picks' own stamps (`planReveal`). `servedAt` is the
   *  server's clock at the answer, the offset's measurement for this adoption. */
  const adoptView = useCallback(
    (view: DraftStateView, servedAt: string | undefined): void => {
      if (servedAt !== undefined) noteServerInstant(Date.parse(servedAt));
      viewRef.current = view;
      const plan = planReveal(view, Date.now() - (offsetRef.current ?? 0));
      revealedRef.current = plan.revealed;
      pendingRef.current = plan.pending;
      drainReveals();
    },
    [drainReveals, noteServerInstant],
  );

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
        let fetchedReasons: ReadonlyMap<string, readonly BoardReason[]> | null = null;
        let fetchedLaws: readonly Law[] | null = null;
        let fetchedByeWeeks: ReadonlyMap<string, number> | null = null;
        if (needsPlayers && playersResponse !== null) {
          const players = (await playersResponse.json()) as ApiEnvelope<DraftPlayersBody>;
          if (generation !== generationRef.current) return;
          if (!players.ok) {
            setState((prev) => ({ ...prev, status: "error", error: players.error }));
            return;
          }
          fetchedPlayers = players.data.players;
          // A `Map` does not survive `JSON.stringify` (`DraftPlayersBody.reasons`'s own
          // docblock) — this is the one place the wire's plain `Record` becomes the `Map` every
          // reader below (`DraftBoard`'s own `reasons` prop) expects. `?? {}`/`?? []` cover a
          // response with no `reasons`/`laws` at all (both optional on the wire type).
          fetchedReasons = new Map(Object.entries(players.data.reasons ?? {}));
          fetchedLaws = players.data.laws ?? [];
          fetchedByeWeeks = new Map(Object.entries(players.data.byeWeeks ?? {}));
          playersLoadedForRef.current = draftId;
        }

        teamRef.current = snapshot.data.teamId;
        queueRef.current = snapshot.data.queue;
        setLeagueId(snapshot.data.draft.leagueId);
        setState((prev) => ({
          ...prev,
          status: "ready",
          error: null,
          committed: snapshot.data.draft,
          players: fetchedPlayers ?? prev.players,
          reasons: fetchedReasons ?? prev.reasons,
          laws: fetchedLaws ?? prev.laws,
          byeWeeks: fetchedByeWeeks ?? prev.byeWeeks,
          teams: snapshot.data.teams,
          leagueName: snapshot.data.leagueName,
          myTeamId: snapshot.data.teamId,
          isCommissioner: snapshot.data.isCommissioner,
          pendingPlayerId: null,
          queue: snapshot.data.queue,
          mock: snapshot.data.mock,
          waiting: snapshot.data.waiting,
          // A snapshot's facts were written with its last commit, or are this viewer's own to
          // compute: the advisor asks at once.
          factsReadySequence: snapshot.data.draft.sequence,
        }));
        adoptView(snapshot.data.draft, snapshot.data.servedAt);
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
  }, [deps, draftId, adoptView]);

  // A `draftId` change is a hard reset, not a revalidation: bump the generation so a fetch
  // still in flight for the OLD draft can never write into the new one's state (the
  // in-flight promise itself is abandoned here too, so the new draft's own refresh below
  // isn't blocked waiting on it), and drop the old view/team/league immediately rather than
  // showing the previous draft while the new one loads.
  useEffect(() => {
    generationRef.current += 1;
    refreshPromiseRef.current = null;
    viewRef.current = null;
    revealedRef.current = null;
    pendingRef.current = [];
    if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
    teamRef.current = null;
    queueRef.current = [];
    playersLoadedForRef.current = null;
    setLeagueId(null);
    setState(INITIAL);
  }, [draftId]);

  useEffect(() => () => {
    if (revealTimerRef.current !== null) clearTimeout(revealTimerRef.current);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (leagueId === null) return;
    const source = deps.openEventSource(`/api/leagues/${leagueId}/events`);

    const onDraftEvent = (event: MessageEvent) => {
      const current = viewRef.current;
      if (current === null) return;
      const data = String(event.data);
      const published = publishedAtMs(data);
      if (published !== null) noteServerInstant(published);
      const frame = parseDraftFrame(data);
      if (frame === null) return;
      const result = applyDraftFrame(current, frame);
      if (!result.ok) {
        if (result.outcome === "resync") void refresh();
        return;
      }
      viewRef.current = result.view;
      // Committed now; revealed at its own stamp, behind whatever is already waiting.
      pendingRef.current = [...pendingRef.current, frame];
      setState((prev) => ({ ...prev, committed: result.view }));
      drainReveals();
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

    // The lost voice (review finding 3): the stream synthesizes this frame on its keepalive when a
    // pick committed but never reached it; the answer is the same refetch a gap gets.
    const onResync = (event: MessageEvent) => {
      let draftIdOfFrame: unknown = null;
      try {
        draftIdOfFrame = (JSON.parse(String(event.data)) as { readonly payload?: { readonly draftId?: unknown } }).payload?.draftId;
      } catch {
        return;
      }
      if (draftIdOfFrame === viewRef.current?.draftId) void refresh();
    };
    // The facts frame (review M5): the advisor's cue that the server's own simulator has finished
    // for this sequence, so its fetch reads the row rather than starting a second simulation.
    const onFacts = (event: MessageEvent) => {
      const frame = parseFactsFrame(String(event.data));
      if (frame === null || frame.payload.draftId !== viewRef.current?.draftId) return;
      setState((prev) => (prev.factsReadySequence !== null && prev.factsReadySequence >= frame.payload.sequence ? prev : { ...prev, factsReadySequence: frame.payload.sequence }));
    };
    for (const type of DRAFT_EVENT_TYPES) source.addEventListener(type, onDraftEvent);
    source.addEventListener(FACTS_EVENT_TYPE, onFacts);
    source.addEventListener(RESYNC_EVENT_TYPE, onResync);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);

    return () => source.close();
  }, [deps, leagueId, refresh, drainReveals, noteServerInstant]);

  const submit = useCallback(
    async (action: ClientDraftAction): Promise<SubmitOutcome> => {
      const before = viewRef.current;
      const shownBefore = revealedRef.current;
      if (before === null || shownBefore === null) return { ok: false, reason: "The draft isn't loaded yet." };

      // The instant feedback lands on both views: the player leaves the board at once.
      const patch = optimisticView(before, action, teamRef.current);
      const shown = optimisticView(shownBefore, action, teamRef.current);
      viewRef.current = patch.view;
      revealedRef.current = shown.view;
      setState((prev) => ({ ...prev, view: shown.view, committed: patch.view, pendingPlayerId: patch.pendingPlayerId, submitting: true }));

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
        revealedRef.current = shownBefore;
        setState((prev) => ({ ...prev, view: shownBefore, committed: before, pendingPlayerId: null, submitting: false }));
      };

      try {
        const response = await deps.fetchJson(`/api/drafts/${draftId}/actions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action),
          // A tapped DRAFT is an affirmative choice (pick-safety review, HIGH): the quilt's
          // undo window flushes a held pick on `pagehide`, and `keepalive` is what lets that
          // in-flight POST outlive the page. Every action body is a few dozen bytes, far under
          // the keepalive budget, so this costs nothing on the ordinary path.
          keepalive: true,
        });
        const body = (await response.json()) as ApiEnvelope<{ readonly draft: DraftStateView; readonly notice?: string | null; readonly servedAt?: string }>;
        if (!body.ok) {
          rollback();
          return { ok: false, reason: body.error };
        }
        // SSE may already have carried us past this response; never move the view backwards.
        // When the response IS ahead (the frames are still on their way), it carries the whole
        // commit — the pick and every bot batched behind it — and the reveals derive from it.
        const held = viewRef.current;
        if (held === null || held.sequence < body.data.draft.sequence) adoptView(body.data.draft, body.data.servedAt);
        else if (body.data.servedAt !== undefined) noteServerInstant(Date.parse(body.data.servedAt));
        setState((prev) => ({ ...prev, pendingPlayerId: null, submitting: false }));
        return { ok: true, notice: body.data.notice ?? null };
      } catch {
        rollback();
        return { ok: false, reason: NETWORK_ERROR };
      }
    },
    [deps, draftId, refresh, adoptView, noteServerInstant],
  );

  // A queue edit is not a draft action: it never touches `pendingPlayerId`, `submitting`,
  // `optimisticView` or the view at all — only `queue` moves, optimistically, then settles on
  // the server's own answer (or rolls back on rejection).
  const setQueue = useCallback(
    async (playerIds: readonly string[]): Promise<QueueOutcome> => {
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
