import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db, DbTx, ReadonlyDb } from "@/db/client";
import { preseasonBoardReasons, preseasonProjections } from "@/db/schema";
import { changedRowWhere, excludedSetFor } from "@/db/upsert";
import type { JsonObject } from "@/domain/audit";
import type { BoardEntry, BoardReason } from "./board";
import type { BoardMoment } from "./source";

/**
 * WHERE THE BOARD LANDS — the first writer in this repository that stores a number the model
 * produced rather than one somebody else published.
 *
 * `preseasonBoard` has been a pure function whose only callers print to a research document, and
 * that was right while the open question was whether it was any good. The answer is now yes
 * (`docs/research/2026-08-28-starter-band.md`), and a rank correlation over a held-out season is a
 * fact about the BOARD: a manager looking at one receiver needs a fact about that receiver, and
 * nothing could give him one because the board did not survive the process that computed it.
 *
 * SEPARATE FROM `store.ts` NEXT DOOR, which holds the two things other people published about a
 * preseason. This holds the one thing we say about it. They share a shape on purpose — the source
 * strip on a player's screen sets all three beside each other and a different shape would have made
 * that comparison a translation — but they have opposite provenance, and a module that wrote both
 * would be one edit away from a benchmark being fed back in as a feature, which the engine spec
 * forbids outright.
 *
 * THE STAMP IS THE BOARD'S OWN MOMENT, never the time of the run. `loadPreseason` derives that
 * moment as one millisecond before the earliest thing the season would reveal and asserts the store
 * against it before returning; carrying it onto every row is what makes a stored projection a claim
 * anybody can check. Two leakage defects have been found in this engine, both silent, both caught
 * by audit; a row that could not say what it was allowed to see would make the third one unfindable.
 */

/**
 * THE HISTORICAL RAW-MODEL SOURCE (C3 fix round, 2026-08-31 — superseded as the SHIPPED board by
 * `BOARD_SOURCE`, below, which now names the blended one). Kept as its own named constant, never
 * deleted: every row ever written under it is the raw, pre-blend board's own honest history, and a
 * reader comparing "what the raw model alone said" against "what shipped" (Task 11's own scorecard,
 * a backtest) needs a stable name for the first half of that comparison. `scripts/preseason-persist.ts`
 * writes fresh rows here too, via `shippedPreseasonCandidates`'s own `{ raw: true }` seam, so this
 * source's own reasons stay CURRENT (never a stale mix of pre-blend projections next to blended-board
 * reasons — the exact drift a fix round found and this constant's split existence now prevents).
 */
export const BOARD_SOURCE_V1_RAW = "commish_board_v1_ppr_12";

