import { mulberry32 } from "@/lib/random/mulberry32";

/** FNV-1a — a small, stable string hash. Same id, same seed, forever. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
