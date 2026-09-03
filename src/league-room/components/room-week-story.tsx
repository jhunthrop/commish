import Link from "next/link";
import { Card } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { LeagueHomeBody, MatchupDetail } from "../contract";
import { formatPoints, formatRecord, ordinal } from "../lib/format";
import type { WeekStory } from "../lib/week-story";

export interface RoomWeekStoryProps {
  readonly home: LeagueHomeBody;
  readonly story: WeekStory;
  /** The viewer's opponent this week — the matchup branch's headline, computed by the stage. */
  readonly opponentName: string | null;
  /** "projected 124.8 to 121.2, your favor" — the stage's own projection sentence, or null. */
  readonly projectedLine: string | null;
}

/** This week's real pairings, each tappable to the week's matchup route. Real pairings only —
 *  every name and score is off the same `matchupWeek` read the league already has. */
function PairingList({ leagueId, weekNumber, matchups }: { readonly leagueId: string; readonly weekNumber: number; readonly matchups: readonly MatchupDetail[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {matchups.map((matchup) => (
        <li key={`${matchup.home.teamId}-${matchup.away.teamId}`}>
          <Link
            href={`/app/leagues/${leagueId}/matchups/${weekNumber}`}
            className="flex items-baseline gap-2 text-sm text-text-primary hover:text-accent"
          >
            <span className="min-w-0 truncate">
              {matchup.home.teamName} vs {matchup.away.teamName}
            </span>
            {matchup.home.score !== null && matchup.away.score !== null ? (
              <span className="ml-auto shrink-0 font-mono text-text-muted">
                {formatPoints(matchup.home.score)} to {formatPoints(matchup.away.score)}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * THE WEEK STORY CARD — the pulse's matchup seat, in whichever of its states the stored data can
 * prove (founder defect, 2026-09-03: "No matchup this week." explained nothing to a manager whose
 * playoffs were on without them). The season-wrap state is `room-arrival-card.tsx`'s bookend:
 * the arrival card opens the season with the roster the draft wrote; this closes it with the
 * finish the results wrote. Null is absent throughout — a line the data cannot back is omitted,
 * never guessed at.
 */
export function RoomWeekStory({ home, story, opponentName, projectedLine }: RoomWeekStoryProps) {
  const myRow = home.standings.find((row) => row.teamId === home.myTeamId) ?? null;
  const finishFacts = myRow === null ? null : `${formatRecord(myRow)}, ${ordinal(myRow.rank)} of ${home.standings.length}`;
  const leader = home.standings[0] ?? null;

  if (story.kind === "matchup") {
    return (
      <Card padding="compact" className="flex flex-col gap-1.5">
        <p className={`${MICRO_LABEL} text-text-faint`}>Your next matchup</p>
        <p className="font-display text-md font-semibold text-text-primary">vs {opponentName}</p>
        {projectedLine === null ? null : <p className="font-mono text-sm text-text-muted">{projectedLine}</p>}
        <Link href={`/app/leagues/${home.leagueId}/matchups/${home.currentWeek}`} className="mt-auto text-xs text-accent">
          Full matchup
        </Link>
      </Card>
    );
  }

  if (story.kind === "playoffs-out") {
    return (
      <Card padding="compact" className="flex flex-col gap-1.5">
        <p className={`${MICRO_LABEL} text-text-faint`}>The playoffs</p>
        {finishFacts === null ? null : (
          <p className="font-display text-md font-semibold text-text-primary">Your season is in the books: {finishFacts}.</p>
        )}
        <p className="text-sm text-text-muted">{story.roundLabel} this week:</p>
        <PairingList leagueId={home.leagueId} weekNumber={story.weekNumber} matchups={story.matchups} />
      </Card>
    );
  }

  if (story.kind === "season-over") {
    return (
      <Card padding="compact" className="flex flex-col gap-1.5">
        <p className={`${MICRO_LABEL} text-text-faint`}>The season is in the books</p>
        {story.champion !== null ? (
          <p className="font-display text-md font-semibold text-text-primary">{story.champion} won the championship.</p>
        ) : leader !== null ? (
          <p className="font-display text-md font-semibold text-text-primary">{leader.teamName} finished first.</p>
        ) : null}
        {finishFacts === null ? null : <p className="text-sm text-text-muted">You finished {finishFacts}.</p>}
        <Link href={`/app/leagues/${home.leagueId}/matchups/${story.finalWeek}`} className="mt-auto text-xs text-accent">
          See the final week
        </Link>
      </Card>
    );
  }

  if (story.kind === "quiet-week") {
    return (
      <Card padding="compact" className="flex flex-col gap-1.5">
        <p className={`${MICRO_LABEL} text-text-faint`}>This week&apos;s matchups</p>
        {home.myTeamId === null ? null : <p className="text-sm text-text-muted">No matchup for your team this week.</p>}
        <PairingList leagueId={home.leagueId} weekNumber={story.weekNumber} matchups={story.matchups} />
      </Card>
    );
  }

  // `none` — nothing loaded to say more (no slate at all). The honest minimum, stated plainly.
  return (
    <Card padding="compact" className="flex flex-col gap-1.5">
      <p className={`${MICRO_LABEL} text-text-faint`}>Your next matchup</p>
      <p className="text-sm text-text-muted">No matchup this week.</p>
    </Card>
  );
}
