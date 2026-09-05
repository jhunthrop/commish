import Link from "next/link";
import { Card, EYEBROW, PlayerFace, PositionBadge } from "@/components/ui";
import type { LineupBody, MatchupSummary } from "../contract";
import { formatWeek } from "../lib/format";
import { playerOf } from "../lib/player";
import { PlayerName } from "./player-peek";

export interface RoomArrivalCardProps {
  readonly leagueId: string;
  /** `home.draftId` — null only in the never-true case every other reader guards defensively. */
  readonly draftId: string | null;
  readonly lineup: LineupBody;
  readonly matchup: MatchupSummary | null;
  /** The projected line the stage already computes for the next-matchup pulse panel — stated
   *  here too, or omitted when the week's projection snapshot is empty. */
  readonly projectedLine: string | null;
}

function matchupHeadline(matchup: MatchupSummary): string {
  return `${formatWeek(matchup.weekNumber)} · ${matchup.homeTeamName} vs ${matchup.awayTeamName}`;
}

/**
 * THE ARRIVAL MOMENT, restored (branch review, HIGH 1). The draft room's last moment used to be
 * a room emptying out; this is what a manager sees on their first week-1 visit instead: the
 * fifteen players `commitDraftResults` wrote to their roster, drawn as players, and the week-1
 * opponent the same transaction scheduled. Dealt as the TOP CARD of the stage for
 * `currentWeek === 1` only — not a stage kind of its own, so a live Sunday still outranks it
 * (law 1) and the ordinary cards still ride beneath it.
 */
export function RoomArrivalCard({ leagueId, draftId, lineup, matchup, projectedLine }: RoomArrivalCardProps) {
  const roster = [...lineup.starters, ...lineup.bench].filter((slot) => slot.playerId !== null);
  return (
    <Card as="section" interactive data-testid="draft-complete-arrival" aria-label="Your draft is in the books" className="flex flex-col gap-3 border-accent">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <h2 className={EYEBROW}>Your draft is in the books</h2>
        {matchup === null ? null : (
          <span className="text-sm text-text-muted">
            {matchupHeadline(matchup)}
            {projectedLine === null ? "" : ` · ${projectedLine}`}
          </span>
        )}
      </div>
      {/* Law 3: the players a manager just drafted, drawn as players — faces and stickers,
          never fifteen strings. */}
      <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {roster.map((slot) => {
          const player = playerOf(slot);
          return (
            <li key={`${slot.slot}:${slot.slotIndex}`} className="flex min-w-0 items-center gap-2 text-sm text-text-primary">
              {player === null ? null : <PlayerFace player={player} size="sm" />}
              {player === null ? (
                <span className="truncate">{slot.playerName}</span>
              ) : (
                <PlayerName leagueId={leagueId} playerId={player.id} name={slot.playerName ?? player.name} className="truncate" />
              )}
              {player === null ? null : <PositionBadge position={player.position} size="sm" />}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        {matchup === null ? null : (
          <Link href={`/app/leagues/${leagueId}/matchups/${matchup.weekNumber}`} className="text-sm font-medium text-accent underline">
            See the matchup
          </Link>
        )}
        {draftId === null ? null : (
          <Link href={`/app/drafts/${draftId}`} className="text-sm font-medium text-accent underline">
            View the draft board
          </Link>
        )}
      </div>
    </Card>
  );
}
