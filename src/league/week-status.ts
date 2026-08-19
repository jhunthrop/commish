import type { GameStatus } from "@/stats/provider";

/**
 * A week's state, structurally identical to `GameStatus` and defined only once: aliased here
 * rather than redeclared, so the two can never quietly drift the way two hand-typed unions of
 * the same three strings eventually do. `src/league-room/contract.ts` carries this across the
 * client boundary as a TYPE only — `@/league` is on that boundary's banned value-import list —
 * which is exactly what an alias (zero runtime footprint) is for.
 */
export type WeekStatus = GameStatus;

/**
 * A week's state, derived from its games. Structurally identical to `GameStatus` and defined once
 * here rather than twice: a week is `final` when every game is, `scheduled` when none has started,
 * and `in_progress` for everything between, including the long tail of a Sunday night where
 * fifteen games are done and one is not.
 */
export function weekStatusFromGames(games: readonly { readonly status: GameStatus }[]): WeekStatus {
  if (games.length === 0) return "scheduled";
  if (games.every((game) => game.status === "final")) return "final";
  if (games.every((game) => game.status === "scheduled")) return "scheduled";
  return "in_progress";
}

/**
 * Lineups lock when the week starts, not when it ends.
 *
 * Phase 1 locked on "both scores exist", which was correct when a score only appeared because a
 * commissioner pressed a button, and is a hole the moment scores move on their own: a manager
 * could watch a running back leave the field at 1:15pm and swap him out at 1:16. Locking on the
 * week's start is the coarse version of the rule; a per-player lock at each player's own kickoff
 * is the finer version and needs a per-game kickoff time this seam does not carry yet. Coarse and
 * correct beats fine and absent, and the coarse rule errs toward locking early, which costs a
 * manager some flexibility and costs nobody their money.
 */
export function isLineupLocked(status: WeekStatus | null): boolean {
  return status !== null && status !== "scheduled";
}
