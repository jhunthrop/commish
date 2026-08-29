"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, PlayerFace, PositionBadge, SegmentGroup } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { NOT_STARTED_DASH } from "@/components/ui/game-state-chip";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { Position } from "@/domain/player";
import { useLeagueRoomDeps } from "../hooks/deps";

interface FreeAgentRow {
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  readonly nflTeam: string;
  readonly headshotUrl: string | null;
  readonly adp: number | null;
}

export interface RosterPlayerRow {
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  readonly nflTeam: string;
  readonly headshotUrl: string | null;
  readonly adp: number | null;
}

export interface FreeAgentsBoardProps {
  readonly leagueId: string;
  /** Everyone this manager owns, for the drop half of a full-roster claim. */
  readonly myRoster: readonly RosterPlayerRow[];
  /** Whether a claim must name a drop — the server enforces it; this only shapes the flow. */
  readonly rosterFull: boolean;
  /** A viewer with no team here (a commissioner reading) browses but cannot claim. */
  readonly canClaim: boolean;
}

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"] as const;

/**
 * THE FREE AGENTS BOARD (founder, 2026-08-28: "a free agents tab that allows for adding and
 * dropping players"). A tower over the unowned pool: ranked by the market's own ADP (the one
 * ordering this product can stand behind today — our model's column arrives with the live-season
 * engine), the amber segmented rail for positions, a name search, and one verb per row.
 *
 * THE CLAIM IS THE ESPN TWO-STEP the lineup manager already taught: tap ADD — on a roster with
 * room it just happens (the claim is the save, no confirm step for a reversible act); on a FULL
 * roster the row expands into your own players, each wearing "Drop for him", and the add and the
 * drop are one transaction on the wire. First come first served, said right on the board's own
 * status line the first time a claim races and loses.
 */
export function FreeAgentsBoard({ leagueId, myRoster, rosterFull, canClaim }: FreeAgentsBoardProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const router = useRouter();
  const [agents, setAgents] = useState<readonly FreeAgentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("ALL");
  const [loading, setLoading] = useState(true);
  const [droppingFor, setDroppingFor] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "claiming" | "claimed">("idle");
  const [error, setError] = useState<string | null>(null);
  const fetchSeq = useRef(0);

  const load = useCallback(
    async (searchTerm: string, positionFilter: string) => {
      const seq = ++fetchSeq.current;
      setLoading(true);
      try {
        const response = await fetchJson(
          `/api/leagues/${leagueId}/claims?search=${encodeURIComponent(searchTerm)}&position=${positionFilter}`,
          { method: "GET" },
        );
        const body = (await response.json()) as ApiEnvelope<{ agents: readonly FreeAgentRow[]; total: number }>;
        if (seq !== fetchSeq.current) return;
        if (body.ok) {
          setAgents(body.data.agents);
          setTotal(body.data.total);
        }
      } finally {
        if (seq === fetchSeq.current) setLoading(false);
      }
    },
    [fetchJson, leagueId],
  );

  useEffect(() => {
    // Debounced by keystroke: the request follows the pause, not every letter.
    const timer = setTimeout(() => void load(search, position), search === "" ? 0 : 250);
    return () => clearTimeout(timer);
  }, [search, position, load]);

  const claim = async (addPlayerId: string, dropPlayerId: string | null): Promise<void> => {
    setStatus("claiming");
    setError(null);
    setDroppingFor(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addPlayerId, dropPlayerId }),
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!body.ok) {
        setError(body.error);
        setStatus("idle");
        void load(search, position);
        return;
      }
      setStatus("claimed");
      void load(search, position);
      // The roster and the lineup changed on the server; the My team tab must not tell an
      // older story when the manager lands on it next.
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setStatus("idle");
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Free agents">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-text-primary">Free agents</h2>
        <p role="status" aria-live="polite" className="text-sm text-text-faint">
          {status === "claiming" ? "Claiming…" : status === "claimed" ? "Claimed. He is on your bench." : `${total} available`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* The segmented rail, now the shared primitive it was the second hand-rolled copy of. */}
        <SegmentGroup
          label="Position"
          labelled={false}
          options={POSITIONS.map((option) => ({ value: option, label: option === "ALL" ? "All" : option }))}
          value={position}
          onChange={(value) => setPosition(value as (typeof POSITIONS)[number])}
        />
        <Input
          className="w-64"
          label="Search"
          placeholder="Search a name"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <div aria-hidden="true" className={`grid grid-cols-[44px_minmax(0,1fr)_88px_176px] items-center gap-x-4 pb-1 ${MICRO_LABEL} text-text-faint`}>
        <span>#</span>
        <span>Player</span>
        <span>ADP</span>
        <span />
      </div>

      {loading && agents.length === 0 ? (
        <p className="text-sm text-text-muted">Loading the pool…</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-text-muted">Nobody matches. Widen the search.</p>
      ) : (
        <ul className="flex flex-col">
          {agents.map((agent, index) => (
            <li key={agent.id} className="border-t border-line">
              <div className="grid grid-cols-[44px_minmax(0,1fr)_88px_176px] items-center gap-x-4 py-2">
                <span aria-hidden="true" className="font-display text-2xl font-extrabold tabular-nums text-text-faint">
                  {index + 1}
                </span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <PlayerFace player={agent} size="md" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-display text-lg font-bold leading-display text-text-primary">{agent.name}</span>
                    <span className="flex items-center gap-1.5">
                      <PositionBadge position={agent.position} size="sm" />
                      {agent.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{agent.nflTeam}</span>}
                    </span>
                  </span>
                </span>
                <span className="font-display text-lg font-bold tabular-nums text-text-muted">
                  {agent.adp === null ? NOT_STARTED_DASH : agent.adp.toFixed(1)}
                </span>
                <span className="justify-self-end">
                  {!canClaim ? null : droppingFor === agent.id ? (
                    <Button variant="secondary" size="sm" onClick={() => setDroppingFor(null)}>
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      variant="verb"
                      size="sm"
                      disabled={status === "claiming"}
                      onClick={() => (rosterFull ? setDroppingFor(agent.id) : void claim(agent.id, null))}
                      aria-label={`Add ${agent.name}`}
                    >
                      Add
                    </Button>
                  )}
                </span>
              </div>

              {droppingFor === agent.id ? (
                <div className="mb-2 border-l-[3px] border-l-accent bg-surface-elevated py-2 pl-3 pr-2">
                  <p className={`${MICRO_LABEL} pb-1.5 text-text-faint`}>Your roster is full. Drop who for {agent.name}?</p>
                  <ul className="flex flex-col gap-1">
                    {myRoster.map((mine) => (
                      <li key={mine.id} className="flex items-center gap-2.5 py-1">
                        <PlayerFace player={mine} size="sm" />
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="truncate text-sm font-medium text-text-primary">{mine.name}</span>
                          <PositionBadge position={mine.position} size="sm" />
                          {mine.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{mine.nflTeam}</span>}
                        </span>
                        <Button variant="verb" size="sm" onClick={() => void claim(agent.id, mine.id)} aria-label={`Drop ${mine.name} for ${agent.name}`}>
                          Drop him
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
