"use client";

import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Button, EmptyState, Table, type TableColumn } from "@/components/ui";
import { rosterSpots } from "../state/format";
import { teamsById } from "../lib/lookups";

export interface BudgetTableProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
}

interface BudgetRow {
  readonly team: TeamCard;
  readonly budget: number;
  readonly maxBid: number;
  readonly spotsLeft: number;
}

/** Remaining money and each team's ceiling — both read straight off the view, never computed. */
export function BudgetTable({ view, teams, myTeamId }: BudgetTableProps) {
  const spots = rosterSpots(view.slotConfig);
  const byId = teamsById(teams);
  const rows: readonly BudgetRow[] = view.draftOrder.flatMap((teamId) => {
    const team = byId.get(teamId);
    if (team === undefined) return [];
    return [{ team, budget: view.budgets[teamId] ?? 0, maxBid: view.maxBids[teamId] ?? 0, spotsLeft: spots - (view.rosters[teamId]?.length ?? 0) }];
  });

  const columns: readonly TableColumn<BudgetRow>[] = [
    {
      key: "team",
      header: "Team",
      // The name is its own element so a test (and a screen reader) can address it without
      // the badge's text being concatenated onto it.
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span>{row.team.name}</span>
          {row.team.id === myTeamId ? <Badge tone="accent">You</Badge> : null}
        </span>
      ),
    },
    { key: "budget", header: "Budget", cell: (row) => `$${row.budget}`, numeric: true },
    { key: "max", header: "Max bid", cell: (row) => `$${row.maxBid}`, numeric: true },
    { key: "spots", header: "Spots left", cell: (row) => row.spotsLeft, numeric: true, hideOnNarrow: true },
  ];

  return (
    <Table
      caption="Team budgets"
      captionVisible
      columns={columns}
      rows={rows}
      rowKey={(row) => row.team.id}
      empty={<EmptyState title="No teams yet" description="Budgets appear once the draft starts." action={<Button disabled>Waiting for the draft to start</Button>} />}
    />
  );
}
