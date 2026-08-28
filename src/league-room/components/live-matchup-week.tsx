"use client";

import { useMemo } from "react";
import type { TeamScore } from "@/stats-pipeline/contract";
import { EYEBROW, Pill } from "@/components/ui";
import type { MatchupDetail, MatchupWeekBody } from "../contract";
import { useLiveScores } from "../hooks/use-live-scores";
import { startedPointsByPosition } from "../lib/population";
import type { RecordsByTeamId } from "./matchup-hero";
import { MatchupLineups, MatchupPanel } from "./matchup-panel";
import { MatchupStrip } from "./matchup-strip";

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

/** E3: the one honest sentence for a week that has kicked off but not finished — said ONCE for
 *  the whole page, not once per matchup panel (`gamesFinal`/`gamesTotal` are a week-wide fact,
 *  identical on every panel, so repeating it four or six times would be noise, not honesty).
 *  `null` outside `in_progress`: a scheduled week has no live stats to disclaim, and a final
 *  week's numbers already are final. */
function statsNotFinalNotice(status: MatchupWeekBody["weekStatus"]): string | null {
  return status === "in_progress" ? "These scores are live. They are not final until every game in the week ends." : null;
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

/** Whether this manager is playing in this matchup. `false` for every matchup when the viewer has
 *  no team here (a commissioner reading somebody else's league), which is why the page below falls
 *  back to leading with the first fixture rather than rendering no hero at all. */
function isMine(matchup: MatchupDetail, myTeamId: string | null): boolean {
  return myTeamId !== null && (matchup.home.teamId === myTeamId || matchup.away.teamId === myTeamId);
}

/**
 * THE WEEK, WITH THE MANAGER'S OWN GAME AT THE TOP OF IT.
 *
 * Before Gameday this page rendered six identical panels in fixture order, so a manager's own
 * matchup was — measured on the real seeded league — the fifth thing on a four-thousand-pixel
 * scroll, drawn at exactly the same weight as five games they have no stake in. That is a listing,
 * not a Sunday screen, and it is what the founder's *"I want it to feel like a sports app"* was
 * about.
 *
 * The order is a fact, not a preference: `myTeamId` is on the wire, so the page knows which
 * fixture is the reader's and leads with it at full weight (`MatchupPanel`, hero plus both
 * lineups). Everything else becomes one row each in `MatchupStrip`, with the lineups behind a
 * native disclosure so nothing that used to be on this page has left it. A viewer with no team in
 * this league has no "own" game to lead with, so the first fixture takes the hero and the label
 * stays "Matchup" — there is no second person to speak to and the page does not pretend there is.
 *
 * `gamesFinal`/`gamesTotal` are a WEEK-WIDE fact and are stated once, here, in the week's own
 * band. They used to be appended to a sentence inside every scoreboard, which printed "0 of 15
 * games final" six times on one screen for one fact.
 */
export function LiveMatchupWeek({ leagueId, body, records }: {
  readonly leagueId: string;
  readonly body: MatchupWeekBody;
  /** Every team's win-loss-tie line, joined by the page from the standings read it already makes.
   *  Optional so a test that does not care renders exactly as before — the hero prints no record
   *  rather than a fabricated one. */
  readonly records?: RecordsByTeamId;
}) {
  const live = useLiveScores(leagueId, {
    week: body.weekNumber,
    status: body.weekStatus,
    scores: initialScores(body),
    gamesFinal: body.gamesFinal,
    gamesTotal: body.gamesTotal,
  });
  const notice = statsNotFinalNotice(live.status);

  /**
   * THE HEAT MAP'S POPULATION (the fun pass, Task 9). This component is the only thing on the
   * route that can see every matchup at once, which is exactly what makes "starting quarterbacks
   * this week" a real population rather than a phrase — so the pool is built here, once, and
   * threaded down rather than recomputed inside each of six panels.
   *
   * Read off `body`, NOT off the live-folded matchups: `score.update` carries team totals only,
   * never a per-player breakdown (`foldLiveScore`'s own docblock), so the per-player numbers are
   * the request-time ones and the population they are ranked inside must be too.
   */
  const positionPoints = useMemo(() => startedPointsByPosition(body.matchups), [body.matchups]);

  const folded = body.matchups.map((matchup) => foldLiveScore(matchup, live.scores, live.status));
  const mineIndex = folded.findIndex((matchup) => isMine(matchup, body.myTeamId));
  const leadIndex = mineIndex === -1 ? 0 : mineIndex;
  const lead = folded[leadIndex];
  const rest = folded.filter((_, index) => index !== leadIndex);

  if (lead === undefined) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* The week's own progress, said once. A `Pill` because it is a figure inside a sentence,
            and `neutral` because a games-final count is a fact about the afternoon rather than
            something urgent — the live family is spent on the chips that mean "points can still
            arrive". `gamesTotal === 0` is a week with no `stat_weeks` row yet, which has nothing
            honest to say about how many of zero games are done. */}
        {live.gamesTotal === 0 ? null : <Pill>{`${live.gamesFinal} of ${live.gamesTotal} games final`}</Pill>}
        {notice === null ? null : <p className="text-sm text-text-muted">{notice}</p>}
      </div>

      <MatchupPanel
        matchup={lead}
        myTeamId={body.myTeamId}
        weekStatus={live.status}
        positionPoints={positionPoints}
        records={records}
        eyebrow={mineIndex === -1 ? "Matchup" : "Your matchup"}
      />

      {rest.length === 0 ? null : (
        <section aria-label="Around the league" className="flex flex-col gap-2">
          <h2 className={`${EYEBROW} text-text-muted`}>Around the league</h2>
          <MatchupStrip matchups={rest}>
            {(matchup) => <MatchupLineups matchup={matchup} myTeamId={body.myTeamId} positionPoints={positionPoints} />}
          </MatchupStrip>
        </section>
      )}
    </>
  );
}
