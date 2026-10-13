/**
 * WEIGHTED ISOTONIC REGRESSION (pool-adjacent-violators), constrained NON-INCREASING in `x`.
 *
 * Shared by every curve in this engine that fits "more of a scarce, ordered resource implies no
 * worse an outcome" — `preseason/rookie-curve.ts` (draft capital) and `market/curve.ts` (ADP rank)
 * both fit exactly this shape and are fit the same way on purpose: one algorithm, proven once, used
 * everywhere a monotone-decreasing curve is measured rather than assumed.
 */

/** Implemented as the textbook INCREASING PAVA over the negated values and negated back, rather
 *  than a second, separately-written decreasing variant. `xs` must already be sorted ascending and
 *  carry no duplicates; every caller guarantees both by building `values`/`weights` from a `Map`
 *  keyed on the ordering variable (a pick, a rounded ADP rank). */
export function isotonicNonIncreasing(values: readonly number[], weights: readonly number[]): readonly number[] {
  interface Block {
    value: number;
    weight: number;
    count: number;
  }
  const blocks: Block[] = [];
  for (let index = 0; index < values.length; index += 1) {
    let block: Block = { value: -values[index]!, weight: weights[index]!, count: 1 };
    blocks.push(block);
    // Pool this new block into whatever precedes it until the sequence is non-decreasing again —
    // the whole of PAVA: a violation (this block's mean below the one before it) can only be fixed
    // by merging, and merging can only ever cascade backward, never forward.
    while (blocks.length > 1 && blocks[blocks.length - 2]!.value > block.value) {
      const previous = blocks[blocks.length - 2]!;
      const merged: Block = {
        value: (previous.value * previous.weight + block.value * block.weight) / (previous.weight + block.weight),
        weight: previous.weight + block.weight,
        count: previous.count + block.count,
      };
      blocks.splice(blocks.length - 2, 2, merged);
      block = merged;
    }
  }
  return blocks.flatMap((block) => Array<number>(block.count).fill(-block.value));
}
