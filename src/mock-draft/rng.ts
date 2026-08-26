/**
 * The mock draft's ONE source of randomness. Every bot decision this phase makes — who a bot
 * picks, how long a bot waits before picking, whether a run tilts its next pick — draws from an
 * `Rng` this module produced, and nothing in the engine path calls `Math.random()` directly. That
 * is the replayability law: a mock room's entire outcome is a pure function of its stored seed,
 * so replaying a finished room (or reproducing a bug report) means re-running the same seed, not
 * hoping the same thing happens twice.
 *
 * Deterministic, not cryptographic. `Math.random()` cannot be seeded, so no bot-strategy code in
 * this phase may call it — every draw in the engine path goes through an `Rng` built here instead.
 * A mulberry32 generator is small, fast, has no known statistical defects at the scale one mock
 * draft needs (a few hundred draws), and — the property that actually matters here — two instances
 * built from the same seed produce the identical sequence forever.
 */
export interface Rng {
  /** The next pseudorandom value, in the half-open range `[0, 1)`. */
  next(): number;
}

/**
 * mulberry32: a 32-bit state, advanced by a fixed odd increment and run through a small
 * xorshift-multiply mix. The state lives in this closure, not on the returned object, so the
 * `Rng` a caller holds is an opaque draw source — nothing external can read or rewind its
 * position, which is what "seed decides everything, nothing else can" actually requires.
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * A seeded Fisher-Yates over a fresh copy — the input array is never touched. Hoisted here from
 * `@/mock-draft/archetypes` (Phase 4.5, Task 5) the day a second seeded draw needed it
 * (`drawBotSeats`, `@/mock-draft-service/start`): one shuffle implementation means the archetype
 * deal and the bot seat draw consume a stream the same way forever, and a replayed seed can
 * never diverge because two hand-rolled shuffles drifted. The algorithm is byte-identical to the
 * one that shipped in Task 3 — a relocation, never a re-deal.
 */
export function seededShuffle<T>(items: readonly T[], rng: Rng): readonly T[] {
  const deck = [...items];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const swap = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = swap;
  }
  return deck;
}

/**
 * FNV-1a over the key's UTF-16 code units, folding the numeric seed in as the hash's own starting
 * value rather than appending it to the string — one pass, no allocation, and the seed still
 * changes every output bit the way a genuine FNV offset-basis would.
 */
function seedForKey(seed: number, key: string): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * One draft seed fans out into as many independent draw streams as the room has bots, keyed by
 * whatever identifies each one (a bot's roster id, or `${botId}:${purpose}` when a single bot
 * needs more than one stream — pick selection and think-delay, say). `rngFor(seed, key)` called
 * twice with the same arguments returns two `Rng`s that draw the identical sequence, so a bot's
 * stream never depends on call order or on how many draws a DIFFERENT bot has taken — the
 * property `createSeededRng`'s docblock calls out as the whole point of a closure-held state.
 */
export function rngFor(seed: number, key: string): Rng {
  return createSeededRng(seedForKey(seed, key));
}
