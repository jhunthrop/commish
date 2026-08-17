/** FNV-1a — a small, stable string hash. Same id, same seed, forever. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 — the same deterministic PRNG the mock dataset generator uses. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A fair, reproducible draft order: the team ids are sorted (so the caller's query order
 * can't influence the result) and then Fisher-Yates shuffled with a PRNG seeded from the
 * draft id. Reproducible matters for debugging a real draft; the authoritative record is
 * still the order written into the START_DRAFT action, not this function.
 *
 * The shuffle mutates a local copy only — the caller's array is never touched.
 */
export function draftOrderFor(draftId: string, teamIds: readonly string[]): readonly string[] {
  const random = mulberry32(hashString(draftId));
  const out = [...teamIds].sort();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}
