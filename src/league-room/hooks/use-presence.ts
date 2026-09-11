"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { PresenceBody } from "../contract";
import { useLeagueRoomDeps } from "./deps";

/** The frame the server publishes when a member's connection opens or closes. */
const PRESENCE_EVENT_TYPE = "presence.changed";

/** The frame's payload is the whole room. Anything else is ignored, never trusted halfway. */
function userIdsFrom(data: string): readonly string[] | null {
  try {
    const frame = JSON.parse(data) as { readonly payload?: { readonly userIds?: unknown } };
    const ids = frame.payload?.userIds;
    return Array.isArray(ids) && ids.every((id): id is string => typeof id === "string") ? ids : null;
  } catch {
    return null;
  }
}

/**
 * WHO IS IN THE ROOM (Sideline P5), kept live. Seeded with the server-rendered read, folded from
 * every `presence.changed` frame (the frame carries the room's whole present list, so a change
 * costs a reader nothing, H2), and re-read once per stream open, the mount-gap resync every
 * stream consumer hangs off `open`. The read is the same membership-gated endpoint the stream is.
 *
 * A read that fails keeps the last answer rather than emptying the room: "we could not check"
 * is not "nobody is here".
 */
export function usePresence(leagueId: string, initial: readonly string[]): ReadonlySet<string> {
  const deps = useLeagueRoomDeps();
  const [present, setPresent] = useState<ReadonlySet<string>>(() => new Set(initial));

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await deps.fetchJson(`/api/leagues/${leagueId}/presence`);
      const body = (await response.json()) as ApiEnvelope<PresenceBody>;
      if (!body.ok) return;
      setPresent(new Set(body.data.userIds));
    } catch {
      // Keep the last honest answer.
    }
  }, [deps, leagueId]);

  useEffect(() => {
    const source = deps.openEventSource(`/api/leagues/${leagueId}/events`);
    const onChanged = (event: MessageEvent): void => {
      const ids = userIdsFrom(String(event.data));
      if (ids !== null) setPresent(new Set(ids));
    };
    const onOpen = (): void => {
      void refresh();
    };
    source.addEventListener(PRESENCE_EVENT_TYPE, onChanged);
    source.addEventListener("open", onOpen);
    return () => source.close();
  }, [deps, leagueId, refresh]);

  return present;
}