/**
 * Which board said it. Model version AND league format in one value, exactly as the benchmark
 * sources name market and format in one (`ffc_adp_ppr_12`), because a projected point total is
 * meaningless without the rules that composed it and a rank is meaningless without the roster
 * shape that valued it. A refit is a new value here, never an overwrite of rows a manager has
 * already been shown.
 *
 * BUMPED TO v2 (C3 fix round 1, 2026-08-31): Task 10 wired `shippedPreseasonCandidates`'s market
 * blend in as the board `scripts/preseason-persist.ts` writes, but `preseason_projections`' own
 * unique key (`season, source, as_of`) meant a rerun under the UNCHANGED v1 source name never wrote
 * a single new projection row — every row already existed from before the blend, so the blend's own
 * point totals never reached the store a live product surface reads, even though its REASONS did
 * (a different table, no `as_of`, always overwritten).
 *
 * BUMPED AGAIN TO v3 (fix round 2, 2026-08-31 — NOT preserved as its own named historical constant
 * the way v1/raw is): the SAME unique-key problem recurred one level up. Fix round 1's own blend had
 * a real correctness bug (an unlisted quarterback's rescale inflated him toward starter-level
 * output); fix round 2 fixed the bug in code, re-ran the grid search, and re-ran persist under the
 * STILL-v2 source name expecting fresh numbers — and got zero new projection rows again, for the
 * identical reason: v2's own `(season, source, as_of)` rows already existed from fix round 1's own
 * run, so the corrected pricing never reached the store either, even though the reasons table (no
 * `as_of`) silently updated to describe numbers the projections table was not actually showing.
 * `commish_board_v3_ppr_12` is, again, a fresh value with no existing rows. Unlike
 * `BOARD_SOURCE_V1_RAW`, v2 is NOT kept as a second permanent named constant: v1/raw serves an
 * ongoing, identified purpose (the raw-vs-blend comparison Task 11's scorecard needs both halves
 * of), while v2 was a blend that never finished shipping correctly — its own stored rows were wrong
 * the entire time they existed, so there is nothing about "v2 specifically" worth a reader
 * addressing by name going forward. Every reader of `BOARD_SOURCE` (the drafts-players route, the
 * player screen) picks up the corrected blend automatically, with no call-site change.
 *
 * BUMPED AGAIN TO v4 (fix round 3, IMPORTANT 1, 2026-09-01 — the identical unique-key problem, a
 * third time). Fix round 2's own tail guard was correct, but the affine rescale layer it capped
 * (`unlistedRescale`) was dead: every fitted intercept at RB/WR/TE already sat above that position's
 * own tail, so the tail's `Math.min` discarded the rescale's output for every candidate, collapsing
 * every unlisted player at a position to the SAME tail value and erasing the raw model's own
 * ordering among them. A live check against v3's own stored rows confirmed the damage directly:
 * multiple DISTINCT unlisted WRs were stored at the identical 85.79-point WR tail in 2024, and
 * re-running the corrected pricing (`market/blend.ts`'s `tailCappedUnlistedPoints`, the rescale layer
 * removed) against those SAME player ids returned distinct, ordered numbers instead (6.94, 65.40,
 * 19.40, 83.39, 8.84, 71.54 among them) — a real, large points change for unlisted RB/WR/TE
 * candidates, not a no-op refactor. QB is the one position where v3's stored numbers are unaffected:
 * `unlistedRescale.QB` was already the identity transform (fix round 2's own fit-validity ruling), so
 * `tailCappedUnlistedPoints` reproduces QB's old output exactly — the discrepancy is real only at
 * RB/WR/TE, but the fix is not position-scoped in the store, so the WHOLE board moves to a fresh
 * source rather than only the affected positions. `commish_board_v4_ppr_12` is, again, a fresh value
 * with no existing rows, for the identical structural reason v2 and v3 needed one: `preseason_projections`'
 * own `(season, source, as_of)` unique key means a rerun under an unchanged source name silently
 * keeps serving the old, wrong numbers forever. v3 is NOT kept as a second permanent named constant,
 * for the same reason v2 was not: its own stored rows were wrong (at RB/WR/TE) the entire time they
 * existed.
 *
 * BUMPED AGAIN TO v5 (live-board plan, Task 4 fix round 2, C1 — a FOURTH occurrence of the identical
 * unique-key problem, this time from a defect that predates every one of the three bumps above and
 * therefore contaminates every archive season, not only the live one that surfaced it). C1's own fix
 * gated `laws/board-reasons.ts`'s `lawReasonsFor` by player position — before it, a law's condition
 * was evaluated against ANY player regardless of the position it was measured on, so
 * `rb_age_curve`'s effect (fitted ONLY over RBs) could reach a wide receiver's board row, and a
 * discovered WR-only candidate could reach an RB's. `blendBoard` reads exactly these "law" reasons
 * to compute a player's admitted price delta, so a stale, wrongly-attributed law reason moved a
 * REAL, ALREADY-SHIPPED archive season's stored points, not only a future live one. Measured
 * directly against 2024 (replay, `as_of` fixed and deterministic — the REPLAY arm this bump exists
 * for): rebuilding the identical 2024 board pre-fix vs. post-fix moved 45 of 653 players' own
 * `projectedPoints` (max delta 5.22 pts), which rippled into 128 players' points-only `rank` and 372
 * players' `valueRank` changing even where their OWN points did not move (a`45→128→372` cascade —
 * price, then position, then draft-value order, three different-sized populations because each is a
 * broader ripple of the one before it). `commish_board_v5_ppr_12` is a fresh value with no existing
 * rows, for the identical structural reason v2/v3/v4 needed one: a REPLAY season's own `as_of` is
 * DERIVED and DETERMINISTIC (`preseasonMomentFor`), so a rerun under the unchanged v4 name would
 * collide with `(season, source, as_of)` on every one of the four archive seasons and the corrected
 * points would never reach the store, exactly as v2 and v3's own re-runs silently kept serving stale
 * numbers before. The RAW board (`BOARD_SOURCE_V1_RAW`) is UNAFFECTED and was verified as such: a
 * "law" reason is a descriptive attachment `preseasonCandidates`'s own per-game line never reads,
 * only `blendBoard` does, so v1's own points are byte-identical before and after C1's fix. v4 is NOT
 * kept as a second permanent named constant, for the same reason v2/v3 were not: its own stored rows
 * were wrong (cross-position law contamination) the entire time they existed.
 *
 * BUMPED AGAIN TO v6 (live-board plan, final fix round, H1 — the FIFTH occurrence of the identical
 * unique-key problem, and the first one whose fix is expected to move NOTHING on the archive
 * seasons). The whole-branch review found that Task 4's derived-2025 admission reached the live
 * board's LAW facts and not its MODEL arm: `loadPreseason` read the prior season's outcome history
 * through the published-only `statLinesAsOf` and its opportunity counts through a `usageAsOf` that
 * synthesized zeros for the metrics the backfill deliberately withheld, so a 2026 live board joined
 * `predictRates` against an EMPTY 2025 and every one of 759 players silently took the position-prior
 * efficiency. The fix asks ONE predicate (`preseason/source.ts`'s `admitsDerivedPriorSeason`) for
 * every prior-season read, and stops the zero synthesis at its source (`usage.ts`).
 *
 * WHY A BUMP AT ALL IF THE ARCHIVES DO NOT MOVE: the admission is live-arm-only by construction, so
 * 2021-2024 SHOULD be byte-identical under v6 — but "should" is exactly the assumption
 * `(season, source, as_of)` punishes. A re-persist under the unchanged v5 name would `DO NOTHING` on
 * every archive season (the replay `as_of` is derived and deterministic, so every row already
 * exists) and the 2026 board would land beside the stale one, leaving no way to tell a verified
 * no-change from a write that never happened. A fresh source makes the replay invariant a MEASURABLE
 * claim: v5 and v6 rows sit side by side for 2021-2024 and a read-only comparison either finds them
 * identical or does not. v5 is not kept as a named constant — unlike v2/v3/v4 its archive rows are
 * not wrong, they are simply the same numbers under an older name.
 *
 * BUMPED AGAIN TO v7 (vegas-laws plan, Task 4 — the SIXTH occurrence of the identical unique-key
 * problem, and the first one whose fix is expected to move the ARCHIVES ON PURPOSE). Discovery
 * confirmed two new laws over a quantity this engine had never carried: a team's published Vegas
 * win total for the season being projected
 * (`and:WR:threshold:WR:incomingTeamWinTotal:q70+threshold:WR:snapShare:q70` and its q80 sibling,
 * both WR, both positive). `blendBoard` reads exactly the "law" reasons `lawReasonsFor` emits, so a
 * newly confirmed law is a price change for every player whose condition it holds for, on every
 * season that has a line — which, unlike the v6 round's live-arm-only admission, is ALL FIVE. The
 * archives are therefore expected to differ from v6, and the honest proof is not a byte-identical
 * comparison but a scoped one: every moved row is a wide receiver gaining or losing one of the two
 * new chips, or a rank rippling off one who did.
 *
 * WHY A BUMP IS STILL THE POINT: `(season, source, as_of)` would silently refuse every archive row
 * on a v6 re-persist (a replay `as_of` is derived and deterministic), so the new pricing would never
 * reach the store while the reasons table, which has no `as_of`, updated underneath it — the exact
 * silent-stale failure v2 through v5 each shipped once. v6 is not kept as a named constant: like v5
 * its rows are not wrong, they are the same board before two laws it could not yet know about.
 *
 * BUMPED AGAIN TO v8 (fit-round plan, Task 4, the SEVENTH occurrence of the identical unique-key
 * problem). This round did not add one quantity, it re-earned the whole evidence base underneath the
 * board and then re-fit every constant on it. Four things move a stored number:
 *
 *   1. THE CROSSWALK CLASS FIX (Task 1). 4,828 skill player-weeks 2003-2024 that the class gate had
 *      been dropping now resolve, and the weekly stat floor moved from 2013 to 2003. Every population
 *      this engine measures on grew, so every fitted constant downstream of it moved.
 *   2. THE ROOKIE CURVE, re-fit on 19 classes instead of 9 (`preseason/rookie-curve-fitted.ts`).
 *      Every position's top end came down, RB pick 1 hardest (383.8 to 271.1 points), because the old
 *      decade's rookie classes were not the modern ones.
 *   3. THE LAW SET (Task 2), re-measured on the completed store: 90 confirmed laws, of which the nine
 *      Task 2 SELF-MARKED SUSPECT are refused admission to pricing by `laws/pricing.ts` while keeping
 *      their measured verdicts and their board reasons. The newly confirmed WR collapse law prices
 *      bad-team receivers down.
 *   4. THE BLEND'S OWN CONSTANTS (`market/blend-fitted.ts`), re-fit over 18,522 grid cells. Two of
 *      the fit-round axes moved off their null cells: a per-player law-channel cap of 20 points and an
 *      availability recency decay of 0.5 (the committed priors' own 0.7 was the null cell). The
 *      availability cap tightened from 20 to 10.
 *
 * WHY A BUMP IS STILL THE POINT: `(season, source, as_of)` would silently refuse every archive row on
 * a v7 re-persist, because a replay `as_of` is derived and deterministic, so the re-fit pricing would
 * never reach the store while the reasons table, which has no `as_of`, updated underneath it. v7 is
 * not kept as a named constant: like v5 and v6 its rows are not wrong, they are the same board fit on
 * evidence that turned out to be incomplete.
 *
 * REVERTED TO v7 (2026-09-02, the bar-break rule): the v8 configuration's held-out verdict came in
 * at +0.0982 [-0.0065, +0.2201] against ADP on decisive 2024, an interval that no longer excludes
 * zero, so per the fit-round plan's own STOP rule the current source went back to v7, whose published
 * verdict (+0.1002 [+0.0041, +0.2089] BEYOND NOISE) still stood. The v8 rows remain in the store as
 * the measured record of the configuration that did not clear. That revert is superseded by v9,
 * below, but it is kept in this history because the sequence matters: v7 stood alone for the hours
 * between the break and the ruling, and a reader tracing a stored row's provenance needs that window
 * to exist here rather than be tidied away.
 *
 * BUMPED TO v9 (2026-09-02, the founder's CORRECTIONS-ONLY ruling after the v8 break, and the EIGHTH
 * occurrence of the unique-key problem). v9 is v7's proven blend semantics carrying only this round's
 * corrections, and the distinction it rests on is between a CORRECTION and a CHOICE.
 *
 *   THE CORRECTIONS, all three ruled before anybody looked at 2024:
 *   1. THE CROSSWALK CLASS FIX and the 2003 floors (Task 1). 4,828 skill player-weeks 2003-2024 that
 *      the class gate had been dropping now resolve. This is a defect fix in the store itself and
 *      cannot be declined.
 *   2. THE ROOKIE CURVE, re-fit on 19 classes instead of 9 (`preseason/rookie-curve-fitted.ts`),
 *      which the completed store made possible and which the old file could not have been. Every
 *      position's top end came down, RB pick 1 hardest (383.8 to 271.1 points).
 *   3. THE LAW SET (Task 2), re-measured on the completed store: 90 confirmed, priced through
 *      `laws/pricing.ts`'s gate, which refuses the nine Task 2 SELF-MARKED SUSPECT while leaving
 *      their verdicts and their board reasons visible. 81 discovered laws plus the six tribal ones
 *      may spend points. THE REGISTRY IS WHAT MEASUREMENT SAYS AND THE GATE WAS RULED BEFORE ANY
 *      2024 LOOK: this round does NOT choose between the old 22-law set and the new 81-law one on
 *      the basis of the break, because that would be selecting a model on the held-out season.
 *
 *   THE CHOICE, declined: v8's blend constants. That cell came out of a search over 18,522 cells,
 *   its board lost the decisive 2024 bar, and picking a replacement cell afterwards would burn the
 *   held-out season. v9's constants are PINNED to v7's cell (lawCapPoints 2, availabilityCapPoints
 *   20, totalCapPoints 40, no per-player law cap, no cluster dedup, no props weight, the committed
 *   availability recency) and `blend-fitted.ts` is regenerated by a single-cell evaluation that says
 *   so in its own first line. Only the two market-side tables move, because they are derived from the
 *   train population rather than chosen from a grid.
 *
 * WHY A BUMP RATHER THAN A REWRITE OF v7'S ROWS: `(season, source, as_of)` again. A replay `as_of`
 * is derived and deterministic, so re-persisting corrected pricing under the unchanged v7 name would
 * write no projection row at all while the reasons table, which has no `as_of`, updated underneath it
 * to describe numbers the projections table was not showing. That is the silent-stale failure v2
 * through v5 each shipped once, and it is why every correction round gets a fresh name. v7 and v8
 * both keep their rows: v7 as the configuration whose verdict stood, v8 as the record of the one that
 * did not clear, and neither is read while this constant points at v9.
 *
 * REVERTED TO v7 A SECOND TIME (2026-09-02, the same bar-break rule): v9's confirmatory read came in
 * at +0.0979 [-0.0068, +0.2203] against ADP on decisive 2024, an interval that does not exclude zero,
 * so v9 did not clear either and this constant points at v7 until the 2025-outcomes round.
 *
 * WHAT THE TWO BREAKS TOGETHER SAY, because it is more than either says alone. v8 and v9 differ in
 * exactly the blend constants (v8's searched cell against v7's pinned one) and their decisive gaps
 * are +0.0982 and +0.0979: statistically the same number. THE CONSTANTS WERE NEVER THE CAUSE. What
 * both configurations share is this round's corrections, and the one that touches pricing is the law
 * family growing from 22 priced laws to 87. On both boards the LAW-ABLATED arm clears the bar
 * (+0.1056 and +0.1063, intervals excluding zero) while the blended arm does not.
 *
 * AND THE ONE THING NOBODY HAS MEASURED, stated here so the next round does not assume it: v7's own
 * published verdict (+0.1002 [+0.0041, +0.2089]) was taken on the PRE-CORRECTION store, and the 2024
 * evaluation population itself grew with the crosswalk fix (653 stored rows to 664). v7's board has
 * never been scored on today's store, so "v7 clears and v9 does not" is not yet a like-for-like
 * comparison. Establishing that is a measurement the 2025-outcomes round should make FIRST, and it
 * costs another look at 2024, which is exactly why it needs to be planned rather than improvised.
 */
