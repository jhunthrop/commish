import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";

/**
 * The one place a draft-room component turns a `teamId`/`playerId` into the human it names.
 * Every component that renders a team or player name (`ClockBanner`, `RosterBoard`,
 * `PickHistory`, and — from Task 7/9 on — `AuctionLotPanel`, `BudgetTable`, `TvBoard`) builds
 * its map once with `teamsById`/`playersById` and reads through `teamName`/`playerName`
 * rather than re-declaring a `.find(...)` closure per component.
 */
export function teamsById(teams: readonly TeamCard[]): ReadonlyMap<string, TeamCard> {
  return new Map(teams.map((team) => [team.id, team]));
}

/** A team's display name, or `fallback` (default: the id itself) when the roster doesn't list it. */
export function teamName(byId: ReadonlyMap<string, TeamCard>, teamId: string, fallback: string = teamId): string {
  return byId.get(teamId)?.name ?? fallback;
}

/** A player's display name, or `fallback` (default: the id itself) when the pool doesn't list it. */
export function playerName(byId: ReadonlyMap<string, Player>, playerId: string, fallback: string = playerId): string {
  return byId.get(playerId)?.name ?? fallback;
}
