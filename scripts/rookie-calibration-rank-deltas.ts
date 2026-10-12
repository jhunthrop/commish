// Task 6 — READ-ONLY. Builds the CURRENT 2026 board and a reconstructed PRE-FIX 2026 board, both
// in memory, and reports the top-30 overall rank deltas so the founder can see exactly what moved.
// Run: npm run projections:rookie-calibration:rank-deltas
//
// WRITES NOTHING. Season 2026 is the LIVE season this board is currently serving
// (`board-store.ts`'s `BOARD_SOURCE`); `scripts/preseason-persist.ts`'s own docblock is explicit that
// a live re-take "replaces the board the product is serving... which is a deliberate act with a
// visible consequence, not something a no-argument archive-refresh run should do as a side effect."
// This script reads `loadPreseason`/`marketBoard` (both read-only) and never calls
// `writePreseasonBoard`, so it can report the real, current rank movement without touching the
// stored live generation. A real prod refresh of the 2026 live board is a SEPARATE, deliberate act
// (`npm run projections:preseason:persist -- 2026`, against the production database) — see this
// task's own final report for what that requires.
//
// THE PRODUCTION CONTROL (fix round 1): the controller runs `projections:preseason:persist -- 2026`
// against prod as part of the SAME ship sequence that merges this branch — a merge without that run
// serves stale numbers. That run, not this script, is what makes the fix visible in production.
import { createDb, type Db } from "@research/db/client";
import type { Clock } from "@research/domain/timing";
import { STAT_FIELDS, type Position, type StatLine } from "@research/domain/player";
import { PPR_SCORING } from "@research/domain/scoring";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research/domain/roster";
import type { LeagueShape } from "@research/projections/decide/replacement";
import { rookieCurve } from "@research/projections/preseason/rookie-curve";
import { preseasonBoard, type BoardCandidate, type BoardEntry } from "@research/projections/preseason/board";
import { loadShippedGameVariance } from "@research/projections/preseason/game-variance-artifacts";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@research/projections/preseason/fitted";
import { FITTED_MODEL } from "@research/projections/model/source";
import { marketBoard } from "@research/projections/market/curve";
import { shippedPreseasonCandidates } from "@research/projections/market/blend";
import {
  liveMomentFor,
  loadPreseason,
  preseasonCandidates,
  replayMomentFor,
  SHIPPED_PRESEASON_FEATURES,
  type BoardMoment,
  type PreseasonPriors,
} from "@research/projections/preseason/source";

const SEASON = 2026;
const SYSTEM_CLOCK: Clock = { now: () => new Date().toISOString() };

/** Identical to `preseason-persist.ts`'s own `boardMomentFor` — LIVE if the season's first kickoff
 *  is still ahead, REPLAY otherwise. Read-only either way: neither arm writes anything. */
async function boardMomentFor(db: Db, season: number, clock: Clock): Promise<BoardMoment> {
  try {
    return await liveMomentFor(db, season, clock);
  } catch (error: unknown) {
    if (error instanceof Error && /has already started/.test(error.message)) {
      return await replayMomentFor(db, season);
    }
    throw error;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:rookie-calibration:rank-deltas\`, which loads .env.local.`);
  }
  return value;
}

/** Identical table to `rookie-calibration-backtest.ts`'s own — see that script's own docblock for
 *  where it comes from. Duplicated rather than imported: that script's `main()` runs unconditionally
 *  on import (no `import.meta.url` guard), so importing it for one constant would also run its own
 *  DB-hitting backtest as a side effect. */
const PRE_FIX_ROOKIE_GAME_RATE: Record<Position, Record<string, number>> = {
  QB: { round1: 0.6558823529411764, round2: 0.2196078431372549, round3: 0.2196078431372549, rounds4to5: 0.20235294117647057, rounds6to7: 0.20235294117647057, undrafted: 0.16323529411764703 },
  RB: { round1: 0.47689075630252103, round2: 0.47689075630252103, round3: 0.47689075630252103, rounds4to5: 0.47689075630252103, rounds6to7: 0.47689075630252103, undrafted: 0.211484593837535 },
  WR: { round1: 0.7351086714635412, round2: 0.6321807411489185, round3: 0.6321807411489185, rounds4to5: 0.5019286403085824, rounds6to7: 0.3954676952748313, undrafted: 0.12377515786854137 },
  TE: { round1: 0.5922643029814666, round2: 0.5922643029814666, round3: 0.5922643029814666, rounds4to5: 0.5922643029814666, rounds6to7: 0.4719312382487242, undrafted: 0.16991173659651815 },
  K: { round1: 0, round2: 0, round3: 0, rounds4to5: 0, rounds6to7: 0, undrafted: 0 },
  DEF: { round1: 0, round2: 0, round3: 0, rounds4to5: 0, rounds6to7: 0, undrafted: 0 },
};

