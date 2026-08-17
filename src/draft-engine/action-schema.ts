import { z } from "zod";
import { DRAFT_ACTION_VERSION, type DraftAction } from "@/domain/draft";
import { AUCTION_CONFIG } from "./config";

const version = z.literal(DRAFT_ACTION_VERSION);
const timestamp = z.string().min(1);
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
