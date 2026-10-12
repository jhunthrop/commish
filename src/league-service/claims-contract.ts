import type { Position } from "@research-ts/domain/player";

/**
 * THE CLAIM SURFACE'S ROW SHAPES, AND NOTHING ELSE. Types only, one import (`Position`), no
 * database handle and no write.
 *
 * WHY THEY LIVE HERE RATHER THAN IN `./claims.ts` (integrity cleanup, 2026-09-10): these two rows
 * are what the league room RENDERS, so `@/league-room/contract` and three of its components
 * import them. `claims.ts` itself is a write module — it imports `materializeLockedLineupsInTx`
 * and `toFilledRosterSlots` from `./trade-transfer`, the whole-slot-map roster transfer — so a
 * presentation module reaching in for a row SHAPE dragged the roster-transfer module into its
 * import graph behind it.
 *
 * That is what broke `flag-only.test.ts`'s standing claim that no trade-mutating module is
 * reachable from the fairness detector. The detector's path ran
 * `trade-fairness.ts -> @/ai-advisor/context -> @/league-service/lineups ->
 * @/league-room/contract -> @/league-service/claims -> ./trade-transfer`, and every hop after the
 * first was a type-only import that existed purely to name a row. `import type` is erased at
 * build time but the guard walks specifiers, not emitted code, and it is right to: a module that
 * can be named can be imported for its value tomorrow by a one-word edit. Splitting the shapes
 * out cuts the edge structurally, so the guard holds by construction rather than by an allowlist
 * entry excusing it.
 *
 * A new row shape the room renders belongs here. Anything that touches `Db` belongs in
 * `./claims.ts`.
 */

export interface FreeAgentRow {
  readonly id: string;
  /** Waivers v1: when set, he is ON WAIVERS until this instant — a claim files rather than
   *  executes, and the board says so. */
  readonly onWaiversUntil?: string | null;
  /** His current designation off the harvested injuries feed ("Q", "O"), or null. */
  readonly injuryDesignation?: string | null;
  /** The market's position rank as the ADP feed words it ("RB12"), or null. */
  readonly posAdp?: string | null;
  readonly name: string;
  readonly position: Position;
  readonly nflTeam: string;
  readonly headshotUrl: string | null;
  /** The market price, when the feed carries one. `null` renders as a dash, never a zero. */
  readonly adp: number | null;
}

export interface PendingWaiverClaim {
  readonly claimId: string;
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  /** ISO instant the window closes — `league_waivers.until`, or filed-at plus the standard
   *  window when the row is already gone (see `pendingWaiverClaims`). */
  readonly clearsAt: string;
  /** 1-based rank among ALL pending claims on the same player, in exact award order. */
  readonly queuePosition: number;
}
