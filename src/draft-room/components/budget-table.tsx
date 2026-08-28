"use client";

import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Button, EmptyState, Table, type TableColumn } from "@/components/ui";
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
}

/** Auction money, whole dollars — this room never bids a cent, so a decimal would be two
 *  characters of noise on every row. */
function money(value: number): string {
  return `$${value}`;
}

/** The comparison set both money columns rank inside. "The room", not "the league": this table
 *  only ever exists inside a live auction, and the room is the word a manager uses while he is
 *  sitting in one. Reads after both "vs " and "Top 8% of ". */
const ROOM_POPULATION = "the room";

/** Remaining money and each team's ceiling — both read straight off the view, never computed. */
export function BudgetTable({ view, teams, myTeamId }: BudgetTableProps) {
  const byId = teamsById(teams);
  const rows: readonly BudgetRow[] = view.draftOrder.flatMap((teamId) => {
    const team = byId.get(teamId);
    if (team === undefined) return [];
    return [{ team, budget: view.budgets[teamId] ?? 0, maxBid: view.maxBids[teamId] ?? 0 }];
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
    // SPOTS LEFT WAS CUT (2026-08-28). Three numbers were carrying two facts: a max bid IS the
    // budget minus a dollar for every roster spot still to fill, so the third column was the
    // arithmetic behind the second, printed beside its own answer. A manager mid-auction asks
    // "how much has he got" and "how far can he go", and both survive. Nothing moves left into
    // the space it freed — the table simply ends sooner.
    //
    // Money is judged now, and this is exactly the column the tint was invented for: twelve
    // budgets are a real set, the whole set is on screen, and "who can still outbid me" is a
    // shape question, not a reading question. In a four-team room the set is at the floor and
    // every figure stays plain, which is the honest answer rather than a decorative one.
    { key: "budget", header: "Budget", judged: { value: (row) => row.budget, format: money, set: ROOM_POPULATION } },
    { key: "max", header: "Max bid", judged: { value: (row) => row.maxBid, format: money, set: ROOM_POPULATION } },
  ];

  return (
    // Task 12 Step 3c: the last `Table` consumer in the product to converge — no explicit
    // `density` needed, since `Table` now defaults to `"dense"` itself (`table.tsx`'s own
    // DENSITY-DEFAULT DECISION docblock, closed by this task).
    <Table
      caption="Team budgets"
      captionVisible
      columns={columns}
      rows={rows}
      rowKey={(row) => row.team.id}
      // An accent-tinted row for your own money — a table row can't take a full border the
      // way a card can, so it recolors the row's existing bottom rule instead of adding one.
      rowClassName={(row) => (row.team.id === myTeamId ? "border-accent bg-accent/10" : "")}
      empty={<EmptyState title="No teams yet" description="Budgets appear once the draft starts." action={<Button disabled>Waiting for the draft to start</Button>} />}
    />
  );
}
