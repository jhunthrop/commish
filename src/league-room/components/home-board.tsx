"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import { EmptyState } from "@/components/ui";
import type { HomeBody } from "../contract";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { useLeagueRoomDeps } from "../hooks/deps";
import { FirstRunPanel } from "./first-run-panel";
import { HomeLeagueCard } from "./home-league-card";

function someWeekInProgress(body: HomeBody): boolean {
  return body.leagues.some((league) => league.weekStatus === "in_progress");
}

function isHomeBody(value: unknown): value is HomeBody {
  return typeof value === "object" && value !== null && Array.isArray((value as { leagues?: unknown }).leagues);
}

/**
 * The cross-league home board: renders the server's payload immediately, then refreshes it on
 * `LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs` — but only while BOTH of two things are true:
 *
 * 1. The document is VISIBLE. A backgrounded tab refreshing every interval all Sunday is
 *    somebody's battery and our request budget for nothing they can see.
 * 2. At least one league's current week is actually `in_progress`. On a Tuesday nothing on this
 *    page can change, so nothing on this page should be asking.
 *
 * This is deliberately not a second real-time transport. Redis Streams over SSE remains the
 * one mechanism, and it is where the per-league live surface lives (`useLiveScores`): a manager
 * in ten leagues cannot hold ten SSE connections (`REALTIME_CONFIG.maxStreamsPerUser` is 10, and a league tab costs two of them, and
 * each one pins a Redis socket and an fd server-side), so this view reads a cached summary on an
 * interval instead, and every card links into the league page where the real stream is.
 *
 * The interval itself runs unconditionally once mounted — cheap, since a `setInterval` callback
 * that returns immediately costs nothing — and both conditions are re-checked on EVERY tick
 * against the latest held state (via `bodyRef`), not just at mount: a week that goes final
 * between two ticks stops polling on the very next one, and a tab that comes back into view
 * resumes on its own without a dedicated `visibilitychange` listener.
 */
export function HomeBoard({ initial }: { readonly initial: HomeBody }) {
  const [body, setBody] = useState<HomeBody>(initial);
  const deps = useLeagueRoomDeps();
  const bodyRef = useRef(body);
  bodyRef.current = body;

  useEffect(() => {
    let cancelled = false;

    async function tick(): Promise<void> {
      if (document.visibilityState !== "visible") return;
      if (!someWeekInProgress(bodyRef.current)) return;
      try {
        const response = await deps.fetchJson("/api/home");
        const envelope = (await response.json()) as ApiEnvelope<unknown>;
        if (cancelled || !envelope.ok || !isHomeBody(envelope.data)) return;
        setBody(envelope.data);
      } catch {
        // A failed background refresh leaves the last-known state on screen — the page already
        // rendered real data from the server, and this loop exists to keep it moving, not to be
        // the thing that can break the page.
      }
    }

    const interval = setInterval(() => void tick(), LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [deps]);

  if (body.leagues.length === 0) {
    if (body.firstRun !== null) return <FirstRunPanel plan={body.firstRun} />;
    // Defensive only: `firstRunPlan` (@/identity/first-run.ts) returns `null` exactly when
    // `leagueCount > 0`, so a caller that computed `firstRun` from the same league count this
    // board renders can never reach this branch. It stays as a fail-safe rather than an assumed
    // invariant, since nothing in `HomeBody`'s own type ties the two fields together.
    return (
      <EmptyState
        title="No leagues yet"
        description="Create one below, or open an invite link a commissioner sent you."
        icon="users"
        action={
          <a href="#create-league" className="text-sm font-medium text-accent underline">
            Jump to the form
          </a>
        }
      />
    );
  }

  // `min-w-0` on the grid ITEM below, not on the track: a grid item's default `min-width: auto`
  // lets its min-content width push the item — and with it the whole single-column track — wider
  // than the container, which is how one long league name made this page scroll sideways at
  // 360px. `HomeLeagueCard`'s heading carries the matching `min-w-0 break-words`.
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {body.leagues.map((league) => (
        <li key={league.id} className="min-w-0">
          <HomeLeagueCard league={league} />
        </li>
      ))}
    </ul>
  );
}