export const BOARD_SOURCE = "commish_board_v7_ppr_12";

/** One player's place on one board, as it was taken at one moment. */
export interface PreseasonProjectionRow {
  readonly season: number;
  readonly source: string;
  /** An `nfl_players.id` — a gsis id. The product reaches it through `player_crosswalk`. */
  readonly playerId: string;
  readonly rank: number;
  readonly positionRank: number;
  readonly projectedPoints: number;
  readonly valueOverReplacement: number;
  readonly valueRank: number;
  readonly expectedGames: number;
  readonly floorPoints: number;
  readonly medianPoints: number;
  readonly ceilingPoints: number;
  readonly tier: number;
  readonly asOf: Date;
  /** Which arm of `BoardMoment` (`source.ts`) `asOf` came from — Task 2. `'replay'` for every board
   *  this engine has ever stored; `'live'` is the one value `scorecard.ts`'s `assertGradableMoment`
   *  refuses to grade. */
  readonly momentKind: BoardMomentKind;
}

export interface BoardStamp {
  readonly season: number;
  readonly source: string;
  /** `PreseasonInputs.moment` and nothing else. See the module docblock. */
  readonly asOf: Date;
}

/** `source.ts`'s `BoardMoment["kind"]`, named locally so this module never has to import the whole
 *  `BoardMoment` union just to talk about which arm a stamp came from. */
