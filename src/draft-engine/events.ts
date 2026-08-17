import type { DraftAction } from "@/domain/draft";
import type { RealtimeEventType } from "@/lib/realtime/events";
import { auctionOf, type DraftState } from "./state";

/**
 * The draft slice of the one event taxonomy. Types are not re-declared here — they are
 * narrowed from `src/lib/realtime/events.ts`, which stays the single enumeration.
 */
export type DraftEventType = Extract<
  RealtimeEventType,
  "draft.pick" | "draft.nominate" | "draft.bid" | "draft.timer_expire" | "draft.status"
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
  const base = { draftId: next.config.draftId, sequence: next.sequence };
  const events: DraftEventEnvelope[] = [];

  if (action.type === "TIMER_EXPIRE") {
    events.push({ type: "draft.timer_expire", payload: { ...base, pickNumber: prev.pickNumber } });
  }

  for (const pick of next.picks.slice(prev.picks.length)) {
    events.push({ type: "draft.pick", payload: { ...base, ...pick } });
  }

  const beforeAuction = auctionOf(prev);
  const afterAuction = auctionOf(next);
  const before = beforeAuction === null ? null : beforeAuction.lot;
  const after = afterAuction === null ? null : afterAuction.lot;
  if (after !== null) {
    events.push(
      before === null || before.playerId !== after.playerId
        ? {
            type: "draft.nominate",
            payload: { ...base, teamId: after.nominatedByTeamId, playerId: after.playerId, openingBid: after.highBid, auto: after.autoNominated },
          }
        : {
            type: "draft.bid",
            payload: { ...base, teamId: after.highBidTeamId, playerId: after.playerId, amount: after.highBid },
          },
    );
  }

  if (next.phase !== prev.phase) {
    events.push({ type: "draft.status", payload: { ...base, phase: next.phase } });
  }

  return events;
}
