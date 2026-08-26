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
 * The draw: a fair, reproducible sequence of every team, drawn once. The team ids are sorted
 * (so the caller's query order can't influence the result) and then Fisher-Yates shuffled with
 * a PRNG seeded from the draft id. Reproducible matters for debugging a real draft; the
 * authoritative record is still the order written into the START_DRAFT action, not this
 * function.
 *
 * This is the WHOLE of the pre-Phase-3.5 `draftOrderFor` — kept, unchanged, as its own name
 * (rather than folded into `draftOrderFor` below) for two reasons: it is exactly NFFC's own
 * "draw order" step (who gets to choose a slot, and in what order), and its own test file keeps
 * a byte-identical reference to compare `draftOrderFor`'s no-preference behavior against, so a
 * future change to the slot-assignment step can never silently change the shuffle itself.
 *
 * The shuffle mutates a local copy only — the caller's array is never touched.
 */
export function drawSequenceFor(draftId: string, teamIds: readonly string[]): readonly string[] {
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

/** A team's ranked draft-slot wish list, most-wanted first. 1-based slot numbers. */
export type SlotPreferenceMap = Readonly<Record<string, readonly number[]>>;

/** Who resolves first when preferences and indifference collide — see `assignDraftSlots`. */
export type SlotAssignMode = "draw-order" | "ranked-first";

/**
 * NFFC's Kentucky Derby System, run over `drawOrder`: each team, taken in TURN — draw order,
 * one team fully resolved before the next is even considered — gets its highest-ranked slot
 * that is still free at that moment. A team with no preference, or whose whole ranking is
 * already taken by the time its turn comes, takes the lowest slot still free at that same
 * moment: exactly the slot an UNRANKED team would have gotten anyway (its draw position IS its
 * slot when nobody has preferences at all), so the fallback is additive rather than a second
 * rule, and never deferred to a second pass — deferring it would let a later team's preference
 * jump a slot an earlier, unranked team would otherwise have claimed at ITS turn.
 *
 * A ranked slot number outside `[1, drawOrder.length]` is ignored rather than assigned — the
 * write path (`setSlotPreference`, `@/draft-service/slot-preference`) already refuses one before
 * it can be stored, so this is a defensive bound on already-trusted data, not a validation path
 * a caller is expected to exercise.
 *
 * Pure: never touches the database, never reads a clock. `draftOrderFor` below is the only
 * caller that knows where `drawOrder` and `preferences` actually come from.
 */
export function assignDraftSlots(
  drawOrder: readonly string[],
  preferences: SlotPreferenceMap,
  mode: SlotAssignMode = "draw-order",
): readonly string[] {
  const slotCount = drawOrder.length;
  // "ranked-first" (mock rooms — founder directive 2026-08-26): teams that EXPRESSED a choice
  // resolve before teams that did not, so a practice host's picked seat is granted outright
  // instead of surviving only when the shuffle happens to draw them early — under the pure
  // Kentucky Derby rule an indifferent bot drawn first consumes `lowestFree` and can block the
  // one seat anyone in the room actually asked for. Real leagues keep "draw-order" untouched
  // (ruling 27's fair-lottery semantics): there, every seat-holder is a person and the draw IS
  // the fairness. Within each group the draw order still decides ties, so two ranked teams
  // wanting one slot resolve exactly as before.
  const resolveOrder =
    mode === "ranked-first"
      ? [...drawOrder.filter((id) => (preferences[id] ?? []).length > 0), ...drawOrder.filter((id) => (preferences[id] ?? []).length === 0)]
      : drawOrder;
  const slots: (string | undefined)[] = new Array(slotCount).fill(undefined);
  const taken = new Set<number>();
  // The lowest slot not yet claimed, advanced lazily (only when a team actually falls back to
  // it) and monotonically — once passed, a slot number is never revisited, which is safe
  // because every slot below it is either already taken or already assigned.
  let lowestFree = 1;

  for (const teamId of resolveOrder) {
    const ranking = preferences[teamId] ?? [];
    const preferred = ranking.find((slot) => slot >= 1 && slot <= slotCount && !taken.has(slot));
    let assigned: number;
    if (preferred !== undefined) {
      assigned = preferred;
    } else {
      while (taken.has(lowestFree)) lowestFree += 1;
      assigned = lowestFree;
    }
    taken.add(assigned);
    slots[assigned - 1] = teamId;
  }

  return slots as readonly string[];
}

/**
 * The full Kentucky Derby draw: `drawSequenceFor`'s seeded shuffle, then `assignDraftSlots`
 * over it. `preferences` defaults to empty, so every existing call site (and every league where
 * nobody ever opens the slot-preference panel) drafts in exactly the order it always has —
 * the feature is additive by construction, not by convention.
 */
export function draftOrderFor(
  draftId: string,
  teamIds: readonly string[],
  preferences: SlotPreferenceMap = {},
  mode: SlotAssignMode = "draw-order",
): readonly string[] {
  return assignDraftSlots(drawSequenceFor(draftId, teamIds), preferences, mode);
}
