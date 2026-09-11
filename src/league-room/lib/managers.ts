import type { TeamStandingsRow } from "../contract";

/**
 * A manager, keyed by the team they run.
 *
 * P1 says the person comes before the number and that a manager row never leads with a team name
 * alone, and `MatchupSide` carries a team name with nobody attached. Every week surface therefore
 * needs this join, and every one of them can make it for free: `leagueHome` is already read for
 * membership, and its standings carry each owner's display name, avatar and record. One shape, one
 * builder, so the three surfaces that do it cannot disagree about how a record is spelled.
 */
export interface ManagerIdentity {
  readonly name: string;
  readonly avatar: string | null;
  /** "9-4", "7-6-1". Ties only appear when a league has one. */
  readonly record: string;
}

export type ManagersByTeamId = Readonly<Record<string, ManagerIdentity>>;

/** Every team's manager, from the standings read the page already makes. */
export function managersFrom(standings: readonly TeamStandingsRow[]): ManagersByTeamId {
  return Object.fromEntries(
    standings.map((row) => [
      row.teamId,
      { name: row.ownerDisplayName, avatar: row.ownerAvatar, record: `${row.wins}-${row.losses}${row.ties > 0 ? `-${row.ties}` : ""}` },
    ]),
  );
}
