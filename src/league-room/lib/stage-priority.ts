/**
 * THE PRIORITY FUNCTION — law 1 of the league room (one stage, following the clock).
 *
 * The stage renders exactly one thing, decided here and nowhere else: live matchup > unlocked
 * lineup problem > pending trade action > standings pulse, with the pre-draft waiting room as
 * the alternate opening state. Explicit, not vibes — wrong-stage is worse than tabs, so every
 * input is a fact the page already loaded and every branch is a flat early return (the
 * `next-action.ts` ladder idiom).
 *
 * A filed waiver claim never appears here: it needs nothing from the user, so it is a notice
 * riding below the cards, never a reason to lift the stage.
 */
import type { WeekStatus } from "@/league/week-status";

export type StageKind = "waiting" | "live" | "attention" | "pulse";

export interface StageInput {
  /** `home.draftStatus === "complete"`. */
  readonly draftComplete: boolean;
  /** `home.draftSchedule !== null` — without one there is no waiting room to show. */
  readonly hasDraftSchedule: boolean;
  /** `home.weekStatus`, the product's one definition of "games are on" (stat_weeks). */
  readonly weekStatus: WeekStatus;
  /** The viewer has a matchup this week (`myMatchup !== null`). */
  readonly hasMyMatchup: boolean;
  /** Unlocked lineup problems from `lineup-problems.ts`. */
  readonly lineupProblemCount: number;
  /** Open trade offers addressed to the viewer (`TradesPageBody.inbox` length). */
  readonly actionableTradeCount: number;
}

/**
 * Precedence, first match wins:
 * 1. waiting — the league has not drafted; the room IS the waiting room.
 * 2. live — the week is in progress and the viewer has a matchup in it.
 * 3. attention — at least one card needs the viewer before Sunday.
 * 4. pulse — the resting room.
 */
export function stageFor(input: StageInput): StageKind {
  if (!input.draftComplete && input.hasDraftSchedule) return "waiting";
  if (input.weekStatus === "in_progress" && input.hasMyMatchup) return "live";
  if (input.lineupProblemCount + input.actionableTradeCount > 0) return "attention";
  return "pulse";
}

/**
 * Card ordering within the attention stage. The stage's own precedence extends into its cards:
 * lineup problems always lead (they decay to zero points at kickoff; a trade can wait until its
 * own deadline), ranked by severity (empty slot > bye > out), then trades by soonest expiry.
 */
export interface RankableCard {
  readonly kind: "lineup" | "trade";
  /** Lineup: problem severity (higher first). Trades: 0. */
  readonly severity: number;
  /** Trades: `Date.parse(expiresAt)`. Lineup: null (the week itself is the clock). */
  readonly deadlineMs: number | null;
}

export function compareAttentionCards(a: RankableCard, b: RankableCard): number {
  if (a.kind !== b.kind) return a.kind === "lineup" ? -1 : 1;
  if (a.severity !== b.severity) return b.severity - a.severity;
  const aDeadline = a.deadlineMs ?? Number.POSITIVE_INFINITY;
  const bDeadline = b.deadlineMs ?? Number.POSITIVE_INFINITY;
  return aDeadline - bDeadline;
}
