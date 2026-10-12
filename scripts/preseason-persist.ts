// Builds the shipped preseason board for one or more seasons and WRITES IT DOWN — the market-blended
// board, under each scoring format's own source (`boardSourceFor`: `commish_board_v9_ppr_12`,
// `_half_12`, `_std_12`; see board-store.ts's own docblock for the version history behind the
// name), AND the raw model board, under BOARD_SOURCE_V1_RAW (v1, PPR), so both halves of Task 11's
// own scorecard comparison stay addressable and CURRENT.
// Run: npm run projections:preseason:persist [season ...]   (defaults to every ingested season)
//      npm run projections:preseason:persist -- --unfreeze   (overrides FROZEN_BOARD_SOURCES, 2027 round)
//      npm run projections:preseason:persist -- --diff-reasons  (prints what would change, writes nothing)
//      npm run projections:preseason:persist -- --formats=half,std  (a subset of the three blended boards)
//
// THREE BLENDED BOARDS A RUN (the scoring-formats round, 2026-09-08). One `loadPreseason`, one
// props anchor, then the blend three times: each format anchors to its own ADP feed through its own
// fitted curve and is scored under its own preset (`market/format-anchor.ts`), and lands under its
// own source. The PPR leg is byte-for-byte the board this script wrote before the round.
//
// --diff-reasons (dossier-voice round, task 7) — BEFORE a re-persist, how many stored reasons per
// code this run would add, drop, or change the payload of. The board has not been re-persisted
// since the games-worth tier rule shipped, so its stored reasons describe tiers the board no
// longer draws, and the peek quotes them; whoever runs the re-persist against production needs to
// see the size of that change before it lands, and record it. This mode builds exactly the board a
// persist would build and writes nothing at all.
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
import { createDb, type Db } from "@research/db/client";
import { PPR_SCORING } from "@research/domain/scoring";
import { BOARD_FORMAT_SPECS, BOARD_FORMATS, boardSourceFor, isBoardFormat, type BoardFormat } from "@research/projections/preseason/board-formats";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research/domain/roster";
import type { Position } from "@research/domain/player";
import type { Clock } from "@research/domain/timing";
import { nflPlayers } from "@research/db/schema";
import type { LeagueShape } from "@research/projections/decide/replacement";
import { shippedPreseasonBoardInputs, type BlendConstants } from "@research/projections/market/blend";
import { rosterStatusReason } from "@research/projections/preseason/roster-status";
import type { ExcludedCandidate } from "@research/projections/preseason/roster-status-gate";
import type { SweepCoverage } from "@research/projections/preseason/roster-status-read";
import { FITTED_BLEND_CONSTANTS } from "@research/projections/market/blend-fitted";
import { marketBoard } from "@research/projections/market/curve";
import { propsAnchorForSeason } from "@research/projections/market/props-anchor";
import { blendConstantsWithPropsAnchor, PROPS_ANCHOR_WEIGHT_ARTIFACT } from "@research/projections/market/props-anchor-artifact";
import { loadModelArtifact } from "@research/projections/model/artifacts";
import { preseasonBoard, type BoardEntry, type BoardReason } from "@research/projections/preseason/board";
import type { GameVariancePriors } from "@research/projections/preseason/game-variance";
import { loadShippedGameVariance } from "@research/projections/preseason/game-variance-artifacts";
import { boardReasons, BOARD_SOURCE_V1_RAW, writePreseasonBoard, type BoardWriteCounts } from "@research/projections/preseason/board-store";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@research/projections/preseason/fitted";
import { FITTED_MODEL } from "@research/projections/model/source";
import {
  liveMomentFor,
  loadPreseason,
  replayMomentFor,
  type BoardMoment,
  type PreseasonInputs,
  type PreseasonPriors,
} from "@research/projections/preseason/source";

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
const DIFF_REASONS = ARGUMENTS.includes("--diff-reasons");
const SEASONS = ARGUMENTS.filter((argument) => !argument.startsWith("--")).map(Number);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : INGESTED_SEASONS;

/** `--formats=half,std` narrows the blended legs; the default is all three. The raw v1 leg is
 *  format-free and always runs. */
function parseFormats(argv: readonly string[]): readonly BoardFormat[] {
  const flag = argv.find((argument) => argument.startsWith("--formats="));
  if (flag === undefined) return BOARD_FORMATS;
  return flag
    .slice("--formats=".length)
    .split(",")
    .map((value) => {
      if (!isBoardFormat(value)) throw new Error(`"${value}" is not a board format (${BOARD_FORMATS.join(", ")}).`);
      return value;
    });
}
const TARGET_FORMATS = parseFormats(ARGUMENTS);

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

