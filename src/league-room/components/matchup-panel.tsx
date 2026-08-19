import type { WeekStatus } from "@/league";
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
 * `weekStatus` is a prop of its own, not read off `matchup.weekStatus`: it decouples "what
 * state the week is in right now" from the server-rendered snapshot `matchup` carries, which is
 * what lets a caller fold a live `score.update` frame (`useLiveScores`) over it without having
 * to reconstruct the whole `MatchupDetail`. Live scoring exists now, so a week says which of
 * the three states it's in — scheduled, in progress, or final — and never shows a moving number
 * with no state beside it.
 */
export function MatchupPanel({
  matchup,
  myTeamId,
  weekStatus,
}: {
  readonly matchup: MatchupDetail;
  readonly myTeamId: string | null;
  readonly weekStatus: WeekStatus;
}) {
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
          weekStatus,
        }}
        myTeamId={myTeamId}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <Side side={matchup.home} />
        <Side side={matchup.away} />
      </div>
    </section>
  );
}
