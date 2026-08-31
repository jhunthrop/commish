import { LEAGUE_CONFIG } from "./config";

/**
 * THE PLAYOFF BRACKET (engine-gap roadmap item 6, 2026-08-30) — pure pairing arithmetic, no IO.
 * Six seeds, three rounds, the incumbent-standard shape every arriving manager expects:
 *
 *   Round 1 (semifinal qualifiers): 3v6, 4v5 — seeds 1 and 2 are on BYE.
 *   Round 2 (semifinals): 1 vs the LOWEST surviving seed, 2 vs the other.
 *   Round 3 (championship): the two semifinal winners.
 *
 * Reseeding is the round-2 rule above (highest seed hosts the lowest survivor) — the
 * incumbent's "reseed" toggle default. Byes are structural: a bye team simply has no round-1
 * fixture, which every consumer already renders honestly as "no matchup this week".
 */

export interface PlayoffPairing {
  /** Home is always the better (lower) seed — the sport's own grammar. */
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

export interface SeededTeam {
  readonly teamId: string;
  /** 1 is best. Callers derive seeds from final regular-season standings (points-for breaks
   *  ties), which is the one ordering the product already computes. */
  readonly seed: number;
}

/** Round 1: 3v6 and 4v5; 1 and 2 rest. Refuses anything but exactly six seeds — the config's
 *  own `playoffTeams`; a different bracket size is a deliberate future change, never a guess. */
export function firstRoundPairings(seeds: readonly SeededTeam[]): readonly PlayoffPairing[] {
  if (seeds.length !== LEAGUE_CONFIG.playoffTeams) {
    throw new Error(`firstRoundPairings: expected exactly ${LEAGUE_CONFIG.playoffTeams} seeds, got ${seeds.length}.`);
  }
  const bySeed = new Map(seeds.map((team) => [team.seed, team.teamId]));
  for (let seed = 1; seed <= LEAGUE_CONFIG.playoffTeams; seed++) {
    if (!bySeed.has(seed)) throw new Error(`firstRoundPairings: seed ${seed} is missing.`);
  }
  return [
    { homeTeamId: bySeed.get(3)!, awayTeamId: bySeed.get(6)! },
    { homeTeamId: bySeed.get(4)!, awayTeamId: bySeed.get(5)! },
  ];
}

/** Round 2, reseeded: seed 1 hosts the LOWEST surviving winner, seed 2 hosts the other. */
export function semifinalPairings(
  seeds: readonly SeededTeam[],
  firstRoundWinners: readonly string[],
): readonly PlayoffPairing[] {
  if (firstRoundWinners.length !== 2) {
    throw new Error(`semifinalPairings: expected 2 first-round winners, got ${firstRoundWinners.length}.`);
  }
  const seedOf = new Map(seeds.map((team) => [team.teamId, team.seed]));
  const [betterWinner, worseWinner] = [...firstRoundWinners].sort((a, b) => (seedOf.get(a) ?? 99) - (seedOf.get(b) ?? 99));
  const bySeed = new Map(seeds.map((team) => [team.seed, team.teamId]));
  return [
    { homeTeamId: bySeed.get(1)!, awayTeamId: worseWinner! },
    { homeTeamId: bySeed.get(2)!, awayTeamId: betterWinner! },
  ];
}

/** The championship: better seed hosts. */
export function championshipPairing(seeds: readonly SeededTeam[], semifinalWinners: readonly string[]): PlayoffPairing {
  if (semifinalWinners.length !== 2) {
    throw new Error(`championshipPairing: expected 2 semifinal winners, got ${semifinalWinners.length}.`);
  }
  const seedOf = new Map(seeds.map((team) => [team.teamId, team.seed]));
  const [better, worse] = [...semifinalWinners].sort((a, b) => (seedOf.get(a) ?? 99) - (seedOf.get(b) ?? 99));
  return { homeTeamId: better!, awayTeamId: worse! };
}

/** Which playoff round a week is, or null for a regular-season week. Round 1 starts the week
 *  after the regular season ends. */
export function playoffRoundOf(weekNumber: number, regularSeasonWeeks: number): 1 | 2 | 3 | null {
  const offset = weekNumber - regularSeasonWeeks;
  return offset === 1 ? 1 : offset === 2 ? 2 : offset === 3 ? 3 : null;
}
