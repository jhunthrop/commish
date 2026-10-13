import { teamGamesIn, type GamesPlayedOutlook } from "./availability";
import type { BoardCandidate, BoardReason } from "./board";
import { isCappedRosterStatus, isExcludedRosterStatus, rosterStatusReason, type CurrentRosterStatus } from "./roster-status";

/**
 * WHAT THE BOARD DOES WITH A CURRENT ROSTER STATUS (founder report, 2026-09-08). Pure: takes the
 * candidates `preseasonCandidates` built and the statuses `roster-status-read.ts` read, and returns
 * the candidates the board may rank plus the players it may not.
 *
 * A RESERVE DESIGNATION CAPS HIS GAMES. Injured reserve, physically unable to perform, the
 * non-football injury list and a suspension all mean a stated minimum absence: a player on IR at
 * the cutdown misses at least four games, PUP and NFI the same four, and a suspension its stated
 * length — which no store this engine holds carries, so four stands for it too, and the reason on
 * the row names the status so a reader knows the cap is a floor on his absence, not a measurement
 * of it. The cap moves the games-played DISTRIBUTION, not just its mean (`capGamesOutlook`), so the
 * season band `game-variance.ts` composes off `probabilities` cannot keep a seventeen-game tail the
 * designation rules out. It never lowers the model's own floor: the availability model's tenth
 * percentile stands where it is higher than the cap, because a floor is a claim already made.
 *
 * AN OFF-ROSTER STATUS REMOVES HIM. A practice-squad player, a man listed with a club but off its
 * active roster, a free agent and a retired man have no projection: not a small one, none. He
 * leaves the candidates entirely and is returned in `exclusions` with his status, so the store
 * can keep him under a "Not on an active roster" band where a manager can still find him, and so
 * nothing downstream — the value order, the tiers, the advisor, autopick — ever sees him.
 *
 * UNKNOWN IS UNCHANGED. A player no source named this season is not in `statuses`, and this
 * function hands him back byte for byte. The report counts him; the board does not guess.
 */

/** The fewest games any reserve designation implies. See the module docblock. */
export const MINIMUM_ABSENCE_GAMES = 4;

export interface ExcludedCandidate {
  readonly playerId: string;
  readonly position: BoardCandidate["position"];
  readonly team: string;
  readonly status: CurrentRosterStatus;
}

export interface GatedCandidates {
  readonly candidates: readonly BoardCandidate[];
  readonly exclusions: readonly ExcludedCandidate[];
}

/**
 * The outlook with every game count above `cap` moved onto `cap`: the mass is kept, the mean and
 * the percentiles are recomputed from where it now sits. The floor protects the cap, never the
 * reverse. Returns the SAME object when nothing above the cap carries any claim, so an untouched
 * candidate is untouched by identity, not by value.
 */
export function capGamesOutlook(games: GamesPlayedOutlook, cap: number): GamesPlayedOutlook {
  const effectiveCap = Math.max(cap, games.distribution.floor);
  if (games.expected <= effectiveCap && games.distribution.ceiling <= effectiveCap) return games;

  const probabilities = games.probabilities.map((probability, count) => {
    if (count < effectiveCap) return probability;
    if (count > effectiveCap) return 0;
    return games.probabilities.slice(effectiveCap).reduce((sum, mass) => sum + mass, 0);
  });
  const expected = probabilities.reduce((sum, probability, count) => sum + probability * count, 0);
  const teamGames = probabilities.length - 1;
  return {
    expected,
    rate: teamGames > 0 ? expected / teamGames : 0,
    distribution: {
      floor: Math.min(games.distribution.floor, effectiveCap),
      median: Math.min(games.distribution.median, effectiveCap),
      ceiling: Math.min(games.distribution.ceiling, effectiveCap),
    },
    probabilities,
  };
}

/** The candidate's own `availability` reason restated from the capped outlook, every other reason
 *  kept in place, and the status reason appended so the row says why. */
function cappedReasons(reasons: readonly BoardReason[], games: GamesPlayedOutlook, status: CurrentRosterStatus): readonly BoardReason[] {
  const restated = reasons.map((reason): BoardReason =>
    reason.code === "availability"
      ? { code: "availability", expectedGames: games.expected, floorGames: games.distribution.floor, ceilingGames: games.distribution.ceiling }
      : reason,
  );
  return [...restated, rosterStatusReason(status)];
}

function cappedCandidate(candidate: BoardCandidate, status: CurrentRosterStatus, cap: number): BoardCandidate {
  const games = capGamesOutlook(candidate.games, cap);
  return { ...candidate, games, reasons: cappedReasons(candidate.reasons, games, status) };
}

/** The gate. See the module docblock for each of the three treatments. */
export function gateCandidates(
  candidates: readonly BoardCandidate[],
  statuses: ReadonlyMap<string, CurrentRosterStatus>,
  season: number,
): GatedCandidates {
  const cap = teamGamesIn(season) - MINIMUM_ABSENCE_GAMES;
  const kept: BoardCandidate[] = [];
  const exclusions: ExcludedCandidate[] = [];
  for (const candidate of candidates) {
    const status = statuses.get(candidate.playerId);
    if (status !== undefined && isExcludedRosterStatus(status.kind)) {
      exclusions.push({ playerId: candidate.playerId, position: candidate.position, team: candidate.team, status });
      continue;
    }
    kept.push(status !== undefined && isCappedRosterStatus(status.kind) ? cappedCandidate(candidate, status, cap) : candidate);
  }
  return { candidates: kept, exclusions };
}
