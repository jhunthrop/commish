import type { MatchupDetail, MatchupSide } from "../contract";
import { Badge, Card, PositionBadge, SlotChip, Table, type TableColumn } from "@/components/ui";
import { formatPoints, formatWeek } from "../lib/format";

const COLUMNS: readonly TableColumn<MatchupSide["starters"][number]>[] = [
  { key: "slot", header: "Slot", cell: (row) => <SlotChip slot={row.slot} /> },
  { key: "player", header: "Player", cell: (row) => row.playerName ?? "Empty" },
  {
    key: "position",
    header: "Pos",
    cell: (row) => (row.position === null ? "—" : <PositionBadge position={row.position} size="sm" />),
    hideOnNarrow: true,
  },
  { key: "points", header: "Points", cell: (row) => formatPoints(row.points), numeric: true },
];

function Side({ side }: { readonly side: MatchupSide }) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-medium text-text-primary">{side.teamName}</h3>
        <span className="text-xl font-semibold tabular-nums text-text-primary">
          {side.score === null ? "—" : formatPoints(side.score)}
        </span>
      </div>
      <Table
        caption={`${side.teamName} starters`}
        columns={COLUMNS}
        rows={side.starters}
        rowKey={(row) => `${row.slot}:${row.slotIndex}`}
        empty={<p className="text-sm text-text-muted">No starters set.</p>}
      />
    </Card>
  );
}

/**
 * One matchup, both lineups, every number already computed on the server.
 *
 * The copy is deliberate: this phase has a fixed 2026 stat set and no feed, so a week is
 * either "Final" or "Not scored yet". There is no "in progress", because there is no such
 * thing here, and implying otherwise is the one thing the spec calls out by name.
 */
export function MatchupPanel({ matchup, myTeamId }: { readonly matchup: MatchupDetail; readonly myTeamId: string | null }) {
  const mine = matchup.home.teamId === myTeamId ? matchup.home : matchup.away.teamId === myTeamId ? matchup.away : null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium text-text-primary">{formatWeek(matchup.weekNumber)}</h2>
        <Badge tone={matchup.final ? "positive" : "neutral"}>{matchup.final ? "Final" : "Not scored yet"}</Badge>
        {mine === null ? null : <Badge tone="accent">Your team</Badge>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Side side={matchup.home} />
        <Side side={matchup.away} />
      </div>
      <p className="text-sm text-text-muted">
        {"Scores come from this preview's fixed 2026 stat set — there's no live scoring yet."}
      </p>
    </section>
  );
}
