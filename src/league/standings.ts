import type { Matchup } from "@/domain/schedule";
import { roundPoints } from "@/scoring";
import { medianResultFor } from "./median";

export interface StandingsRow {
  readonly teamId: string;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
}

interface Tally {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** A tie is worth half a win — standard fantasy practice, and the reason a ties-blind sort
 *  (wins alone) can rank a worse record above a better one: 5-1-1 (5.5 win pct) must outrank
 *  5-2-0 (5.0), even though a wins-only comparison calls them equal. */
function winPct(row: StandingsRow): number {
  return row.wins + row.ties / 2;
}

/** Win pct first, then points for, then team id — a total order, so two clients never disagree. */
function byRecord(a: StandingsRow, b: StandingsRow): number {
  return winPct(b) - winPct(a) || b.pointsFor - a.pointsFor || a.teamId.localeCompare(b.teamId);
}

/** Folds one median result into a tally's record columns only — never `pointsFor`/`pointsAgainst`,
 *  because the median is not an opponent a team actually played against. */
function applyMedianResult(tally: Tally, score: number, median: number): void {
  const result = medianResultFor(score, median);
  if (result === "win") tally.wins += 1;
  else if (result === "loss") tally.losses += 1;
  else tally.ties += 1;
}

/**
 * Wins, losses, ties and both points columns, from finished matchups only. A matchup counts
 * once BOTH scores are present — a half-scored week is not a result, it is a bug in progress.
 *
 * `medianByWeek`, when given, adds a SECOND result to every team that played that week: its own
 * score against the week's league median, folded into the same `wins`/`losses`/`ties` columns
 * the head-to-head result uses — there is no second matchup row for it (the schema's FK/PK shape
 * has no room for a pseudo-opponent), so the median game's record lives entirely in this fold.
 * `pointsFor`/`pointsAgainst` are untouched by it: the median is not an opponent, so it earns no
 * points column of its own. A week absent from `medianByWeek` (the toggle is off, or the week
 * hasn't settled with a median yet) contributes no second result, identically to how a
 * half-scored matchup contributes no first one.
 */
export function computeStandings(input: {
  readonly teamIds: readonly string[];
  readonly matchups: readonly Matchup[];
  readonly medianByWeek?: ReadonlyMap<number, number>;
}): readonly StandingsRow[] {
  const tallies = new Map<string, Tally>(input.teamIds.map((teamId) => [teamId, { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }]));
  const medianByWeek = input.medianByWeek ?? new Map<number, number>();

  for (const matchup of input.matchups) {
    const { homeScore, awayScore } = matchup;
    if (homeScore === null || awayScore === null) continue;
    const home = tallies.get(matchup.homeTeamId);
    const away = tallies.get(matchup.awayTeamId);
    if (home === undefined || away === undefined) continue;
    home.pointsFor += homeScore;
    home.pointsAgainst += awayScore;
    away.pointsFor += awayScore;
    away.pointsAgainst += homeScore;
    if (homeScore > awayScore) {
      home.wins += 1;
      away.losses += 1;
    } else if (awayScore > homeScore) {
      away.wins += 1;
      home.losses += 1;
    } else {
      home.ties += 1;
      away.ties += 1;
    }

    const median = medianByWeek.get(matchup.weekNumber);
    if (median !== undefined) {
      applyMedianResult(home, homeScore, median);
      applyMedianResult(away, awayScore, median);
    }
  }

  return [...tallies.entries()]
    .map(([teamId, t]) => ({ teamId, wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: roundPoints(t.pointsFor), pointsAgainst: roundPoints(t.pointsAgainst) }))
    .sort(byRecord);
}
