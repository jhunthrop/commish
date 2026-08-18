import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";

/**
 * The one place any room turns a `teamId`/`playerId` into the human it names. Both the draft
 * room and the league room build their map once with `teamsById`/`playersById` and read
 * through `teamName`/`playerName` rather than re-declaring a `.find(...)` closure per
 * component — the DRY violation a second room repeating this pattern would otherwise be.
 */
export function teamsById(teams: readonly TeamCard[]): ReadonlyMap<string, TeamCard> {
  return new Map(teams.map((team) => [team.id, team]));
}

/** `teamsById`'s counterpart for the player dictionary — built once per render and shared by
 *  every component below it that needs a `playerId` → `Player` lookup, instead of each one
 *  re-declaring its own `new Map(...)` memo. */
export function playersById(players: readonly Player[]): ReadonlyMap<string, Player> {
  return new Map(players.map((player) => [player.id, player]));
}

/** A team's display name, or `fallback` (default: the id itself) when the roster doesn't list it. */
export function teamName(byId: ReadonlyMap<string, TeamCard>, teamId: string, fallback: string = teamId): string {
  return byId.get(teamId)?.name ?? fallback;
}

/** A player's display name, or `fallback` (default: the id itself) when the pool doesn't list it. */
export function playerName(byId: ReadonlyMap<string, Player>, playerId: string, fallback: string = playerId): string {
  return byId.get(playerId)?.name ?? fallback;
}
