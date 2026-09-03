import type { LeagueHomeBody } from "../contract";
import { StandingsTable } from "./standings-table";

export interface RoomSurfaceStandingsProps {
  readonly home: LeagueHomeBody;
  readonly playoffTeams: number | null;
}

/** The standings surface at any drawer height — the same table the standings route serves. */
export function RoomSurfaceStandings({ home, playoffTeams }: RoomSurfaceStandingsProps) {
  return (
    <StandingsTable
      rows={home.standings}
      myTeamId={home.myTeamId}
      medianGame={home.medianGame}
      playoffTeams={playoffTeams ?? undefined}
    />
  );
}
