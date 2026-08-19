"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScoreUpdatePayload, TeamScore, WeekStatus } from "@/stats-pipeline/contract";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { MatchupWeekBody } from "../contract";
import { useLeagueRoomDeps } from "./deps";

/** The one frame type this hook owns. Draft and chat frames ride the same stream and are ignored. */
const SCORE_EVENT_TYPES = ["score.update"] as const;

export type LiveScoresConnection = "connecting" | "live" | "reconnecting";

/** What the caller already knows server-side — the seed this hook starts from and folds onto. */
export interface LiveScoresInitial {
  readonly week: number;
  readonly status: WeekStatus;
  readonly scores: readonly TeamScore[];
}

export interface LiveScores {
  readonly scores: ReadonlyMap<string, number>;
  readonly status: WeekStatus;
  readonly connection: LiveScoresConnection;
}

function toScoresMap(scores: readonly TeamScore[]): ReadonlyMap<string, number> {
  return new Map(scores.map((score) => [score.teamId, score.points]));
}

/** Every score for the week, home and away, from the ONE endpoint that has them:
 *  `GET /api/leagues/[leagueId]/matchups/[week]`. A side with no score yet (`null` — the
 *  matchup hasn't started) is left OUT rather than coalesced to `0`: a team that has not
 *  played is not the same fact as a team that played and scored zero, and the caller (a
 *  scoreboard) renders those two states differently. Leaving a team out of this snapshot means
 *  `useLiveScores`'s consumer sees it missing from the map and falls back to its own
 *  server-rendered `null`, exactly as if no live data had arrived for it at all. */
function scoresFromWeek(body: MatchupWeekBody): readonly TeamScore[] {
  return body.matchups.flatMap((matchup) => [
    ...(matchup.home.score === null ? [] : [{ teamId: matchup.home.teamId, points: matchup.home.score }]),
    ...(matchup.away.score === null ? [] : [{ teamId: matchup.away.teamId, points: matchup.away.score }]),
  ]);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function toTeamScores(value: unknown): readonly TeamScore[] | null {
  if (!Array.isArray(value)) return null;
  const scores: TeamScore[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const teamId = record?.teamId;
    const points = record?.points;
    if (typeof teamId !== "string" || typeof points !== "number") return null;
    scores.push({ teamId, points });
  }
  return scores;
}

function toWeekStatus(value: unknown): WeekStatus | null {
  return value === "scheduled" || value === "in_progress" || value === "final" ? value : null;
}

/**
 * The one place a raw `score.update` SSE frame becomes a payload. Parsed defensively, same
 * rationale as `parseChatFrame` (`@/chat/parse`): a throw inside an `EventSource` listener would
 * take the whole panel down, and a frame is untrusted text by the time it reaches the browser.
 */
function parseScoreFrame(raw: string): ScoreUpdatePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const frame = asRecord(parsed);
  if (frame?.type !== "score.update") return null;
  const payload = asRecord(frame.payload);
  if (payload === null) return null;

  const status = toWeekStatus(payload.status);
  const scores = toTeamScores(payload.scores);
  if (
    typeof payload.week !== "number" ||
    status === null ||
    typeof payload.version !== "number" ||
    typeof payload.gamesFinal !== "number" ||
    typeof payload.gamesTotal !== "number" ||
    scores === null
  ) {
    return null;
  }
  return { week: payload.week, status, version: payload.version, gamesFinal: payload.gamesFinal, gamesTotal: payload.gamesTotal, scores };
}

interface LiveScoresState {
  readonly scores: ReadonlyMap<string, number>;
  readonly status: WeekStatus;
  readonly connection: LiveScoresConnection;
}

