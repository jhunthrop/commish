import type { DraftFormat } from "@/domain/league";
import type { DraftPoolEntry, DraftStatus } from "@/domain/draft";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import type { ClockTier, DraftSkipPolicy, PauseWindow } from "./config";

/** Static, DB-derived setup. Never changes during a draft. */
export interface DraftConfig {
  readonly draftId: string;
  readonly leagueId: string;
  readonly format: DraftFormat;
  /** The league's first-kickoff instant — what the auto-tightening clock is measured against. */
  readonly kickoffAt: string;
  /** Auction dollars per team; null for snake drafts. */
  readonly auctionBudget: number | null;
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly clockSchedule: readonly ClockTier[];
  /**
   * The overnight freeze (Task 4), injected by `loadDraftConfig` beside `clockSchedule` — the
   * two travel together because they are the same kind of thing: a deploy-flippable clock rule
   * consumed at command time and at view time. Optional (rather than matching `clockSchedule`'s
   * always-required shape) so the many `DraftConfig` literals this engine's own test suite
   * already hand-writes stay untouched by this addition; every one of them means "no freeze",
   * exactly what an absent field and an explicit `null` both mean to every reader of it.
   */
  readonly pauseWindow?: PauseWindow | null;
  /**
   * The skip-and-owe allowance (Task 5), set from `StartDraftAction.skipPolicy` by `reduceStart`
   * — never by `loadDraftConfig`, unlike `pauseWindow`/`clockSchedule` above. `reduceSnakeExpiry`
   * is a REDUCER that reads this field while folding state, so it must be a value frozen into
   * this draft's own history rather than one re-read fresh on every load (`config.ts`'s
   * `DraftSkipPolicy` docblock explains the asymmetry in full). Null before `START_DRAFT` runs;
   * every hand-written `DraftConfig` literal in this engine's own test suite that never drives a
   * real START_DRAFT can leave it absent, the same allowance `pauseWindow` already gets.
   *
   * AND absent AFTER `START_DRAFT` too, for a log that predates Task 5 (final whole-branch review,
   * F3): `StartDraftAction.skipPolicy` is optional at the persisted-row boundary, so `reduceStart`
   * copies `undefined` through and `skipEligible`'s `?? null` path takes the no-skip branch — which
   * is what those drafts actually did. That branch used to be unreachable in production, because
   * the schema defaulted the field to TODAY's tunable.
   */
  readonly skipPolicy?: DraftSkipPolicy | null;
  /**
   * True for a mock draft (Task 4), set by `loadDraftConfig` from the `mock_rooms` sidecar
   * beside `clockSchedule`/`pauseWindow` above — the same kind of tunable, injected the same
   * way. The ONE field `applyAction` (`@/draft-service/store`) reads to skip every real-world
   * side effect (audit, notices, money, season-commit) for a mock room while running the
   * identical reducer, clock and SSE machinery a real draft gets — see that function's own
   * docblock for the full list of guarded effect sites. The REDUCER never reads it: this is
   * config the same way `clockSchedule` is, and `reduce.ts`/`snake.ts`/`auction.ts`/
   * `apply-pick.ts` stay exactly as pure as the reducer-purity ruling (`pause.ts`'s own
   * docblock) already requires. Optional, defaulting to falsy everywhere a caller reads it
   * (`state.config.isMock === true`) — every hand-written `DraftConfig` literal already in this
   * engine's own test suite, and every real (non-mock) draft `loadDraftConfig` has ever built,
   * means "not a mock" the same way an absent `pauseWindow` means "no freeze".
   */
  readonly isMock?: boolean;
}

export interface CompletedPick {
  /** Global 1-based pick order (snake pick number / auction lot number). */
  readonly pickNumber: number;
  /** Snake: the serpentine round. Auction: how many players this team had already won, +1. */
  readonly round: number;
  readonly teamId: string;
  readonly playerId: string;
  readonly slot: RosterSlotType;
  /**
   * Which copy of that slot (RB0, RB1, …). Recorded rather than derived so a client folding
   * a `draft.pick` event into its view never has to re-run slot-assignment rules.
   */
  readonly slotIndex: number;
  /** Winning bid for an auction pick; null for a snake pick. */
  readonly price: number | null;
  readonly timestamp: string;
  /** True when the clock made this pick, not a human. */
  readonly auto: boolean;
}

