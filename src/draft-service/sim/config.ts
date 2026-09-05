/**
 * THE SIMULATOR'S OWN TUNABLES — one object, so a dial the founder wants to move later (a run-size
 * option, the sync-run ceiling, the per-user in-flight budget) is a config edit, never a literal
 * buried in `simulate.ts` or an API route. No paywall gate here (spec ruling 1, 2026-09-04): the
 * ceilings below are the honest generous defaults a later billing pass will narrow for a paid
 * tier, not a limit this program enforces on anyone's behalf.
 */

/** The three run sizes the Simulator page offers (spec §5). Any positive integer is accepted by
 *  the service itself; this is the UI's own closed set. */
export const SIM_RUN_OPTIONS = [100, 1_000, 10_000] as const;

/** Room sharpness: 0 is a casual room (ADP-heavy, more jitter), 1 is a sharp room (board-heavy,
 *  little jitter). `"mixed"` is the midpoint, matching the mock's three-way segmented control. */
export const SIM_SHARPNESS = { casual: 0, mixed: 0.5, sharp: 1 } as const;
export type SimSharpnessName = keyof typeof SIM_SHARPNESS;

export const SIM_CONFIG = {
  /**
   * A run request at or under this many drafts fits comfortably inside one request/response
   * cycle (Task 1's own benchmark: 1,000 runs of a 12-team, 15-round snake draft complete in
   * roughly five seconds of pure computation on this hardware, so 100 is a firmly sub-second
   * slice of that with room for the request's other work). Above this threshold a run always
   * goes through the job system instead, so a slow request never ties up a serverless invocation
   * waiting on a 10,000-run sim.
   */
  syncRunThreshold: 100,
  /** How many sim runs (job rows in a non-terminal state) one user may have in flight at once —
   *  a fairness ceiling, not a paywall (see the module docblock). */
  maxInFlightPerUser: 3,
  /**
   * Jitter magnitude for the room-sharpness board order (`board-order.ts`), in RANK POSITIONS at
   * the casual end (`sharpness = 0`) — scaled linearly to zero at the sharp end. THE HONEST
   * MODEL: this codebase has no measurable per-player ADP variance (the market feed this engine
   * reads, `fetchAverageDraftPosition`/`BENCHMARK_SOURCES.adp`, is Fantasy Football Calculator's
   * PUBLISHED AVERAGE only — one number per player, no distribution beneath it), so the jitter
   * below is a documented, simple noise model rather than a value derived from real variance
   * data. A future ADP feed that publishes a spread (or one this platform's own room history
   * accumulates, `adp_snapshots`, Task 6) would replace this constant with a measured one without
   * changing anything else in `board-order.ts`.
   */
  casualJitterRankSpread: 6,
} as const;
