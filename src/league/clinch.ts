import type { StandingsRow } from "./standings";

export interface ClinchInput {
  /** Ordered by `computeStandings` — best record first. */
  readonly standings: readonly StandingsRow[];
  /**
   * The most wins still reachable, over every week left in the season — GAMES, not weeks. Named
   * for what it holds rather than what usually produces it, the same correction
   * `maxDraftDaysFromCreation` already got in Plan D (renamed because it sometimes had to hold a
   * value measured from a different anchor than its name claimed): a league median game is worth
   * a second win every week, so a caller with the median toggle on must pass `weeksRemaining * 2`
   * here, never `weeksRemaining` itself — a parameter called `weeksRemaining` that must
   * sometimes hold games is exactly the silent wrongness that rename fixed once already.
   */
  readonly gamesRemaining: number;
  readonly playoffTeams: number;
}

/**
 * Who can no longer be caught for a playoff spot: a team clinches once its win total is
 * strictly greater than what the first team OUTSIDE the cut could reach by winning every
 * remaining game. Deliberately conservative — a team that could still be tied has not
 * clinched, because a tiebreaker is not a guarantee.
 */
export function clinchedTeamIds({ standings, gamesRemaining, playoffTeams }: ClinchInput): readonly string[] {
  const firstOut = standings[playoffTeams];
  // A league no bigger than the playoff field: everyone is in, whatever happens.
  if (firstOut === undefined) return standings.map((row) => row.teamId);
  const ceiling = firstOut.wins + gamesRemaining;
  return standings.slice(0, playoffTeams).filter((row) => row.wins > ceiling).map((row) => row.teamId);
}
