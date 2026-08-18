import type { StandingsRow } from "./standings";

export interface ClinchInput {
  /** Ordered by `computeStandings` — best record first. */
  readonly standings: readonly StandingsRow[];
  readonly weeksRemaining: number;
  readonly playoffTeams: number;
}

/**
 * Who can no longer be caught for a playoff spot: a team clinches once its win total is
 * strictly greater than what the first team OUTSIDE the cut could reach by winning every
 * remaining week. Deliberately conservative — a team that could still be tied has not
 * clinched, because a tiebreaker is not a guarantee.
 */
export function clinchedTeamIds({ standings, weeksRemaining, playoffTeams }: ClinchInput): readonly string[] {
  const firstOut = standings[playoffTeams];
  // A league no bigger than the playoff field: everyone is in, whatever happens.
  if (firstOut === undefined) return standings.map((row) => row.teamId);
  const ceiling = firstOut.wins + weeksRemaining;
  return standings.slice(0, playoffTeams).filter((row) => row.wins > ceiling).map((row) => row.teamId);
}
