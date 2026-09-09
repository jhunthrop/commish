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
  /**
   * THE ROSTER-STATUS GATE'S MARK (founder report 2026-09-08): `true` when the served board had this
   * player off an active roster (practice squad, unsigned, retired) at the moment the draft started.
   * The room's own safety net (`bestAvailableFor`), the auction's auto-nomination and the practice
   * bots never take him; a manager still can, by hand, because the pool is the whole directory and
   * he is in it. ABSENT MEANS ELIGIBLE, never "today's status": a log written before this field
   * existed replays exactly as it was picked, and the mark is snapshotted at START_DRAFT with the
   * rest of the pool so a later roster move can never change what an expiry already chose.
   */
  readonly excludedFromAutopick?: true;
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
  /**
   * The need-aware autopick scoring in force when this draft started (the 2026-09-03 autopick
   * upgrade), snapshotted here for the identical reason `minBid` and `skipPolicy` are:
   * `bestAvailableFor` reads it while folding a TIMER_EXPIRE, so replaying this log must never
   * depend on `AUTOPICK_CONFIG`'s CURRENT values — a retuned temperature would otherwise change
   * what an already-persisted draft's autopick WAS.
   *
   * OPTIONAL, and absent MUST MEAN the pre-upgrade policy (plain board-order fallback, need
   * weight permanently zero), NEVER "today's tunables" — the exact F3 lesson `skipPolicy` above
   * records: a log written before this field existed derived its autopicks under the old
   * algorithm, and replaying it under the new one would reconstruct rosters that disagree with
   * the picks (and `draft_auto_picked` notices) the live draft actually produced. Every
   * `START_DRAFT` this codebase writes from the upgrade on carries the value.
   */
  readonly autopick?: {
    readonly temperature: number;
    readonly needPerOpenStartingSlot: number;
    readonly startersFilledDamp: number;
    readonly rampFullAtRosterFraction: number;
    /**
     * The 2026-09-05 surplus-damping fix (`DraftAutopickPolicy.surplusDamp`, `@/draft-engine/
     * config`). OPTIONAL for the identical F3 reason every other field here is: a log persisted
     * before this fix shipped carries no value, and absent MUST mean no compounding at all —
     * never today's tunable — so that draft's reconstructed roster keeps agreeing with the
     * picks the live draft actually made.
     */
    readonly surplusDamp?: number;
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
