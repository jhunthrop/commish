import type { DraftFormat } from "@/domain/league";
import type { DraftPoolEntry, DraftStatus } from "@/domain/draft";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import type { ClockTier } from "./config";

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
