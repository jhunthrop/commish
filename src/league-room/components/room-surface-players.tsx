"use client";

import { useEffect, useRef, useState } from "react";
import { BigNumber, Button, PlayerRow, SegmentGroup } from "@/components/ui";
import type { Player } from "@/domain/player";
import type { FreeAgentRow, PendingWaiverClaim } from "@/league-service/claims-contract";
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

/** The two-position switch over the board. `ALL` is the resting state and reads as a word. */
const FILTER_OPTIONS = POSITION_FILTERS.map((filter) => ({ value: filter, label: filter === "ALL" ? "All" : filter }));

/**
 * THE FREE-AGENT HALF OF THE WIRE — the same component at half height, full height, and the
 * /players route. Sideline (2026-09-11): every row is a `PlayerRow` at research density, so the
 * face is on the club's ring, the name is the largest thing on the row, the facts are small
 * beneath it, and the ONE number at the right is this week's projection with its basis (P1, P2).
 * The claim verb is the row's one control and opens the claim sheet — the drop decision surfaces
 * before anything commits.
 *
 * ABSENCE IS ABSENCE. Nothing on the wire renders as a sentence saying so, never as a skeleton or
 * a zero-filled row, and a search that matches nobody says that it matched nobody rather than
 * looking like a board still loading.
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
      <div className="flex flex-wrap items-center gap-3">
        {/* The mock's 40px pill field, spelled here because the search box carries a ref for the
            shell's "/" key and `Input`'s own label row would put a second heading over a board
            that already has one. Same height, same radius, same border role. */}
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search free agents"
          aria-label="Search free agents"
          className="h-10 min-w-48 flex-1 rounded-pill border border-edge bg-surface-elevated px-4 text-md text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <SegmentGroup
          label="Position"
          labelled={false}
          size="sm"
          options={FILTER_OPTIONS}
          value={position}
          onChange={(value) => setPosition(value as PositionFilter)}
        />
      </div>

      {failed ? <p className="text-sm text-negative">The player pool did not load. Try again in a moment.</p> : null}
      {loaded && !failed && agents.length === 0 ? (
        <p className="text-md text-text-muted">Nobody on the wire matches that.</p>
      ) : null}

      {agents.map((agent) => {
        const projection = projectionsByPlayerId.get(agent.id) ?? null;
        const filed = claimByPlayerId.get(agent.id);
        // `FreeAgentRow` already carries every field a `Player` needs, so the row draws the real
        // person rather than a position chip beside a string.
        const player: Player = {
          id: agent.id,
          name: agent.name,
          position: agent.position,
          nflTeam: agent.nflTeam,
          headshotUrl: agent.headshotUrl,
          adp: agent.adp,
        };
        return (
          <PlayerRow
            key={agent.id}
            dense
            player={player}
            name={<PlayerName leagueId={leagueId} playerId={agent.id} name={agent.name} className="truncate" />}
            meta={factsLine(agent, fixturesByNflTeam)}
            // THE ONE NUMBER (P2), naming its rules and its span in the same glance. A player the
            // projection read does not cover renders a dash and says why, never a zero (P11).
            figure={
              <BigNumber
                size="sm"
                value={projection === null ? null : projection.toFixed(1)}
                basis={projection === null ? "no projection this week" : "projected this week"}
              />
            }
            // THE ONE CONTROL. A claim already filed says where it sits in line instead: there is
            // nothing left to press on a player you have already claimed.
            action={
              filed !== undefined ? (
                <span className="whitespace-nowrap text-sm tabular-nums text-text-faint">{`filed · ${ordinal(filed.queuePosition)}`}</span>
              ) : canClaim ? (
                <Button variant="secondary" size="sm" onClick={() => onClaim(agent)}>
                  Claim
                </Button>
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}
