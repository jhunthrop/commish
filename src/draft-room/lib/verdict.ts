import type { Player } from "@research-ts/domain/player";
import type { CompletedPick } from "@/draft-engine";
import type { StatComparison } from "@/components/ui/stat";
import { boardRanks } from "../state/pick-review";
import { DRAFT_ROOM_CONFIG } from "../state/config";

/**
 * THE VERDICT — the fun pass's single highest-value change
 * (`docs/design/2026-08-27-fun-pass-spec.md`, "The single highest-value change").
 *
 * *"We already compute a pick's board rank at the moment it is made — it is the 'RB4 on the
 * board' in today's results copy. The same number, framed as a verdict instead of a receipt, is
 * the difference between a room that records what you did and a room that tells you whether it
 * was any good. No new data, no new honesty."*
 *
 * So this module adds no data. `boardRanks` (`../state/pick-review`) is the existing board-rank
 * computation — the pool order `START_DRAFT` snapshotted, which is also what prints the position
 * rank on the results page — and everything below is arithmetic over it and the pick number.
 */
export type VerdictKind = "steal" | "reach" | "even";

export interface Verdict {
  readonly kind: VerdictKind;
  /**
   * `pickSlot − boardRank`: how many picks LATER than his own board rank the player actually
   * went. Positive is a player who lasted (a steal), negative is a player taken ahead of his
   * rank (a reach). The sign convention is the whole grammar of the chip and is stated here
   * rather than at three call sites.
   */
  readonly slip: number;
  /** `slip`, already carrying its sign: "+11", "-3", "0". */
  readonly value: string;
  /**
   * What `Stat` colours by, or `undefined` when there is no population to compare against —
   * the first pick of a draft, where nothing has happened yet. Undefined renders ordinary ink,
   * which is the correct answer: a number is never coloured for looking big.
   */
  readonly comparison: StatComparison | undefined;
}

/**
 * The comparison set every verdict in one room is ranked inside: the slips of the picks this
 * draft has actually made, plus the board ranks those slips came from.
 *
 * The population has to be genuine and stated (rule 1's magnitude amendment), and this is the
 * one that is genuinely available on every surface a verdict renders on: the pool row asks "if I
 * took him here, how would that compare to the picks this room has already made?", and the pick
 * log asks the same question about a pick that happened. One population, three surfaces, no
 * surface inventing a scale of its own.
 *
 * Built once per render pass by the surface that owns the data, never per row: it is O(picks)
 * plus one map over the pool, and sixty pool rows each rebuilding it would be sixty scans of the
 * same log.
 */
export interface VerdictPopulation {
  /** playerId → 1-based rank in the pool order the draft snapshotted. */
  readonly boardRanks: ReadonlyMap<string, number>;
  /** Every completed pick's own slip, ascending. Sorted so a percentile is a scan, not a sort
   *  per row. Empty before the first pick, which is what makes an early verdict uncoloured. */
  readonly slips: readonly number[];
}

/** How many picks later than his board rank a player actually went. */
export function slipOf(boardRank: number, pickSlot: number): number {
  return pickSlot - boardRank;
}

/**
 * Steal, reach, or neither. The band is `DRAFT_ROOM_CONFIG.verdict.evenBandPicks` and never a
 * literal here: those picks are the entire difference between "a steal" and "a fine pick", and
 * that judgement belongs somewhere a persona review can find it in one file rather than inside
 * whichever component rendered it first.
 */
export function verdictKindOf(slip: number): VerdictKind {
  const band = DRAFT_ROOM_CONFIG.verdict.evenBandPicks;
  if (slip > band) return "steal";
  if (slip < -band) return "reach";
  return "even";
}

/** "+11", "-3", "0" — the sign is the fact, so it is never dropped for a positive slip. */
function formatSlip(slip: number): string {
  return slip > 0 ? `+${slip}` : String(slip);
}

/**
 * Where `slip` falls inside `slips`, 0..1, by the standard percentile-rank definition (everything
 * below it, plus half of everything equal to it). Half the ties rather than none of them keeps a
 * room where every pick went exactly to board sitting at the middle of its own ramp instead of at
 * the bottom of it.
 */
function percentileOf(slips: readonly number[], slip: number): number {
  let below = 0;
  let equal = 0;
  for (const other of slips) {
    if (other < slip) below += 1;
    else if (other === slip) equal += 1;
  }
  return (below + equal / 2) / slips.length;
}

/**
 * `players` must be the pool's own ranked snapshot order and `picks` must be EVERY pick of the
 * draft, the same two inputs `reviewPicks` takes and for the same reason: a rank is a fact of the
 * order this draft started with, never of a live ranking that has moved since.
 *
 * A pick whose player is not in the snapshot contributes no slip rather than a fabricated one —
 * the same "degrade to nothing rather than a lie" posture `reviewPicks` already takes.
 */
export function verdictPopulation(players: readonly Player[], picks: readonly CompletedPick[]): VerdictPopulation {
  const ranks = boardRanks(players);
  const slips: number[] = [];
  for (const pick of picks) {
    const rank = ranks.get(pick.playerId);
    if (rank !== undefined) slips.push(slipOf(rank, pick.pickNumber));
  }
  return { boardRanks: ranks, slips: slips.sort((a, b) => a - b) };
}

/**
 * One verdict: a board rank against a pick slot, coloured by where its slip falls among the
 * picks this room has already made.
 *
 * The population sentence `Stat` reads out is "Top n% of picks in this room" — a percentile
 * inside a defined set, which is the only thing rule 1's magnitude amendment permits. An empty
 * population (the first pick of a draft) yields no comparison at all rather than a guess.
 */
export function verdictFor(population: VerdictPopulation, boardRank: number, pickSlot: number): Verdict {
  const slip = slipOf(boardRank, pickSlot);
  return {
    kind: verdictKindOf(slip),
    slip,
    value: formatSlip(slip),
    comparison:
      population.slips.length === 0
        ? undefined
        : { percentile: percentileOf(population.slips, slip), population: "picks in this room" },
  };
}

/** The same verdict for a pick that already happened. Null when the pick's player is not in the
 *  snapshotted pool — there is no honest rank to judge it against. */
export function verdictForPick(population: VerdictPopulation, pick: CompletedPick): Verdict | null {
  const rank = population.boardRanks.get(pick.playerId);
  return rank === undefined ? null : verdictFor(population, rank, pick.pickNumber);
}
