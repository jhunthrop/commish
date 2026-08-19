import type { MatchupDetail, MatchupSide } from "../contract";
import { Card, PositionBadge, SlotChip, Table, type TableColumn } from "@/components/ui";
import { formatPoints } from "../lib/format";
import { MatchupScoreboard } from "./matchup-scoreboard";

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
  // The score lives on the scoreboard above; down here the roster is the story.
  return (
    <Card>
      <h3 className="font-display text-lg font-bold uppercase leading-display text-text-primary">{side.teamName}</h3>
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
  return (
    <section aria-label={`${matchup.home.teamName} against ${matchup.away.teamName}`} className="flex flex-col gap-3">
      <MatchupScoreboard
        matchup={{
          weekNumber: matchup.weekNumber,
          homeTeamId: matchup.home.teamId,
          awayTeamId: matchup.away.teamId,
          homeTeamName: matchup.home.teamName,
          awayTeamName: matchup.away.teamName,
          homeScore: matchup.home.score,
          awayScore: matchup.away.score,
          final: matchup.final,
        }}
        myTeamId={myTeamId}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <Side side={matchup.home} />
        <Side side={matchup.away} />
      </div>
      <p className="text-sm text-text-muted">
        {"Scores come from this preview's fixed 2026 stat set. There's no live scoring yet."}
      </p>
    </section>
  );
}
