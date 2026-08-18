import type { Matchup } from "@/domain/schedule";
import { roundPoints } from "@/scoring";

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

/** Wins first, then points for, then team id — a total order, so two clients never disagree. */
function byRecord(a: StandingsRow, b: StandingsRow): number {
  return b.wins - a.wins || b.pointsFor - a.pointsFor || a.teamId.localeCompare(b.teamId);
}

/**
 * Wins, losses, ties and both points columns, from finished matchups only. A matchup counts
 * once BOTH scores are present — a half-scored week is not a result, it is a bug in progress.
 */
export function computeStandings(input: { readonly teamIds: readonly string[]; readonly matchups: readonly Matchup[] }): readonly StandingsRow[] {
  const tallies = new Map<string, Tally>(input.teamIds.map((teamId) => [teamId, { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }]));

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
  }

  return [...tallies.entries()]
    .map(([teamId, t]) => ({ teamId, wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: roundPoints(t.pointsFor), pointsAgainst: roundPoints(t.pointsAgainst) }))
    .sort(byRecord);
}
