import type { DraftAction } from "@/domain/draft";
import type { RealtimeEventType } from "@/lib/realtime/events";
import { auctionOf, type DraftState } from "./state";
import { draftClockView, maxBidsFor, minBidFor } from "./selectors";

/**
 * The draft slice of the one event taxonomy. Types are not re-declared here — they are
 * narrowed from `src/lib/realtime/events.ts`, which stays the single enumeration.
 */
export type DraftEventType = Extract<
  RealtimeEventType,
  "draft.pick" | "draft.nominate" | "draft.bid" | "draft.timer_expire" | "draft.status" | "draft.queue"
>;

export interface DraftEventEnvelope {
  readonly type: DraftEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * What to broadcast for a transition. Derived from the state diff rather than the action
 * alone, so a clock-driven autopick or auto-nomination produces the same events a human
 * action would. Ordering is deliberate: the cause (`draft.timer_expire`) precedes its
 * effects, so a client can render them in arrival order without reordering.
 */
export function draftEventsFor(prev: DraftState, next: DraftState, action: DraftAction): readonly DraftEventEnvelope[] {
  // Every payload embeds the post-transition clock view, so a client that applies an event
  // learns the new deadline, tier and turn without re-deriving any of them.
  const base = { draftId: next.config.draftId, clock: draftClockView(next) };
  const events: DraftEventEnvelope[] = [];

  if (action.type === "TIMER_EXPIRE") {
    events.push({ type: "draft.timer_expire", payload: { ...base, pickNumber: prev.pickNumber } });
  }

  if (action.type === "SET_QUEUE") {
    // Team id only. The ordered list is this team's draft plan and is never broadcast.
    events.push({ type: "draft.queue", payload: { ...base, teamId: action.teamId } });
  }

  const afterAuction = auctionOf(next);
  // A lot being awarded is the only thing that moves money, so budgets, ceilings and the next
  // lot's opening floor all ride the pick event — the client assigns them rather than doing
  // budget or bid-floor arithmetic of its own.
  const money = afterAuction === null ? {} : { budgets: next.budgets, maxBids: maxBidsFor(next), minBid: minBidFor(next) };

  for (const pick of next.picks.slice(prev.picks.length)) {
    events.push({ type: "draft.pick", payload: { ...base, ...pick, ...money } });
  }

  const beforeAuction = auctionOf(prev);
  const before = beforeAuction === null ? null : beforeAuction.lot;
  const after = afterAuction === null ? null : afterAuction.lot;
  // Gated on the lot actually having MOVED, not merely being open: an action that changes
  // something else entirely (a SET_QUEUE during a live lot) must not re-broadcast the
  // standing bid as if somebody had raised it.
  const lotMoved =
    after !== null &&
    (before === null || before.playerId !== after.playerId || before.highBid !== after.highBid || before.highBidTeamId !== after.highBidTeamId);
  if (lotMoved) {
    // A nomination or a bid always moves the floor for the NEXT bid on this same lot — carried
    // here so a client folding the event never re-derives `highBid + bidIncrement` itself.
    const nextMinBid = minBidFor(next);
    events.push(
      before === null || before.playerId !== after.playerId
        ? {
            type: "draft.nominate",
            payload: {
              ...base, teamId: after.nominatedByTeamId, playerId: after.playerId,
              openingBid: after.highBid, auto: after.autoNominated, minBid: nextMinBid,
            },
          }
        : {
            type: "draft.bid",
            payload: { ...base, teamId: after.highBidTeamId, playerId: after.playerId, amount: after.highBid, minBid: nextMinBid },
          },
    );
  }

  if (next.phase !== prev.phase) {
    events.push({ type: "draft.status", payload: { ...base, phase: next.phase } });
  }

  return events;
}
