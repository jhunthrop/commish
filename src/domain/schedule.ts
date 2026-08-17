export interface Week {
  readonly leagueId: string;
  readonly weekNumber: number;
}

export interface Matchup {
  readonly leagueId: string;
  readonly weekNumber: number;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
}
