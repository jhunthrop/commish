import type { Position } from "./player";

export type DraftStatus = "scheduled" | "in_progress" | "complete";

/**
 * Persisted JSON shape version. `draft_actions.action` stores these rows forever, so the
 * discriminant `v` travels with every action: a future shape adds `v: 2` members and an
 * explicit upgrade path, and never silently reinterprets a `v: 1` row.
 */
export const DRAFT_ACTION_VERSION = 1;

/** One draftable player, as the draft saw them: id plus the position roster rules key off. */
export interface DraftPoolEntry {
  readonly playerId: string;
  readonly position: Position;
}

/**
 * Opens the draft. Carries the team order AND the ranked pool so the action log is
 * self-contained: replaying it can never depend on a ranking or ordering that has since moved.
 */
export interface StartDraftAction {
  readonly v: 1;
  readonly type: "START_DRAFT";
  readonly timestamp: string;
  /** Team ids in round-1 pick order (snake) / nomination order (auction). */
  readonly draftOrder: readonly string[];
  /** The full draftable pool, best player first. */
  readonly pool: readonly DraftPoolEntry[];
}

export interface MakePickAction {
  readonly v: 1;
  readonly type: "MAKE_PICK";
  readonly timestamp: string;
  readonly teamId: string;
  readonly playerId: string;
}

export interface NominateAction {
  readonly v: 1;
  readonly type: "NOMINATE";
  readonly timestamp: string;
  readonly teamId: string;
  readonly playerId: string;
  /** The nominating team's own opening bid — a nomination is a bid. */
  readonly openingBid: number;
}

export interface BidAction {
  readonly v: 1;
  readonly type: "BID";
  readonly timestamp: string;
  readonly teamId: string;
  readonly amount: number;
}

/** Submitted only by the server-side ticker, never by a client. */
export interface TimerExpireAction {
  readonly v: 1;
  readonly type: "TIMER_EXPIRE";
  readonly timestamp: string;
}

/**
 * A team's ranked autopick queue. Persisted as an ACTION rather than threaded into
 * TIMER_EXPIRE from outside, because `draft_actions` is the source of truth and state is
 * derived by replay: an out-of-log queue would make the same log replay to different picks
 * the moment somebody edited their queue afterwards.
 */
export interface SetQueueAction {
  readonly v: 1;
  readonly type: "SET_QUEUE";
  readonly timestamp: string;
  readonly teamId: string;
  /** Ordered, best first. An empty array clears the queue. */
  readonly playerIds: readonly string[];
}

export type DraftAction =
  | StartDraftAction
  | MakePickAction
  | NominateAction
  | BidAction
  | TimerExpireAction
  | SetQueueAction;