export type BoardMomentKind = BoardMoment["kind"];

/**
 * `BoardStamp` plus the moment kind — what `projectionRows` needs to fill the `moment_kind` column.
 * Kept separate from `BoardStamp` itself rather than folded into it: `preseasonProjectionsAsOf` and
 * `preseasonProjectionsFor` below both take a bare `BoardStamp` to READ a board (season, source and
 * as-of are the whole identity of a read), and their call sites across the product never had a moment
 * kind to supply. Only a WRITE needs to say which arm produced the row.
 */
export interface PreseasonProjectionStamp extends BoardStamp {
  readonly momentKind: BoardMomentKind;
}

/**
 * A board turned into rows, with every number the entry carried and nothing derived here.
 *
 * `reasons` IS NOW STORED (Task 7, `reasonRows`/`preseasonBoardReasons` below) — the omission this
 * docblock used to state was deliberate and temporary, and Task 7 is that "temporary" arriving:
 * layer 7 says the diagnostic and the explanation are the same artifact, and a rank with no reason
 * beside it is half the product. `seasonLine` stays out; it is a fourteen-field line rather than a
 * short discriminated union, and no surface reads it yet — the same "store what a screen needs,
 * say what is missing" discipline, just not yet due for that field.
 */
export function projectionRows(board: readonly BoardEntry[], stamp: PreseasonProjectionStamp): readonly PreseasonProjectionRow[] {
  return board.map((entry) => ({
    season: stamp.season,
    source: stamp.source,
    playerId: entry.playerId,
    rank: entry.rank,
    positionRank: entry.positionRank,
    projectedPoints: entry.projectedPoints,
    valueOverReplacement: entry.valueOverReplacement,
    valueRank: entry.valueRank,
    expectedGames: entry.expectedGames,
    floorPoints: entry.outlook.floor,
    medianPoints: entry.outlook.median,
    ceilingPoints: entry.outlook.ceiling,
    tier: entry.tier,
    asOf: stamp.asOf,
    momentKind: stamp.momentKind,
  }));
}

