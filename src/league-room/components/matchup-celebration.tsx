"use client";

import type { MatchupSummary } from "../contract";
import { Celebration } from "@/components/ui";
import { useTransientVisibility } from "@/design/use-transient-visibility";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { formatPoints, formatWeek } from "../lib/format";

export interface MatchupCelebrationProps {
  readonly matchup: MatchupSummary | null;
  readonly myTeamId: string | null;
  /** Server-computed (`clinchedTeamIds`). Never derived here. */
  readonly clinched: boolean;
}

/**
 * The league's own moment: your matchup flipped to a win, or you clinched a playoff spot.
 * The same `Celebration` the draft's pick-landing uses — one component, two callers, and one
 * reduced-motion branch to maintain instead of two.
 */
export function MatchupCelebration({ matchup, myTeamId, clinched }: MatchupCelebrationProps) {
  const won =
    matchup !== null &&
    myTeamId !== null &&
    matchup.final &&
    matchup.homeScore !== null &&
    matchup.awayScore !== null &&
    ((matchup.homeTeamId === myTeamId && matchup.homeScore > matchup.awayScore) ||
      (matchup.awayTeamId === myTeamId && matchup.awayScore > matchup.homeScore));

  const show = won || (clinched && myTeamId !== null);
  const key = show && matchup !== null ? `${matchup.weekNumber}:${won ? "won" : "clinched"}` : null;
  const visible = useTransientVisibility(key, LEAGUE_ROOM_CONFIG.celebrationMs);
  if (!show || matchup === null || !visible) return null;

  const mineScore = matchup.homeTeamId === myTeamId ? matchup.homeScore : matchup.awayScore;
  const theirScore = matchup.homeTeamId === myTeamId ? matchup.awayScore : matchup.homeScore;

  return (
    // Keyed like PickCelebration: a different week's result remounts and replays the entrance.
    <Celebration
      key={key}
      testId="matchup-celebration"
      emphasis="self"
      title={won ? `You won in ${formatWeek(matchup.weekNumber)}!` : "You've clinched a playoff spot!"}
      detail={
        won && mineScore !== null && theirScore !== null ? `${formatPoints(mineScore)} to ${formatPoints(theirScore)}` : undefined
      }
    />
  );
}