export interface AuctionLot {
  readonly playerId: string;
  readonly highBid: number;
  readonly highBidTeamId: string;
  readonly nominatedByTeamId: string;
  /** True when the clock nominated this player because the nominating team stalled. */
  readonly autoNominated: boolean;
}

export interface AuctionState {
  /** Team whose turn it is to nominate; null once every roster is full. */
  readonly nominatingTeamId: string | null;
  /** The player currently up for bid, or null between lots. */
  readonly lot: AuctionLot | null;
  /**
   * Opening price for auto-nominated lots, carried from the START_DRAFT action. Folding
   * reads THIS, never `AUCTION_CONFIG.minBid` — a tunable change must not rewrite history.
   */
  readonly minBid: number;
}

export interface DraftState {
  readonly config: DraftConfig;
  readonly phase: DraftStatus;
  /** Count of actions applied. Doubles as the optimistic-concurrency sequence number. */
  readonly sequence: number;
  readonly draftOrder: readonly string[];
  /** The draftable pool, best player first. Empty until START_DRAFT. */
  readonly pool: readonly DraftPoolEntry[];
  readonly picks: readonly CompletedPick[];
  /** teamId → filled roster slots only. Empty slots are simply absent. */
  readonly rosters: Readonly<Record<string, readonly RosterSlot[]>>;
  /** teamId → remaining auction dollars. Empty for snake drafts. */
  readonly budgets: Readonly<Record<string, number>>;
  /** teamId → that team's ranked autopick queue, best first. Absent = no queue. */
  readonly queues: Readonly<Record<string, readonly string[]>>;
  /**
   * teamId → the pick NUMBERS that team was skipped at, in the order it owes them (Task 5).
   * Not a boolean (the pick number is what the board renders, and a redeemed pick has to be
   * stamped with it) and not a count (a redeemed pick has to know which slot in the draft's own
   * history it fills). Never holds an empty array for a key — every writer here removes the key
   * entirely once a team's last owed pick is redeemed, which is the invariant `hasOwedPicks`/
   * `catchUpTeamId` (`selectors.ts`) both lean on. Auction never populates this at all: a frozen
   * nomination freezes every bidder, so Task 5 excludes auction entirely.
   */
  readonly owedPicks: Readonly<Record<string, readonly number[]>>;
  readonly auction: AuctionState | null;
  /** Snake: the pick about to be made. Auction: the lot about to be awarded. 1-based. */
  readonly pickNumber: number;
  /** When the current clock window started. The deadline is derived, never stored. */
  readonly turnStartedAt: string | null;
}

/**
 * The one reducer result shape. It lives here rather than in `reduce.ts` so that
 * `snake.ts` and `auction.ts` can reference it without importing the module that
 * imports them — no cycle, type-only or otherwise.
 */
export type DraftReduceResult =
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly reason: string };

/** Rounds in a snake draft = roster spots per team. */
export function totalRosterSlots(slotConfig: readonly RosterSlotConfig[]): number {
  return slotConfig.reduce((sum, s) => sum + s.count, 0);
}

/**
 * Every pick a snake draft will ever make: one per roster spot, per team. The ceiling
 * `advanceSnake` completes the draft at, and the ceiling `upcomingOnClock` stops walking at —
 * stated here once so the two can never disagree about where the board ends.
 */
export function totalPickCount(state: DraftState): number {
  return state.draftOrder.length * totalRosterSlots(state.config.slotConfig);
}

export function initialDraftState(config: DraftConfig): DraftState {
  return {
    config,
    phase: "scheduled",
    sequence: 0,
    draftOrder: [],
    pool: [],
    picks: [],
    rosters: {},
    budgets: {},
    queues: {},
    owedPicks: {},
    auction: null,
    pickNumber: 0,
    turnStartedAt: null,
  };
}

/** Convenience for callers building a roster map: the filled slots for one team. */
export function rosterFor(state: DraftState, teamId: string): readonly RosterSlot[] {
  return state.rosters[teamId] ?? [];
}

/**
 * The auction sub-state, or null for a snake draft. One accessor, so no caller re-derives
 * "is this an auction" from two fields that could disagree.
 */
export function auctionOf(state: DraftState): AuctionState | null {
  return state.config.format === "auction" ? state.auction : null;
}
