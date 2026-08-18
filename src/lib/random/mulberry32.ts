/**
 * mulberry32 — small, fast, deterministic PRNG. Returns floats in [0,1).
 *
 * Shared by every deterministic-shuffle consumer in the repo (draft order, the mock stats
 * dataset). Do not fork this: two copies of a seeded PRNG can silently diverge if only one
 * is ever tuned, and both callers rely on producing byte-identical sequences from the same
 * seed forever.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
