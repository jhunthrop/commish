/**
 * EVERY ADVISOR TUNABLE, in one place (the config-over-hardcoding rule this product keeps
 * everywhere else). Spec: `docs/superpowers/specs/2026-09-07-draft-advisor-design.md`.
 */
export const ADVISOR_CONFIG = {
  plan: {
    /** Turns ahead the plan covers (spec 3.1: "your next three turns"). */
    horizon: 3,
    /** Seeded continuations behind the plan's odds. Measured 2026-09-07 on a 12-team, 15-round
     *  board at pick 41: 200 runs through turn 3 with 40 targets in 176 ms. */
    runs: 200,
    /** How deep into the undrafted board (by value order) the plan draws its target pool from. */
    candidatePoolSize: 40,
    /** Named targets per turn (spec: "two or three named targets"). */
    targetsPerTurn: 3,
    /** Below this survival at a turn a target is a REACH for that turn (spec 3.1a): the plan
     *  places him at an earlier turn where he clears it, or drops him. */
    reachFloor: 0.25,
    /** A fallback is the best player at the turn's position who clears this at that turn. */
    fallbackFloor: 0.7,
  },
  now: {
    /** Rows on the now card (spec 3.2: "top five by the existing score"). */
    shortlistSize: 5,
  },
  signals: {
    /** A run: `runThreshold` of the last `runWindow` picks at one position (spec 3.3). */
    runWindow: 4,
    runThreshold: 3,
  },
  voice: {
    /** The writer runs when you are within this many picks of the clock, and on it (spec 3.5). */
    writeWithinPicks: 2,
    /** The writer's own budget inside one advisor request; late text lands on the next poll. */
    budgetMs: 2_000,
    /** Word caps per slot, held by the same validator the player peek's slots are. */
    strategyMaxWords: 45,
    reasonMaxWords: 28,
    /** Sized like the peek's narrative call: a reasoning model spends tokens thinking first. */
    maxTokens: 1_200,
  },
  /** How long one room state's computed advisor view is remembered on the server, so a voice
   *  re-poll never re-runs the simulator for the same sequence. */
  memoTtlMs: 90_000,
} as const;
