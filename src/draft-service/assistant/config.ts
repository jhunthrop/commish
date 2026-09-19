/**
 * EVERY ADVISOR TUNABLE, in one place (the config-over-hardcoding rule this product keeps
 * everywhere else). Spec: `docs/superpowers/specs/2026-09-07-draft-advisor-design.md`, section 7.
 * The survival bands the card and the pool colour by live in `@/domain/draft-odds`, shared with
 * the client.
 */
export const ADVISOR_CONFIG = {
  /** Seeded room continuations behind every odds number, one simulation per room state serving
   *  every seat. Measured in the simplification round (see the ledger): 200 runs through the
   *  furthest next turn at the worst case a room can pose (14 teams, 16 rounds, pick 1) is the
   *  budget this constant is held to, and the count the card states. */
  runs: 200,
  /** Runs played before the simulation yields one macrotask (draft-room performance round, item
   *  1; `simulateRoomOddsInChunks`). Eight runs of a 12-team room are about 25 ms on Apple
   *  silicon (200 runs measured 587 ms), so a pick request or a pacing timer sharing the
   *  invocation waits at most that long, never the whole table. */
  simChunkRuns: 8,
  /** How many candidates `recommendPick` ranks for every seat, on or off the clock: the card's
   *  pick is the first the runs leave on the board past the reach floor, the tab's rows are the
   *  rest, and the on-clock seat's whole shortlist is held off its own current pick in the runs
   *  (R-3). One depth, the most the tab's selector can show, so a selector change never costs a
   *  second request (pick count round). */
  shortlistSize: 10,
  signals: {
    /** A run: `runThreshold` of the last `runWindow` picks at one position (spec 3.3). */
    runWindow: 4,
    runThreshold: 3,
  },
  /** Room odds tables remembered at once, one per room state; a new pick evicts the room's old
   *  table, and the least-recently-computed room goes past this. */
  memoRooms: 64,
  /**
   * THE CROSS-PROCESS FACTS STORE (draft-room performance round, item 2; `facts-store.ts`).
   * `ttlMs` is short by ruling: a room's facts are superseded by its next pick within seconds in
   * a mock and within a clock in a real league, and a viewer who reads past it computes once
   * under the lock. `lockMs` bounds the compute lock well past the longest measured simulation
   * (1,137 ms on Apple silicon before the engine index, a few seconds on a Vercel vCPU) so a
   * holder that died releases by expiry; `waitPollMs` and `waitMaxMs` bound how long a contending
   * reader waits for the holder's write before computing itself, inside the lock's own life so
   * the two never disagree.
   */
  facts: {
    ttlMs: 10 * 60_000,
    lockMs: 15_000,
    waitPollMs: 50,
    waitMaxMs: 5_000,
  },
} as const;