/** One `BoardReason` turned into a row: `code` is the union's own tag, `detail` is the
 *  discriminator WITHIN that tag (see `preseasonBoardReasons`'s own docblock — a law id for `"law"`
 *  rows, `''` for every other current variant), `payload` is every other field of that variant,
 *  verbatim — see the same docblock for why there is no `asOf` here, unlike `PreseasonProjectionRow`. */
export interface PreseasonBoardReasonRow {
  readonly season: number;
  readonly source: string;
  readonly playerId: string;
  readonly code: string;
  readonly detail: string;
  readonly payload: JsonObject;
}

/** The discriminator WITHIN a reason's `code` — the field `detail` stores (fix round, superseding
 *  Task 7's original PK). A `"law"` reason's own `lawId` is the only variant that can repeat for one
 *  player on one board today, so it is the only one that needs a second key; every other variant is
 *  `''`, since none of them can fire twice for the same candidate. */
function reasonDetail(reason: BoardReason): string {
  return reason.code === "law" ? reason.lawId : "";
}

/**
 * Every reason on a board, turned into rows — one row per `(player, reason)` pair, `code`/`detail`
 * and `payload` split exactly as `preseasonBoardReasons` stores them. `detail` (`reasonDetail`) is
 * what lets a player carry MORE THAN ONE `"law"` reason: `target_share_persistence` and
 * `wr_target_competition` can both be true for the same receiver, and without a second key inside
 * `code` the table's PK could hold only one of them.
 */
export function reasonRows(board: readonly BoardEntry[], stamp: BoardStamp): readonly PreseasonBoardReasonRow[] {
  const rows: PreseasonBoardReasonRow[] = [];
  for (const entry of board) {
    for (const reason of entry.reasons) {
      const { code, ...payload } = reason;
      rows.push({
        season: stamp.season,
        source: stamp.source,
        playerId: entry.playerId,
        code,
        detail: reasonDetail(reason),
        payload: payload as JsonObject,
      });
    }
  }
  return rows;
}

const INSERT_CHUNK_ROWS = 2_000;

/**
 * Writes a board, idempotently, returning how many rows were ACTUALLY new.
 *
 * `onConflictDoNothing` and never `DoUpdate`, matching every writer in the point-in-time store: a
 * board taken at a stated moment is immutable. A refit says something different, and it says it
 * under a new `source` or at a new moment, which is a new row. Overwriting would rewrite a number
 * somebody was shown last Tuesday and leave nothing to notice it by.
 *
 * IMMUTABLE IS NOT THE SAME AS PERMANENT for a LIVE board — see `writePreseasonBoard` below, which
 * runs this write behind a delete when the moment is live. This function itself is unchanged and is
 * still the only write a replay board ever takes.
 */
export async function recordPreseasonProjections(db: Db | DbTx, rows: readonly PreseasonProjectionRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row }));
    const inserted = await db
      .insert(preseasonProjections)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: preseasonProjections.id });
    written += inserted.length;
  }
  return written;
}

/** `preseasonBoardReasons`'s conflict target — the whole PK, `detail` included — as JS property
 *  names, the shape `excludedSetFor`/`changedRowWhere` (`@/db/upsert`) both key off. */
const REASON_KEYS: readonly string[] = ["source", "season", "playerId", "code", "detail"];

/**
 * Writes a board's reasons, returning how many rows this call ACTUALLY WROTE — a fresh insert, or a
 * replaced payload on a row that already existed.
 *
 * `onConflictDoUpdate`, not `onConflictDoNothing` (fix round, superseding Task 7's original write):
 * this table's own docblock promises a rerun REPLACES its opinion, and a payload can genuinely
 * change between two runs of the "same" board — a refreshed `measured.json` moves a law's own
 * `effect`, a player's own facts move his `magnitude` — so a writer that only skipped conflicting
 * rows would leave a stale payload sitting under a row still claiming to be current.
 *
 * `changedRowWhere` (the SAME idiom `stats-pipeline/persist.ts` uses for exactly this reason, see
 * its own docblock) is what keeps a rerun with an UNCHANGED payload a true no-op: Postgres itself
 * decides, via `WHERE payload IS DISTINCT FROM excluded.payload`, so a row whose incoming payload
 * matches what's stored is neither updated nor returned by `RETURNING` — the write genuinely did
 * not happen, rather than merely being labelled a no-op after the fact.
 */
