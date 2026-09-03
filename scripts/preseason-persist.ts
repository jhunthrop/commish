// Builds the shipped preseason board for one or more seasons and WRITES IT DOWN — the market-blended
// board, under BOARD_SOURCE (see board-store.ts's own docblock for its current value and the
// source-bump history behind it), AND the raw model board, under BOARD_SOURCE_V1_RAW (v1), so both
// halves of Task 11's own scorecard comparison stay addressable and CURRENT.
// Run: npm run projections:preseason:persist [season ...]   (defaults to every ingested season)
//      npm run projections:preseason:persist -- --unfreeze   (overrides FROZEN_BOARD_SOURCES, 2027 round)
//
// NEITHER SOURCE THIS SCRIPT WRITES IS FROZEN ANY MORE (Round D, the serve-v9 ruling). Both were,
// while the served rows were v7's and this tree's fitted files were v9's — a write then would have
// replaced measured rows with numbers no stored board was measured on. Serving v9 makes the tree
// reproduce what it stores, so both legs below run without `--unfreeze`. What `FROZEN_BOARD_SOURCES`
// still protects is v7, which this script never writes under and which the register reads every
// week as its shadow track. See that constant's own docblock for the re-adjudication.
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
  writePreseasonBoard,
  type BoardWriteCounts,
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

/**
 * Every season this script will build WITHOUT being asked for one by name.
 *
 * 2026 WAS ON THIS LIST AND IS NOT ANY MORE (fit-round final review), and it STAYS OFF for a
 * different reason than the one that removed it. It joined the day its week-one rosters, depth
 * charts and ADP landed and it builds through the LIVE arm, which retires the stored generation
 * before writing. It came off because the frozen-state ruling meant this tree could not reproduce
 * that generation; the serve-v9 ruling ended that, and 2026 still does not belong here. A live
 * re-take replaces the board the product is serving and the board next week's register freeze will
 * record, which is a deliberate act with a visible consequence, not something a no-argument
 * archive-refresh run should do as a side effect. Naming 2026 explicitly is how it is taken.
 *
 * A board needs three prior seasons of usage, which is why the floor is not the backfill's floor.
 */
const INGESTED_SEASONS = [2021, 2022, 2023, 2024];
const ARGUMENTS = process.argv.slice(2);
const UNFREEZE = ARGUMENTS.includes("--unfreeze");
const SEASONS = ARGUMENTS.filter((argument) => !argument.startsWith("--")).map(Number);
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

/**
 * Builds one board (raw or blended) and writes both its projection rows and its reason rows under
 * `source`, returning what actually changed so the caller can print an honest summary.
 *
 * THE WRITE ITSELF IS `writePreseasonBoard`'s (fix round 1), not two calls made here: a LIVE board
 * retires its own prior generation in one transaction and a REPLAY board appends exactly as it always
 * did, and which of those happens is a property of the moment rather than of this script. See that
 * function's docblock for why a live board that only appended left a released player on the board for
 * a day after his roster row had been corrected.
 *
 * `unfrozen` is threaded through rather than read from module scope so `persistSeason` stays callable
 * from a test with either value; the guard it lifts lives in `writePreseasonBoard`, where no caller
 * can go around it.
 */
async function persistBoard(
  db: Db,
  inputs: PreseasonInputs,
  source: string,
  raw: boolean,
  unfrozen: boolean,
): Promise<{ readonly board: readonly BoardEntry[]; readonly write: BoardWriteCounts }> {
  const candidates = await shippedPreseasonCandidates(db, inputs, PRIORS, { raw });
  const board = preseasonBoard(candidates, { season: inputs.season, asOf: inputs.moment, rules: PPR_SCORING, shape: SHAPE });
  const write = await writePreseasonBoard(
    db,
    { season: inputs.season, source, asOf: inputs.moment, momentKind: inputs.momentKind },
    board,
    { unfrozen },
  );
  return { board, write };
}

/** What a board write retired, printed only when it retired something. A replay persist prints
 *  exactly what it always printed, since it never retires anything. */
