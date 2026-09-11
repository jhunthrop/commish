"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { EventReactionBody } from "../contract";
import { applyEventReaction, parseStreamReactionFrame, type EventReactionMap } from "../lib/stream-reactions";
import { useLeagueRoomDeps } from "./deps";

/** The frame the server publishes when somebody reacts to a pick, a claim or a trade. */
const STREAM_REACTION_EVENT_TYPE = "stream.reaction";

export interface StreamReactions {
  readonly held: EventReactionMap;
  /** Toggles the viewer's own reaction. Optimistic, and put back if the write does not land. */
  readonly react: (eventId: string, emoji: string) => Promise<void>;
}

/**
 * REACTIONS ON THINGS THAT HAPPENED, KEPT LIVE (Sideline P5: "reactions attach to all of them").
 * Seeded with the reactions the server rendered the page with, folded from every
 * `stream.reaction` frame, and toggled optimistically so the pill answers the thumb rather than
 * the round trip.
 *
 * THE STREAM COSTS NOTHING EXTRA. `deps.openEventSource` is `subscribeLeagueStream`, which is
 * ref-counted per url — this hook joins the socket the room's chat already holds rather than
 * opening a second one against `REALTIME_CONFIG.maxStreamsPerUser`.
 *
 * OPTIMISTIC, WITH THE PUT-BACK WRITTEN DOWN. The local fold happens first, then the response
 * folds in the action the SERVER says it took, which is how a race resolves (two taps in flight,
 * the second arriving as the opposite transition) without the client inventing a verdict. A
 * request that fails or refuses folds the INVERSE of the optimistic transition rather than
 * restoring a snapshot — a leaguemate's frame that landed while the write was out must survive
 * this browser's own failed tap, and a snapshot restore would silently drop it.
 *
 * `meUserId` is the room's own viewer id (the chat page read's `meUserId`), empty until that read
 * lands. With no viewer id there is no honest optimistic draw, so the tap simply waits for the
 * server's answer — the pill is a fraction slower for the first instant of the page and never
 * wrong.
 */
export function useStreamReactions(leagueId: string, initial: EventReactionMap, meUserId: string): StreamReactions {
  const deps = useLeagueRoomDeps();
  const [held, setHeld] = useState<EventReactionMap>(initial);
  const heldRef = useRef<EventReactionMap>(initial);
  /** The newest request number per `${eventId}|${emoji}` — see `react`'s own note on M3. */
  const generations = useRef(new Map<string, number>());

  const write = useCallback((next: EventReactionMap): void => {
    heldRef.current = next;
    setHeld(next);
  }, []);

  useEffect(() => {
    const source = deps.openEventSource(`/api/leagues/${leagueId}/events`);
    const onReaction = (event: MessageEvent): void => {
      const payload = parseStreamReactionFrame(String(event.data));
      if (payload !== null) write(applyEventReaction(heldRef.current, payload));
    };
    source.addEventListener(STREAM_REACTION_EVENT_TYPE, onReaction);
    return () => source.close();
  }, [deps, leagueId, write]);

  const react = useCallback(
    async (eventId: string, emoji: string): Promise<void> => {
      // THE NEWEST TAP ON THIS PILL WINS (M3). Two of the viewer's own toggles can be in flight at
      // once, and HTTP does not promise the responses come back in the order the requests went
      // out — so without this, whichever RESPONSE lands last decides what the pill shows, while
      // the server's own state was decided by whichever REQUEST it processed first. Double-tap 🔥
      // and the row ends absent server-side while a late "added" leaves the pill pressed until a
      // reload. A generation per (event, emoji) — the pair a tap is actually about, so a tap on
      // 😂 never invalidates one on 🔥 — and a response older than the latest request for that
      // pair is dropped whole: it is strictly older information about the same fact, and the
      // newest request's own response, plus the stream's frames, still carry the truth.
      const pill = `${eventId}|${emoji}`;
      const generation = (generations.current.get(pill) ?? 0) + 1;
      generations.current.set(pill, generation);
      const isStale = (): boolean => generations.current.get(pill) !== generation;

      const mine = (map: EventReactionMap): boolean =>
        meUserId !== "" && (map.get(eventId) ?? []).some((reaction) => reaction.emoji === emoji && reaction.userId === meUserId);
      const optimistic: "added" | "removed" = mine(heldRef.current) ? "removed" : "added";
      if (meUserId !== "") write(applyEventReaction(heldRef.current, { eventId, emoji, userId: meUserId, action: optimistic }));

      const putBack = (): void => {
        if (meUserId === "") return;
        write(applyEventReaction(heldRef.current, { eventId, emoji, userId: meUserId, action: optimistic === "added" ? "removed" : "added" }));
      };

      try {
        const response = await deps.fetchJson(`/api/leagues/${leagueId}/activity/${eventId}/reactions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ emoji }),
        });
        const envelope = (await response.json()) as ApiEnvelope<EventReactionBody>;
        if (!envelope.ok) {
          putBack();
          return;
        }
        if (meUserId === "" || isStale()) return;
        write(applyEventReaction(heldRef.current, { eventId, emoji, userId: meUserId, action: envelope.data.action }));
      } catch {
        putBack();
      }
    },
    [deps, leagueId, meUserId, write],
  );

  return { held, react };
}
