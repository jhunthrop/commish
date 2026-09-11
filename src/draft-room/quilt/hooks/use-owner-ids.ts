"use client";

import { useEffect, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useDraftRoomDeps } from "../../hooks/deps";

/** One instance for every render before the read answers. */
const NO_OWNERS: ReadonlyMap<string, string> = new Map();

interface MemberLike {
  readonly id?: unknown;
  readonly ownerUserId?: unknown;
}

/**
 * teamId → the owner's user id, so presence (a set of user ids) can wear the wall's faces. The
 * draft snapshot's `TeamCard` carries no user id by design (the room never needs one for a
 * pick), and the league's own read does, so this asks the league once per room. A read that
 * fails leaves the map empty: the rail then counts who is here without naming faces, never
 * inventing a person.
 */
export function useOwnerIds(leagueId: string): ReadonlyMap<string, string> {
  const { fetchJson } = useDraftRoomDeps();
  const [owners, setOwners] = useState<ReadonlyMap<string, string>>(NO_OWNERS);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetchJson(`/api/leagues/${encodeURIComponent(leagueId)}`);
        const body = (await response.json()) as ApiEnvelope<{ readonly teams?: readonly MemberLike[] }>;
        if (!alive || !body.ok || !Array.isArray(body.data.teams)) return;
        const pairs = body.data.teams.flatMap((member) => (typeof member.id === "string" && typeof member.ownerUserId === "string" ? [[member.id, member.ownerUserId] as const] : []));
        if (pairs.length > 0) setOwners(new Map(pairs));
      } catch {
        // No names for the faces; the count still tells the truth.
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchJson, leagueId]);

  return owners;
}
