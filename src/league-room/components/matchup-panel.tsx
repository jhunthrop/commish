import type { MedianResult, WeekStatus } from "@/league";
import type { MatchupDetail, MatchupSide } from "../contract";
import { Card, EYEBROW, InfoTip, PositionBadge, SlotChip, Table, type TableColumn } from "@/components/ui";
import { formatPoints } from "../lib/format";
import { MatchupScoreboard } from "./matchup-scoreboard";
import { MedianResultLine } from "./median-result";

const COLUMNS: readonly TableColumn<MatchupSide["starters"][number]>[] = [
  { key: "slot", header: "Slot", cell: (row) => <SlotChip slot={row.slot} /> },
  { key: "player", header: "Player", cell: (row) => row.playerName ?? "Empty" },
  {
    key: "position",
    header: "Pos",
    // `null`, not a dash glyph: the Player column already says "Empty" for this same row, and a
    // slot with no player has no position to show beside it.
    cell: (row) => (row.position === null ? null : <PositionBadge position={row.position} size="sm" />),
    hideOnNarrow: true,
  },
  { key: "points", header: "Points", cell: (row) => formatPoints(row.points), numeric: true },
];

/** One side's own median line, or `null` when there's nothing to say yet — the toggle is off,
 *  or this week hasn't settled, or (defensively) this side has no score despite a median
 *  existing, a combination `finalizeWeekInTx`'s own single transaction never actually produces. */
function medianLineFor(
  matchup: MatchupDetail,
  which: "home" | "away",
): { readonly score: number; readonly medianScore: number; readonly result: MedianResult } | null {
  const { median } = matchup;
  const score = matchup[which].score;
  if (median === null || score === null) return null;
  return { score, medianScore: median.score, result: which === "home" ? median.homeResult : median.awayResult };
}

function Side({
  side,
  myTeamId,
  median,
}: {
  readonly side: MatchupSide;
  readonly myTeamId: string | null;
  readonly median: { readonly score: number; readonly medianScore: number; readonly result: MedianResult } | null;
}) {
  // The score lives on the scoreboard above; down here the roster is the story.
  return (
    <Card>
      <h3 className="font-display text-lg font-bold uppercase leading-display text-text-primary">{side.teamName}</h3>
      {median === null ? null : (
        <MedianResultLine
          teamName={side.teamName}
          isMine={side.teamId === myTeamId}
          score={median.score}
          medianScore={median.medianScore}
          result={median.result}
        />
      )}
      {/* No explicit `density`: `Table` defaults to `"dense"` itself since Task 12 Step 3c's
          closeout (`table.tsx`'s own DENSITY-DEFAULT DECISION docblock). */}
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
 *
 * A15: the "matchup" glossary term's own `InfoTip` caller — read off this file per the
 * backend-leverage inventory's Task 15 Step 4 ledger. Placed on this panel's own eyebrow rather
 * than on `MatchupScoreboard` itself: the scoreboard is ALSO `HomeLeagueCard`'s hero (Task 10),
 * a dense card-list context whose own test pins "no button at all" for a league with nothing
 * pending, and an unconditional InfoTip trigger there would be a real regression on a component
 * this task does not own.
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
      <span className="flex items-center gap-1">
        <span className={`${EYEBROW} text-text-muted`}>Matchup</span>
        <InfoTip term="matchup" />
      </span>
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
        <Side side={matchup.home} myTeamId={myTeamId} median={medianLineFor(matchup, "home")} />
        <Side side={matchup.away} myTeamId={myTeamId} median={medianLineFor(matchup, "away")} />
      </div>
    </section>
  );
}
