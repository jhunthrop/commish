"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BottomSheet, PlayerObject, SeasonBars, SourceStrip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { PlayerSeasonBody } from "@/league-service/player";
import { sourcesFor, weeksFor } from "../lib/player-season-view";
import { useLeagueRoomDeps } from "../hooks/deps";

interface PeekTarget {
  readonly leagueId: string;
  readonly playerId: string;
  readonly name: string;
}

/**
 * ONE listener, module scope: `PlayerName` triggers anywhere in the tree reach the single
 * `PlayerPeekHost` the page mounts, with no context threading through the server components
 * between them. A trigger pressed with no host mounted does nothing, quietly — the failure mode
 * is a dead click, never a crash.
 */
let host: ((target: PeekTarget) => void) | null = null;

export function openPlayerPeek(target: PeekTarget): void {
  host?.(target);
}

/**
 * A PLAYER'S NAME, PRESSABLE (founder, 2026-08-30: "we should be able to click the players name
 * wherever they're displayed... it should bring up a pop up from the bottom"). The name is the
 * control everywhere it appears; pressing it raises the bottom-sheet peek instead of navigating
 * away. The full page still exists — the sheet links to it — so a deep look is one more press,
 * never lost.
 */
export function PlayerName({
  leagueId,
  playerId,
  name,
  className = "",
  children,
}: {
  readonly leagueId: string;
  readonly playerId: string;
  readonly name: string;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => openPlayerPeek({ leagueId, playerId, name })}
      className={`min-w-0 cursor-pointer text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      {children ?? name}
    </button>
  );
}

/**
 * The one mounted receiver for `PlayerName` presses: fetches the player's season under this
 * league's rules (the same body the full page reads) and raises the sheet. Loading shows the
 * name immediately — the reader pressed a name, the sheet answers with it before the wire does.
 */
export function PlayerPeekHost() {
  const { fetchJson } = useLeagueRoomDeps();
  const [target, setTarget] = useState<PeekTarget | null>(null);
  const [body, setBody] = useState<PlayerSeasonBody | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    host = setTarget;
    return () => {
      if (host === setTarget) host = null;
    };
  }, []);

  useEffect(() => {
    if (target === null) return;
    setBody(null);
    setFailed(false);
    let alive = true;
    void (async () => {
      try {
        const response = await fetchJson(`/api/leagues/${target.leagueId}/player-season?playerId=${encodeURIComponent(target.playerId)}`, { method: "GET" });
        const envelope = (await response.json()) as ApiEnvelope<PlayerSeasonBody>;
        if (!alive) return;
        if (envelope.ok) setBody(envelope.data);
        else setFailed(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [target, fetchJson]);

  if (target === null) return null;
  const played = body?.weeks.some((week) => week.points !== null) ?? false;
  return (
    <BottomSheet label={target.name} onClose={() => setTarget(null)}>
      <div className="flex flex-col gap-6">
        {body === null ? (
          <div className="flex flex-col gap-2">
            <p className="font-display text-2xl font-bold text-text-primary">{target.name}</p>
            <p className="text-sm text-text-muted">{failed ? "We could not load him. Close this and try again." : "Loading…"}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <PlayerObject player={body.player} />
              <Link
                className={`${MICRO_LABEL} pt-2 text-accent underline`}
                href={`/app/leagues/${target.leagueId}/players/${target.playerId}`}
                onClick={() => setTarget(null)}
              >
                Full page
              </Link>
            </div>
            <SourceStrip label={`Where ${body.player.name} is ranked, by source`} sources={sourcesFor(body)} />
            {played ? (
              <SeasonBars label={`${body.player.name}, points by week`} weeks={weeksFor(body)} />
            ) : (
              <p className="text-sm text-text-muted">No scored week for him this season.</p>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
