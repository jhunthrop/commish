"use client";

import { useMemo, useState } from "react";
import type { Player, Position } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Button, EmptyState, Input, Select, Table, type TableColumn } from "@/components/ui";
import { DRAFT_ROOM_CONFIG } from "../state/config";

const ALL = "ALL";
const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const POSITION_OPTIONS = [{ value: ALL, label: "All positions" }, ...POSITIONS.map((position) => ({ value: position, label: position }))];

export interface PlayerPoolProps {
  /** Server-ranked, best first. This component never re-ranks. */
  readonly players: readonly Player[];
  readonly view: DraftStateView;
  readonly pendingPlayerId: string | null;
  /** True only when the server says it is this user's turn to act. */
  readonly canAct: boolean;
  /** "Draft" for snake, "Nominate" for auction. */
  readonly actionLabel: string;
  readonly submitting: boolean;
  readonly onAct: (playerId: string) => void;
}

interface PoolRow {
  readonly player: Player;
  readonly rank: number;
  readonly drafted: boolean;
}

export function PlayerPool({ players, view, pendingPlayerId, canAct, actionLabel, submitting, onAct }: PlayerPoolProps) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(ALL);

  const available = useMemo(() => new Set(view.availablePlayerIds), [view.availablePlayerIds]);
  // The full match set, before the page-size cap below — its length is what tells the
  // truncation notice how many rows are hidden.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return players
      .map((player, index): PoolRow => ({ player, rank: index + 1, drafted: !available.has(player.id) }))
      .filter((row) => (position === ALL || row.player.position === position) && (needle === "" || row.player.name.toLowerCase().includes(needle)));
  }, [players, available, query, position]);
  const rows = useMemo(() => filtered.slice(0, DRAFT_ROOM_CONFIG.poolPageSize), [filtered]);
  const truncated = filtered.length > DRAFT_ROOM_CONFIG.poolPageSize;

  const columns: readonly TableColumn<PoolRow>[] = [
    { key: "name", header: "Player", cell: (row) => row.player.name },
    { key: "position", header: "Pos", cell: (row) => row.player.position },
    { key: "team", header: "NFL", cell: (row) => row.player.nflTeam, hideOnNarrow: true },
    { key: "rank", header: "Rank", cell: (row) => row.rank, numeric: true, hideOnNarrow: true },
    {
      key: "action",
      header: "Action",
      cell: (row) =>
        row.drafted ? (
          <Badge tone="neutral">Drafted</Badge>
        ) : (
          <Button size="sm" disabled={!canAct} loading={submitting && pendingPlayerId === row.player.id} onClick={() => onAct(row.player.id)}>
            {actionLabel}
          </Button>
        ),
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Search players" value={query} placeholder="Name" onChange={(event) => setQuery(event.target.value)} />
        <Select label="Position" options={POSITION_OPTIONS} value={position} onChange={(event) => setPosition(event.target.value)} />
      </div>
      <Table
        caption="Available players, best first"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.player.id}
        rowClassName={(row) => (row.drafted ? "opacity-60" : "")}
        empty={
          <EmptyState
            title="No players match"
            description="Try a different name or position."
            icon="search"
            action={
              <Button
                onClick={() => {
                  setQuery("");
                  setPosition(ALL);
                }}
              >
                Clear filters
              </Button>
            }
          />
        }
      />
      {truncated ? (
        <p className="text-sm text-text-muted">
          Showing the top {rows.length} of {filtered.length} — narrow your search to see more.
        </p>
      ) : null}
    </section>
  );
}
