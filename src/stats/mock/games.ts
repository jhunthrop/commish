import type { Player, StatLine } from "@research/domain/player";
import type { GameStatus, GameSummary } from "../provider";

/**
 * The mock dataset is a completed 2026 season: players and stat lines, no schedule. Rather than
 * committing a second fixture that could disagree with the stat lines, a week's fixtures are
 * DERIVED from them — the NFL teams that produced stats in that week, sorted and paired.
 *
 * This is not a real NFL schedule and does not pretend to be. It is a deterministic partition of
 * a week's players into fixtures, which is exactly the property every consumer of `listGames`
 * needs: a stable id, two disjoint teams, and the guarantee that every stat line in the week
 * belongs to exactly one of them.
 *
 * A team with an odd-one-out (an odd number of teams played in a week) is dropped from the game
 * list, and so are its stat lines, so the contract's "every line belongs to a listed game" case
 * holds rather than being papered over with a one-team fixture.
 */
export function deriveMockGames(week: number, players: readonly Player[], lines: readonly StatLine[], status: GameStatus): readonly GameSummary[] {
  const teamById = new Map(players.map((player) => [player.id, player.nflTeam]));
  const playing = [...new Set(lines.flatMap((line) => {
    const team = teamById.get(line.playerId);
    return team === undefined ? [] : [team];
  }))].sort();
  const games: GameSummary[] = [];
  for (let i = 0; i + 1 < playing.length; i += 2) {
    games.push({
      gameId: `mock-${week}-${playing[i]}-${playing[i + 1]}`,
      week,
      status,
      homeNflTeam: playing[i]!,
      awayNflTeam: playing[i + 1]!,
      // A derived fixture has no published kickoff, and this dataset does not invent one
      // (founder, 2026-08-30: "don't mock ANYTHING"). The real schedule comes from Tank01.
      gameDate: "",
      kickoffEt: "",
    });
  }
  return games;
}
