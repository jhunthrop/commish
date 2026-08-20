"use client";

import { useMemo, useState } from "react";
import type { TeamStandingsRow } from "../contract";
import { Avatar, Badge, Button, EmptyState, InfoTip, Table, type TableColumn } from "@/components/ui";
import { formatPoints, formatRecord } from "../lib/format";

type SortKey = "rank" | "pointsFor" | "pointsAgainst";

/**
 * The canonical ranking — wins, then points for, then team id — is `computeStandings`', on
 * the server, and is never restated here. `rank` therefore sorts by nothing at all and simply
 * keeps the order the server sent. The other two sort by that number alone; because
 * `Array.prototype.sort` is stable, ties fall back to the server's ranking for free. That is
 * display, not a league rule.
 */
const ORDER_BY: Readonly<Record<SortKey, (row: TeamStandingsRow) => number>> = {
  rank: () => 0,
  pointsFor: (row) => row.pointsFor,
  pointsAgainst: (row) => row.pointsAgainst,
};

export interface StandingsTableProps {
  readonly rows: readonly TeamStandingsRow[];
  readonly myTeamId: string | null;
}

export function StandingsTable({ rows, myTeamId }: StandingsTableProps) {
  const [sort, setSort] = useState<SortKey>("rank");
  const ordered = useMemo(() => [...rows].sort((a, b) => ORDER_BY[sort](b) - ORDER_BY[sort](a)), [rows, sort]);

  // `clinchedTeamIds` reports every team clinched from week 1 whenever the playoff field is at
  // least as big as the league (`playoffTeams >= teamCount`) — a real branch, but a signal with
  // no information in it. Twelve meaningless badges are worse than none, so a whole-league
  // clinch is treated as "nothing to show" rather than rendered literally.
  const showClinchBadges = rows.length > 0 && rows.some((row) => !row.clinched);

  const sortable = (key: SortKey, label: string) => (
    <button type="button" className="underline" onClick={() => setSort(key)}>
      {`Sort by ${label}`}
    </button>
  );

  const columns: readonly TableColumn<TeamStandingsRow>[] = [
    {
      key: "team",
      header: "Team",
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={row.ownerDisplayName} avatar={row.ownerAvatar} size="sm" />
          <span className="truncate">{row.teamName}</span>
          {showClinchBadges && row.clinched ? <Badge tone="positive">Clinched</Badge> : null}
        </span>
      ),
    },
    {
      key: "record",
      header: (
        <span className="inline-flex items-center gap-1">
          Record
          <InfoTip term="standings-record" />
        </span>
      ),
      cell: (row) => formatRecord(row),
    },
    { key: "pointsFor", header: "Points for", cell: (row) => formatPoints(row.pointsFor), numeric: true },
    { key: "pointsAgainst", header: "Points against", cell: (row) => formatPoints(row.pointsAgainst), numeric: true, hideOnNarrow: true },
  ];

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3 text-sm text-text-muted">
        {sortable("rank", "standing")}
        {sortable("pointsFor", "points for")}
        {sortable("pointsAgainst", "points against")}
      </div>
      <Table
        caption="League standings"
        captionVisible
        columns={columns}
        rows={ordered}
        rowKey={(row) => row.teamId}
        rowClassName={(row) =>
          row.teamId === myTeamId ? "border-l-2 border-l-accent bg-surface-elevated font-medium" : ""
        }
        rowAttributes={(row) => ({ "data-own": row.teamId === myTeamId ? "true" : "false" })}
        empty={
          <EmptyState
            title="No results yet"
            description="Standings appear once the first week has been scored."
            icon="trophy"
            action={<Button disabled>Waiting for the first week to be scored</Button>}
          />
        }
      />
      {rows.length === 0 ? null : (
        // The rule the server ranks by, said out loud: nobody should have to guess how a
        // 7-7 logjam resolves. (Persona review: veterans want the tiebreak named.)
        <p className="text-xs text-text-muted">
          Ties in the standings break on points for.
          {showClinchBadges ? " Clinched means a guaranteed playoff spot." : ""}
        </p>
      )}
    </section>
  );
}