/**
 * The live matchup surface's one data layer: seed from the server-rendered snapshot, subscribe
 * to the shared league stream, and fold `score.update` frames in as they arrive.
 *
 * Follows `useLeagueChat`'s shape exactly: one shared `EventSource` per league url via
 * `openEventSource` (the real implementation is `subscribeLeagueStream`), a refetch on `open` to
 * cover the mount gap (the page rendered with `initial` before this hook's own listeners were
 * attached), and the generation guard Plan A added so a slow refetch response can never clobber
 * a fresher one that resolved first. Reconnect is the browser's own, exactly as
 * `useDraftRoom`/`useLeagueChat` document — there is no retry loop or poll here.
 *
 * The one behavior that is NEW here, not copied from chat: a `score.update` frame whose
 * `version` is not newer than the one already held is dropped whole, never folded. Frames can
 * arrive out of order across a reconnect, and applying an older one over a newer one would make
 * a score go backwards on screen — in a money product, that reads as a bug at the worst possible
 * moment. A refetch's RESPONSE carries no version to compare against a frame's, but the same
 * failure mode reaches it from the other direction: a refetch that was IN FLIGHT while a fresher
 * frame folded in would otherwise apply its now-stale snapshot on top of that fresher value when
 * it resolves. `refresh` guards against exactly that by snapshotting `versionRef` before the
 * request goes out and refusing to apply if a frame changed it while the request was in flight —
 * on top of the existing chat-idiom generation guard for two concurrent refreshes racing each
 * other. When neither race fires, a refetch is the current truth as of right now and replaces
 * the held state wholesale, the same as chat's `refresh`.
 *
 * A `score.update` frame can carry only the teams its tick actually affected (`worker.ts`'s
 * `publishAffected`) — everyone else's last-known score would be wrong to discard. Applying a
 * frame therefore MERGES its teams into the held map rather than replacing it; only a refetch,
 * which is a full snapshot of the week, replaces it wholesale.
 */
export function useLiveScores(leagueId: string, initial: LiveScoresInitial): LiveScores {
  const [state, setState] = useState<LiveScoresState>({
    scores: toScoresMap(initial.scores),
    status: initial.status,
    connection: "connecting",
  });
  const deps = useLeagueRoomDeps();
  const scoresRef = useRef<ReadonlyMap<string, number>>(toScoresMap(initial.scores));
  /** The newest `score.update` version folded so far. -1 means "no frame yet", so any real
   *  version (>= 0) is accepted the first time. */
  const versionRef = useRef(-1);
  /** Same race the chat hook's `refreshGeneration` guards against: the mount effect and the SSE
   *  `open` handler both fire a refetch, with no ordering between their responses. */
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    refreshGeneration.current += 1;
    const generation = refreshGeneration.current;
    // Captured BEFORE the request goes out: if a `score.update` frame folds in while this
    // refresh is in flight, that is strictly newer information than a GET issued before it
    // arrived, and applying this refresh's response afterward would make the score go
    // backwards on screen — the exact failure mode `versionRef`'s frame-vs-frame gate exists to
    // prevent, just arriving from the other channel this hook reads.
    const versionBeforeRequest = versionRef.current;
    try {
      const response = await deps.fetchJson(`/api/leagues/${leagueId}/matchups/${initial.week}`);
      const body = (await response.json()) as ApiEnvelope<MatchupWeekBody>;
      if (generation !== refreshGeneration.current) return; // a newer refresh already won
      if (versionRef.current !== versionBeforeRequest) return; // a live frame already won
      if (!body.ok) return;
      const scores = toScoresMap(scoresFromWeek(body.data));
      scoresRef.current = scores;
      setState((prev) => ({ ...prev, scores, status: body.data.weekStatus }));
    } catch {
      // A failed background refresh leaves the last-known state on screen rather than an error
      // state of its own — the page's own server render already has real data, and this hook
      // exists to keep it moving, not to be the thing that can break the page.
    }
  }, [deps, initial.week, leagueId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const source = deps.openEventSource(`/api/leagues/${leagueId}/events`);

    const onScoreEvent = (event: MessageEvent): void => {
      const payload = parseScoreFrame(String(event.data));
      if (payload === null) return;
      if (payload.version <= versionRef.current) return; // stale — a reorder across a reconnect
      versionRef.current = payload.version;
      const merged = new Map(scoresRef.current);
      for (const score of payload.scores) merged.set(score.teamId, score.points);
      scoresRef.current = merged;
      setState((prev) => ({ ...prev, scores: merged, status: payload.status }));
    };

    const onOpen = (): void => {
      setState((prev) => ({ ...prev, connection: "live" }));
      void refresh();
    };

    const onError = (): void => {
      setState((prev) => ({ ...prev, connection: "reconnecting" }));
    };

    for (const type of SCORE_EVENT_TYPES) source.addEventListener(type, onScoreEvent);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);

    return () => source.close();
  }, [deps, leagueId, refresh]);

  return state;
}
