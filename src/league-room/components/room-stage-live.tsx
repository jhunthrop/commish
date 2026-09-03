"use client";

import Link from "next/link";
import { Card } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { positionStickerClass } from "@/components/ui/position-badge";
import type { FixtureLabel } from "@/league-service/nfl-schedule";
import type { MatchupDetail, MatchupLineupEntry, MatchupSide, MatchupWeekBody } from "../contract";
import { useLiveScores } from "../hooks/use-live-scores";
import { formatPoints } from "../lib/format";
import { remainingToPlay } from "../lib/matchup-facts";

export interface RoomStageLiveProps {
  readonly leagueId: string;
  readonly week: MatchupWeekBody;
  readonly myMatchupDetail: MatchupDetail;
  readonly myTeamId: string;
  readonly fixturesByNflTeam: ReadonlyMap<string, FixtureLabel>;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
}

interface SwingPair {
  readonly mine: MatchupLineupEntry;
  readonly theirs: MatchupLineupEntry;
  readonly gap: number;
}

/** The highest-projected starter on each side who has not scored yet — the honest "what
 *  decides it from here" this product can compute (current-week projections, nothing invented). */
function swingPair(
  mine: MatchupSide,
  theirs: MatchupSide,
  projections: ReadonlyMap<string, number>,
): SwingPair | null {
  if (projections.size === 0) return null;
  const best = (side: MatchupSide): MatchupLineupEntry | null => {
    let top: MatchupLineupEntry | null = null;
    let topProjection = Number.NEGATIVE_INFINITY;
    for (const entry of side.starters) {
      if (entry.playerId === null || entry.points !== null) continue;
      const projection = projections.get(entry.playerId);
      if (projection === undefined || projection <= topProjection) continue;
      top = entry;
      topProjection = projection;
    }
    return top;
  };
  const myBest = best(mine);
  const theirBest = best(theirs);
  if (myBest === null || theirBest === null || myBest.playerId === null || theirBest.playerId === null) return null;
  return {
    mine: myBest,
    theirs: theirBest,
    gap: (projections.get(myBest.playerId) ?? 0) - (projections.get(theirBest.playerId) ?? 0),
  };
}

function initialScores(week: MatchupWeekBody): readonly { readonly teamId: string; readonly points: number }[] {
  return week.matchups.flatMap((matchup) => [
    ...(matchup.home.score === null ? [] : [{ teamId: matchup.home.teamId, points: matchup.home.score }]),
    ...(matchup.away.score === null ? [] : [{ teamId: matchup.away.teamId, points: matchup.away.score }]),
  ]);
}

