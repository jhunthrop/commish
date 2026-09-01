// Builds the shipped preseason board for one or more seasons and WRITES IT DOWN — the market-blended
// board, under BOARD_SOURCE (see board-store.ts's own docblock for its current value and the
// source-bump history behind it), AND the raw model board, under BOARD_SOURCE_V1_RAW (v1), so both
// halves of Task 11's own scorecard comparison stay addressable and CURRENT.
// Run: npm run projections:preseason:persist [season ...]   (defaults to every ingested season)
//
// THE SCRIPT THAT MAKES THE BOARD ADDRESSABLE. `preseason-report.ts` computes exactly this board
// and prints it; this one computes exactly this board and stores it. They must not diverge, so the
// league shape, the priors and the feature set are imported from the same places rather than
// restated, and the board is built by the same two calls in the same order.
//
// EVERY ROW CARRIES THE BOARD'S OWN MOMENT, which `loadPreseason` derives as one millisecond before
// the earliest thing the season would reveal and then asserts the store against. A run that could
// see the season it is projecting throws instead of writing, which is the only defence the engine
// has ever had against the thing that has already gone wrong twice.
//
// TWO SOURCES, EVERY RUN (C3 fix round, 2026-08-31). Before this fix round, this script wrote ONLY
// `BOARD_SOURCE` — and when Task 10 wired the market blend in without bumping that constant's own
// value, every re-run kept finding `preseason_projections` rows already present under the unchanged
// source (the unique key is `season, source, as_of`, and `as_of` never moves for a season once its
// board has been taken), so the blend's own point totals never actually reached the store: only its
// REASONS did (a different table, no `as_of`, always overwritten by a rerun) — leaving v1's own
// reasons quietly describing a blended board its own stored POINTS never became. This run restores
// that: v1 gets the RAW board's own reasons back (`shippedPreseasonCandidates`'s `{ raw: true }`
// seam), honest again; v2, a source with no prior rows, gets the blended board's projections AND
// reasons written for real, for the first time.
import { createDb, type Db } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import type { Position } from "@/domain/player";
import type { Clock } from "@/domain/timing";
import { nflPlayers } from "@/db/schema";
import type { LeagueShape } from "@/projections/decide/replacement";
import { shippedPreseasonCandidates } from "@/projections/market/blend";
import { preseasonBoard, type BoardEntry } from "@/projections/preseason/board";
import {
  BOARD_SOURCE,
  BOARD_SOURCE_V1_RAW,
  projectionRows,
  reasonRows,
  recordPreseasonBoardReasons,
  recordPreseasonProjections,
} from "@/projections/preseason/board-store";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@/projections/preseason/fitted";
import { FITTED_MODEL } from "@/projections/model/source";
import {
  liveMomentFor,
  loadPreseason,
  replayMomentFor,
  type BoardMoment,
  type PreseasonInputs,
  type PreseasonPriors,
} from "@/projections/preseason/source";

/** Every season the preseason ingestion has ever run for. A board needs three prior seasons of
 *  usage, which is why the floor is not the backfill's floor. 2026 joined this list the day its
 *  week-one rosters, depth charts and ADP landed (live-board plan, Task 4) — it builds through the
 *  LIVE arm below rather than the replay arm every prior season here still uses. */
const INGESTED_SEASONS = [2021, 2022, 2023, 2024, 2026];
const SEASONS = process.argv.slice(2).map(Number);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : INGESTED_SEASONS;

const SYSTEM_CLOCK: Clock = { now: () => new Date().toISOString() };

/**
 * ONE SEASON'S BOARD MOMENT — LIVE if its first kickoff is still ahead, REPLAY otherwise.
 *
 * `liveMomentFor` is the only function that can tell the two cases apart, and it does so by
 * throwing: it refuses the instant `clock.now()` reaches `season`'s first scheduled kickoff,
 * because a started season has a REPLAY moment, never a live one (`source.ts`'s own `BoardMoment`
 * docblock). That throw is exactly the signal this script needs, so it is caught rather than
 * avoided — narrowly, matching only the "already started" message `liveMomentFor` raises for that
 * one reason. A season with NO ingested schedule at all raises a DIFFERENT message ("no ingested
 * schedule") for a genuinely different problem (missing data, not a started season), and that one
 * is left to propagate: silently falling back to a replay moment for it would build a board off
 * `preseasonMomentFor`'s own unrelated derivation and call the resulting confusion a schedule gap.
 */
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

/**
 * The league the board is computed for, identical to `preseason-report.ts`' shape and for the same
 * reason: a stored board that was not the board we published a scorecard for would be a number with
 * no measurement behind it. Twelve teams, PPR, no kickers and no defences — Phase 2 projects
 * neither and their slots would be guaranteed blanks.
 */
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set. Run this through \`npm run projections:preseason:persist\`, which loads .env.local.`,
    );
  }
  return value;
}

/** Builds one board (raw or blended) and writes both its projection rows and its reason rows under
 *  `source`, returning what actually changed so the caller can print an honest summary. */
async function persistBoard(
  db: Db,
  inputs: PreseasonInputs,
  source: string,
  raw: boolean,
): Promise<{ readonly board: readonly BoardEntry[]; readonly written: number; readonly reasonsWritten: number }> {
  const candidates = await shippedPreseasonCandidates(db, inputs, PRIORS, { raw });
  const board = preseasonBoard(candidates, { season: inputs.season, asOf: inputs.moment, rules: PPR_SCORING, shape: SHAPE });
  const rows = projectionRows(board, { season: inputs.season, source, asOf: inputs.moment, momentKind: inputs.momentKind });
  const written = await recordPreseasonProjections(db, rows);
  const reasons = reasonRows(board, { season: inputs.season, source, asOf: inputs.moment });
  const reasonsWritten = await recordPreseasonBoardReasons(db, reasons);
  return { board, written, reasonsWritten };
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const names = new Map(
    (await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name] as const),
  );

  for (const season of TARGET_SEASONS) {
    const boardMoment = await boardMomentFor(db, season, SYSTEM_CLOCK);
    const inputs = await loadPreseason(db, season, { boardMoment });
    console.log(`${season}  moment kind: ${boardMoment.kind}  taken at ${inputs.moment.toISOString()}`);

    const v1 = await persistBoard(db, inputs, BOARD_SOURCE_V1_RAW, true);
    console.log(
      `${season}  [v1 raw, ${BOARD_SOURCE_V1_RAW}]  ${String(v1.board.length).padStart(4)} players  ` +
        `${String(v1.written).padStart(4)} new projection rows  ${String(v1.reasonsWritten).padStart(4)} reason rows written`,
    );

    const blended = await persistBoard(db, inputs, BOARD_SOURCE, false);
    console.log(
      `${season}  [blend, ${BOARD_SOURCE}]  ${String(blended.board.length).padStart(4)} players  taken at ${inputs.moment.toISOString()}  ` +
        `${String(blended.written).padStart(4)} new projection rows  ${String(blended.reasonsWritten).padStart(4)} reason rows written`,
    );
    for (const entry of blended.board.slice(0, 5)) {
      console.log(
        `      ${String(entry.rank).padStart(3)} ${entry.position} ${(names.get(entry.playerId) ?? entry.playerId).padEnd(22)}` +
          `proj ${entry.projectedPoints.toFixed(0).padStart(4)}  ${entry.position}${entry.positionRank}`,
      );
    }
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
