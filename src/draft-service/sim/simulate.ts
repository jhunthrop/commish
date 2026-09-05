/**
 * THE SIMULATOR'S ONE ENTRY POINT — runs `config.runs` headless drafts (`run.ts`) and folds them
 * into the three outputs spec §5 names for a snake room: build classification finish rates, per-
 * pick survival odds, and an exposure report. Pure over its two arguments (`config`, the evidence
 * pool) and `Date.now` for the timing field alone — everything a caller needs to reproduce a
 * result byte-for-byte is `{config}` plus the pool it was called with, both already persisted
 * onto `sim_runs.config` by the caller (`persist.ts`).
 */
import { roundForPick, snakeTeamForPick, totalRosterSlots } from "@/draft-engine";
import { simBoardOrder, type SimRankableEntry } from "./board-order";
import { BUILD_LABELS, classifyBuild, type BuildLabel, type ClassifiablePick } from "./classify";
import { bestStartingLineupPoints } from "./lineup-score";
import { rngFor } from "@/mock-draft/rng";
import { runOneDraft } from "./run";
import type { BuildOutcome, ExposureRow, PickAvailabilityRow, SimConfig, SimPlayerEvidence, SimSummary } from "./types";

function teamIdsFor(teamCount: number): readonly string[] {
  return Array.from({ length: teamCount }, (_, i) => `seat_${i + 1}`);
}

/** The target seat's own pick numbers, purely from the schedule (never from any run's outcome):
 *  a snake draft's turn order is a fact of `teamCount`/`slot` alone. */
function targetPickNumbers(teamIds: readonly string[], targetTeamId: string, lastPick: number): readonly number[] {
  const numbers: number[] = [];
  for (let pickNumber = 1; pickNumber <= lastPick; pickNumber += 1) {
    if (snakeTeamForPick(teamIds, pickNumber) === targetTeamId) numbers.push(pickNumber);
  }
  return numbers;
}

/** `min(3, teamCount) / teamCount` — the top-3 finish rate a build with no real edge posts by
 *  arithmetic alone, never a measured or hand-picked number. */
function baselineTop3Rate(teamCount: number): number {
  return Math.min(3, teamCount) / teamCount;
}