export async function recordPreseasonBoardReasons(db: Db | DbTx, rows: readonly PreseasonBoardReasonRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row }));
    const inserted = await db
      .insert(preseasonBoardReasons)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          preseasonBoardReasons.source,
          preseasonBoardReasons.season,
          preseasonBoardReasons.playerId,
          preseasonBoardReasons.code,
          preseasonBoardReasons.detail,
        ],
        set: excludedSetFor(preseasonBoardReasons, REASON_KEYS),
        where: changedRowWhere(preseasonBoardReasons, REASON_KEYS),
      })
      .returning({ code: preseasonBoardReasons.code });
    written += inserted.length;
  }
  return written;
}

/**
 * Retires one board: every `preseason_projections` row for a `(season, source)` AT ANY STAMP, and
 * every `preseason_board_reasons` row that explained them.
 *
 * FOR A LIVE BOARD ONLY, enforced by its one caller (`writePreseasonBoard` below) and never exposed
 * to a replay path. An archived board is the primary record every published measurement was scored
 * against, exactly as an archive season's roster rows are, and nothing in a write path may delete
 * one.
 *
 * BOTH TABLES, ALWAYS, and never one without the other: `preseason_board_reasons` carries no `as_of`
 * at all (its PK is `(source, season, player_id, code, detail)`), so a reason survives every
 * re-persist by construction. Retiring the projections alone would leave a reason row explaining a
 * rank that no longer exists, which `boardReasons` would go on serving to any surface that draws one
 * man.
 */
export async function deletePreseasonBoard(
  db: Db | DbTx,
  { season, source }: Omit<BoardStamp, "asOf">,
): Promise<{ readonly projections: number; readonly reasons: number }> {
  const projections = await db
    .delete(preseasonProjections)
    .where(and(eq(preseasonProjections.season, season), eq(preseasonProjections.source, source)))
    .returning({ id: preseasonProjections.id });
  const reasons = await db
    .delete(preseasonBoardReasons)
    .where(and(eq(preseasonBoardReasons.season, season), eq(preseasonBoardReasons.source, source)))
    .returning({ code: preseasonBoardReasons.code });
  return { projections: projections.length, reasons: reasons.length };
}

/**
 * THE FROZEN SOURCES (fit-round final review, 2026-09-02): the board names no write may touch while
 * the frozen-state ruling stands.
 *
 * WHAT THE RULING IS. The fit round ended with two held-out bar breaks, so `BOARD_SOURCE` points
 * back at v7 (see its own docblock) while every fitted file on this tree is the v9 configuration.
 * The ledger's adjudication: the 2026 data year runs on the v7 configuration exactly as committed,
 * and ALL fitted-file regeneration belongs to the 2027 fit round. The store's v7 rows are therefore
 * the product, and this tree can no longer reproduce them.
 *
 * WHY A GUARD RATHER THAN A NOTE. `scripts/preseason-persist.ts` is one command away from destroying
 * them, and neither of its two paths would say a word:
 *
 *   - THE LIVE PATH RETIRES BEFORE IT WRITES. `writePreseasonBoard`'s live arm deletes every row for
 *     `(season, source)` AT ANY STAMP and writes the fresh board in the same transaction. Run today
 *     against 2026, it would delete the 546 rows the product serves and replace them with rows this
 *     tree's constants produce, under v7's name. There is no second copy and no `as_of` to fall back
 *     to: the previous generation is gone.
 *   - THE REPLAY PATH REWRITES REASONS WITH NO STAMP TO PROTECT THEM. `preseason_board_reasons`
 *     carries no `as_of` and is written with `onConflictDoUpdate`, so an archive re-run leaves the
 *     archived POINTS untouched (their unique key already exists) while silently replacing their
 *     EXPLANATIONS with the 87-law family's. The result is an archive whose reasons describe numbers
 *     it is not showing, which is the same silent-stale shape v2 through v5 each shipped once.
 *
 * THE GUARD IS WIDER THAN THE LIVE SEASON, deliberately. The live arm deletes by `(season, source)`,
 * so a live-moment write aimed at an ARCHIVE season under a frozen name would delete that archive
 * outright. Nothing legitimate needs any write under a served name while the freeze stands, so the
 * guard does not try to tell the cases apart.
 *
 * HOW IT LIFTS. `writePreseasonBoard`'s `unfrozen` option, reachable only through the persist
 * script's `--unfreeze` flag, which prints what it is overriding. The 2027 fit round will bump
 * `BOARD_SOURCE` to a fresh name, at which point these two constants name boards nobody serves and
 * this set should be re-pointed at whatever the new served names are, never simply emptied.
 */
export const FROZEN_BOARD_SOURCES: ReadonlySet<string> = new Set([BOARD_SOURCE, BOARD_SOURCE_V1_RAW]);

/** Options every write path shares. Separate from the stamp because this is a property of the RUN,
 *  never of the board being written. */
export interface BoardWriteOptions {
  /** Lifts `FROZEN_BOARD_SOURCES` for this one call. The persist script's `--unfreeze` flag is the
   *  only caller that sets it, and it prints a warning when it does. */
  readonly unfrozen?: boolean;
}

