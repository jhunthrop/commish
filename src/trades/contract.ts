import type { TradeAsset } from "./assets";
import type { TradeStatus } from "./lifecycle";

/**
 * TYPES ONLY, no runtime code — the same discipline `src/chat/contract.ts`,
 * `src/reviews/contract.ts` and `src/matchmaking/contract.ts` follow. Imported by
 * `src/league-service/**` and `POST /api/leagues/[leagueId]/trades*` (Tasks 2, 3 and 5) as their
 * return shape, and by `src/league-room/**` (Task 8) as its prop shape, so the two sides of the
 * wire cannot drift.
 *
 * `TradeProposal` (`@/domain/trade.ts`) stays the pure Phase 1 shape the advisor takes — it has
 * no id, no status and no timestamps, because nothing had proposed one yet. The types below are
 * what a proposal becomes once it is a real row: `proposedAt`/`expiresAt`/`settledAt`/
 * `reversedAt` are strings, the same "`Date` only at the Drizzle boundary" discipline
 * `AuditEvent` and `IntegrityFlag` both keep.
 */

/** One side of a stored proposal, as the wire sees it. `teamName` is here because the composer
 *  and the inbox both render "who", not just "which team id". */
export interface TradeSideView {
  readonly teamId: string;
  readonly teamName: string;
  readonly assets: readonly TradeAsset[];
}

export interface TradeProposalView {
  readonly id: string;
  readonly leagueId: string;
  /** The week this proposal is valued at — the league's current week when it was proposed, and
   *  re-stamped to the league's current week at the moment it is accepted (final review,
   *  CRITICAL 1). Kept so a re-read months later, and `sweepUnflaggedTrades`' own re-derivation,
   *  can still price the trade at the week it actually happened in. Never a caller's to name. */
  readonly weekNumber: number;
  readonly status: TradeStatus;
  readonly proposedAt: string;
  readonly expiresAt: string;
  readonly settledAt: string | null;
  /** Set by an operator's reversal (Task 7). `status` stays `"accepted"` — the acceptance
   *  happened and nothing erases it — so this is the field a card checks to render "reversed"
   *  rather than a seventh status (`TRADE_STATUSES` already declares six). */
  readonly reversedAt: string | null;
  /** The proposer's optional note, capped at `TRADE_CONFIG.noteMaxLength`. */
  readonly note: string | null;
  /** The side that proposed — "what they give up". */
  readonly from: TradeSideView;
  /** The side being asked — "what they get back". */
  readonly to: TradeSideView;
}

/** `GET /api/leagues/[leagueId]/trades`'s body. Three bands, the same shape `TradeInbox` (Task
 *  8) renders: offers to answer, offers sent, and the league's settled history. */
export interface TradesPageBody {
  readonly leagueId: string;
  /** The caller's own team id, so the client can tell "to me" from "by me" without re-deriving
   *  it from a session lookup. */
  readonly meTeamId: string;
  readonly inbox: readonly TradeProposalView[];
  readonly outbox: readonly TradeProposalView[];
  readonly history: readonly TradeProposalView[];
}

/** `POST /api/leagues/[leagueId]/trades`'s body. No `weekNumber` and no `proposerTeamId`: both
 *  are the server's to derive, never the caller's to name — see `proposeTradeSchema`'s own
 *  docblock (`@/league-service/trade-schemas`), which refuses either as an unknown key. */
export interface ProposeTradeBody {
  readonly counterpartyTeamId: string;
  readonly proposerAssets: readonly TradeAsset[];
  readonly counterpartyAssets: readonly TradeAsset[];
  readonly note: string | null;
}
