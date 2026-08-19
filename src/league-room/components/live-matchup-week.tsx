"use client";

import type { TeamScore } from "@/stats-pipeline/contract";
import type { MatchupDetail, MatchupWeekBody } from "../contract";
import { useLiveScores } from "../hooks/use-live-scores";
import { MatchupPanel } from "./matchup-panel";

/** The teams that already have a real score, home and away, across every matchup in the week.
 *  A side with no score yet (`null` — hasn't started) is left out, the same rule
 *  `useLiveScores`'s own refetch snapshot follows: "no live value yet" and "scored zero" are
 *  different facts, and coalescing the first into the second would show "0.00" for a matchup
 *  that hasn't kicked off. */
function initialScores(body: MatchupWeekBody): readonly TeamScore[] {
  return body.matchups.flatMap((matchup) => [
    ...(matchup.home.score === null ? [] : [{ teamId: matchup.home.teamId, points: matchup.home.score }]),
    ...(matchup.away.score === null ? [] : [{ teamId: matchup.away.teamId, points: matchup.away.score }]),
  ]);
}

/** `matchup`, with its score and `final` flag folded from the live map when the live layer has
 *  a value for that team — falling back to the server-rendered snapshot otherwise. Per-player
 *  starter/bench points are NOT folded: `score.update` only ever carries team totals
 *  (`ScoreUpdatePayload.scores`), never a per-player breakdown, so the roster tables below the
 *  scoreboard stay as they were at request time until the page is next reloaded. */
function foldLiveScore(matchup: MatchupDetail, scores: ReadonlyMap<string, number>, status: MatchupDetail["weekStatus"]): MatchupDetail {
  return {
    ...matchup,
    weekStatus: status,
    final: status === "final",
    home: { ...matchup.home, score: scores.get(matchup.home.teamId) ?? matchup.home.score },
    away: { ...matchup.away, score: scores.get(matchup.away.teamId) ?? matchup.away.score },
  };
}

/**
 * The live matchup surface itself: mounts `useLiveScores` ONCE for the whole week (one league
 * stream, one status, one score map — `score.update` is a per-league frame, not per-matchup) and
 * folds it over the server-rendered `body` before handing each matchup to `MatchupPanel`.
 *
 * A thin client boundary around an otherwise server-rendered page, the same shape
 * `MatchupWeekPage` (`src/app/app/leagues/[leagueId]/matchups/[week]/page.tsx`) already uses for
 * `MatchupPanel` itself: the page stays a Server Component (title, nav, the provider-driven
 * footer sentence), and only the part that actually moves is client-side.
 */
export function LiveMatchupWeek({ leagueId, body }: { readonly leagueId: string; readonly body: MatchupWeekBody }) {
  const live = useLiveScores(leagueId, {
    week: body.weekNumber,
    status: body.weekStatus,
    scores: initialScores(body),
  });

  return (
    <>
      {body.matchups.map((matchup) => (
        <MatchupPanel
          key={`${matchup.home.teamId}:${matchup.away.teamId}`}
          matchup={foldLiveScore(matchup, live.scores, live.status)}
          myTeamId={body.myTeamId}
          weekStatus={live.status}
        />
      ))}
    </>
  );
}