/**
 * Refuses a write under a frozen source, BEFORE any statement runs, naming the ruling and how to
 * lift it. Both arms of `writePreseasonBoard` call this first; putting it inside the writer rather
 * than in the script is what makes it unbypassable by a new caller.
 */
function assertNotFrozen(stamp: PreseasonProjectionStamp, { unfrozen = false }: BoardWriteOptions): void {
  if (unfrozen || !FROZEN_BOARD_SOURCES.has(stamp.source)) return;
  throw new Error(
    `"${stamp.source}" is a FROZEN board source and this ${stamp.momentKind} write for ${stamp.season} is refused. ` +
      "The fit round's frozen-state ruling holds the 2026 data year on the v7 configuration exactly as committed, " +
      "and this tree's fitted files are the v9 configuration, so a write here would replace the rows the product " +
      "serves (live) or rewrite an archive's reasons out from under its own points (replay) with numbers no stored " +
      "board was measured on. The 2027 fit round lifts this by bumping BOARD_SOURCE to a fresh name. " +
      "To override deliberately, pass --unfreeze to `npm run projections:preseason:persist`.",
  );
}

/** Which write path a board took, and what it did. See `writePreseasonBoard`. */
export interface BoardWriteCounts {
  readonly mode: "retire_generation" | "append";
  readonly written: number;
  readonly reasonsWritten: number;
  /** Rows of a PRIOR live generation this write retired. Always 0 on the replay path, which retires
   *  nothing by construction, and 0 on the first live write of a season. */
  readonly retiredProjections: number;
  readonly retiredReasons: number;
}

/**
 * THE ONE PLACE A BOARD IS WRITTEN — retiring for a LIVE moment, appending for a REPLAY one.
 *
 * WHY A LIVE BOARD MUST RETIRE ITS PREDECESSOR. `preseasonProjectionsAsOf` (and
 * `preseasonProjectionsFor`, which the player page reads) resolve `DISTINCT ON (player_id)` over
 * `as_of <= bound`, so a player carried by YESTERDAY's live board and absent from today's smaller one
 * is still returned, with yesterday's points, yesterday's rank and yesterday's reasons. That is not a
 * point-in-time reconstruction of anything: nobody asked for yesterday's board, and the row is
 * indistinguishable, at the reader, from a row today's board actually produced. It is how a running
 * back his club had released stayed at value#118 on the 2026 board after his roster row had already
 * been corrected — the roster fix cleared the input and the stale OUTPUT went on being drawn. A live
 * board is a claim about a roster that is still moving; the only honest thing to do with the previous
 * claim is to retire it.
 *
 * WHY A REPLAY BOARD MUST NOT. Every archived board is the record a published measurement was taken
 * against (`docs/research/2026-08-31-market-edge-closeout.md`'s scorecards read these exact rows),
 * and a replay moment is derived from a season that has been played, so a second persist of it is a
 * refit rather than a refresh. That path is byte-identical to the write every archived board landed
 * under: `recordPreseasonProjections` then `recordPreseasonBoardReasons`, in that order, no
 * transaction, no delete reachable from here.
 *
 * THE SPLIT COMES FROM THE MOMENT, never from a recomputation: `stamp.momentKind` is the kind
 * `loadPreseason` already resolved from the branded `BoardMoment`, carried on every row this writes.
 *
 * REFUSES AN EMPTY LIVE BOARD, the same fail-fast reading `ingestWeek1Rosters` gives an empty roster
 * capture: "retire the generation and write nothing in its place" is the one outcome that must never
 * happen quietly. The replay path needs no guard, since writing nothing there deletes nothing.
 */
export async function writePreseasonBoard(
  db: Db,
  stamp: PreseasonProjectionStamp,
  board: readonly BoardEntry[],
  options: BoardWriteOptions = {},
): Promise<BoardWriteCounts> {
  // FIRST, before a row is built and long before a statement runs: see `FROZEN_BOARD_SOURCES`.
  assertNotFrozen(stamp, options);
  const rows = projectionRows(board, stamp);
  const reasons = reasonRows(board, stamp);

  if (stamp.momentKind === "replay") {
    const written = await recordPreseasonProjections(db, rows);
    const reasonsWritten = await recordPreseasonBoardReasons(db, reasons);
    return { mode: "append", written, reasonsWritten, retiredProjections: 0, retiredReasons: 0 };
  }

  if (board.length === 0) {
    throw new Error(
      `The live board built for ${stamp.season} under "${stamp.source}" is empty, so there is nothing to replace its stored generation with. Refusing to retire a board on the strength of an empty one.`,
    );
  }

  return db.transaction(async (tx) => {
    const retired = await deletePreseasonBoard(tx, stamp);
    const written = await recordPreseasonProjections(tx, rows);
    const reasonsWritten = await recordPreseasonBoardReasons(tx, reasons);
    return {
      mode: "retire_generation",
      written,
      reasonsWritten,
      retiredProjections: retired.projections,
      retiredReasons: retired.reasons,
    };
  });
}

