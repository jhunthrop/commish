"use client";

import { useEffect, useRef, useState } from "react";
import { Button, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { Position } from "@/domain/player";
import type { FreeAgentRow, PendingWaiverClaim } from "@/league-service/claims";
import type { FixtureLabel } from "@/league-service/nfl-schedule";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useLeagueRoomDeps } from "../hooks/deps";
import { formatWeekdayClock, ordinal } from "../lib/format";
import { PlayerName } from "./player-peek";

const POSITION_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;
type PositionFilter = (typeof POSITION_FILTERS)[number];

const SEARCH_DEBOUNCE_MS = 250;

export interface RoomSurfacePlayersProps {
  readonly leagueId: string;
  readonly canClaim: boolean;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
  readonly fixturesByNflTeam: ReadonlyMap<string, FixtureLabel>;
  readonly pendingClaims: readonly PendingWaiverClaim[];
  /** Increment to focus the search box — the shell's "/" key lands here. */
  readonly searchFocusToken: number;
  readonly onClaim: (agent: FreeAgentRow) => void;
}

/** The honest why-line: waiver state, injury listing, and this week's real fixture. No scouting
 *  prose — nothing in the platform writes any. */
function factsLine(agent: FreeAgentRow, fixtures: ReadonlyMap<string, FixtureLabel>): string {
  const parts: string[] = [];
  if (agent.onWaiversUntil !== null && agent.onWaiversUntil !== undefined) {
    parts.push(`on waivers · clears ${formatWeekdayClock(agent.onWaiversUntil)}`);
  } else {
    parts.push("free agent · adds now");
  }
  const designation = agent.injuryDesignation ?? null;
  if (designation !== null) parts.push(`listed ${designation}`);
  const fixture = fixtures.get(agent.nflTeam);
  parts.push(fixture === undefined ? "on bye this week" : `plays ${fixture.when} ${fixture.opp}`);
  return parts.join(" · ");
}

/**
 * THE PLAYERS SURFACE — the drawer's draft-pool-density free agent table, the same component at
 * half height, full height, and the /players route. Every column is a number the services
 * actually produce: this week's projection, ADP, the waiver window. The claim verb opens the
 * claim sheet (law 3) — the drop decision surfaces before anything commits.
 */
export function RoomSurfacePlayers(props: RoomSurfacePlayersProps) {
  const { leagueId, canClaim, projectionsByPlayerId, fixturesByNflTeam, pendingClaims, searchFocusToken, onClaim } = props;
  const { fetchJson } = useLeagueRoomDeps();
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<PositionFilter>("ALL");
  const [agents, setAgents] = useState<readonly FreeAgentRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (searchFocusToken > 0) searchRef.current?.focus();
  }, [searchFocusToken]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetchJson(
            `/api/leagues/${leagueId}/claims?search=${encodeURIComponent(search)}&position=${position}`,
          );
          const body = (await response.json()) as ApiEnvelope<{ readonly agents: readonly FreeAgentRow[] }>;
          if (cancelled) return;
          if (!body.ok) {
            setFailed(true);
            return;
          }
          setAgents(body.data.agents);
          setFailed(false);
          setLoaded(true);
        } catch {
          if (!cancelled) setFailed(true);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchJson, leagueId, search, position]);

  const claimByPlayerId = new Map(pendingClaims.map((claim) => [claim.playerId, claim]));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search free agents"
          aria-label="Search free agents"
          className="min-w-48 flex-1 rounded-md border border-line bg-surface-inset px-3 py-1.5 text-sm text-text-primary placeholder:text-text-faint focus:border-edge focus:outline-none"
        />
        {POSITION_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setPosition(filter)}
            aria-pressed={position === filter}
            className={`rounded-md border px-2.5 py-1 font-display text-xs font-semibold ${
              position === filter ? "border-accent text-accent" : "border-line text-text-muted hover:border-edge"
            }`}
          >
            {filter === "ALL" ? "All" : filter}
          </button>
        ))}
      </div>

      <div
        className="hidden grid-cols-[2.25rem_minmax(10rem,2fr)_4rem_4rem_minmax(12rem,3fr)_7rem] items-center gap-2 border-b border-line pb-1 sm:grid"
        aria-hidden
      >
        <span />
        <span className={`${MICRO_LABEL} text-text-faint`}>Free agent</span>
        <span className={`${MICRO_LABEL} text-right text-text-faint`}>Wk proj</span>
        <span className={`${MICRO_LABEL} text-right text-text-faint`}>ADP</span>
        <span className={`${MICRO_LABEL} text-text-faint`}>The facts</span>
        <span />
      </div>

      {failed ? <p className="text-sm text-negative">The player pool did not load. Try again in a moment.</p> : null}
      {loaded && !failed && agents.length === 0 ? (
        <p className="text-sm text-text-muted">No free agents match.</p>
      ) : null}

      {agents.map((agent) => {
        const projection = projectionsByPlayerId.get(agent.id) ?? null;
        const filed = claimByPlayerId.get(agent.id);
        return (
          <div
            key={agent.id}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-raised sm:grid-cols-[2.25rem_minmax(10rem,2fr)_4rem_4rem_minmax(12rem,3fr)_7rem]"
          >
            <PositionBadge position={agent.position as Position} size="sm" />
            <span className="min-w-0 truncate font-display text-sm font-semibold text-text-primary">
              <PlayerName leagueId={leagueId} playerId={agent.id} name={agent.name} className="inline" />{" "}
              <span className="font-mono text-xs font-normal text-text-faint">{agent.nflTeam}</span>
            </span>
            <span className="hidden text-right font-mono text-sm text-text-primary sm:block">
              {projection === null ? "·" : projection.toFixed(1)}
            </span>
            <span className="hidden text-right font-mono text-sm text-text-muted sm:block">
              {agent.adp === null ? "·" : Math.round(agent.adp)}
            </span>
            <span className="hidden min-w-0 truncate text-xs text-text-muted sm:block">
              {factsLine(agent, fixturesByNflTeam)}
            </span>
            {filed !== undefined ? (
              <span className="text-right font-mono text-xs text-text-faint">filed · {ordinal(filed.queuePosition)}</span>
            ) : canClaim ? (
              <Button variant="secondary" size="sm" onClick={() => onClaim(agent)}>
                Claim
              </Button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>
  );
}