function describeRetirement(write: BoardWriteCounts): string {
  if (write.mode === "append" || write.retiredProjections + write.retiredReasons === 0) return "";
  return `  (retired ${write.retiredProjections} prior projection rows, ${write.retiredReasons} prior reasons)`;
}

/**
 * ONE SEASON, BOTH BOARDS — extracted out of `main`'s loop body (Task 4 fix round 2, I5) so the
 * ORDERING GUARANTEE below is a unit anyone can call and test, not an implicit property of two
 * lines sitting in a particular order inside a `for` loop.
 *
 * THE BLENDED BOARD IS BUILT AND WRITTEN FIRST, DELIBERATELY — the review's own finding: the
 * degeneracy guard (`market/blend.ts`'s `assertLiveMarketCoverage`) lives inside
 * `shippedPreseasonCandidates`'s `raw: false` path, so it can only ever fire while building the
 * BLENDED board. Before this fix, `main`'s loop built and WROTE v1 (raw) first, then built the
 * blend second — so a degenerate live market let v1's 759 rows land in `preseason_projections`
 * before the guard ever got a chance to run, leaving a raw board on record for a season that was
 * about to be refused outright. Calling the blended `persistBoard` first means the guard's own
 * `throw` (if it fires) propagates out of THIS function before the v1 call below is ever reached —
 * no `try`/`catch`, no flag, just call order, which is the whole point: the ordering IS the
 * guarantee, not a workaround around a guard that fires too late.
 */
export async function persistSeason(
  db: Db,
  season: number,
  clock: Clock,
  names: ReadonlyMap<string, string>,
  unfrozen = false,
): Promise<void> {
  const boardMoment = await boardMomentFor(db, season, clock);
  const inputs = await loadPreseason(db, season, { boardMoment });
  console.log(`${season}  moment kind: ${boardMoment.kind}  taken at ${inputs.moment.toISOString()}`);

  const blended = await persistBoard(db, inputs, BOARD_SOURCE, false, unfrozen);
  console.log(
    `${season}  [blend, ${BOARD_SOURCE}]  ${String(blended.board.length).padStart(4)} players  taken at ${inputs.moment.toISOString()}  ` +
      `${String(blended.write.written).padStart(4)} new projection rows  ${String(blended.write.reasonsWritten).padStart(4)} reason rows written` +
      describeRetirement(blended.write),
  );
  for (const entry of blended.board.slice(0, 5)) {
    console.log(
      `      ${String(entry.rank).padStart(3)} ${entry.position} ${(names.get(entry.playerId) ?? entry.playerId).padEnd(22)}` +
        `proj ${entry.projectedPoints.toFixed(0).padStart(4)}  ${entry.position}${entry.positionRank}`,
    );
  }

  const v1 = await persistBoard(db, inputs, BOARD_SOURCE_V1_RAW, true, unfrozen);
  console.log(
    `${season}  [v1 raw, ${BOARD_SOURCE_V1_RAW}]  ${String(v1.board.length).padStart(4)} players  ` +
      `${String(v1.write.written).padStart(4)} new projection rows  ${String(v1.write.reasonsWritten).padStart(4)} reason rows written` +
      describeRetirement(v1.write),
  );
}

async function main(): Promise<void> {
  if (UNFREEZE) {
    console.warn(
      "--unfreeze: OVERRIDING FROZEN_BOARD_SOURCES. This run may retire the live generation the product " +
        "serves and may rewrite an archive's stored reasons. See board-store.ts's FROZEN_BOARD_SOURCES for " +
        "the ruling this lifts, and be sure BOARD_SOURCE is the name you mean to write under.",
    );
  }
  const db = createDb(requireEnv("DATABASE_URL"));
  const names = new Map(
    (await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name] as const),
  );

  for (const season of TARGET_SEASONS) {
    await persistSeason(db, season, SYSTEM_CLOCK, names, UNFREEZE);
  }

  await db.$client.end();
}

// Runs `main` only when this file is the process entry point, never when a test imports
// `persistSeason` — the identical guard `scripts/board-top.ts` carries for the identical reason.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
