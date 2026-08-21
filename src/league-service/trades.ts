import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { tradeProposals } from "@/db/schema";
import { canonicalSerialize } from "@/integrity/canonical";
import { assetPlayerIds, type TradeAsset } from "@/trades/assets";
import type { TradeStatus } from "@/trades/lifecycle";

/**
 * `trade_proposals`, ISO-stringed at the boundary — the same "`Date` only inside Drizzle"
 * discipline `AuditEvent` and `IntegrityFlag` both keep. This is the STORED row, not the wire
 * view (`TradeProposalView`, `@/trades/contract`): it has no team names, because resolving those
 * is a join this module does not own (Tasks 3 and 5).
 */
export interface TradeProposal {
  readonly id: string;
  readonly leagueId: string;
  readonly proposerTeamId: string;
  readonly counterpartyTeamId: string;
  /** The week the proposal was VALUED at — see `tradeProposals.weekNumber`'s own docblock. */
  readonly weekNumber: number;
  readonly proposerAssets: readonly TradeAsset[];
  readonly counterpartyAssets: readonly TradeAsset[];
  readonly fingerprint: string;
  readonly note: string | null;
  readonly status: TradeStatus;
  readonly proposedAt: string;
  readonly expiresAt: string;
  readonly settledAt: string | null;
  readonly settledByUserId: string | null;
  readonly reversedAt: string | null;
  readonly reversedByFlagId: string | null;
}

export function toTradeProposal(row: typeof tradeProposals.$inferSelect): TradeProposal {
  return {
    id: row.id,
    leagueId: row.leagueId,
    proposerTeamId: row.proposerTeamId,
    counterpartyTeamId: row.counterpartyTeamId,
    weekNumber: row.weekNumber,
    proposerAssets: row.proposerAssets,
    counterpartyAssets: row.counterpartyAssets,
    fingerprint: row.fingerprint,
    note: row.note,
    status: row.status as TradeStatus,
    proposedAt: row.proposedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
    settledByUserId: row.settledByUserId,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    reversedByFlagId: row.reversedByFlagId,
  };
}

/**
 * The identity of an OFFER, not of a row. Two proposals with the same league, the same ordered
 * team pair and the same two asset sets are the same offer however the arrays were ordered on
 * the way in, so the ids are sorted before hashing. Reuses `canonicalSerialize`
 * (`@/integrity/canonical`) rather than `JSON.stringify` for exactly the reason the audit chain
 * does: key order is not part of the meaning, and a rejecting encoder refuses the values that
 * would not survive a round trip.
 */
export function proposalFingerprint(input: {
  readonly leagueId: string;
  readonly proposerTeamId: string;
  readonly counterpartyTeamId: string;
  readonly proposerAssets: readonly TradeAsset[];
  readonly counterpartyAssets: readonly TradeAsset[];
}): string {
  const canonical = canonicalSerialize({
    leagueId: input.leagueId,
    proposerTeamId: input.proposerTeamId,
    counterpartyTeamId: input.counterpartyTeamId,
    proposerAssets: [...assetPlayerIds(input.proposerAssets)].sort(),
    counterpartyAssets: [...assetPlayerIds(input.counterpartyAssets)].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** The three bands `TradesPageBody` renders: offers to answer, offers sent, and settled history. */
export type TradeBox = "inbox" | "outbox" | "history";

export interface TradesQueryInput {
  readonly leagueId: string;
  /** Unused for `box: "history"` — a league's whole settled record has no single team's inbox
   *  or outbox to key off of. Carried anyway so callers building all three bands from one
   *  `{ leagueId, teamId }` pair (`TradesPageBody`) pass one input shape, not three. */
  readonly teamId: string;
  readonly box: TradeBox;
}

/**
 * Exported for inspection, mirroring `feedQuery`, `browseQuery` and `pendingFlagQuery`:
 * `src/db/index-plans.test.ts` EXPLAINs this builder itself rather than a hand-written SQL
 * string that resembles it.
 *
 * `inbox` and `outbox` are partial on `status = 'open'` — the same predicate
 * `trade_proposals_inbox_idx`/`trade_proposals_outbox_idx` carry — so the index serves the whole
 * WHERE clause and nothing is left for a `Filter` to discard. `history` is deliberately NOT
 * narrowed to open rows: it is the league's settled record, and `trade_proposals_league_idx` is
 * not partial for exactly that reason.
 */
export function tradesQuery(db: Db, input: TradesQueryInput) {
  switch (input.box) {
    case "inbox":
      return db
        .select()
        .from(tradeProposals)
        .where(and(eq(tradeProposals.counterpartyTeamId, input.teamId), eq(tradeProposals.status, "open")))
        .orderBy(desc(tradeProposals.proposedAt));
    case "outbox":
      return db
        .select()
        .from(tradeProposals)
        .where(and(eq(tradeProposals.proposerTeamId, input.teamId), eq(tradeProposals.status, "open")))
        .orderBy(desc(tradeProposals.proposedAt));
    case "history":
      return db
        .select()
        .from(tradeProposals)
        .where(eq(tradeProposals.leagueId, input.leagueId))
        .orderBy(desc(tradeProposals.proposedAt));
  }
}

/**
 * Pure, and the lazy half of expiry: a row whose `expiresAt` has passed reads as expired and is
 * refused on accept, without a scheduler ever having touched it. Only meaningful for a row still
 * `open` — a terminal row's `expiresAt` is a fact about an offer nobody can act on any more
 * anyway, so this returns `false` rather than double-labeling an already-settled row.
 */
export function isExpired(row: Pick<TradeProposal, "status" | "expiresAt">, now: string): boolean {
  return row.status === "open" && new Date(row.expiresAt).getTime() <= new Date(now).getTime();
}
