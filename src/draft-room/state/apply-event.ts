import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { draftEventSchema, type DraftEventFrame, type DraftPickPayload } from "./payloads";

export type ApplyOutcome = "ignored" | "resync";

export interface NudgeNotice {
  readonly teamId: string;
  readonly message: string;
  /** The turn this nudge was about. The banner hides itself once the view moves past it. */
  readonly sequence: number;
}

export type ApplyEventResult =
  | { readonly ok: true; readonly view: DraftStateView; readonly nudge: NudgeNotice | null }
  | { readonly ok: false; readonly outcome: ApplyOutcome };

const IGNORED: ApplyEventResult = { ok: false, outcome: "ignored" };
const RESYNC: ApplyEventResult = { ok: false, outcome: "resync" };

function parseFrame(data: string): DraftEventFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = draftEventSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function applyPick(view: DraftStateView, payload: DraftPickPayload): DraftStateView {
  // A sibling/redelivered frame for a pick we already hold is a no-op — the clock in `view`
  // has already been updated by the caller, so returning it keeps that and adds nothing.
  if (view.picks.some((pick) => pick.pickNumber === payload.pickNumber)) return view;

  const pick: CompletedPick = {
    pickNumber: payload.pickNumber,
    round: payload.round,
    teamId: payload.teamId,
    playerId: payload.playerId,
    slot: payload.slot,
    slotIndex: payload.slotIndex,
    price: payload.price,
    timestamp: payload.timestamp,
    auto: payload.auto,
  };

  return {
    ...view,
    picks: [...view.picks, pick],
    rosters: {
      ...view.rosters,
      [payload.teamId]: [...(view.rosters[payload.teamId] ?? []), { slot: payload.slot, slotIndex: payload.slotIndex, playerId: payload.playerId }],
    },
    availablePlayerIds: view.availablePlayerIds.filter((id) => id !== payload.playerId),
    // Money is assigned, never computed: the engine sent the post-award numbers. `minBid` is
    // only on the payload for an auction award (see docs/draft-engine.md's payload table); a
    // snake pick's payload has none, so the view's existing (null) minBid is kept as-is.
    budgets: payload.budgets ?? view.budgets,
    maxBids: payload.maxBids ?? view.maxBids,
    minBid: payload.minBid ?? view.minBid,
    // A resolved lot closes, and `onClockTeamId` is the engine's own next nominator.
    auction: view.auction === null ? null : { nominatingTeamId: payload.clock.onClockTeamId, lot: null },
  };
}

/** Returns the next view, or null when the frame proves we are out of sync and must refetch. */
function applyFrame(view: DraftStateView, frame: DraftEventFrame): DraftStateView | null {
  switch (frame.type) {
    case "draft.timer_expire":
    case "draft.status":
    case "draft.queue":
    case "draft.nudge":
      return view;
    case "draft.pick":
      return applyPick(view, frame.payload);
    case "draft.nominate":
      return view.format !== "auction"
        ? null
        : {
            ...view,
            // The engine's floor for the lot's next bid — never `highBid + bidIncrement`
            // re-derived here.
            minBid: frame.payload.minBid,
            auction: {
              nominatingTeamId: frame.payload.teamId,
              lot: {
                playerId: frame.payload.playerId,
                highBid: frame.payload.openingBid,
                highBidTeamId: frame.payload.teamId,
                nominatedByTeamId: frame.payload.teamId,
                autoNominated: frame.payload.auto,
              },
            },
          };
    case "draft.bid": {
      const auction = view.auction;
      if (auction === null || auction.lot === null) return null;
      return {
        ...view,
        minBid: frame.payload.minBid,
        auction: { ...auction, lot: { ...auction.lot, highBid: frame.payload.amount, highBidTeamId: frame.payload.teamId } },
      };
    }
  }
}

/**
 * Fold one SSE frame into the draft view. Pure, total, and idempotent by content: the only
 * thing it ever *computes* is set membership and list append — every draft rule (turn,
 * deadline, tier, slot, budget, ceiling, next-bid floor) arrives already decided in
 * `payload.clock` or the payload's own fields.
 *
 * `resync` is the caller's cue to refetch `GET /api/drafts/[draftId]` — the documented
 * fallback for a gap that outlasted the stream's retention window, and for the auction case
 * where a bid arrives against a lot we never saw open.
 */
export function applyDraftEvent(view: DraftStateView, data: string): ApplyEventResult {
  const frame = parseFrame(data);
  if (frame === null) return IGNORED;
  if (frame.payload.draftId !== view.draftId) return IGNORED;

  const { sequence } = frame.payload.clock;
  if (sequence < view.sequence) return IGNORED;
  if (sequence > view.sequence + 1) return RESYNC;

  const next = applyFrame({ ...view, ...frame.payload.clock }, frame);
  if (next === null) return RESYNC;
  const nudge: NudgeNotice | null =
    frame.type === "draft.nudge"
      ? { teamId: frame.payload.teamId, message: frame.payload.message, sequence: frame.payload.clock.sequence }
      : null;
  return { ok: true, view: next, nudge };
}
