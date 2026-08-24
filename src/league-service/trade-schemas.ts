import { z } from "zod";
import { TRADE_ASSET_KINDS, type TradeAsset } from "@/trades/assets";
import { TRADE_CONFIG } from "@/trades/config";

/**
 * `z.literal(TRADE_ASSET_KINDS[0])`, not a hand-written `z.literal("player")`: the single closed
 * vocabulary (`@/trades/assets`) still drives the value, so a rename there is a rename here too.
 * A literal rather than `z.enum` on purpose — `TRADE_ASSET_KINDS` has exactly one member today,
 * and a literal is the schema shape whose OUTPUT type is `"player"` rather than `string`, which
 * is what lets this parse straight into `TradeAsset` with no cast at the route. Phase 9's pick
 * arm widens this to `z.enum`/`z.discriminatedUnion` the same commit it widens `TradeAsset`
 * itself, not before.
 */
const tradeAssetSchema: z.ZodType<TradeAsset> = z.object({
  kind: z.literal(TRADE_ASSET_KINDS[0]),
  playerId: z.string().min(1, { message: "That is not a player." }),
});

/**
 * `POST /api/leagues/[leagueId]/trades`'s body. `proposerTeamId` is deliberately NOT a field
 * here — the proposing team resolves from the session inside `proposeTrade` itself
 * (`src/league-service/trades.ts`), so there is no input a body could spoof.
 *
 * NEITHER IS `weekNumber`, and for the identical reason (final review, CRITICAL 1). The week a
 * trade is valued at IS the collusion detector's own basis: a package priced at a week whose
 * trend window has no games in it yet values every player at zero, so the party being detected
 * could switch the detector off by naming a week. It is derived server-side now, from
 * `currentWeekOf` (`./schedule`) — the same definition `leagueHome` shows the member — at propose
 * time and again, authoritatively, at accept time.
 *
 * `z.strictObject`, not `z.object`: a stripping parse would accept a body carrying `weekNumber`
 * and silently ignore it, which reads to a caller as "the field still works". An UNKNOWN KEY IS A
 * REFUSAL here, so a client still sending the old shape is told so at the boundary instead of
 * being quietly misled about what priced its trade.
 *
 * `note` is required (not `.optional()`), matching `ProposeTradeBody.note: string | null`
 * (`@/trades/contract`): a caller states explicitly that there is no note rather than omitting
 * the field. An empty or whitespace-only note reads the same as no note at all.
 */
export const proposeTradeSchema = z.strictObject({
  counterpartyTeamId: z.string().min(1, { message: "Choose a team to trade with." }),
  proposerAssets: z
    .array(tradeAssetSchema)
    .min(1, { message: "Send at least one player." })
    .max(TRADE_CONFIG.maxAssetsPerSide, { message: `Send at most ${TRADE_CONFIG.maxAssetsPerSide} players.` }),
  counterpartyAssets: z
    .array(tradeAssetSchema)
    .min(1, { message: "Ask for at least one player." })
    .max(TRADE_CONFIG.maxAssetsPerSide, { message: `Ask for at most ${TRADE_CONFIG.maxAssetsPerSide} players.` }),
  note: z
    .string()
    .trim()
    .max(TRADE_CONFIG.noteMaxLength, { message: `Keep your note to ${TRADE_CONFIG.noteMaxLength} characters or fewer.` })
    .nullable()
    .transform((value) => (value === null || value.length === 0 ? null : value)),
});

/**
 * `POST /api/leagues/[leagueId]/trades/[tradeId]`'s body — a discriminated union on `action` in
 * spelling only (all three arms share the one field), so the route dispatches with no string
 * comparison of its own beyond this. `accept` is Task 5's; the route refuses it with product
 * copy until that lands (`_shared.ts` docblock, and the route's own).
 */
export const tradeDecisionSchema = z.object({
  action: z.enum(["accept", "reject", "withdraw"]),
});
