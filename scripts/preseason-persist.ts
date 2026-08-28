// Builds the shipped preseason board for one or more seasons and WRITES IT DOWN.
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
import { createDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import type { Position } from "@/domain/player";
import { nflPlayers } from "@/db/schema";
import type { LeagueShape } from "@/projections/decide/replacement";
import { preseasonBoard } from "@/projections/preseason/board";
import {
  BOARD_SOURCE,
  projectionRows,
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
  SHIPPED_PRESEASON_FEATURES,
  loadPreseason,
  preseasonCandidates,
  type PreseasonPriors,
} from "@/projections/preseason/source";

/** Every season the preseason ingestion has ever run for. A board needs three prior seasons of
 *  usage, which is why the floor is not the backfill's floor. */
const INGESTED_SEASONS = [2021, 2022, 2023, 2024];
const SEASONS = process.argv.slice(2).map(Number);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : INGESTED_SEASONS;

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

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const names = new Map(
    (await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name] as const),
  );

  for (const season of TARGET_SEASONS) {
    const inputs = await loadPreseason(db, season);
    const board = preseasonBoard(preseasonCandidates(inputs, SHIPPED_PRESEASON_FEATURES, PRIORS), {
      season,
      asOf: inputs.moment,
      rules: PPR_SCORING,
      shape: SHAPE,
    });
    const rows = projectionRows(board, { season, source: BOARD_SOURCE, asOf: inputs.moment });
    const written = await recordPreseasonProjections(db, rows);

    console.log(
      `${season}  ${String(board.length).padStart(4)} players  taken at ${inputs.moment.toISOString()}  ` +
        `${String(written).padStart(4)} new rows (${rows.length - written} already stored)`,
    );
    for (const entry of board.slice(0, 5)) {
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