const SCORED: readonly Position[] = ["QB", "RB", "WR", "TE"];
const SLOTS: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter(
  (slot) => slot.slot === BENCH_SLOT || slot.eligiblePositions.every((position) => SCORED.includes(position)),
).map((slot) => ({ ...slot, eligiblePositions: slot.eligiblePositions.filter((position) => SCORED.includes(position)) }));
const SHAPE: LeagueShape = { teamCount: 12, rosterSlots: SLOTS };

const PRIORS: PreseasonPriors = {
  model: FITTED_MODEL,
  availability: FITTED_AVAILABILITY_PRIORS,
  rookies: FITTED_ROOKIE_PRIORS,
  depth: FITTED_DEPTH_PRIORS,
  career: FITTED_CAREER_PRIORS,
};

/** Overrides a listed rookie's `perGame` with the LITERAL pre-fix substitution formula: full
 *  substitution of `rookieCurve(pick)`, divided by THIS candidate's own (pre-fix) `games.expected`
 *  to fake a per-game rate — `market/blend.ts`'s exact pre-fix `pointsOnlyPerGame` call. Every
 *  non-rookie candidate, and every unlisted rookie, passes through unchanged: this reconstruction
 *  targets ONLY the branch this calibration round actually changed.
 */
function applyPreFixRookieSubstitution(candidates: readonly BoardCandidate[], marketByPlayer: ReadonlyMap<string, number>): readonly BoardCandidate[] {
  return candidates.map((candidate) => {
    const rookie = candidate.reasons.find((r): r is Extract<typeof r, { code: "rookie" }> => r.code === "rookie");
    if (rookie === null || rookie === undefined || rookie.overallPick === null) return candidate;
    if (!marketByPlayer.has(candidate.playerId)) return candidate; // unlisted: pre-fix left him alone too.
    const seasonPoints = rookieCurve(candidate.position, rookie.overallPick);
    const perGamePoints = candidate.games.expected > 0 ? seasonPoints / candidate.games.expected : 0;
    const zeroedPerGame: StatLine = {
      ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
      playerId: candidate.perGame.playerId,
      week: candidate.perGame.week,
      receivingYards: perGamePoints / PPR_SCORING.pointsPerReceivingYard,
    };
    return { ...candidate, perGame: zeroedPerGame };
  });
}

interface RankedEntry {
  readonly playerId: string;
  readonly position: Position;
  readonly rank: number;
  readonly projectedPoints: number;
}

function topRanks(board: readonly BoardEntry[], count: number): readonly RankedEntry[] {
  return board.slice(0, count).map((entry) => ({ playerId: entry.playerId, position: entry.position, rank: entry.rank, projectedPoints: entry.projectedPoints }));
}