/**
 * THE PROPS-ANCHOR BLEND CONSTANTS (fit-round Task 3, plumbing round 2026-09-05).
 * `FITTED_BLEND_CONSTANTS` itself carries no `propsAnchorWeight` — `scripts/blend-fit.ts`'s own
 * train window (2013-2021) predates the props archive entirely, so that fit cannot move this axis
 * (see its own header) — `scripts/props-anchor-fit.ts` fits it separately, on the seasons the
 * archive actually covers, and publishes the verdict to the model artifact store
 * (`market/props-anchor-weight`, file-sourced data round 2026-09-09). This reads the PINNED version
 * and merges it onto the committed constants for the BLENDED arm only; a `null` weight (the gate
 * not beaten) hands `FITTED_BLEND_CONSTANTS` back BY REFERENCE, unchanged, so a re-fit that lands
 * on the null cell reproduces the incumbent board bit for bit.
 */
async function blendedConstants(db: Db): Promise<BlendConstants> {
  return blendConstantsWithPropsAnchor(FITTED_BLEND_CONSTANTS, await loadModelArtifact(db, PROPS_ANCHOR_WEIGHT_ARTIFACT));
}

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
 *
 * `blendEvidence` (plumbing round 2026-09-05) carries the season's own props-anchor map and the
 * merged `BLENDED_CONSTANTS` — omitted entirely for the raw (v1) call, which does not read
 * `BlendConstants` at all (`shippedPreseasonCandidates`'s own `raw: true` early return).
 */
/** The board a persist would write, built and not stored — the one place both the write path below
 *  and `--diff-reasons` get their candidates, so a diff can never describe a board a persist would
 *  not actually produce. */
/** One blended leg: which format, and therefore which source it lands under. `null` is the raw
 *  v1 leg, which is PPR and format-free. */
interface BoardLeg {
  readonly format: BoardFormat | null;
  readonly source: string;
}

const RAW_LEG: BoardLeg = { format: null, source: BOARD_SOURCE_V1_RAW };

function blendedLeg(format: BoardFormat): BoardLeg {
  return { format, source: boardSourceFor(format) };
}

/** A built board plus the players the roster-status gate kept off it (`roster-status-gate.ts`),
 *  which the write below stores beside the board so the product can render them under their band. */
interface BuiltBoard {
  readonly board: readonly BoardEntry[];
  readonly exclusions: readonly ExcludedCandidate[];
  /** What the roster sweep behind the gate covered; printed when it was incomplete, because an
   *  incomplete sweep excluded nobody on absence and an operator should know the gate stood down. */
  readonly sweep: SweepCoverage | null;
}

/** The sweep's own line in the write summary: nothing when it was complete or absent. */
function describeSweep(sweep: SweepCoverage | null): string {
  if (sweep === null || sweep.complete) return "";
  return `  (roster sweep incomplete: ${sweep.clubCount} clubs, smallest ${sweep.smallestClub ?? 0}, absence not read as a status)`;
}

async function buildBoard(
  db: Db,
  inputs: PreseasonInputs,
  leg: BoardLeg,
  gameVariance: GameVariancePriors,
  blendEvidence?: { readonly constants: BlendConstants; readonly propsAnchor: ReadonlyMap<string, number> },
): Promise<BuiltBoard> {
  const raw = leg.format === null;
  const { candidates, exclusions, sweep } = await shippedPreseasonBoardInputs(db, inputs, PRIORS, {
    raw,
    ...(leg.format === null ? {} : { format: leg.format }),
    ...(blendEvidence !== undefined ? { constants: blendEvidence.constants, propsAnchor: blendEvidence.propsAnchor } : {}),
  });
  const rules = leg.format === null ? PPR_SCORING : BOARD_FORMAT_SPECS[leg.format].rules;
  return { board: preseasonBoard(candidates, { season: inputs.season, asOf: inputs.moment, rules, shape: SHAPE, gameVariance }), exclusions, sweep };
}

/** One reason code's own before-and-after count, over the players the board holds. */
export interface ReasonDiff {
  readonly code: string;
  /** Players who would GAIN this reason (the stored board has none for them). */
  readonly added: number;
  /** Players who would LOSE it (stored has one, the fresh board does not). */
  readonly removed: number;
  /** Players who keep it with a DIFFERENT payload (a moved tier count, a new drop). */
  readonly changed: number;
  readonly unchanged: number;
}

function reasonsByCode(reasons: readonly BoardReason[]): ReadonlyMap<string, BoardReason> {
  return new Map(reasons.map((reason) => [reason.code, reason] as const));
}

/**
 * How the stored reasons and a freshly built board's reasons differ, per code. Payload equality is
 * a JSON comparison of the reason object, which is exactly what the store round-trips, so "changed"
 * means a reader would see a different sentence.
 *
 * Exported and pure so `preseason-persist.test.ts` pins the counting without a board build.
 */
export function diffReasons(
  stored: ReadonlyMap<string, readonly BoardReason[]>,
  fresh: ReadonlyMap<string, readonly BoardReason[]>,
): readonly ReasonDiff[] {
  const codes = new Set<string>();
  for (const reasons of [...stored.values(), ...fresh.values()]) for (const reason of reasons) codes.add(reason.code);
  const playerIds = new Set<string>([...stored.keys(), ...fresh.keys()]);

  const diffs: ReasonDiff[] = [];
  for (const code of [...codes].sort()) {
    let added = 0;
    let removed = 0;
    let changed = 0;
    let unchanged = 0;
    for (const playerId of playerIds) {
      const before = reasonsByCode(stored.get(playerId) ?? []).get(code);
      const after = reasonsByCode(fresh.get(playerId) ?? []).get(code);
      if (before === undefined && after === undefined) continue;
      if (before === undefined) added += 1;
      else if (after === undefined) removed += 1;
      else if (JSON.stringify(before) !== JSON.stringify(after)) changed += 1;
      else unchanged += 1;
    }
    diffs.push({ code, added, removed, changed, unchanged });
  }
  return diffs;
}

function printReasonDiff(season: number, source: string, diffs: readonly ReasonDiff[]): void {
  console.log(`${season}  [${source}] stored reasons that would change:`);
  for (const diff of diffs) {
    console.log(
      `      ${diff.code.padEnd(24)} +${String(diff.added).padStart(4)} added  -${String(diff.removed).padStart(4)} removed  ` +
        `~${String(diff.changed).padStart(4)} changed  =${String(diff.unchanged).padStart(4)} unchanged`,
    );
  }
  const moved = diffs.reduce((sum, diff) => sum + diff.added + diff.removed + diff.changed, 0);
  console.log(`      TOTAL reasons that would change: ${moved}`);
}

async function persistBoard(
  db: Db,
  inputs: PreseasonInputs,
  leg: BoardLeg,
  gameVariance: GameVariancePriors,
  unfrozen: boolean,
  blendEvidence?: { readonly constants: BlendConstants; readonly propsAnchor: ReadonlyMap<string, number> },
): Promise<BuiltBoard & { readonly write: BoardWriteCounts }> {
  const built = await buildBoard(db, inputs, leg, gameVariance, blendEvidence);
  const write = await writePreseasonBoard(
    db,
    { season: inputs.season, source: leg.source, asOf: inputs.moment, momentKind: inputs.momentKind },
    built.board,
    { unfrozen, exclusions: built.exclusions },
  );
  return { ...built, write };
}

function printBoardWrite(season: number, label: string, leg: BoardLeg, result: BuiltBoard & { readonly write: BoardWriteCounts }): void {
  console.log(
    `${season}  [${label}, ${leg.source}]  ${String(result.board.length).padStart(4)} players  ` +
      `${String(result.write.written).padStart(4)} new projection rows  ${String(result.write.reasonsWritten).padStart(4)} reason rows written  ` +
      `${String(result.exclusions.length).padStart(3)} not on an active roster` +
      describeRetirement(result.write) +
      describeSweep(result.sweep),
  );
}

const TOP_ROWS_PRINTED = 5;

function printTopRows(board: readonly BoardEntry[], names: ReadonlyMap<string, string>): void {
  for (const entry of board.slice(0, TOP_ROWS_PRINTED)) {
    console.log(
      `      ${String(entry.rank).padStart(3)} ${entry.position} ${(names.get(entry.playerId) ?? entry.playerId).padEnd(22)}` +
        `proj ${entry.projectedPoints.toFixed(0).padStart(4)}  ${entry.position}${entry.positionRank}`,
    );
  }
}

/** What a board write retired, printed only when it retired something. A replay persist prints
 *  exactly what it always printed, since it never retires anything. */
function describeRetirement(write: BoardWriteCounts): string {
  if (write.mode === "append" || write.retiredProjections + write.retiredReasons === 0) return "";
  return `  (retired ${write.retiredProjections} prior projection rows, ${write.retiredReasons} prior reasons)`;
}

/**
 * ONE SEASON, EVERY BOARD (three blended formats, then the raw v1) — extracted out of `main`'s loop
 * body (Task 4 fix round 2, I5) so the ORDERING GUARANTEE below is a unit anyone can call and test,
 * not an implicit property of two lines sitting in a particular order inside a `for` loop.
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
  formats: readonly BoardFormat[] = TARGET_FORMATS,
): Promise<void> {
  const boardMoment = await boardMomentFor(db, season, clock);
  const inputs = await loadPreseason(db, season, { boardMoment });
  console.log(`${season}  moment kind: ${boardMoment.kind}  taken at ${inputs.moment.toISOString()}`);

  // THE PROPS ANCHOR (plumbing round 2026-09-05) — built once per season, for the BLENDED arm only.
  // This is a SECOND `marketBoard` read: `shippedPreseasonCandidates` fetches its own inside the
  // blend, and this one exists purely to hand `propsAnchorForSeason` the market points it needs to
  // rescale against. The identical duplicate-read tradeoff `scripts/blend-fit.ts`'s own
  // `factsForSeason` and `scripts/props-anchor-fit.ts`'s own `factsForSeason` already accept, for
  // the same reason: the anchor's own rescale (`props-anchor.ts`'s step 5) needs a season's market
  // prices before the blend that will later read the anchor has been built.
  const { entries: marketForAnchor } = await marketBoard(db, season, inputs.moment);
  const propsAnchor = await propsAnchorForSeason(
    db,
    season,
    inputs.positions,
    new Map(marketForAnchor.map((entry) => [entry.playerId, entry.marketPoints] as const)),
    FITTED_BLEND_CONSTANTS.impliedGamesByPosition,
  );

  // THE LOUD WARNING (fix round 1, MEDIUM 1b) — an empty props anchor on a REPLAY board is
  // ordinary (2021/2022 predate the archive entirely; see `props-anchor.ts`'s own null-cell
  // docblock), so this is scoped to a LIVE board only: the one case where "zero players anchored"
  // means the product's own served board silently fell back to ADP-only, with nothing anywhere
  // else that would ever say so. `console.warn`, never a throw — an empty archive is a real,
  // recoverable state (the daily snapshot job has not run yet, or its resolve step has not caught
  // up), not a reason to refuse a board the way `assertLiveMarketCoverage` refuses a degenerate
  // market.
  if (boardMoment.kind === "live" && propsAnchor.size === 0) {
    console.warn(`props anchor: 0 players anchored for ${season}. Resolve has not run, or the archive is empty.`);
  }

  // Both fitted tables come from the model artifact store, pinned by version; a store that lacks
  // either throws here, before any leg is built or written.
  const blendEvidence = { constants: await blendedConstants(db), propsAnchor };
  const gameVariance = await loadShippedGameVariance(db);
  const legs: readonly (readonly [BoardLeg, typeof blendEvidence | undefined])[] = [
    ...formats.map((format) => [blendedLeg(format), blendEvidence] as const),
    [RAW_LEG, undefined] as const,
  ];

  if (DIFF_REASONS) {
    for (const [leg, evidence] of legs) {
      const fresh = await buildBoard(db, inputs, leg, gameVariance, evidence);
      const stored = await boardReasons(db, leg.source, season);
      // The gate's exclusions carry exactly one reason each, and a diff that left them out would
      // under-count what a persist writes by every player it takes off the board.
      const freshReasons = new Map<string, readonly BoardReason[]>([
        ...fresh.board.map((entry) => [entry.playerId, entry.reasons] as const),
        ...fresh.exclusions.map((excluded) => [excluded.playerId, [rosterStatusReason(excluded.status)]] as const),
      ]);
      printReasonDiff(season, leg.source, diffReasons(stored, freshReasons));
    }
    return;
  }

  // THE BLENDED LEGS FIRST, THE RAW LEG LAST: the degeneracy guard lives inside the blended path
  // (see the docblock above), so a thin live market throws out of the first blended leg before a
  // raw row could land.
  for (const [leg, evidence] of legs) {
    const result = await persistBoard(db, inputs, leg, gameVariance, unfrozen, evidence);
    printBoardWrite(season, leg.format === null ? "v1 raw" : `blend ${BOARD_FORMAT_SPECS[leg.format].label}`, leg, result);
    if (leg.format !== null) printTopRows(result.board, names);
  }
}

async function main(): Promise<void> {
  if (UNFREEZE) {
    console.warn(
      "--unfreeze: OVERRIDING FROZEN_BOARD_SOURCES. This run may retire the live generation the product " +
        "serves and may rewrite an archive's stored reasons. See board-store.ts's FROZEN_BOARD_SOURCES for " +
        "the ruling this lifts, and be sure BOARD_SOURCE is the name you mean to write under.",
    );
  }
  if (DIFF_REASONS) {
    console.log("--diff-reasons: building each board and printing what its stored reasons would become. NOTHING is written.");
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