const SELECTED = {
  season: preseasonProjections.season,
  source: preseasonProjections.source,
  playerId: preseasonProjections.playerId,
  rank: preseasonProjections.rank,
  positionRank: preseasonProjections.positionRank,
  projectedPoints: preseasonProjections.projectedPoints,
  valueOverReplacement: preseasonProjections.valueOverReplacement,
  valueRank: preseasonProjections.valueRank,
  expectedGames: preseasonProjections.expectedGames,
  floorPoints: preseasonProjections.floorPoints,
  medianPoints: preseasonProjections.medianPoints,
  ceilingPoints: preseasonProjections.ceilingPoints,
  tier: preseasonProjections.tier,
  asOf: preseasonProjections.asOf,
  momentKind: preseasonProjections.momentKind,
} as const;

/**
 * One board for one season as it was knowable at `asOf`, one row per player.
 *
 * The same `DISTINCT ON` + `as_of <=` shape every read in this engine uses, and carried here even
 * though a product surface passes a moment far in the future: the gate costs nothing when nothing
 * is being hidden, and a reader that did not have one is a reader a backtest cannot reuse.
 */
export async function preseasonProjectionsAsOf(
  db: ReadonlyDb,
  { season, source, asOf }: BoardStamp,
): Promise<readonly PreseasonProjectionRow[]> {
  return db
    .selectDistinctOn([preseasonProjections.playerId], SELECTED)
    .from(preseasonProjections)
    .where(
      and(
        eq(preseasonProjections.season, season),
        eq(preseasonProjections.source, source),
        lte(preseasonProjections.asOf, asOf),
      ),
    )
    .orderBy(asc(preseasonProjections.playerId), desc(preseasonProjections.asOf));
}

/**
 * The board's opinion of a named handful of players, for a surface that draws one man or a lineup.
 *
 * A player the board never ranked is ABSENT FROM THE RESULT rather than present with a zero. There
 * is no projection for a man the model could not build one for, and the caller's job is to print a
 * dash — `NOT_STARTED_DASH` — rather than to invent the number that would fit.
 */
export async function preseasonProjectionsFor(
  db: ReadonlyDb,
  { season, source, asOf }: BoardStamp,
  playerIds: readonly string[],
): Promise<readonly PreseasonProjectionRow[]> {
  if (playerIds.length === 0) return [];
  return db
    .selectDistinctOn([preseasonProjections.playerId], SELECTED)
    .from(preseasonProjections)
    .where(
      and(
        eq(preseasonProjections.season, season),
        eq(preseasonProjections.source, source),
        lte(preseasonProjections.asOf, asOf),
        inArray(preseasonProjections.playerId, [...playerIds]),
      ),
    )
    .orderBy(asc(preseasonProjections.playerId), desc(preseasonProjections.asOf));
}

/** Every `BoardReason` tag this reader knows how to reconstruct — hand-paired with the union in
 *  `board.ts`, the same literal-and-type pairing this engine keeps everywhere a runtime list stands
 *  in for a type TypeScript itself erases (`populations.ts`'s `SKILL_POSITIONS`, for one). */
const KNOWN_REASON_CODES: ReadonlySet<BoardReason["code"]> = new Set([
  "availability",
  "offseason_share_gained",
  "offseason_share_lost",
  "changed_team",
  "new_play_caller",
  "rookie",
  "scarcity",
  "tier_cliff",
  "law",
  "market_unlisted",
  "market_anchor",
]);

function isKnownReasonCode(code: string): code is BoardReason["code"] {
  return KNOWN_REASON_CODES.has(code as BoardReason["code"]);
}

/**
 * One stored row, reconstructed into the exact `BoardReason` it was written from — `reasonRows`
 * split a reason into `code` (the tag) and `payload` (everything else); this puts them back
 * together. Trusted rather than re-validated field by field, because every row here was written by
 * `reasonRows` from a real `BoardReason` — nothing hand-edits this table the way `measured.json` can
 * be hand-edited, so this is not the boundary `registry.ts`'s `parseMeasuredJson` is.
 */
function reasonFromRow(code: string, payload: JsonObject): BoardReason | undefined {
  if (!isKnownReasonCode(code)) return undefined;
  return { code, ...payload } as BoardReason;
}

/**
 * Every reason a board stored for a season, keyed by player.
 *
 * A stored row whose `code` this reader does not recognise — a variant retired since the row was
 * written, or a hand-edited table — is DROPPED rather than thrown: an explanation surface losing one
 * reason is a smaller failure than a whole board request failing. `console.warn` names how many were
 * dropped, once, after the whole read, so the drop is visible rather than silent.
 */
export async function boardReasons(
  db: ReadonlyDb,
  source: string,
  season: number,
): Promise<ReadonlyMap<string, readonly BoardReason[]>> {
  const rows = await db
    .select({
      playerId: preseasonBoardReasons.playerId,
      code: preseasonBoardReasons.code,
      payload: preseasonBoardReasons.payload,
    })
    .from(preseasonBoardReasons)
    .where(and(eq(preseasonBoardReasons.source, source), eq(preseasonBoardReasons.season, season)));

  const out = new Map<string, BoardReason[]>();
  let dropped = 0;
  for (const row of rows) {
    const reason = reasonFromRow(row.code, row.payload);
    if (reason === undefined) {
      dropped += 1;
      continue;
    }
    const list = out.get(row.playerId);
    if (list === undefined) out.set(row.playerId, [reason]);
    else list.push(reason);
  }
  if (dropped > 0) {
    console.warn(`boardReasons: dropped ${dropped} row(s) with an unrecognised reason code for source "${source}", season ${season}.`);
  }
  return out;
}
