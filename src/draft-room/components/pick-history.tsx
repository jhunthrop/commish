"use client";

import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { Badge, Button, EmptyState, PositionBadge, Table, type TableColumn } from "@/components/ui";
import { teamName, teamsById } from "../lib/lookups";

export interface PickHistoryProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly variant?: "room" | "tv";
  readonly caption?: string;
  readonly emptyAction?: ReactNode;
}

/**
 * A pick's player, wearing their position sticker. `PositionBadge` is how a position is
 * rendered anywhere in this product (docs/design-system.md), so the history reads with the
 * same color code as the board above it.
 */
function playerCell(playersById: ReadonlyMap<string, Player>, playerId: string): ReactNode {
  const player = playersById.get(playerId) ?? null;
  return (
    <span className="flex items-center gap-2">
      {player === null ? null : <PositionBadge position={player.position} size="sm" />}
      <span>{player?.name ?? playerId}</span>
    </span>
  );
}

/** Column definitions for each variant. */
function columnsFor(variant: "room" | "tv", playersById: ReadonlyMap<string, Player>, byId: ReadonlyMap<string, TeamCard>): readonly TableColumn<CompletedPick>[] {
  if (variant === "tv") {
    return [
      { key: "pick", header: "#", cell: (pick) => pick.pickNumber, numeric: true },
      { key: "round", header: "Rd", cell: (pick) => pick.round, numeric: true, hideOnNarrow: true },
      { key: "team", header: "Team", cell: (pick) => teamName(byId, pick.teamId) },
      { key: "player", header: "Player", cell: (pick) => playerCell(playersById, pick.playerId) },
      { key: "price", header: "Price", cell: (pick) => (pick.price === null ? "—" : `$${pick.price}`), numeric: true },
    ];
  }
  // "room" variant (default)
  return [
    { key: "pick", header: "#", cell: (pick) => pick.pickNumber, numeric: true },
    { key: "player", header: "Player", cell: (pick) => playerCell(playersById, pick.playerId) },
    { key: "team", header: "Team", cell: (pick) => teamName(byId, pick.teamId), hideOnNarrow: true },
    { key: "slot", header: "Slot", cell: (pick) => pick.slot, hideOnNarrow: true },
    { key: "price", header: "Price", cell: (pick) => (pick.price === null ? "—" : `$${pick.price}`), numeric: true },
    { key: "auto", header: "Auto", cell: (pick) => (pick.auto ? <Badge tone="warning">Auto</Badge> : null) },
  ];
}

export function PickHistory({ view, teams, playersById, variant = "room", caption, emptyAction }: PickHistoryProps) {
  const rows = [...view.picks].reverse();
  const byId = teamsById(teams);
  const columns = columnsFor(variant, playersById, byId);

  const defaultCaption = variant === "tv" ? "Every pick so far" : "Pick history, newest first";
  const defaultEmptyAction = variant === "tv" ? <span className="text-text-muted">Waiting for the first pick</span> : <Button disabled>Waiting for the first pick</Button>;
  const defaultEmptyTitle = variant === "tv" ? "The board is empty" : "No picks yet";
  const defaultEmptyDesc = variant === "tv" ? "Picks appear here the moment they land." : "Every pick lands here the moment it happens.";

  return (
    <Table
      caption={caption ?? defaultCaption}
      captionVisible
      columns={columns}
      rows={rows}
      rowKey={(pick) => String(pick.pickNumber)}
      empty={<EmptyState title={defaultEmptyTitle} description={defaultEmptyDesc} action={emptyAction ?? defaultEmptyAction} />}
    />
  );
}
