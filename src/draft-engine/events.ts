import type { DraftAction } from "@research-ts/domain/draft";
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
 * The team a TIMER_EXPIRE just skipped, and the pick number it owes — null when this
 * transition wasn't a skip at all (Task 5). A skip is the only thing that ever grows a team's
 * `owedPicks` entry, and only ever one team's, by exactly one, so the first team whose list grew
 * IS the skip. Shared by `draftEventsFor` (the wire event's `skipped` flag) and `store.ts` (who
 * to notify), so the two can never disagree about which transition was a skip.
 */
export function newlySkippedPick(prev: DraftState, next: DraftState): { readonly teamId: string; readonly pickNumber: number } | null {
  for (const teamId of next.draftOrder) {
    const before = prev.owedPicks[teamId]?.length ?? 0;
    const owed = next.owedPicks[teamId];
    if (owed !== undefined && owed.length > before) return { teamId, pickNumber: owed[owed.length - 1]! };
  }
  return null;
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
    // The flag is new (Task 5); the payload already existed. A skip records no pick at all, so
    // this is the only signal a client gets that `pickNumber` just went pending rather than
    // vanishing into a name it will never see.
    events.push({ type: "draft.timer_expire", payload: { ...base, pickNumber: prev.pickNumber, skipped: newlySkippedPick(prev, next) !== null } });
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
