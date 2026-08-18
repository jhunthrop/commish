"use client";

import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { Badge, Button, EmptyState, Table, type TableColumn } from "@/components/ui";
import { playerName, teamName, teamsById } from "../lib/lookups";

export interface PickHistoryProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
}

export function PickHistory({ view, teams, playersById }: PickHistoryProps) {
  const rows = [...view.picks].reverse();
  const byId = teamsById(teams);

  const columns: readonly TableColumn<CompletedPick>[] = [
    { key: "pick", header: "#", cell: (pick) => pick.pickNumber, numeric: true },
    { key: "player", header: "Player", cell: (pick) => playerName(playersById, pick.playerId) },
    { key: "team", header: "Team", cell: (pick) => teamName(byId, pick.teamId), hideOnNarrow: true },
    { key: "slot", header: "Slot", cell: (pick) => pick.slot, hideOnNarrow: true },
    { key: "price", header: "Price", cell: (pick) => (pick.price === null ? "—" : `$${pick.price}`), numeric: true },
    { key: "auto", header: "Auto", cell: (pick) => (pick.auto ? <Badge tone="warning">Auto</Badge> : null) },
  ];

  return (
    <Table
      caption="Pick history, newest first"
      captionVisible
      columns={columns}
      rows={rows}
      rowKey={(pick) => String(pick.pickNumber)}
      empty={<EmptyState title="No picks yet" description="Every pick lands here the moment it happens." action={<Button disabled>Waiting for the first pick</Button>} />}
    />
  );
}
