import type { Position } from "./player";

/**
 * `"dissolved"` (Phase 4, Task 9) is reached from `"scheduled"` alone, one way, the moment an
 * operator dissolves a league before its draft ever starts (`dissolveLeague`,
 * `@/money-service/dissolution`) — never from `"in_progress"` or `"complete"`: a season already
 * under way is a season in motion, and dissolution refuses it outright. Nothing in the live
 * draft engine (`@/draft-engine`, `@/draft-room`) ever assigns or reads this value: a dissolved
 * league's draft never started, so no draft SESSION — the reducer's own `phase`, the realtime
 * `phase` payload — ever needs to represent it. It exists purely as the SEASON-STATE fact
 * `@/league-service/browse.ts`'s `browseQuery` already filters on (`eq(drafts.status,
 * "scheduled")`), which is what lets a dissolved league leave the public browse shelf with no
 * new predicate: it simply stops matching the one browse already has.
 */
export type DraftStatus = "scheduled" | "in_progress" | "complete" | "dissolved";

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
  /**
   * Opening price for auto-nominated auction lots, snapshotted here so replaying the log
   * never reads `AUCTION_CONFIG` while folding state. Present-but-unused for snake drafts.
   */
  readonly minBid: number;
  /**
   * The skip-and-owe allowance in force when this draft started (Task 5), snapshotted here for
   * the identical reason `minBid` is: `reduceSnakeExpiry` reads it while folding state, so
   * replaying this log must never depend on `DRAFT_SKIP_POLICY`'s CURRENT value. Present-but-
   * unused for an auction draft, which never skips a nomination at all.
   *
   * OPTIONAL, and only for the rows that predate Task 5 (final whole-branch review, F3). Every
   * `START_DRAFT` this codebase writes carries the value; a log row written before the field
   * existed carries nothing, and ABSENT MUST MEAN "no skipping", not "today's allowance". The
   * persisted-row schema used to `.default(DRAFT_SKIP_POLICY)` here, which quietly gave a
   * pre-Task-5 draft the CURRENT tunable on every replay — so a queueless team at a slow tier
   * replayed as a SKIP where the live draft had autopicked, and the reconstructed rosters
   * disagreed with the ones actually committed. `reduceSnakeExpiry`'s own `?? null` path
   * (`@/draft-engine/snake.ts`) has always handled the absent case correctly; the default was
   * what made it unreachable.
   */
  readonly skipPolicy?: {
    readonly maxOwedPerTeam: number;
    readonly appliesAtOrAbovePickSeconds: number;
  };
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
