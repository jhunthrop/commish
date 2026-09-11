"use client";

import type { MatchupSummary } from "../contract";
import { Celebration } from "@/components/ui";
import { useTransientVisibility } from "@/design/use-transient-visibility";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { formatPoints, formatWeek } from "../lib/format";
import type { ManagersByTeamId } from "../lib/managers";

export interface MatchupCelebrationProps {
  readonly matchup: MatchupSummary | null;
  readonly myTeamId: string | null;
  /** Server-computed (`clinchedTeamIds`). Never derived here. */
  readonly clinched: boolean;
  /** The league's own name, printed on the frame. Without it the card is a moment with no league
   *  attached, which is the half of P8's test ("does it say which league and who") that a
   *  screenshot in a group text actually needs. */
  readonly leagueName?: string;
  /** Every team's manager (`managersFrom`): the two faces on the frame. */
  readonly managers?: ManagersByTeamId;
  /** When it happened, already worded. The frame's fourth fact. */
  readonly date?: string;
}

/**
 * THE LEAGUE'S OWN MOMENT: your matchup flipped to a win, or you clinched a playoff spot.
 *
 * A FRAME, NOT A SHOUT (P8, Sideline 2026-09-10). This used to be a title and a score: *"You won
 * in Week 14!"* over *"118.40 to 96.20"*, with no league name, no people and no date on it — a
 * banner that said something happened and could not survive being screenshotted, which is the
 * exact failure P8's test is written to catch ("is it something you would send? does it say which
 * league and who?"). It now fills every slot `Celebration` has: the league at the top, the two
 * managers as faces, the winning score as the figure with its basis, and the date. The clinch
 * carries the same frame with the fact that earned it in the figure (P9: progress is real or it is
 * not shown), which is why a clinch with no score to point at prints its week instead of a number.
 *
 * Same component as the draft's pick-landing, so there is one entrance and one reduced-motion
 * branch to maintain rather than two.
 */
export function MatchupCelebration({ matchup, myTeamId, clinched, leagueName, managers, date }: MatchupCelebrationProps) {
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

  const iAmHome = matchup.homeTeamId === myTeamId;
  const mineScore = iAmHome ? matchup.homeScore : matchup.awayScore;
  const theirScore = iAmHome ? matchup.awayScore : matchup.homeScore;
  const theirTeamId = iAmHome ? matchup.awayTeamId : matchup.homeTeamId;

  // THE PEOPLE. You first, because it is your moment, then the manager you beat. A frame with no
  // managers threaded renders no faces at all rather than initials standing in for somebody.
  const mine = myTeamId === null ? undefined : managers?.[myTeamId];
  const theirs = managers?.[theirTeamId];
  const people = [
    ...(mine === undefined ? [] : [{ name: mine.name, avatar: mine.avatar }]),
    ...(won && theirs !== undefined ? [{ name: theirs.name, avatar: theirs.avatar }] : []),
  ];

  return (
    // Keyed like PickCelebration: a different week's result remounts and replays the entrance.
    <Celebration
      key={key}
      testId="matchup-celebration"
      emphasis="self"
      leagueName={leagueName}
      people={people.length === 0 ? undefined : people}
      title={won ? `You won in ${formatWeek(matchup.weekNumber)}` : "You are in the playoffs"}
      detail={won && theirs !== undefined ? `over ${theirs.name}` : won ? undefined : "You clinched a spot"}
      figure={
        won && mineScore !== null && theirScore !== null
          ? { value: formatPoints(mineScore), basis: `PPR, against ${formatPoints(theirScore)}` }
          : { value: String(matchup.weekNumber), basis: "the week you clinched in" }
      }
      date={date}
    />
  );
}
