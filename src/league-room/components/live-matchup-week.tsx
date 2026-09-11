"use client";

import { useMemo } from "react";
import type { TeamScore } from "@/stats-pipeline/contract";
import { ButtonLink, EYEBROW, LowerThird, NOT_STARTED_DASH, signedPoints } from "@/components/ui";
import { useValueChangeHighlight } from "@/design/use-value-change-highlight";
import type { LeagueAct } from "@/lib/leagues/next-act";
import type { MatchupDetail, MatchupWeekBody } from "../contract";
import type { ManagersByTeamId } from "../lib/managers";
import { useLiveScores } from "../hooks/use-live-scores";
import { remainingToPlay, signedMargin, summaryOf } from "../lib/matchup-facts";
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
export function LiveMatchupWeek({ leagueId, body, records, managers, act = null }: {
  readonly leagueId: string;
  readonly body: MatchupWeekBody;
  /** Every team's manager (`managersFrom`), joined by the page from the standings read it already
   *  makes. P1: a week surface shows people, and `MatchupSide` carries a team name and nobody. */
  readonly managers?: ManagersByTeamId;
  /** Every team's win-loss-tie line, joined by the page from the standings read it already makes.
   *  Optional so a test that does not care renders exactly as before — the hero prints no record
   *  rather than a fabricated one. */
  readonly records?: RecordsByTeamId;
  /** The one act this league is waiting on, computed by the page (`leagueAct`, `@/lib/leagues/
   *  next-act`) because `nextAction` is a value import this room may not make. `null` is a real
   *  answer and renders no verb: law 6 gives the verb a place, not an obligation. */
  readonly act?: LeagueAct | null;
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

  // THE TWO VALUES SSE ACTUALLY MOVES ON THIS PAGE, and the only two that flash. `score.update`
  // carries team totals and the week's own games-final count, so the margin below is derived from
  // a number that genuinely changes under the reader and the games count changes directly. Every
  // per-player figure on this page is request-time (`foldLiveScore`'s own docblock), so the
  // yet-to-play counts are deliberately NOT wired to a highlight: arming a wash on a value that
  // cannot change is a promise of motion the data never keeps.
  const margin = lead === undefined ? null : signedMargin(summaryOf(lead), body.myTeamId);
  // `String`, not the number itself: the hook keys on a scalar and `null` is a real state here
  // (no score yet). Coercing it to a zero would flash the cell the instant the first score landed,
  // reporting a change from a number that never existed.
  const marginFlash = useValueChangeHighlight(String(margin));
  const gamesFlash = useValueChangeHighlight(live.gamesFinal);

  if (lead === undefined) return null;

  const myLeadSide = body.myTeamId === null ? null : lead.home.teamId === body.myTeamId ? lead.home : lead.away.teamId === body.myTeamId ? lead.away : null;
  const leftToPlay = myLeadSide === null ? null : remainingToPlay(myLeadSide, live.status);

  return (
    // `data-week` is a TEST CONTRACT: `useLiveScores` refuses a `score.update` frame for any week
    // but this one, and the fluidity spec has no other way to learn which week this page shows.
    <div data-testid="matchup-week" data-week={body.weekNumber} className="flex flex-col gap-4">
      {notice === null ? null : <p className="text-sm text-text-muted">{notice}</p>}

      <MatchupPanel
        leagueId={leagueId}
        matchup={lead}
        myTeamId={body.myTeamId}
        weekStatus={live.status}
        positionPoints={positionPoints}
        records={records}
        managers={managers}
        eyebrow={mineIndex === -1 ? "Matchup" : "Your matchup"}
      />

      {rest.length === 0 ? null : (
        <section aria-label="Around the league" className="flex flex-col gap-2">
          <h2 className={`${EYEBROW} text-text-muted`}>Around the league</h2>
          <MatchupStrip matchups={rest}>
            {(matchup) => <MatchupLineups leagueId={leagueId} matchup={matchup} myTeamId={body.myTeamId} positionPoints={positionPoints} managers={managers} />}
          </MatchupStrip>
        </section>
      )}

      {/*
        LAW 6 — THE MATCHUP'S LOWER THIRD. *"On a matchup it is the game state and the act the week
        is waiting on."* Four cells and one verb, left to right in the order a broadcast reads them:
        where the afternoon is, what state the week is in, the margin AS A DELTA, and how much of
        this manager's own lineup has yet to take the field.

        THE GAMES COUNT MOVED HERE from a `Pill` at the top of the page, which is a subtraction and
        not an addition: it was a lone chip floating above the hero, saying a week-wide fact in a
        place nothing else on the page belonged to. A strip across the foot is where a clock has
        always gone, and `clock` draws it at the hero size in the live ink for exactly the window
        it is still ticking.

        THE MARGIN IS UNTINTED, and that is the same refusal `Scoreboard` makes about the winning
        score, applied to the figure derived from it. A pair is not a population: a percentile
        inside a set of two is fully determined by who is ahead, so a one-point lead would wear a
        blowout's ink. The sign is printed, which is the channel that survives a monochrome screen.
      */}
      <LowerThird
        live={live.status === "in_progress"}
        cells={[
          ...(live.gamesTotal === 0
            ? []
            : [
                {
                  label: "Games final",
                  clock: live.status === "in_progress",
                  value: (
                    <span className={`transition-colors duration-500 ${gamesFlash ? "text-accent" : ""}`}>
                      {`${live.gamesFinal}/${live.gamesTotal}`}
                    </span>
                  ),
                },
              ]),
          { label: "Week", value: WEEK_STATE_WORD[live.status] },
          {
            label: mineIndex === -1 ? "Margin" : "Your margin",
            value: (
              <span className={`transition-colors duration-500 ${marginFlash ? "text-accent" : ""}`}>
                {margin === null ? NOT_STARTED_DASH : signedPoints(margin, 2)}
              </span>
            ),
          },
          ...(leftToPlay === null || leftToPlay === 0
            ? []
            : [{ label: "Still to play", value: <span className="text-live">{leftToPlay}</span> }]),
        ]}
        action={act === null ? undefined : <ButtonLink href={act.href} variant="verb" size="sm">{act.label}</ButtonLink>}
      />
    </div>
  );
}

/** The week's state in the words a scoreboard uses, not the enum's own. "In progress" is an
 *  administrative noun; a week that is happening now reads "Live" (the copy charter's own
 *  example). */
const WEEK_STATE_WORD: Readonly<Record<MatchupWeekBody["weekStatus"], string>> = {
  scheduled: "Not started",
  in_progress: "Live",
  final: "Final",
};