function PlayerRow({
  entry,
  mine,
  fixture,
  projection,
}: {
  readonly entry: MatchupLineupEntry;
  readonly mine: boolean;
  readonly fixture: FixtureLabel | null;
  readonly projection: number | null;
}) {
  const live = fixture?.status === "in_progress";
  const waiting = entry.points === null;
  return (
    <div className={`flex items-center gap-2 rounded-sm px-2 py-1 ${waiting ? "opacity-70" : ""}`}>
      {entry.position === null ? (
        <span className="h-6 w-7 rounded-sm border border-line" aria-hidden />
      ) : (
        <span
          className={`flex h-6 w-7 items-center justify-center rounded-sm font-display text-[10px] font-semibold ${positionStickerClass(entry.position)}`}
        >
          {entry.position}
        </span>
      )}
      <span className="min-w-0 truncate font-display text-sm font-semibold text-text-primary">
        {entry.playerName ?? "Empty slot"}
      </span>
      {live ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-live" aria-label="playing now" /> : null}
      {waiting && fixture !== null ? <span className="font-mono text-xs text-text-faint">{fixture.when}</span> : null}
      {waiting ? (
        <span className="ml-auto font-mono text-sm text-text-faint">
          {projection === null ? "·" : `proj ${projection.toFixed(1)}`}
        </span>
      ) : (
        <span className={`ml-auto font-mono text-sm font-medium ${mine ? "text-text-primary" : "text-text-muted"}`}>
          {formatPoints(entry.points ?? 0)}
        </span>
      )}
    </div>
  );
}

/**
 * SUNDAY'S STAGE — law 1's first rung. The margin is the protagonist; both lineups head to head
 * with per-player points as the worker lands them; the swing named from real projections; the
 * rest of the league in one thin ticker. Live team totals ride the SSE stream via
 * `useLiveScores`; there is no projected final and no win probability anywhere on this surface,
 * because nothing in the platform computes one.
 */
export function RoomStageLive(props: RoomStageLiveProps) {
  const { leagueId, week, myMatchupDetail, myTeamId, fixturesByNflTeam, projectionsByPlayerId } = props;
  const live = useLiveScores(leagueId, {
    week: week.weekNumber,
    status: week.weekStatus,
    scores: initialScores(week),
    gamesFinal: week.gamesFinal,
    gamesTotal: week.gamesTotal,
  });

  const iAmHome = myMatchupDetail.home.teamId === myTeamId;
  const mySide = iAmHome ? myMatchupDetail.home : myMatchupDetail.away;
  const theirSide = iAmHome ? myMatchupDetail.away : myMatchupDetail.home;
  const myScore = live.scores.get(mySide.teamId) ?? mySide.score;
  const theirScore = live.scores.get(theirSide.teamId) ?? theirSide.score;
  const margin = myScore === null || theirScore === null ? null : myScore - theirScore;
  const myRemaining = remainingToPlay(mySide, live.status);
  const theirRemaining = remainingToPlay(theirSide, live.status);
  const swing = swingPair(mySide, theirSide, projectionsByPlayerId);
  const otherMatchups = week.matchups.filter(
    (matchup) => matchup.home.teamId !== myTeamId && matchup.away.teamId !== myTeamId,
  );

  const fixtureOf = (entry: MatchupLineupEntry): FixtureLabel | null =>
    entry.nflTeam === null ? null : (fixturesByNflTeam.get(entry.nflTeam) ?? null);
  const projectionOf = (entry: MatchupLineupEntry): number | null =>
    entry.playerId === null ? null : (projectionsByPlayerId.get(entry.playerId) ?? null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {/* The score block: the margin is the protagonist. */}
      <Card padding="compact" className="flex items-stretch gap-4 p-0">
        <div className="accent-wash flex flex-1 flex-col gap-0.5 border-r border-line p-3">
          <p className="font-display text-sm font-semibold text-accent">{mySide.teamName}</p>
          <p className="font-display text-display-sm font-semibold leading-none text-text-primary">
            {myScore === null ? "·" : formatPoints(myScore)}
          </p>
          <p className="font-mono text-xs text-text-muted">
            {myRemaining} {myRemaining === 1 ? "starter" : "starters"} still to play
          </p>
        </div>
        <div className="flex flex-col items-center justify-center gap-0.5 px-2 py-3">
          <p className={`${MICRO_LABEL} text-text-faint`}>{margin === null ? "Margin" : margin >= 0 ? "Your lead" : "Their lead"}</p>
          <p
            className={`font-display text-display-sm font-semibold leading-none ${
              margin === null ? "text-text-faint" : margin >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            {margin === null ? "·" : `${margin >= 0 ? "+" : ""}${formatPoints(margin)}`}
          </p>
          <p className="font-mono text-xs text-text-faint">
            {live.gamesFinal} of {live.gamesTotal} games final
          </p>
        </div>
        <div className="flex flex-1 flex-col items-end gap-0.5 p-3 text-right">
          <p className="font-display text-sm font-semibold text-text-muted">{theirSide.teamName}</p>
          <p className="font-display text-display-sm font-semibold leading-none text-text-muted">
            {theirScore === null ? "·" : formatPoints(theirScore)}
          </p>
          <p className="font-mono text-xs text-text-faint">
            {theirRemaining} {theirRemaining === 1 ? "starter" : "starters"} still to play
          </p>
        </div>
      </Card>

      {/* Both lineups, head to head. */}
      <div className="grid min-h-0 flex-1 content-start gap-3 md:grid-cols-2">
        <Card padding="compact" className="flex flex-col gap-0.5">
          <p className={`${MICRO_LABEL} text-accent`}>Yours</p>
          {mySide.starters.map((entry) => (
            <PlayerRow
              key={`${entry.slot}-${entry.slotIndex}`}
              entry={entry}
              mine
              fixture={fixtureOf(entry)}
              projection={projectionOf(entry)}
            />
          ))}
        </Card>
        <Card padding="compact" className="flex flex-col gap-0.5">
          <p className={`${MICRO_LABEL} text-text-faint`}>Theirs</p>
          {theirSide.starters.map((entry) => (
            <PlayerRow
              key={`${entry.slot}-${entry.slotIndex}`}
              entry={entry}
              mine={false}
              fixture={fixtureOf(entry)}
              projection={projectionOf(entry)}
            />
          ))}
        </Card>
      </div>

      {swing === null ? null : (
        <Card padding="compact" className="flex items-baseline gap-3">
          <span className={`${MICRO_LABEL} shrink-0 text-text-faint`}>The swing</span>
          <p className="text-sm text-text-muted">
            Still to come: your {swing.mine.playerName} against their {swing.theirs.playerName}, a{" "}
            {formatPoints(Math.abs(swing.gap))} point projected gap {swing.gap >= 0 ? "in your favor" : "their way"}.
          </p>
        </Card>
      )}

      {otherMatchups.length === 0 ? null : (
        <Card padding="compact" className="flex flex-wrap items-baseline gap-x-5 gap-y-1 bg-surface-inset">
          <span className={`${MICRO_LABEL} shrink-0 text-text-faint`}>Around the league</span>
          {otherMatchups.map((matchup) => (
            <Link
              key={`${matchup.home.teamId}-${matchup.away.teamId}`}
              href={`/app/leagues/${leagueId}/matchups/${week.weekNumber}`}
              className="flex items-baseline gap-1.5 text-sm hover:text-accent"
            >
              <span className="font-display font-semibold text-text-primary">{matchup.home.teamName}</span>
              <span className="font-mono text-text-muted">
                {formatPoints(live.scores.get(matchup.home.teamId) ?? matchup.home.score ?? 0)}
              </span>
              <span className="text-text-faint">·</span>
              <span className="font-display font-semibold text-text-muted">{matchup.away.teamName}</span>
              <span className="font-mono text-text-faint">
                {formatPoints(live.scores.get(matchup.away.teamId) ?? matchup.away.score ?? 0)}
              </span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
