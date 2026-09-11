"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { PresenceBody } from "../contract";
import { useLeagueRoomDeps } from "./deps";

/** The frame the server publishes when a member's connection opens or closes. */
const PRESENCE_EVENT_TYPE = "presence.changed";

/**
 * WHO IS IN THE ROOM (Sideline P5), kept live. Seeded with the server-rendered read, then
 * re-read whenever the league stream says presence changed and whenever the stream (re)opens,
 * the same mount-gap resync every stream consumer hangs off `open`. The frame carries no names;
 * the read is the same membership-gated endpoint, so the browser never trusts a frame's word.
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
    const onChange = (): void => {
      void refresh();
    };
    source.addEventListener(PRESENCE_EVENT_TYPE, onChange);
    source.addEventListener("open", onChange);
    return () => source.close();
  }, [deps, leagueId, refresh]);

  return present;
}