async function main(): Promise<void> {
  const db: Db = createDb(requireEnv("DATABASE_URL"));

  const boardMoment = await boardMomentFor(db, SEASON, SYSTEM_CLOCK);
  const inputs = await loadPreseason(db, SEASON, { boardMoment });
  console.log(`${SEASON} board moment: ${inputs.momentKind}, asOf ${inputs.moment.toISOString()}`);

  const newCandidates = await shippedPreseasonCandidates(db, inputs, PRIORS, {});
  const gameVariance = await loadShippedGameVariance(db);
  const newBoard = preseasonBoard(newCandidates, { season: SEASON, asOf: inputs.moment, rules: PPR_SCORING, shape: SHAPE, gameVariance });

  const oldPriors: PreseasonPriors = { ...PRIORS, rookies: { ...PRIORS.rookies, gameRate: PRE_FIX_ROOKIE_GAME_RATE as never } };
  const oldRawCandidates = preseasonCandidates(inputs, SHIPPED_PRESEASON_FEATURES, oldPriors);
  const { entries: market } = await marketBoard(db, SEASON, inputs.moment);
  const marketByPlayer = new Map(market.map((entry) => [entry.playerId, entry.marketPoints] as const));
  // The non-rookie blend mechanism (admittedDelta/anchorPoints) was UNCHANGED by this calibration
  // round; only the rookie branch moved. Reusing the CURRENT `shippedPreseasonCandidates` internals
  // via `blendBoard` on the old-priors raw candidates gives the correct (unchanged) non-rookie
  // pricing, and `applyPreFixRookieSubstitution` then overwrites exactly the branch that changed.
  const { blendBoard } = await import("@research/projections/market/blend");
  const oldBlended = applyPreFixRookieSubstitution(blendBoard(market, oldRawCandidates, { season: SEASON }), marketByPlayer);
  const oldBoard = preseasonBoard(oldBlended, {
    season: SEASON,
    asOf: inputs.moment,
    rules: PPR_SCORING,
    shape: SHAPE,
    gameVariance: { rookie: { QB: 0, RB: 0, WR: 0, TE: 0 }, veteran: { QB: 0, RB: 0, WR: 0, TE: 0 } },
  });

  const oldRankByPlayer = new Map(oldBoard.map((entry) => [entry.playerId, entry] as const));
  const newTop30 = topRanks(newBoard, 30);

  console.log(`\n${SEASON} TOP-30 OVERALL: pre-fix rank -> current rank (delta), points then vs now`);
  console.log("rank | player | pos | old rank | delta | old pts | new pts");
  for (const entry of newTop30) {
    const old = oldRankByPlayer.get(entry.playerId);
    const oldRank = old?.rank ?? null;
    const delta = oldRank === null ? null : oldRank - entry.rank;
    console.log(
      `${String(entry.rank).padStart(4)} | ${entry.playerId.padEnd(10)} | ${entry.position.padEnd(3)} | ` +
        `${oldRank === null ? "n/a".padStart(8) : String(oldRank).padStart(8)} | ` +
        `${delta === null ? "n/a".padStart(5) : (delta >= 0 ? `+${delta}` : `${delta}`).padStart(5)} | ` +
        `${(old?.projectedPoints ?? 0).toFixed(1).padStart(7)} | ${entry.projectedPoints.toFixed(1).padStart(7)}`,
    );
  }

  const biggestMovers = [...newBoard]
    .map((entry) => {
      const old = oldRankByPlayer.get(entry.playerId);
      return { entry, oldRank: old?.rank ?? null, delta: old === undefined ? null : old.rank - entry.rank };
    })
    .filter((row) => row.delta !== null)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))
    .slice(0, 15);
  console.log(`\nBIGGEST MOVERS BOARD-WIDE (top 15 by |delta|):`);
  for (const row of biggestMovers) {
    console.log(`  ${row.entry.playerId} (${row.entry.position}): old rank ${row.oldRank} -> new rank ${row.entry.rank} (${row.delta! >= 0 ? "+" : ""}${row.delta})`);
  }

  // THE FOUNDER'S OWN NAMED CASE: the 2026 draft's pick-three running back (Player A).
  const newByPlayer = new Map(newBoard.map((entry) => [entry.playerId, entry] as const));
  console.log(`\nNAMED CASES:`);
  for (const playerId of ["00-0041027", "00-0041562"]) {
    const before = oldRankByPlayer.get(playerId);
    const after = newByPlayer.get(playerId);
    console.log(
      `  ${playerId}: old rank ${before?.rank ?? "n/a"} (${before?.projectedPoints.toFixed(1) ?? "n/a"} pts, floor ${before?.outlook.floor.toFixed(1) ?? "n/a"}-ceiling ${before?.outlook.ceiling.toFixed(1) ?? "n/a"}) ` +
        `-> new rank ${after?.rank ?? "n/a"} (${after?.projectedPoints.toFixed(1) ?? "n/a"} pts, floor ${after?.outlook.floor.toFixed(1) ?? "n/a"}-ceiling ${after?.outlook.ceiling.toFixed(1) ?? "n/a"})`,
    );
  }

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
