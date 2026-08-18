import { z } from "zod";
import { DRAFT_ACTION_VERSION, type DraftAction, type SetQueueAction } from "@/domain/draft";
import { AUCTION_CONFIG, DRAFT_QUEUE_CONFIG, PERSISTED_QUEUE_MAX } from "./config";

const version = z.literal(DRAFT_ACTION_VERSION);
// A strict ISO 8601 datetime (not just any non-empty string) so a malformed stamp can't
// `Date.parse` to `NaN` and silently bypass the R-B4 "clock hasn't run out yet" guard, which
// compares `Date.parse(action.timestamp)` against the deadline.
const timestamp = z.iso.datetime();
const teamId = z.string().min(1);
const playerId = z.string().min(1);
const dollars = z.number().int().positive();

const poolEntry = z.object({
  playerId,
  position: z.enum(["QB", "RB", "WR", "TE", "K", "DEF"]),
});

/**
 * The persisted-row boundary. `draft_actions.action` is jsonb written by an earlier
 * process (possibly an earlier deploy), so replay validates it rather than trusting it.
 * Unknown `v` values fail loudly instead of being reinterpreted as v1.
 */
export const draftActionSchema: z.ZodType<DraftAction> = z.discriminatedUnion("type", [
  z.object({ v: version, type: z.literal("START_DRAFT"), timestamp, draftOrder: z.array(teamId).min(2), pool: z.array(poolEntry).min(1) }),
  z.object({ v: version, type: z.literal("MAKE_PICK"), timestamp, teamId, playerId }),
  z.object({ v: version, type: z.literal("NOMINATE"), timestamp, teamId, playerId, openingBid: dollars }),
  z.object({ v: version, type: z.literal("BID"), timestamp, teamId, amount: dollars }),
  z.object({ v: version, type: z.literal("TIMER_EXPIRE"), timestamp }),
  // Capped at the frozen PERSISTED_QUEUE_MAX, not the tunable DRAFT_QUEUE_CONFIG.maxLength —
  // see PERSISTED_QUEUE_MAX's doc comment: lowering the tunable must never break replay of
  // rows already written under a higher one.
  z.object({ v: version, type: z.literal("SET_QUEUE"), timestamp, teamId, playerIds: z.array(playerId).max(PERSISTED_QUEUE_MAX) }),
]);

/**
 * The HTTP boundary for POST /api/drafts/:draftId/actions.
 *
 * Deliberately has NO `teamId` and NO `timestamp`: the server resolves the acting team
 * from the authenticated session and stamps the time itself. A client that sends a
 * `teamId` has it stripped, not honoured. TIMER_EXPIRE and START_DRAFT are absent because
 * only the ticker and the commissioner route may produce them.
 */
export const clientDraftActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MAKE_PICK"), playerId }),
  z.object({ type: z.literal("NOMINATE"), playerId, openingBid: dollars.default(AUCTION_CONFIG.minBid) }),
  z.object({ type: z.literal("BID"), amount: dollars }),
]);

export type ClientDraftAction = z.infer<typeof clientDraftActionSchema>;

/**
 * Turns a validated client submission into a persisted action by stamping the two fields a
 * client is never allowed to choose: which team is acting, and when.
 */
export function toDraftAction(input: ClientDraftAction, teamId: string, timestamp: string): DraftAction {
  switch (input.type) {
    case "MAKE_PICK":
      return { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp, teamId, playerId: input.playerId };
    case "NOMINATE":
      return { v: DRAFT_ACTION_VERSION, type: "NOMINATE", timestamp, teamId, playerId: input.playerId, openingBid: input.openingBid };
    case "BID":
      return { v: DRAFT_ACTION_VERSION, type: "BID", timestamp, teamId, amount: input.amount };
  }
}

/**
 * The HTTP boundary for POST /api/drafts/:draftId/queue.
 *
 * Deliberately SEPARATE from `clientDraftActionSchema` rather than a fourth member of it:
 * that union is the set of *draft moves*, and `optimisticView` switches over it
 * exhaustively — folding a queue edit in would force a meaningless optimistic branch and a
 * second response shape onto the actions route. Same rule as the others: no `teamId`, no
 * `timestamp`; the server resolves the acting team from the session and stamps the time.
 */
export const clientQueueSchema = z.object({
  playerIds: z.array(playerId).max(DRAFT_QUEUE_CONFIG.maxLength),
});

export function toSetQueueAction(playerIds: readonly string[], teamId: string, timestamp: string): SetQueueAction {
  return { v: DRAFT_ACTION_VERSION, type: "SET_QUEUE", timestamp, teamId, playerIds };
}
