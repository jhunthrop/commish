import type { ReadonlyDb } from "@/db/client";
import type { Position } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints, type ScoringRules } from "@/scoring/compute";
import { statLinesAsOf } from "@/projections/lines";
import { RANK_BANDS, scoreCard, type Observation, type RankBandName, type ScoreCard } from "@/projections/metrics";
import type { BoardEntry } from "./board";
import type { BoardMoment, PreseasonInputs } from "./source";

/**
 * THE BENCHMARK SCORECARD MACHINERY — extracted from `scripts/preseason-report.ts` (where it was
 * built and first proved out) so `scripts/market-edge-scorecard.ts` (Task 11's own held-out-season
 * run) scores every arm with the IDENTICAL rules, rather than a second, drifting copy of "what
 * counts as a match" and "how a band is assigned." One reader-visible consequence: a number this
 * module returns means the same thing wherever it is printed.
 */

const LAST_REGULAR_WEEK = 18;

/**
 * TASK 2 — "A LIVE BOARD MUST BE STRUCTURALLY UNGRADEABLE."
 *
 * Every scorecard in this engine scores a board's projections against `actualSeasonPoints` — what
 * players really scored, over a REGULAR SEASON THAT HAS ALREADY BEEN PLAYED. A board taken at a LIVE
 * moment (`source.ts`'s `BoardMoment`) is a claim about a season that has not been played yet: there
 * is no actual outcome for it, and running it through this machinery anyway would not fail loudly —
 * it would silently score against whatever the store happens to hold (nothing, today; a leaked
 * partial season, tomorrow) and print a number that looks like a measurement and is not one.
 *
 * Called once, at the top of every grading run, before a single board is built or scored — the same
 * "refuse before doing any work" shape `loadPreseason`'s own leakage guards use, applied to the one
 * thing THIS module is responsible for: a board only this file's readers ever compare to reality.
 */
export function assertGradableMoment(momentKind: BoardMoment["kind"], season: number): void {
  if (momentKind === "live") {
    throw new Error(
      `${season}'s board was taken at a LIVE moment. The season has not been played yet, so there is no actual outcome to grade it against. The scorecard only grades REPLAY boards; a live board is structurally ungradeable.`,
    );
  }
}

/**
 * THE CONVERGENCE POINT (fix round, I3). Four scripts grade a preseason board against reality —
 * `preseason-report.ts`, `preseason-diagnose.ts`, `blend-fit.ts` and `market-edge-scorecard.ts` —
 * and before this each one called `loadPreseason` on its own, with nothing in between forcing
 * `assertGradableMoment` to run. Wiring the guard into ONE of the four would have left three
 * unguarded, which is exactly the shape a defect hides in. `gradableInputs` is the seam all four are
 * changed to call THROUGH, immediately after `loadPreseason` and before anything reads `inputs` for
 * grading:
 *
 * ```ts
 * const inputs = gradableInputs(await loadPreseason(db, season));
 * ```
 *
 * Returns `inputs` unchanged (identity on the happy path) so wrapping the assignment is the whole
 * change at each call site — there is no second variable to thread through, and a reviewer diffing
 * any one of the four scripts sees the guard land in exactly the same one-line shape.
 */
export function gradableInputs(inputs: PreseasonInputs): PreseasonInputs {
  assertGradableMoment(inputs.momentKind, inputs.season);
  return inputs;
}

/** Far past any correction: outcomes are scored against, never fed in. */
const FINAL = new Date("9999-12-31T00:00:00.000Z");

/** What every player on a board actually scored over the regular season, under `rules` (PPR unless a
 *  format's own scorecard says otherwise; the scoring-formats round). Zero for a man who never played. */
export async function actualSeasonPoints(
  db: ReadonlyDb,
  season: number,
  positions: ReadonlyMap<string, Position>,
  rules: ScoringRules = PPR_SCORING,
): Promise<ReadonlyMap<string, number>> {
  const rows = await statLinesAsOf(db, { season, week: { from: 1, to: LAST_REGULAR_WEEK }, asOf: FINAL });
  const totals = new Map<string, number>();
  for (const row of rows) {
    const position = positions.get(row.line.playerId);
    if (position === undefined) continue;
    totals.set(row.line.playerId, (totals.get(row.line.playerId) ?? 0) + computeFantasyPoints(row.line, position, rules));
  }
  return totals;
}

/**
 * Scores one ordering against outcomes, banded by a COMMON prior where one is given.
 *
 * Banding by a shared ranking rather than by each source's own is the fix every previous research
 * document in this engine asked for and none could apply: model v1 and model v2 both record that a
 * band-by-band comparison between sources is "indicative rather than exact" because the two arms do
 * not hold the same players in a band, and both name average draft position as the fix. This phase
 * ingested it, so the fix is available here for the first time.
 */
export function scoreOrdering(
  predicted: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
  eligible: ReadonlySet<string>,
  bandBy: ReadonlyMap<string, number> | null,
): { readonly overall: ScoreCard; readonly byBand: Readonly<Record<RankBandName, ScoreCard>> } {
  const rows = [...predicted.entries()]
    .filter(([playerId]) => eligible.has(playerId) && actual.has(playerId))
    .map(([playerId, value]) => ({ playerId, value, actual: actual.get(playerId)! }));

  const order = [...rows].sort((a, b) => {
    if (bandBy === null) return b.value - a.value || a.playerId.localeCompare(b.playerId);
    return (bandBy.get(a.playerId) ?? Infinity) - (bandBy.get(b.playerId) ?? Infinity) || a.playerId.localeCompare(b.playerId);
  });
  const bandOf = new Map(order.map((row, index) => [row.playerId, index + 1] as const));

  const observationsIn = (from: number, to: number): readonly Observation[] =>
    rows
      .filter((row) => {
        const rank = bandOf.get(row.playerId)!;
        return rank >= from && rank <= to;
      })
      .map((row) => ({ predicted: row.value, actual: row.actual }));

  return {
    overall: scoreCard(rows.map((row) => ({ predicted: row.value, actual: row.actual }))),
    byBand: Object.fromEntries(
      RANK_BANDS.map((band) => [band.name, scoreCard(observationsIn(band.from, band.to))]),
    ) as Record<RankBandName, ScoreCard>,
  };
}

export function boardPoints(board: readonly BoardEntry[]): ReadonlyMap<string, number> {
  return new Map(board.map((entry) => [entry.playerId, entry.projectedPoints] as const));
}

export function boardValues(board: readonly BoardEntry[]): ReadonlyMap<string, number> {
  return new Map(board.map((entry) => [entry.playerId, entry.valueOverReplacement] as const));
}