export function simulateDrafts(config: SimConfig, pool: readonly SimPlayerEvidence[]): SimSummary {
  const startedAt = Date.now();
  const teamIds = teamIdsFor(config.teamCount);
  const targetTeamId = teamIds[config.slot - 1];
  if (targetTeamId === undefined) {
    throw new Error(`sim: slot ${config.slot} does not exist in a ${config.teamCount}-team league.`);
  }
  const requiredPool = config.teamCount * totalRosterSlots(config.rosterSlots);
  if (pool.length < requiredPool) {
    throw new Error(
      `sim: the evidence board carries ${pool.length} ranked players, fewer than the ${requiredPool} a full ${config.teamCount}-team, ${totalRosterSlots(config.rosterSlots)}-slot draft needs.`,
    );
  }

  const rankable: readonly SimRankableEntry[] = pool.map((entry) => ({
    playerId: entry.playerId,
    position: entry.position,
    evidenceRank: entry.evidenceRank,
    marketRank: entry.marketRank,
  }));
  const positionByPlayerId = new Map(pool.map((entry) => [entry.playerId, entry.position] as const));
  const pointsByPlayerId = new Map(pool.map((entry) => [entry.playerId, entry.projectedPoints] as const));
  const evidenceOrder = [...pool].sort((a, b) => a.evidenceRank - b.evidenceRank).map((entry) => entry.playerId);

  const lastPick = Math.min(config.rounds, totalRosterSlots(config.rosterSlots)) * config.teamCount;
  const pickNumbers = targetPickNumbers(teamIds, targetTeamId, lastPick);

  const buildRunCounts = new Map<BuildLabel, number>(BUILD_LABELS.map((label) => [label, 0] as const));
  const buildTop3Counts = new Map<BuildLabel, number>(BUILD_LABELS.map((label) => [label, 0] as const));
  const finishRanks: number[] = [];
  const exposureCounts = new Map<string, number>();
  /** pickNumber → (playerId → how many runs he was the evidence board's own best undrafted
   *  player at that exact pick). Exactly one entry gains a count per run per pick, so summing a
   *  pick's whole map always equals `config.runs`. */
  const bestAvailableCounts = new Map<number, Map<string, number>>(pickNumbers.map((n) => [n, new Map<string, number>()] as const));

  for (let i = 0; i < config.runs; i += 1) {
    const seed = config.seed + i;
    const board = simBoardOrder(rankable, config.sharpness, rngFor(seed, "board-order"));
    const result = runOneDraft({ teamIds, board, rosterSlots: config.rosterSlots, rounds: config.rounds, seed });

    const sortedPicks = [...result.picks].sort((a, b) => a.pickNumber - b.pickNumber);
    const drafted = new Set<string>();
    let cursor = 0;
    for (const pickNumber of pickNumbers) {
      while (cursor < sortedPicks.length && sortedPicks[cursor]!.pickNumber < pickNumber) {
        drafted.add(sortedPicks[cursor]!.playerId);
        cursor += 1;
      }
      const bestAvailable = evidenceOrder.find((playerId) => !drafted.has(playerId));
      if (bestAvailable !== undefined) {
        const counts = bestAvailableCounts.get(pickNumber)!;
        counts.set(bestAvailable, (counts.get(bestAvailable) ?? 0) + 1);
      }
    }

    const targetPicks: ClassifiablePick[] = result.picks
      .filter((pick) => pick.teamId === targetTeamId)
      .map((pick) => ({ round: pick.round, position: positionByPlayerId.get(pick.playerId)! }));
    const labels = classifyBuild(targetPicks);
    for (const label of labels) buildRunCounts.set(label, (buildRunCounts.get(label) ?? 0) + 1);

    const finishRank = rankFinish(result.rosters, targetTeamId, config.rosterSlots, pointsByPlayerId);
    finishRanks.push(finishRank);
    if (finishRank <= 3) for (const label of labels) buildTop3Counts.set(label, (buildTop3Counts.get(label) ?? 0) + 1);

    for (const player of result.rosters[targetTeamId] ?? []) {
      exposureCounts.set(player.playerId, (exposureCounts.get(player.playerId) ?? 0) + 1);
    }
  }

  const availability: readonly PickAvailabilityRow[] = pickNumbers.map((pickNumber) => {
    const counts = bestAvailableCounts.get(pickNumber)!;
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const modal = ranked[0];
    if (modal === undefined) {
      return { pickNumber, round: roundForPick(config.teamCount, pickNumber), expectedBestAvailable: null, survivalRate: 0, fallbacks: [] };
    }
    const [modalPlayerId, survivedCount] = modal;
    return {
      pickNumber,
      round: roundForPick(config.teamCount, pickNumber),
      expectedBestAvailable: { playerId: modalPlayerId, position: positionByPlayerId.get(modalPlayerId)! },
      survivalRate: config.runs === 0 ? 0 : survivedCount / config.runs,
      fallbacks: ranked
        .slice(1, 4)
        .map(([playerId, runs]) => ({ playerId, position: positionByPlayerId.get(playerId)!, runs })),
    };
  });

  const builds: readonly BuildOutcome[] = BUILD_LABELS.map((label) => {
    const runsWithLabel = buildRunCounts.get(label) ?? 0;
    const top3 = buildTop3Counts.get(label) ?? 0;
    return { label, runsWithLabel, top3FinishRate: runsWithLabel === 0 ? 0 : top3 / runsWithLabel };
  });

  const exposure: readonly ExposureRow[] = [...exposureCounts.entries()]
    .map(([playerId, count]): ExposureRow => ({ playerId, position: positionByPlayerId.get(playerId)!, rosterShare: config.runs === 0 ? 0 : count / config.runs }))
    .sort((a, b) => b.rosterShare - a.rosterShare || a.playerId.localeCompare(b.playerId));

  const meanFinishRank = finishRanks.length === 0 ? 0 : finishRanks.reduce((sum, rank) => sum + rank, 0) / finishRanks.length;

  return {
    runs: config.runs,
    teamCount: config.teamCount,
    slot: config.slot,
    rounds: config.rounds,
    baselineTop3Rate: baselineTop3Rate(config.teamCount),
    builds,
    availability,
    exposure,
    meanFinishRank,
    elapsedMs: Date.now() - startedAt,
  };
}

function rankFinish(
  rosters: Readonly<Record<string, readonly { readonly playerId: string; readonly position: string }[]>>,
  targetTeamId: string,
  rosterSlots: SimConfig["rosterSlots"],
  pointsByPlayerId: ReadonlyMap<string, number>,
): number {
  const scores = Object.entries(rosters)
    .map(([teamId, roster]) => ({ teamId, score: bestStartingLineupPoints(roster, rosterSlots, pointsByPlayerId) }))
    .sort((a, b) => b.score - a.score || a.teamId.localeCompare(b.teamId));
  const index = scores.findIndex((row) => row.teamId === targetTeamId);
  return index === -1 ? scores.length : index + 1;
}
