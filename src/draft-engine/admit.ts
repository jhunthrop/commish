import type { BidAction, DraftAction, MakePickAction, NominateAction, SetQueueAction, TimerExpireAction } from "@research/domain/draft";
import { auctionOf, totalRosterSlots, type DraftState } from "./state";
import { AUCTION_CONFIG, DRAFT_QUEUE_CONFIG } from "./config";
import { currentDeadline, maxBidFor, openSlotCount } from "./selectors";

export type AdmitResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const ADMITTED: AdmitResult = { ok: true };

/**
 * Command-time preconditions: everything that can flip ok→not-ok when a TUNABLE changes.
 *
 * Never called on the replay path — the log records commands that were already admitted, and
 * re-adjudicating them against today's constants is what broke draft replay once: raising the
 * clock schedule's floor from 60s to 90s turned every persisted TIMER_EXPIRE into a
 * `DraftReplayError`, which 500s the draft permanently. A reducer folds facts; admitting a
 * command is a different job, and the two must not share a guard that reads a deploy-time
 * constant.
 *
 * The five sites moved here (plus the START_DRAFT budget floor, which is the same class):
 * the TIMER_EXPIRE deadline (`DRAFT_CLOCK_SCHEDULE` via `config.clockSchedule`, and
 * `AUCTION_CONFIG.bidWindowSeconds` via `currentClockSeconds`), the SET_QUEUE length cap
 * (`DRAFT_QUEUE_CONFIG.maxLength`), the nomination floor and the bid increment
 * (`AUCTION_CONFIG.minBid` / `bidIncrement`), and the bid ceiling
 * (`AUCTION_CONFIG.reservePerOpenSlot` via `maxBidFor`).
 */
export function admitCommand(state: DraftState, action: DraftAction): AdmitResult {
  switch (action.type) {
    case "START_DRAFT":
      return admitStart(state);
    case "SET_QUEUE":
      return admitSetQueue(action);
    case "TIMER_EXPIRE":
      return admitTimerExpire(state, action);
    case "NOMINATE":
      return admitNominate(state, action);
    case "BID":
      return admitBid(state, action);
    case "MAKE_PICK":
      return admitMakePick(state, action);
  }
}

/**
 * An auction needs enough budget to cover the minimum bid on every roster spot, which is what
 * keeps auto-nomination from deadlocking. "There is no budget at all" stays in the reducer —
 * that reads `config`, not a tunable, and carries the better message.
 */
function admitStart(state: DraftState): AdmitResult {
  const budget = state.config.auctionBudget;
  if (state.config.format !== "auction" || budget === null || budget <= 0) return ADMITTED;
  if (budget < totalRosterSlots(state.config.slotConfig) * AUCTION_CONFIG.minBid) {
    return { ok: false, reason: `An auction budget must be at least $${AUCTION_CONFIG.minBid} for every roster spot.` };
  }
  return ADMITTED;
}

/**
 * A pick stamped before the turn it is made in began is refused (the batched bots round,
 * 2026-09-25). Every other MAKE_PICK guard (turn order, pool membership, roster shape) is a pure
 * function of the log and prior state and lives in the reducer; this one is about the WIRE
 * clock. A mock's bot picks are committed in a batch stamped at their reveal instants, so the
 * human's `turnStartedAt` sits in the future until the last bot is revealed; a pick posted
 * before then (a reloaded tab whose clock ran ahead and offered the turn early, a direct POST)
 * would be applied stamped before the bot ahead of it, and the next batch would chain from that
 * earlier instant. Command time only, never replay: an older log holds no such stamp.
 */
function admitMakePick(state: DraftState, action: MakePickAction): AdmitResult {
  if (state.turnStartedAt !== null && Date.parse(action.timestamp) < Date.parse(state.turnStartedAt)) {
    return { ok: false, reason: "The picks before yours are still landing." };
  }
  return ADMITTED;
}

function admitSetQueue(action: SetQueueAction): AdmitResult {
  if (action.playerIds.length > DRAFT_QUEUE_CONFIG.maxLength) {
    return { ok: false, reason: `A queue can hold at most ${DRAFT_QUEUE_CONFIG.maxLength} players.` };
  }
  return ADMITTED;
}

/**
 * A clock can only be expired once it has actually run out. This closes a check-then-act race
 * between concurrent COMMANDS — the ticker reads state and computes a deadline in one step,
 * then submits TIMER_EXPIRE in a later, separate step; a legitimate action can land in between
 * and start a fresh clock for someone else, and the ticker's now-stale timestamp must not be
 * allowed to expire THAT clock. A race with an in-flight command has no meaning during replay,
 * which is exactly why the check belongs here and not in the reducer.
 *
 * No clock running (`currentDeadline` null) means nothing to guard — allow through.
 */
function admitTimerExpire(state: DraftState, action: TimerExpireAction): AdmitResult {
  const deadline = currentDeadline(state);
  if (deadline !== null && Date.parse(action.timestamp) < Date.parse(deadline)) {
    return { ok: false, reason: "The clock hasn't run out yet." };
  }
  return ADMITTED;
}

function admitNominate(state: DraftState, action: NominateAction): AdmitResult {
  // A nomination against a snake draft is the reducer's rejection to explain, not a bid rule.
  if (auctionOf(state) === null) return ADMITTED;
  if (action.openingBid < AUCTION_CONFIG.minBid) {
    return { ok: false, reason: `The opening bid must be at least $${AUCTION_CONFIG.minBid}.` };
  }
  return admitAmount(state, action.teamId, action.openingBid);
}

function admitBid(state: DraftState, action: BidAction): AdmitResult {
  const auction = auctionOf(state);
  // No auction, or no lot open: there is no standing high bid to raise, so there is no
  // increment to enforce. The reducer says which of the two it was.
  if (auction === null || auction.lot === null) return ADMITTED;
  const minimum = auction.lot.highBid + AUCTION_CONFIG.bidIncrement;
  if (action.amount < minimum) return { ok: false, reason: `Your bid must be at least $${minimum}.` };
  return admitAmount(state, action.teamId, action.amount);
}

/** The budget ceiling: this team's remaining money less the reserve for every spot still open. */
function admitAmount(state: DraftState, teamId: string, amount: number): AdmitResult {
  // A full roster is a fact of the log, not a tunable — leave that rejection, and its far
  // better message, to the reducer's slot assignment.
  if (openSlotCount(state, teamId) <= 0) return ADMITTED;
  const max = maxBidFor(state, teamId);
  if (amount > max) {
    return {
      ok: false,
      reason: `You can only bid up to $${max}. You need $${AUCTION_CONFIG.reservePerOpenSlot} for each of your remaining roster spots.`,
    };
  }
  return ADMITTED;
}
