import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { assembleAdvisorContext, valuePlayers } from "@/ai-advisor/context";
import type { Db, DbTx } from "@research-ts/db/client";
import { isUniqueViolation } from "@research-ts/db/errors";
import { players, statWeeks } from "@research-ts/db/schema";
import { leagues, rosterSlots, teams, tradeProposals } from "@/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import type { Position } from "@research-ts/domain/player";
import { isLineupLocked } from "@/league";
import { canonicalSerialize } from "@/integrity/canonical";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import type { NoticeContexts } from "@/integrity/notices";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, deliverNotice, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import {
  closeSupersededHoldFlagsQuietly,
  evaluateTradeBeforeExecute,
  evidenceFor,
  raiseTradeFairnessFlag,
  type TradeFairnessEvaluation,
} from "@/integrity-service/trade-fairness";
// Imported directly from `./raise-flag`, never from `@/integrity-service/flags` — the same
// self-contained-slice discipline `trade-fairness.ts`'s own import already keeps, so this module
// (already in the trade-mutating closure `src/integrity/flag-only.test.ts` guards) never widens
// what it pulls in beyond the one function it actually calls.
import { raiseFlag } from "@/integrity-service/raise-flag";
import { tradeBalance, type TradeBalance, type ValuedPlayer } from "@/trades/fairness";
import { assetPlayerIds, describeAsset, type TradeAsset } from "@/trades/assets";
import { TRADE_CONFIG } from "@/trades/config";
import { isBalancedProposal } from "@/domain/trade";
import { nextStatusFor, type TradeStatus } from "@/trades/lifecycle";
import type { TradeProposalView, TradeSideView, TradesPageBody } from "@/trades/contract";
import type { ScoreCache } from "@/stats-pipeline/score-cache";
import { enforcementAppliesTo } from "./enforcement";
import { currentWeekOf } from "./schedule";
import { applyTradeInTx, plannedTransfer, TransferRefusedError, type FilledRosterSlot, type TransferAsset } from "./trade-transfer";
import { LEAGUE_CONFIG } from "@/league";

export const TRADE_GOVERNANCE_REFUSALS = {
  deadline: "The trade deadline has passed for this season.",
  notUnderReview: "That trade is not under league review.",
  partyCannotVeto: "You are part of this trade, so your vote does not count toward a veto.",
  alreadyVetoed: "You already cast your veto on this trade.",
} as const;

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
  /** The week this proposal is VALUED at, always server-derived — see `tradeProposals
   *  .weekNumber`'s own docblock. */
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

/** The three bands `TradesPageBody` renders: offers to answer, offers sent, and the league's
 *  shared record of what actually happened plus the caller's own dead offers. */
export type TradeBox = "inbox" | "outbox" | "history";

export interface TradesQueryInput {
  readonly leagueId: string;
  /** Read by every box, `"history"` included (fix round 1, F1) — see `tradesQuery`'s own
   *  docblock for why history needs the caller's team id too, not just the league's. */
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
 * WHERE clause and nothing is left for a `Filter` to discard.
 *
 * `history` (fix round 1, F1 — a HIGH from both the code review and the member panel): a still-
 * negotiating or dead proposal between two OTHER teams is not this caller's to see. Ruling 12's
 * whole reason `trade_proposed` is hidden from the activity feed — "a bid discloses what a
 * manager thinks his own players are worth" (`@/integrity/activity-view.ts`) — is defeated if the
 * SAME information reaches every OTHER league member here instead, mislabeled as settled. So
 * `history` answers with exactly two kinds of row, both NEVER `open` (an open row already has its
 * own home in `inbox`/`outbox`, and would otherwise double-render there and here): every ACCEPTED
 * trade in the league (executed, so it is a fact about rosters that already moved — a reversed
 * one stays `status = 'accepted'` and is included the same way `TradeCard`'s own reversed branch
 * expects), and the CALLER'S OWN dead proposals — rejected, withdrawn, expired or superseded, on
 * either side of the deal — the two managers who negotiated a trade that fell through keep their
 * own copy of it; a third team never sees it. Both conditions are still reached through
 * `league_id` first (`trade_proposals_league_idx`), so this needs no new index: the `AND`/`OR` is
 * a `Filter` applied after the league is found, not a second seek.
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
        .where(
          and(
            eq(tradeProposals.leagueId, input.leagueId),
            ne(tradeProposals.status, "open"),
            or(
              eq(tradeProposals.status, "accepted"),
              eq(tradeProposals.proposerTeamId, input.teamId),
              eq(tradeProposals.counterpartyTeamId, input.teamId),
            ),
          ),
        )
        .orderBy(desc(tradeProposals.proposedAt));
  }
}

const systemClock: Clock = { now: () => new Date().toISOString() };

/** English, singular or joined naturally ("A", "A and B", "A, B, and C") — no hand-rolled comma
 *  logic to keep coverage-honest, and no dash either way. */
const ASSET_LIST_FORMAT = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** Exported for `reverseTradeInTx` (`./trade-reversal`, Task 7), which composes its own
 *  `trade_reversed` notices from the SAME `describeAsset`/`Intl.ListFormat` machinery rather than
 *  a second copy — a reversal's notice is built from the identical moved-asset shape a trade's
 *  own `trade_executed` notice already is. */
export function summarizeAssets(assets: readonly TradeAsset[], playersById: Readonly<Record<string, ValuedPlayer>>): string {
  return ASSET_LIST_FORMAT.format(assets.map((asset) => describeAsset(asset, playersById).label));
}

/** Exported for the same reason `summarizeAssets` is. */
export function playersById(players: readonly ValuedPlayer[]): Readonly<Record<string, ValuedPlayer>> {
  return Object.fromEntries(players.map((player) => [player.playerId, player]));
}

/**
 * Whether the package leaves BOTH rosters legal once cleared and refilled, previewed at propose
 * time so a manager never wastes a yes on an offer the product would refuse at accept time
 * anyway. This is Task 4's `plannedTransfer` (`./trade-transfer`) — the one clear-then-place
 * implementation in the codebase, reused rather than restated: this used to be a local
 * `checkRoom` stopgap (a Task 3 carry), and that second copy is gone now that `plannedTransfer`
 * exists to subsume it. Advisory only and touches no roster; Task 5's `acceptTrade` calls
 * `applyTradeInTx`, which runs this same planner again against the roster as it stands at
 * accept time, because rosters move in between.
 */
function toTransferAssets(playerIds: readonly string[], positions: ReadonlyMap<string, Position>): readonly TransferAsset[] {
  return playerIds.map((playerId) => ({ playerId, position: positions.get(playerId)! }));
}

export interface ProposeTradeInput {
  /** SEEDERS ONLY — see `AcceptTradeInput.bypassDeadline`. */
  readonly bypassDeadline?: boolean;
  readonly leagueId: string;
  /** The offer resolves to a team from THIS, never from the request body — see the schema's own
   *  docblock for why there is no `proposerTeamId` field to spoof. */
  readonly userId: string;
  readonly counterpartyTeamId: string;
  readonly proposerAssets: readonly TradeAsset[];
  readonly counterpartyAssets: readonly TradeAsset[];
  readonly note: string | null;
  readonly clock?: Clock;
  readonly newId?: () => string;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `notifyAffectedMember`. Injectable so a test never needs a live
   *  Postgres row to exercise a failure. */
  readonly notify?: typeof notifyAffectedMember;
  /** Defaults to the real `deliverNotice`, called AFTER commit — never inside the transaction. */
  readonly deliver?: (notice: MemberNotice) => Promise<void>;
}

export type ProposeTradeResult =
  | { readonly ok: true; readonly tradeId: string; readonly verdict: TradeBalance }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Offer a trade. Refuses, in order: no team of the caller's own in this league (403, the service
 * holding the same boundary the route already does); trading with your own team, or an empty
 * side (422, `isBalancedProposal` — Phase 1's own answer, asked rather than restated); a
 * counterparty team this league doesn't have (404); a named player either side doesn't actually
 * own (422); more open offers out than `TRADE_CONFIG.maxOpenProposalsPerTeam` allows (409,
 * counted inside the transaction so two near-simultaneous proposals can't both slip past a
 * pre-check); a package that would leave either roster illegal once cleared and refilled (422,
 * `plannedTransfer`, before anybody has to answer it); the identical open offer already out (409, the
 * partial unique fingerprint index).
 *
 * The verdict returned on success is `tradeBalance` run for the PROPOSER'S OWN eyes only —
 * advisory, never stored, never shown to the counterparty and never conflated with Task 6's
 * after-acceptance detector, which runs its own valuation independently at a different moment
 * for a different audience.
 *
 * THE WEEK IS DERIVED, NEVER SUPPLIED (final review, CRITICAL 1). `currentWeekOf` (`./schedule`)
 * answers it from this league's own `matchups`, the same definition `leagueHome` puts in front of
 * the member. A caller who could name the week could pick one whose trend window is empty, value
 * both sides at zero, and walk a grotesque package straight past `trade_fairness` — so the week
 * belongs to the server for exactly the reason `proposerTeamId` already does. The value stored
 * here is the offer's valuation basis while it sits open; `acceptTrade` re-derives at the moment
 * of the yes and re-stamps the row, because a 72-hour offer can straddle a week boundary.
 *
 * LOCK ORDER (ruling 3). Business rows first: BOTH teams' rows `FOR UPDATE` in canonical
 * sorted-by-id order — the same rule `acceptTrade` and `reverseTradeInTx` follow — then the
 * proposal row itself. Then the notice, which takes `FOR KEY SHARE` on `users` and `leagues`. Then
 * the anchor. Then `attachAuditEvent`. Then commit, then `deliverNotice` outside the transaction
 * entirely. Nothing here touches `stat_weeks`: a proposal moves no roster.
 */
export async function proposeTrade(db: Db, input: ProposeTradeInput): Promise<ProposeTradeResult> {
  const clock = input.clock ?? systemClock;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const deliver = input.deliver ?? deliverNotice;
  const now = clock.now();

  const [proposerTeam] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
  if (proposerTeam === undefined) {
    return { ok: false, status: 403, reason: "You do not have a team in this league." };
  }
  const proposerTeamId = proposerTeam.id;

  if (proposerTeamId === input.counterpartyTeamId) {
    return { ok: false, status: 422, reason: "You cannot trade with your own team." };
  }

  // THE WEEK, DERIVED — see this function's own docblock. One read, one definition.
  const weekNumber = await currentWeekOf(db, input.leagueId);
  // TRADE DEADLINE (roadmap item 5): the late-season line every arriving manager expects.
  if (input.bypassDeadline !== true && weekNumber > LEAGUE_CONFIG.tradeDeadlineWeek) {
    return { ok: false, status: 409, reason: TRADE_GOVERNANCE_REFUSALS.deadline };
  }

  const proposerAssetIds = assetPlayerIds(input.proposerAssets);
  const counterpartyAssetIds = assetPlayerIds(input.counterpartyAssets);
  if (
    !isBalancedProposal({
      leagueId: input.leagueId,
      weekNumber,
      from: { teamId: proposerTeamId, playerIds: proposerAssetIds },
      to: { teamId: input.counterpartyTeamId, playerIds: counterpartyAssetIds },
    })
  ) {
    return { ok: false, status: 422, reason: "Both sides need to send at least one player." };
  }

  const [mine, theirs] = await Promise.all([
    assembleAdvisorContext(db, { leagueId: input.leagueId, teamId: proposerTeamId, weekNumber }),
    assembleAdvisorContext(db, { leagueId: input.leagueId, teamId: input.counterpartyTeamId, weekNumber }),
  ]);
  // `mine` cannot be null through real Postgres: `proposerTeamId` was just read out of `teams`
  // scoped to this same `leagueId`, so `assembleAdvisorContext`'s own team-in-league check always
  // finds it. Asserted rather than branched on, the same "impossible-state" discipline
  // `resolverNameFor` (`@/integrity-service/flags`) uses for its own FK-guaranteed row.
  const myContext = mine!;
  if (theirs === null) {
    return { ok: false, status: 404, reason: "We could not find that team in this league." };
  }

  const myPlayers = playersById(myContext.me.players);
  const theirPlayers = playersById(theirs.me.players);
  const myOwnedIds = new Set(Object.keys(myPlayers));
  const theirOwnedIds = new Set(Object.keys(theirPlayers));

  if (!proposerAssetIds.every((id) => myOwnedIds.has(id))) {
    return { ok: false, status: 422, reason: "One of those players is not on your team." };
  }
  if (!counterpartyAssetIds.every((id) => theirOwnedIds.has(id))) {
    return { ok: false, status: 422, reason: "One of those players is not on that team." };
  }

  const [leagueRow] = await db.select({ rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId));
  const slotConfig = leagueRow!.rosterSlots;

  const myRoster: readonly FilledRosterSlot[] = myContext.me.players.map((p) => ({ slot: p.slot, slotIndex: p.slotIndex, playerId: p.playerId }));
  const theirRoster: readonly FilledRosterSlot[] = theirs.me.players.map((p) => ({ slot: p.slot, slotIndex: p.slotIndex, playerId: p.playerId }));
  const myPositions = new Map(myContext.me.players.map((p) => [p.playerId, p.position]));
  const theirPositions = new Map(theirs.me.players.map((p) => [p.playerId, p.position]));

  const plan = plannedTransfer({
    slotConfig,
    proposer: { teamId: proposerTeamId, roster: myRoster },
    counterparty: { teamId: input.counterpartyTeamId, roster: theirRoster },
    give: toTransferAssets(proposerAssetIds, myPositions),
    get: toTransferAssets(counterpartyAssetIds, theirPositions),
  });
  if (!plan.ok) return { ok: false, status: 422, reason: plan.reason };

  const verdict = tradeBalance(valuePlayers(myContext.me, proposerAssetIds), valuePlayers(theirs.me, counterpartyAssetIds));

  // The fingerprint conflict is caught OUTSIDE the transaction, never inside it — the same shape
  // `joinPublicLeague`'s own team-membership backstop uses (`@/league-service/join`). A statement
  // that fails leaves the underlying Postgres transaction aborted; catching that failure INSIDE
  // the callback and returning a normal value asks `db.transaction` to commit a transaction
  // Postgres has already marked dead. Letting the whole transaction reject and roll back, then
  // reading the aftermath on a fresh connection, is the only shape that actually works.
  let outcome: { readonly ok: true; readonly tradeId: string; readonly notice: MemberNotice } | { readonly ok: false; readonly status: number; readonly reason: string };
  try {
    outcome = await db.transaction(async (tx) => {
      // THE FIRST LOCKS, ahead of the count: BOTH teams' rows, `FOR UPDATE`, in CANONICAL
      // SORTED-BY-ID order — the identical rule `acceptTrade` and `reverseTradeInTx` already
      // follow, so all three trade writers converge on one order over the same lockable set.
      //
      // The PROPOSER's own row is what serializes concurrent proposals from this team: without
      // it, two arriving at once both read the SAME "N-1 open offers" snapshot and both insert,
      // because a row lock on the rows a count reads cannot fence a PHANTOM insert nobody has
      // written yet. The second caller's count only runs once the first's insert has committed
      // (or rolled back) and released it.
      //
      // The COUNTERPARTY's row is taken here too, and that is the final review's HIGH 2 (a real
      // `40P01`, reproduced three ways). This transaction was ALREADY acquiring it — invisibly,
      // through the `trade_proposals` INSERT's own foreign key, which takes `FOR KEY SHARE` on
      // both team rows. So the true order was proposer-then-counterparty, and whenever the
      // proposer sorted SECOND that is the opposite order from `acceptTrade`'s and
      // `reverseTradeInTx`'s. `FOR KEY SHARE` genuinely conflicts with `FOR UPDATE`, so two
      // MIRROR proposals — Alice offering Bob a trade while Bob offers Alice one, no operator, no
      // accept, no race either member could perceive — deadlocked, and `proposeTrade`'s catch
      // handles only the fingerprint unique violation, so the victim saw an unexplained 500.
      // Taking both rows here, sorted, makes the INSERT's FK acquisition a REACQUISITION of locks
      // this transaction already holds strictly stronger, which costs nothing and closes the cycle.
      //
      // Two sequential single-row `FOR UPDATE`s, not one `IN (...)` select — only a sequence of
      // single-row locks guarantees the acquisition ORDER, since an `IN` list's row order is the
      // planner's to choose. Same construction `acceptTrade` uses, same reason.
      //
      // LOCK ORDER (ruling 3): business rows, taken first, ahead of the notice's `FOR KEY SHARE`
      // on `leagues`/`users` and ahead of the anchor — the global order, unchanged.
      // `src/integrity-service/lock-order.test.ts` drives BOTH halves against real Postgres: a
      // park on `leagues[X] FOR UPDATE` (the insert's league FK) and a two-connection mirror-
      // propose proof (the team FKs).
      const [firstTeamId, secondTeamId] = [proposerTeamId, input.counterpartyTeamId].sort();
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, firstTeamId)).for("update");
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, secondTeamId)).for("update");

      const openOffers = await tx
        .select({ id: tradeProposals.id })
        .from(tradeProposals)
        .where(and(eq(tradeProposals.proposerTeamId, proposerTeamId), eq(tradeProposals.status, "open")));
      if (openOffers.length >= TRADE_CONFIG.maxOpenProposalsPerTeam) {
        return {
          ok: false as const,
          status: 409,
          reason: `You have ${TRADE_CONFIG.maxOpenProposalsPerTeam} offers out already. Withdraw one before you send another.`,
        };
      }

      const id = newId();
      const proposedAt = new Date(now);
      const expiresAt = new Date(proposedAt.getTime() + TRADE_CONFIG.proposalTtlHours * 60 * 60 * 1000);
      const fingerprint = proposalFingerprint({
        leagueId: input.leagueId,
        proposerTeamId,
        counterpartyTeamId: input.counterpartyTeamId,
        proposerAssets: input.proposerAssets,
        counterpartyAssets: input.counterpartyAssets,
      });

      const [row] = await tx
        .insert(tradeProposals)
        .values({
          id,
          leagueId: input.leagueId,
          proposerTeamId,
          counterpartyTeamId: input.counterpartyTeamId,
          weekNumber,
          proposerAssets: input.proposerAssets,
          counterpartyAssets: input.counterpartyAssets,
          fingerprint,
          note: input.note,
          status: "open",
          proposedAt,
          expiresAt,
        })
        .returning();

      const [counterpartyTeamRow] = await tx.select({ userId: teams.userId }).from(teams).where(eq(teams.id, input.counterpartyTeamId));

      const notice = await notify(tx, {
        leagueId: input.leagueId,
        userId: counterpartyTeamRow!.userId,
        noticeType: "trade_proposed",
        context: {
          leagueName: myContext.leagueName,
          proposerTeamName: myContext.me.teamName,
          giveSummary: summarizeAssets(input.proposerAssets, myPlayers),
          getSummary: summarizeAssets(input.counterpartyAssets, theirPlayers),
          note: input.note,
        },
        occurredAt: now,
        auditEventId: null,
      });

      const event = await audit.record(tx, {
        eventType: "trade_proposed",
        actorId: input.userId,
        actorType: "user",
        leagueId: input.leagueId, // league chain — ruling 1, independent of visibility
        payload: { tradeId: row!.id, proposerTeamId, counterpartyTeamId: input.counterpartyTeamId },
        occurredAt: now,
      });
      await attachAuditEvent(tx, notice, event.eventId);

      return { ok: true as const, tradeId: row!.id, notice };
    });
  } catch (error: unknown) {
    if (isUniqueViolation(error, "trade_proposals_open_fingerprint_idx")) {
      return { ok: false, status: 409, reason: "You already have this exact trade open." };
    }
    throw error;
  }

  if (!outcome.ok) return outcome;
  await deliver(outcome.notice);
  return { ok: true, tradeId: outcome.tradeId, verdict };
}

/**
 * `rejectTrade`/`withdrawTrade` share every field. `leagueId` is the URL's own league — never
 * trusted as an authorization boundary on its own (`settleProposal` still re-derives the actor's
 * team from the row, the same as ever), but REQUIRED so a `tradeId` borrowed from another league
 * 404s here rather than being found and acted on because the caller happens to also field a team
 * in that other league. The same URL-scoping idiom `reportMessage`
 * (`@/chat-service/moderation`) fuses into its own lookup's `WHERE`.
 */
export interface SettleTradeInput {
  readonly tradeId: string;
  readonly leagueId: string;
  readonly userId: string;
  readonly clock?: Clock;
  readonly audit?: AuditLogger;
  readonly notify?: typeof notifyAffectedMember;
  readonly deliver?: (notice: MemberNotice) => Promise<void>;
}

export type SettleTradeResult =
  | { readonly ok: true; readonly tradeId: string; readonly status: TradeStatus }
  | { readonly ok: false; readonly status: number; readonly reason: string };

export type SettleTransition = "reject" | "withdraw";

export interface SettleProposalInput extends SettleTradeInput {
  readonly transition: SettleTransition;
}

/** `reject`'s and `withdraw`'s own team column — the one that must equal the caller's team. */
function roleColumnFor(transition: SettleTransition) {
  return transition === "withdraw" ? tradeProposals.proposerTeamId : tradeProposals.counterpartyTeamId;
}

/**
 * Whether this transition refuses an offer whose `expiresAt` has passed (final review, HIGH 3).
 *
 * ANSWERING a dead offer is refused: `accept` and `reject` both act on an offer the other manager
 * is no longer bound by, and executing either would move rosters (or record a decision) on a
 * negotiation that ran out. CLEARING YOUR OWN dead offer is not answering it — a proposer
 * withdrawing an expired offer is housekeeping, tidying a card out of their own outbox, and
 * refusing that would leave a manager staring at a row with no control that works on it. So
 * `withdraw` is the one transition expiry does not gate.
 */
function expiryGuards(transition: SettleTransition): boolean {
  return transition !== "withdraw";
}

/**
 * The league name both `trade_rejected` and `trade_withdrawn` templates interpolate — resolved
 * once so neither composes its own copy of the same lookup. `league!.name`: `trade_proposals
 * .league_id` carries a real foreign key onto `leagues.id` with `onDelete: "cascade"` — a league
 * cannot be deleted while this row still references it — so a row this function is ever called
 * with always names a league that is still there.
 */
async function leagueNameFor(tx: DbTx, leagueId: string): Promise<string> {
  const [league] = await tx.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
  return league!.name;
}

/** `proposerTeam!.name`: same FK-cascade guarantee `leagueNameFor` relies on, on `teams.id`. */
async function withdrawnContextFor(tx: DbTx, row: typeof tradeProposals.$inferSelect): Promise<NoticeContexts["trade_withdrawn"]> {
  const [proposerTeam] = await tx.select({ name: teams.name }).from(teams).where(eq(teams.id, row.proposerTeamId));
  return { leagueName: await leagueNameFor(tx, row.leagueId), proposerTeamName: proposerTeam!.name };
}

async function rejectedContextFor(tx: DbTx, row: typeof tradeProposals.$inferSelect): Promise<NoticeContexts["trade_rejected"]> {
  const [counterpartyTeam] = await tx.select({ name: teams.name }).from(teams).where(eq(teams.id, row.counterpartyTeamId));
  return { leagueName: await leagueNameFor(tx, row.leagueId), counterpartyTeamName: counterpartyTeam!.name };
}

/**
 * Told apart from a 404 by whether the caller was ever a legitimate party to this trade at all
 * (ruling: `publicJoinPrecondition`/`withAdmin`'s non-oracle discipline, a third time). Re-reads
 * the row fresh, inside the same transaction, AFTER the guarded `UPDATE` above has already
 * failed to match — never the pre-attempt snapshot, because a concurrent winner may have
 * changed the row in between (the race two settlements at once proves).
 *
 * EXPORTED for one narrow test and nothing else (the same discipline `removeSubject`,
 * `@/integrity-service/flags`, uses for its own unreachable-through-Postgres backstop). Its own
 * `row === undefined` branch cannot be reached through `settleProposal`: that caller already
 * confirmed the row exists (`existing`, above) inside the SAME transaction moments earlier, and
 * nothing in this codebase ever deletes a `trade_proposals` row. `trades.test.ts` puts a stub
 * `DbTx` in the state this defends against directly, the same "impossible-state guard, proved by
 * a stub" discipline `vitest.config.mts`'s own docblock sanctions.
 */
export async function refusalFor(
  tx: DbTx,
  input: SettleProposalInput & { readonly actorTeamId: string },
): Promise<Extract<SettleTradeResult, { readonly ok: false }>> {
  const [row] = await tx.select().from(tradeProposals).where(eq(tradeProposals.id, input.tradeId));
  if (row === undefined) return { ok: false, status: 404, reason: "We could not find that offer." };

  const authorizedTeamId = input.transition === "withdraw" ? row.proposerTeamId : row.counterpartyTeamId;
  if (authorizedTeamId !== input.actorTeamId) {
    // Same answer for "doesn't exist" and "isn't yours" — an id must tell a prober nothing.
    return { ok: false, status: 404, reason: "We could not find that offer." };
  }
  // Plan D (Task 5): a held trade is no longer a question between these two managers — it is a
  // question for an operator — so the ordinary refusal ("someone already answered") would be a
  // lie; nobody answered anything. Checked before the generic terminal-status message so a held
  // row gets the honest one rather than the one every OTHER non-open row gets.
  if (row.status === "held") {
    return { ok: false, status: 409, reason: "This trade is waiting on a fairness review, so it cannot change right now." };
  }
  if (row.status !== "open") {
    return { ok: false, status: 409, reason: "Someone already answered that offer." };
  }
  // status is still open and the caller IS the right party, so the only remaining reason the
  // guarded UPDATE above failed to match is the one condition left: expiry. Reached only for the
  // transitions that GUARD on expiry (`reject`, and `accept` which reuses this diagnosis) — a
  // `withdraw` cannot arrive here at all, since its own UPDATE carries no expiry predicate, so an
  // open row with the right proposer always matches (`expiryGuards`' own docblock).
  return { ok: false, status: 409, reason: "That offer expired before anyone answered it." };
}

/**
 * `rejectTrade` and `withdrawTrade` are one implementation with two actor tests: they differ
 * only in which column must equal the caller's team (`roleColumnFor`) and which notice fires
 * (`withdrawnContextFor`/`rejectedContextFor`).
 *
 * ONE WAY: the guard lives in the stamp `UPDATE`'s own `WHERE`, not in a prior read — a losing
 * concurrent caller matches zero rows, not a stale "yes" (the same discipline `resolveFlag` and
 * `removeReview` both use). A row this `UPDATE` fails to match is diagnosed AFTER the fact by
 * `refusalFor`, re-reading fresh rather than trusting `existing` above (a concurrent winner may
 * have changed the row in between).
 *
 * LOCK ORDER (ruling 3). Business rows first: the proposal row itself, taken through the guarded
 * UPDATE's own row lock. That UPDATE takes NO foreign-key lock on `leagues` or either `teams` row
 * (final review, LOW 7 item 9 — this used to claim it did): Postgres re-checks a foreign key only
 * when the REFERENCING column changes, and this statement writes `status`/`settledAt`/
 * `settledByUserId` only, so its sole FK acquisition is `FOR KEY SHARE` on `users[actor]` through
 * `settled_by_user_id`. Then the notice, which takes `FOR KEY SHARE` on `users` and
 * `leagues`. Then the anchor. Then `attachAuditEvent`. Then commit, then `deliverNotice` outside
 * the transaction entirely. Nothing here touches `stat_weeks`: a settlement moves no roster,
 * which is why this has no interaction with the week lock at all — `acceptTrade` (Task 5) is
 * where that begins.
 */
async function settleProposal(db: Db, input: SettleProposalInput): Promise<SettleTradeResult> {
  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const deliver = input.deliver ?? deliverNotice;
  const now = clock.now();

  const outcome = await db.transaction(async (tx) => {
    // URL-SCOPED, fused into one `WHERE` — the same shape `reportMessage` uses for its own
    // `(id, leagueId)` lookup. A `tradeId` that is real but belongs to a DIFFERENT league than
    // the URL's own reads as "not found" here, before anything downstream ever asks who the
    // caller is, so a borrowed id from another league can never be told apart from a bogus one.
    const [existing] = await tx
      .select({ id: tradeProposals.id })
      .from(tradeProposals)
      .where(and(eq(tradeProposals.id, input.tradeId), eq(tradeProposals.leagueId, input.leagueId)));
    if (existing === undefined) return { ok: false as const, status: 404, reason: "We could not find that offer." };

    const [team] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
    // No team in this league at all: never a real match for either role column, so this
    // sentinel guarantees the guarded UPDATE below matches nothing and `refusalFor` answers 404.
    const actorTeamId = team?.id ?? "";

    const [row] = await tx
      .update(tradeProposals)
      .set({ status: nextStatusFor(input.transition), settledAt: new Date(now), settledByUserId: input.userId })
      .where(
        and(
          eq(tradeProposals.id, input.tradeId),
          eq(tradeProposals.status, "open"),
          expiryGuards(input.transition) ? gt(tradeProposals.expiresAt, new Date(now)) : undefined,
          eq(roleColumnFor(input.transition), actorTeamId),
        ),
      )
      .returning();
    if (row === undefined) return refusalFor(tx, { ...input, actorTeamId });

    const noticeTeamId = input.transition === "withdraw" ? row.counterpartyTeamId : row.proposerTeamId;
    const [noticeTeam] = await tx.select({ userId: teams.userId }).from(teams).where(eq(teams.id, noticeTeamId));

    const notice =
      input.transition === "withdraw"
        ? await notify(tx, {
            leagueId: row.leagueId,
            userId: noticeTeam!.userId,
            noticeType: "trade_withdrawn",
            context: await withdrawnContextFor(tx, row),
            occurredAt: now,
            auditEventId: null,
          })
        : await notify(tx, {
            leagueId: row.leagueId,
            userId: noticeTeam!.userId,
            noticeType: "trade_rejected",
            context: await rejectedContextFor(tx, row),
            occurredAt: now,
            auditEventId: null,
          });

    // ONE event type covers both outcomes — `AUDIT_EVENT_TYPES` is frozen, so a `trade_withdrawn`
    // type does not exist. `payload.outcome` is the honest spelling.
    const event = await audit.record(tx, {
      eventType: "trade_rejected",
      actorId: input.userId,
      actorType: "user",
      leagueId: row.leagueId,
      payload: { tradeId: row.id, outcome: row.status, proposerTeamId: row.proposerTeamId, counterpartyTeamId: row.counterpartyTeamId },
      occurredAt: now,
    });
    await attachAuditEvent(tx, notice, event.eventId);

    return { ok: true as const, tradeId: row.id, status: row.status as TradeStatus, notice };
  });

  if (!outcome.ok) return outcome;
  await deliver(outcome.notice);
  return { ok: true, tradeId: outcome.tradeId, status: outcome.status };
}

/** Only the COUNTERPARTY may reject — the offer's own `WHERE` clause is the guard, not a prior
 *  read (a losing concurrent caller matches zero rows, not a stale "yes"). */
export async function rejectTrade(db: Db, input: SettleTradeInput): Promise<SettleTradeResult> {
  return settleProposal(db, { ...input, transition: "reject" });
}

/** Only the PROPOSER may withdraw — and, unlike `reject`, an EXPIRED offer may still be withdrawn
 *  (final review, HIGH 3): clearing your own dead offer is housekeeping, not answering it. See
 *  `expiryGuards`' own docblock. */
export async function withdrawTrade(db: Db, input: SettleTradeInput): Promise<SettleTradeResult> {
  return settleProposal(db, { ...input, transition: "withdraw" });
}

// ---------------------------------------------------------------------------------------------
// Task 5: acceptTrade — the execution transaction.
// ---------------------------------------------------------------------------------------------

const NOOP_SCORE_CACHE: Pick<ScoreCache, "invalidate"> = { invalidate: async () => {} };

/**
 * Awaits the eviction and swallows its failure, with a log — the identical discipline
 * `invalidateQuietly` (`@/league-service/lineups`) keeps for `setLineup`'s own cache. A missed
 * eviction is one stale read bounded by the key's TTL, never worth failing a trade that already
 * committed.
 */
async function invalidateScoreCacheQuietly(cache: Pick<ScoreCache, "invalidate">, leagueId: string, weekNumber: number): Promise<void> {
  try {
    await cache.invalidate(leagueId, weekNumber);
  } catch (error: unknown) {
    console.error("[league-service] score cache invalidation failed", { leagueId, weekNumber }, error);
  }
}

/**
 * Awaits Task 6's after-commit flag write and swallows its failure, with a log — the identical
 * discipline `sweepQuietly` (`@/integrity-service/multi-account`) keeps for its own after-commit
 * trigger, and for the identical reason: the manager who accepted did nothing wrong and can do
 * nothing about a flag write that failed, and the trade already committed. `npm run trades:sweep`
 * is the operator's re-run — see `raiseTradeFairnessFlag`'s own docblock (`@/integrity-service/
 * trade-fairness`) for why this cannot be inside `acceptTrade`'s own transaction at all.
 */
async function raiseFairnessFlagQuietly(
  raise: typeof raiseTradeFairnessFlag,
  db: Db,
  input: Parameters<typeof raiseTradeFairnessFlag>[1],
): Promise<void> {
  try {
    await raise(db, input);
  } catch (error: unknown) {
    console.error("[league-service] trade fairness flag raise failed", { tradeId: input.tradeId }, error);
  }
}

/**
 * Every OTHER open-OR-HELD offer in this league naming a player the just-accepted trade moved —
 * the supersede sweep's own read. ONE bounded query over `trade_proposals_league_idx` (this
 * league's rows), filtered in TypeScript with `assetPlayerIds`: the asset lists are `jsonb` and
 * bounded at `TRADE_CONFIG.maxAssetsPerSide` per row, so a `jsonb` containment predicate per moved
 * player would buy nothing and cost an index this plan does not have. `excludeTradeId` is the
 * trade that just accepted — belt over the brace that its own `status` is no longer `'open'` by
 * the time this runs, so the filter below would already exclude it either way.
 *
 * `held` joins `open` here (Plan D, Task 5): a held trade is not immune to the world moving on.
 * It dies the same way an open one does when a DIFFERENT trade moves one of its players — the
 * fairness review it was waiting on never gets an answer, because there is nothing left to answer
 * about (`TRADE_STATUSES.superseded`'s own docblock, `@/trades/lifecycle`). `closeSupersededHold
 * FlagsQuietly` (`@/integrity-service/trade-fairness`), called AFTER this transaction commits by
 * both of this function's own callers, is what keeps that trade's own `trade_hold` flag from
 * lingering open forever once this sweep supersedes it — see fix round 1, Finding 1, for why that
 * closure cannot live in this transaction, or in this module, at all.
 */
async function openOrHeldProposalsNaming(
  tx: DbTx,
  leagueId: string,
  movedPlayerIds: readonly string[],
  excludeTradeId: string,
): Promise<readonly (typeof tradeProposals.$inferSelect)[]> {
  const rows = await tx
    .select()
    .from(tradeProposals)
    .where(and(eq(tradeProposals.leagueId, leagueId), or(eq(tradeProposals.status, "open"), eq(tradeProposals.status, "held"))));
  const moved = new Set(movedPlayerIds);
  return rows.filter(
    (row) =>
      row.id !== excludeTradeId &&
      [...assetPlayerIds(row.proposerAssets), ...assetPlayerIds(row.counterpartyAssets)].some((id) => moved.has(id)),
  );
}

/**
 * THE WHOLE OF A HOLD (Plan D, Task 5), called from `acceptTrade`'s own transaction the moment its
 * guarded UPDATE has already stamped `held` — never a separate transaction, and never after
 * commit. See `acceptTrade`'s own "THE AUTO-HOLD" docblock section for why that is provably safe:
 * every write below is PLATFORM-scoped, so this function never touches the league chain at all,
 * and one transaction appending to at most one chain (Plan A ruling 3) is satisfied by never
 * reaching for the league's.
 *
 * ORDER, all four writes inside the ONE transaction `acceptTrade` already opened: (1) both
 * `trade_held_for_review` notices — `FOR KEY SHARE` on `users` and `leagues`, taken first, matching
 * the "business rows and notices before any anchor" order every other writer in this file holds
 * to; (2) `raiseFlag` — its own insert (`FOR KEY SHARE` on `leagues` again, already held, so this
 * re-acquisition costs nothing) and its own `flag_raised` append, the FIRST anchor lock this
 * sub-path takes; (3) the `system_action` append — the SAME platform anchor row, re-entered, the
 * identical "two platform-chain appends in one transaction" shape `resolveFlag`'s own
 * `content_removed` branch already proves safe (`lock-order.test.ts`, "removes a CHAT MESSAGE...
 * appends TWICE to the platform chain"); (4) `attachAuditEvent` for both notices, against the
 * `system_action` event — the one statement permitted after an anchor.
 *
 * `raiseFlag`, never `raiseTradeFairnessFlag`: a `trade_hold` flag is not a fairness flag (two
 * different `FlagType`s, two different subject types — `SUBJECT_OF.trade_hold`'s own docblock,
 * `@/integrity/flags`), and `raiseTradeFairnessFlag` is built to run in its OWN, separate
 * transaction for a trade that has ALREADY executed — the opposite of this one.
 */
async function holdTradeInTx(
  tx: DbTx,
  input: {
    readonly row: typeof tradeProposals.$inferSelect;
    readonly league: Pick<typeof leagues.$inferSelect, "name">;
    readonly fairness: TradeFairnessEvaluation;
    readonly now: string;
    readonly audit: AuditLogger;
    readonly notify: typeof notifyAffectedMember;
    readonly newId: () => string;
    readonly raiseFlag: typeof raiseFlag;
  },
): Promise<{
  readonly ok: true;
  readonly outcome: "held";
  readonly tradeId: string;
  readonly fairness: TradeFairnessEvaluation;
  readonly notices: readonly MemberNotice[];
}> {
  const { row, league, fairness, now, audit, notify, newId, raiseFlag: raise } = input;

  const teamRows = await tx.select({ id: teams.id, name: teams.name, userId: teams.userId }).from(teams).where(inArray(teams.id, [row.proposerTeamId, row.counterpartyTeamId]));
  const teamById = new Map(teamRows.map((t) => [t.id, t]));
  const proposerTeam = teamById.get(row.proposerTeamId)!;
  const counterpartyTeam = teamById.get(row.counterpartyTeamId)!;

  const proposerNotice = await notify(tx, {
    leagueId: row.leagueId,
    userId: proposerTeam.userId,
    noticeType: "trade_held_for_review",
    context: { leagueName: league.name, counterpartyTeamName: counterpartyTeam.name },
    occurredAt: now,
    auditEventId: null,
  });
  const counterpartyNotice = await notify(tx, {
    leagueId: row.leagueId,
    userId: counterpartyTeam.userId,
    noticeType: "trade_held_for_review",
    context: { leagueName: league.name, counterpartyTeamName: proposerTeam.name },
    occurredAt: now,
    auditEventId: null,
  });

  // `fairness.hold` is true, and it can only be true when a threshold exists at all
  // (`crossesFairnessThreshold` answers `false` for a `null` threshold, by construction) — so
  // `INTEGRITY_CONFIG.trade.autoHoldThreshold!` is safe here the same way `acceptTrade`'s own
  // `shouldHold` gate already established it.
  await raise(tx, {
    flagType: "trade_hold",
    subjectId: row.id,
    leagueId: row.leagueId,
    evidence: evidenceFor(
      { balance: fairness.balance, gap: fairness.gap, giving: fairness.giving, receiving: fairness.receiving, basis: "accept_evaluation" },
      INTEGRITY_CONFIG.trade.autoHoldThreshold!,
    ),
    raisedByUserId: null, // a system path, never a member accusing another — ruling 12
    occurredAt: now,
    newId,
    audit,
  });

  const event = await audit.record(tx, {
    eventType: "system_action",
    actorId: null,
    actorType: "system",
    leagueId: null, // platform chain — nothing about a hold is league news (ruling 12)
    payload: { action: "trade_held_for_review", tradeId: row.id, leagueId: row.leagueId },
    occurredAt: now,
  });
  await attachAuditEvent(tx, proposerNotice, event.eventId);
  await attachAuditEvent(tx, counterpartyNotice, event.eventId);

  return { ok: true, outcome: "held", tradeId: row.id, fairness, notices: [proposerNotice, counterpartyNotice] };
}

export interface AcceptTradeInput {
  readonly tradeId: string;
  readonly leagueId: string;
  readonly userId: string;
  /** SEEDERS ONLY (documented at every setter): a fixture manufacturing believable history
   *  places trades at weeks the calendar no longer allows. Routes never set this — the deadline
   *  binds every live manager. */
  readonly bypassDeadline?: boolean;
  /** Trade governance (roadmap item 5): the lazy review finalizer's re-entry. The guarded
   *  update runs FROM `under_review` instead of `open`, skips the expiry gate (an offer's TTL
   *  may lapse during its review), and lands in the ordinary executed path unchanged. Never set
   *  by a route — the processor passes the stored counterparty's own userId. */
  readonly finalizeReview?: boolean;
  readonly clock?: Clock;
  readonly audit?: AuditLogger;
  readonly notify?: typeof notifyAffectedMember;
  readonly deliver?: (notice: MemberNotice) => Promise<void>;
  /** Defaults to a no-op — injectable so a test never needs a live Redis connection. The route
   *  supplies the real `getScoreCache()` (`@/league-service/score-cache-instance`). */
  readonly cache?: Pick<ScoreCache, "invalidate">;
  /** Defaults to the real `raiseTradeFairnessFlag` (`@/integrity-service/trade-fairness`).
   *  Injectable so a test can force its failure without needing a real threshold-crossing trade —
   *  see `raiseFairnessFlagQuietly`'s own docblock for why a failure here never fails this
   *  function's own result. Never called on the `held` branch — a held trade's own `trade_hold`
   *  flag is raised INSIDE this same transaction, not after commit. */
  readonly raiseFairnessFlag?: typeof raiseTradeFairnessFlag;
  /** Plan D's own test seam, mirroring `proposeTrade`'s `newId` — the id `raiseFlag` stamps on a
   *  new `trade_hold` flag. Defaults to `crypto.randomUUID()`; production never supplies this. */
  readonly newId?: () => string;
  /** Defaults to the real `raiseFlag` (`@/integrity-service/raise-flag`). Injectable so a test can
   *  force ITS failure specifically — inside the hold transaction, never after — and prove the
   *  whole hold rolls back with it: no stamp, no notices, no flag. Production never supplies this. */
  readonly raiseFlag?: typeof raiseFlag;
}

export type AcceptTradeResult =
  | {
      readonly ok: true;
      readonly tradeId: string;
      /** Trade governance: the yes landed and the league's review window opened — nothing has
       *  executed yet. `reviewEndsAt` is when the unvetoed trade will. */
      readonly outcome: "under_review";
      readonly reviewEndsAt: string;
      readonly fairness: TradeFairnessEvaluation;
    }
  | {
      readonly ok: true;
      readonly tradeId: string;
      readonly outcome: "executed";
      /** How many other open-or-held offers this acceptance just made unhonorable. */
      readonly supersededCount: number;
      /** The seam Plan D needs: computed inside this same transaction, from the rosters as they
       *  stood a moment before this trade moved them. Rides to Task 6's after-commit flag write. */
      readonly fairness: TradeFairnessEvaluation;
    }
  | {
      readonly ok: true;
      /**
       * Plan D, Task 5. Nothing executed: no roster moved, and every notice both managers got says
       * so. `supersededCount` has no place in this variant — a held trade never runs the supersede
       * sweep, because nothing about it moved to invalidate any OTHER offer.
       */
      readonly outcome: "held";
      readonly tradeId: string;
      readonly fairness: TradeFairnessEvaluation;
    }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Answer "yes" to an offer: move both rosters, settle every other offer it just invalidated, and
 * tell everyone who is owed a word — all in one transaction. Founder decision #6: immediate
 * execution on acceptance, no veto window, no commissioner approval, no league vote.
 *
 * Refuses, in order: no such offer for the caller's own team as the COUNTERPARTY, or one already
 * settled, or one that has since expired (404/409, `refusalFor`'s own diagnosis, reused as-is —
 * the counterparty is the authorized role for both `reject` and `accept`, so the two share one
 * implementation rather than a second copy of the same three messages); the league's current week
 * has already started (409, the week lock below); a named player has since left the
 * roster it was named from (409, the ownership re-check below); the package would leave either
 * roster illegal once cleared and refilled (409, `applyTradeInTx`'s own `TransferRefusedError`,
 * caught outside the transaction and passed through verbatim).
 *
 * LOCK ORDER (ruling 3, and ruling 17 of this plan). In order:
 *
 *   1. `trade_proposals[id]` — a PLAIN read, scoped to `(id, leagueId)`, no write. Everything
 *      that follows through step 5 below is a REFUSAL CHECK, never a write, and every one of
 *      them can therefore return a plain `{ ok: false, ... }` safely: `db.transaction()` only
 *      rolls back on a THROWN error, so a refusal returned AFTER a write would silently COMMIT
 *      that write. (Fix round 1, CRITICAL: this is exactly the bug the guarded UPDATE running
 *      FIRST produced — a week-locked or ownership-changed refusal used to commit the trade as
 *      `accepted` with nothing actually moved. The guarded UPDATE is now the LAST write before
 *      the transfer, never the first statement, so every refusal above it is genuinely free.)
 *   2. `stat_weeks[weekNumber] FOR SHARE` — matching `setLineup`'s own re-check exactly, on the
 *      week DERIVED HERE by `currentWeekOf` (`./schedule`), never the week the proposal carries
 *      (final review, CRITICAL 1: the week is the fairness detector's own valuation basis, so it
 *      is the server's to derive at the moment of the yes; `currentWeekOf` reads through `tx`, so
 *      the derivation and the lock cannot disagree). `persistTick` flips a week's status in its
 *      own transaction with no coordination; this lock is what makes the two agree, and it is
 *      taken before any write in this transaction, matching `setLineup`'s own position at the
 *      very top of ITS transaction.
 *   3. BOTH teams' rows, `FOR UPDATE`, in CANONICAL SORTED-BY-ID order — never proposer-first.
 *      Two concurrent accepts on MIRROR trades (each side the proposer of one) would deadlock
 *      under proposer-first ordering; sorted-id ordering is deadlock-free against both a
 *      concurrent `proposeTrade` (which locks only the proposer's own team) and a concurrent
 *      mirror accept. Two sequential single-row `FOR UPDATE`s, not one `IN (...)` select — only a
 *      sequence of single-row locks guarantees the acquisition order, since an `IN` list's row
 *      order is the planner's to choose. `lock-order.test.ts`'s two-connection proof drives this,
 *      for both the week lock and a real mirror-trade pair.
 *   4. the ownership re-check's own read of `roster_slots` — safe to refuse from, still no write,
 *      and stable once the team locks above are held (any writer of either roster takes an
 *      implicit `FOR KEY SHARE` on the SAME `teams` row through its own foreign key, so nothing
 *      can move a named player out from under this read between here and the transfer below).
 *   5. `trade_proposals[id]` via the guarded UPDATE — the one-way stamp, `WHERE status = 'open'`,
 *      so the loser of a concurrent accept/reject race (or a second accept click, or a row that
 *      settled/expired between the plain read at step 1 and here) matches zero rows rather than a
 *      stale "yes" — safe as a plain return even here, because zero rows changing is not a write.
 *      Takes NO foreign-key lock on `leagues` or either `teams` row (final review, LOW 7 item 9 —
 *      this used to claim it did): a foreign key is re-checked only when its REFERENCING column
 *      changes, and this statement writes `status`/`settledAt`/`settledByUserId`/`weekNumber`, so
 *      its sole FK acquisition is `FOR KEY SHARE` on `users[actor]`. Both `teams` rows are held
 *      `FOR UPDATE` from step 3 anyway, which is strictly stronger.
 *      EVERYTHING FROM HERE ON is either the happy path or a THROW (`applyTradeInTx`'s own
 *      `TransferRefusedError`, or `evaluateTradeBeforeExecute`'s), never a plain refusal return —
 *      a throw is the only way to roll back a write that already landed.
 *   6. `roster_slots` / `lineup_slots` writes — `materializeLockedLineupsInTx`'s own `FOR SHARE`
 *      (internal to `applyTradeInTx`, over the whole season) and then the transfer itself,
 *      `FOR KEY SHARE` on both `teams` rows through its own foreign keys (already held stronger,
 *      above).
 *   7. the supersede sweep's `UPDATE` — same table, same class of lock, after the row that caused
 *      it.
 *   8. the notice inserts — `FOR KEY SHARE` on `users` and `leagues`.
 *   9. `audit.recordAll` — the anchor, ALWAYS last. `trade_accepted` and `roster_move`, ONE batch:
 *      both are league-scoped, so one call carries both and the two land at consecutive
 *      sequences with no second anchor lock (Plan A ruling 3 — a transaction appends to at most
 *      one chain).
 *  10. `attachAuditEvent` — the one statement permitted after the anchor.
 *
 * Then commit. Then `deliverNotice` for every recipient, then the score-cache eviction for the
 * one week this trade touched, both best-effort and both OUTSIDE the transaction — the same
 * failure asymmetry `setLineup` accepts for its own cache: a slightly-late eviction costs one
 * stale read bounded by the key's TTL, an early one would cache a roster the write might still
 * roll back. Then, in a SEPARATE transaction, `raiseTradeFairnessFlag` (Task 6) — that one
 * appends to the PLATFORM chain and this one has already appended to the league's.
 *
 * `evaluateTradeBeforeExecute` (`@/integrity-service/trade-fairness`) runs INSIDE this
 * transaction, after the ownership re-check and BEFORE the guarded UPDATE (Plan D, Task 5 — moved
 * up from where Plan C left it, since the update's own target status now depends on the verdict) —
 * the rosters as they stand a moment before they would move. Its verdict rides this function's own
 * result for the after-commit fairness-flag write to act on (`outcome: "executed"`), OR decides
 * the update's own target status and is acted on immediately, in this same transaction
 * (`outcome: "held"`).
 *
 * THE AUTO-HOLD (Plan D, Task 5). When `fairness.hold` is true AND `enforcementAppliesTo` says the
 * platform is this league's own commissioner (a public, platform-enforced league —
 * `@/league-service/enforcement`), the guarded UPDATE at step 5 stamps `held` instead of
 * `accepted`, and NOTHING FROM STEP 6 ON EVER RUNS: no `applyTradeInTx`, no supersede sweep, no
 * `trade_executed` notice, no `trade_accepted`/`roster_move` append. In their place,
 * `holdTradeInTx` (below) does the WHOLE of what a hold is, inside this SAME transaction: two
 * `trade_held_for_review` notices, a `trade_hold` flag (`raiseFlag`, never `raiseTradeFairnessFlag`
 * — this is not a fairness flag), and ONE `system_action` event. Every one of those four writes is
 * PLATFORM-scoped — the flag by construction, the `system_action` because nothing about a hold is
 * league news (ruling 12), and the two notices carry `leagueId` only as metadata, the same way
 * every other notice in this file does. So this transaction, on the hold branch, appends to the
 * PLATFORM chain and NEVER to the league's — the opposite of the ordinary execute branch, which
 * appends to the league chain and never the platform's. One transaction, one chain, either way;
 * which chain is the one thing the auto-hold changes. THE CONSEQUENCE, STATED: there is no
 * after-commit gap for the hold to leave. Plan C's own fairness flag has to be written after this
 * transaction commits because a league-scoped `trade_accepted` and a platform-scoped `flag_raised`
 * cannot share one transaction; a hold has no league-scoped write to share a transaction WITH, so
 * its own flag commits inside the very transaction that decided to hold — see `holdTradeInTx`'s
 * own docblock for the row-by-row accounting.
 */
export async function acceptTrade(db: Db, input: AcceptTradeInput): Promise<AcceptTradeResult> {
  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const deliver = input.deliver ?? deliverNotice;
  const cache = input.cache ?? NOOP_SCORE_CACHE;
  const raiseFairnessFlag = input.raiseFairnessFlag ?? raiseTradeFairnessFlag;
  const now = clock.now();

  let outcome:
    | {
        readonly ok: true;
        readonly outcome: "under_review";
        readonly tradeId: string;
        readonly reviewEndsAt: string;
        readonly fairness: TradeFairnessEvaluation;
        readonly notices: readonly MemberNotice[];
      }
    | {
        readonly ok: true;
        readonly outcome: "executed";
        readonly tradeId: string;
        readonly supersededCount: number;
        /** Fix round 1, Finding 1: every OTHER held offer this acceptance just superseded, so the
         *  post-commit step below can close each one's own `trade_hold` flag honestly. */
        readonly supersededHeldTradeIds: readonly string[];
        readonly fairness: TradeFairnessEvaluation;
        readonly weekNumber: number;
        readonly notices: readonly MemberNotice[];
      }
    | {
        readonly ok: true;
        readonly outcome: "held";
        readonly tradeId: string;
        readonly fairness: TradeFairnessEvaluation;
        readonly notices: readonly MemberNotice[];
      }
    | { readonly ok: false; readonly status: number; readonly reason: string };

  try {
    outcome = await db.transaction(async (tx) => {
      const [team] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
      // No team in this league at all: never a real match for the counterparty column the
      // guarded UPDATE checks below, so this sentinel guarantees it matches nothing and
      // `refusalFor` answers 404.
      const actorTeamId = team?.id ?? "";

      // STEP 1 — a PLAIN READ, no write. See the LOCK ORDER docblock above (fix round 1,
      // CRITICAL): every refusal from here through the guarded UPDATE at step 5 must be free to
      // return a plain `{ ok: false, ... }`, because `db.transaction()` only rolls back on a
      // THROW — a refusal returned after a write would silently commit that write.
      const [existing] = await tx
        .select()
        .from(tradeProposals)
        .where(and(eq(tradeProposals.id, input.tradeId), eq(tradeProposals.leagueId, input.leagueId)));
      if (existing === undefined) {
        return { ok: false as const, status: 404, reason: "We could not find that offer." };
      }

      // STEP 2 — THE WEEK, DERIVED AT THE MOMENT OF THE YES (final review, CRITICAL 1), then
      // locked. Never `existing.weekNumber`: a 72-hour offer can straddle a week boundary, and
      // the week that governs an execution is the one the league is actually living in when the
      // rosters move — which is also the only week whose scores this trade can change, and the
      // only lock that coordinates with `persistTick` flipping the LIVE week. `currentWeekOf`
      // runs on `tx`, so the answer is the one this transaction will act on.
      const weekNumber = await currentWeekOf(tx, input.leagueId);
      // TRADE DEADLINE (roadmap item 5) — the yes is refused past it, exactly like the offer.
      // A FINALIZE re-entry is exempt: the acceptance beat the deadline, and the review window
      // running past it must not kill a legally-made trade.
      if (input.finalizeReview !== true && input.bypassDeadline !== true && weekNumber > LEAGUE_CONFIG.tradeDeadlineWeek) {
        return { ok: false as const, status: 409, reason: TRADE_GOVERNANCE_REFUSALS.deadline };
      }
      const [week] = await tx.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, weekNumber)).for("share");
      if (isLineupLocked(week?.status ?? "scheduled")) {
        return { ok: false as const, status: 409, reason: `Week ${weekNumber} has started, so rosters cannot change until it ends.` };
      }

      // STEP 3 — both teams' rows, `FOR UPDATE`, in CANONICAL SORTED-BY-ID order — never
      // proposer-first (see the LOCK ORDER docblock's ruling 1).
      const [firstTeamId, secondTeamId] = [existing.proposerTeamId, existing.counterpartyTeamId].sort();
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, firstTeamId)).for("update");
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, secondTeamId)).for("update");

      const giveIds = assetPlayerIds(existing.proposerAssets);
      const getIds = assetPlayerIds(existing.counterpartyAssets);

      // STEP 4 — OWNERSHIP, RE-CHECKED HERE — the other half of "plan at propose time, enforce at
      // accept time". Between the offer and the yes, another trade may have moved the same
      // player, and the guard is in THIS transaction's own read (taken after the team locks
      // above, so it cannot race a concurrent writer) rather than in a stale plan.
      const currentRosterRows = await tx
        .select({ teamId: rosterSlots.teamId, playerId: rosterSlots.playerId })
        .from(rosterSlots)
        .where(inArray(rosterSlots.teamId, [existing.proposerTeamId, existing.counterpartyTeamId]));
      const ownedByProposer = new Set(currentRosterRows.filter((r) => r.teamId === existing.proposerTeamId).map((r) => r.playerId));
      const ownedByCounterparty = new Set(currentRosterRows.filter((r) => r.teamId === existing.counterpartyTeamId).map((r) => r.playerId));
      if (!giveIds.every((id) => ownedByProposer.has(id)) || !getIds.every((id) => ownedByCounterparty.has(id))) {
        return {
          ok: false as const,
          status: 409,
          reason: "One of the players in this offer has already moved to another team. Ask for a fresh offer.",
        };
      }

      const [leagueRow] = await tx
        .select({ name: leagues.name, rosterSlots: leagues.rosterSlots, isPublicMatchmade: leagues.isPublicMatchmade })
        .from(leagues)
        .where(eq(leagues.id, input.leagueId));
      // FK-guaranteed: `trade_proposals.league_id` references `leagues.id`, cascading — the row
      // step 1's own plain read already found always names a league that is still there.
      const league = leagueRow!;

      // THE SEAM, computed from the rosters a moment before they move, and BEFORE the guarded
      // update below (Plan D, Task 5 — moved up from where Plan C left it): the target status the
      // guarded update stamps depends on this verdict, so the verdict has to exist first. Nothing
      // about moving this earlier changes what it reads or locks — `evaluateTradeBeforeExecute`
      // takes no lock of its own beyond the plain reads `assembleAdvisorContext` already makes, so
      // this is still safe to run ahead of any write. Valued at the DERIVED accept-time week (the
      // same one about to be stamped onto the row either way), never at a week the proposal was
      // allowed to name. See this function's own docblock and `evaluateTradeBeforeExecute`'s.
      const fairness = await evaluateTradeBeforeExecute(tx, {
        leagueId: input.leagueId,
        weekNumber,
        proposerTeamId: existing.proposerTeamId,
        counterpartyTeamId: existing.counterpartyTeamId,
        proposerAssetIds: giveIds,
        counterpartyAssetIds: getIds,
      });

      // THE SECOND GATE (Plan D, Task 5): a crossed threshold holds nothing unless the platform is
      // this league's own commissioner — `enforcementAppliesTo` (`./enforcement`), the identical
      // predicate the tier-segregation join gate reads, so "is this public and platform-enforced"
      // has exactly one answer across every automated action this phase takes. A private league's
      // manager never has a trade held, however lopsided: the platform is never that league's
      // commissioner, so it is never that league's business either.
      const shouldHold =
        input.finalizeReview !== true && fairness.hold && enforcementAppliesTo({ isPublicMatchmade: league.isPublicMatchmade });

      // STEP 5 — THE GUARDED UPDATE, the one true authorization gate and the LAST write before
      // either branch below. Still safe as a plain return on failure: a `WHERE` that matches zero
      // rows changes nothing, whether that is because the caller was never the counterparty, the
      // offer already settled, or a concurrent settlement won the race since the plain read at
      // step 1. From here on, every remaining refusal is a THROW, never a plain return —
      // `applyTradeInTx`'s own `TransferRefusedError`, caught outside the transaction below.
      //
      // `weekNumber` is RE-STAMPED to the accept-time week either way, not left at the propose-time
      // one (final review, CRITICAL 1): the row records the week this trade was last VALUED at,
      // which is what `sweepUnflaggedTrades` re-derives its own valuation at long afterward for an
      // EXECUTED trade (`reDeriveAcceptedTradeValue`, `@/integrity-service/trade-fairness`) — a
      // trade proposed on Sunday and accepted on Tuesday is a Tuesday trade. A HELD trade carries
      // no `settledAt`/`settledByUserId` at all: it is not settled, by construction (`held` is not
      // terminal, `TERMINAL_STATUSES.held` is `false`, `@/trades/lifecycle`), and `resolveFlag`'s
      // own `trade_released` branch re-derives the week AGAIN at the moment of release rather than
      // trusting this one — see that branch's own docblock for why. Not a foreign-key column
      // either way, so this still takes no lock beyond the ones step 5's own docblock enumerates.
      const finalize = input.finalizeReview === true;
      const reviewEndsAt = new Date(new Date(now).getTime() + LEAGUE_CONFIG.tradeReviewHours * 3_600_000);
      const [row] = await tx
        .update(tradeProposals)
        .set(
          shouldHold
            ? { status: "held", weekNumber }
            : finalize
              ? { status: "accepted", settledAt: new Date(now), settledByUserId: input.userId, weekNumber, reviewEndsAt: null }
              // Trade governance (roadmap item 5): the yes opens the LEAGUE's window. Nothing
              // executes below on this branch — the finalizer re-enters with `finalizeReview`.
              : { status: "under_review", weekNumber, reviewEndsAt },
        )
        .where(
          and(
            eq(tradeProposals.id, input.tradeId),
            eq(tradeProposals.leagueId, input.leagueId),
            eq(tradeProposals.status, finalize ? "under_review" : "open"),
            // An offer's TTL may lapse while its review runs; expiry gates the YES, not the
            // finalize of a yes already given.
            finalize ? sql`true` : gt(tradeProposals.expiresAt, new Date(now)),
            eq(tradeProposals.counterpartyTeamId, actorTeamId),
          ),
        )
        .returning();
      if (row === undefined) {
        // `refusalFor`'s counterparty-column diagnosis IS accept's own: only the counterparty may
        // accept, the same role `reject` already answers to, so this reuses that implementation
        // rather than restating the same three messages under a fourth transition.
        return refusalFor(tx, { tradeId: input.tradeId, leagueId: input.leagueId, userId: input.userId, transition: "reject", actorTeamId });
      }

      if (shouldHold) {
        return holdTradeInTx(tx, {
          row,
          league,
          fairness,
          now,
          audit,
          notify,
          newId: input.newId ?? (() => crypto.randomUUID()),
          raiseFlag: input.raiseFlag ?? raiseFlag,
        });
      }

      if (!finalize) {
        return {
          ok: true as const,
          outcome: "under_review" as const,
          tradeId: row.id,
          reviewEndsAt: reviewEndsAt.toISOString(),
          fairness,
          notices: [] as readonly MemberNotice[],
        };
      }

      await applyTradeInTx(tx, {
        leagueId: input.leagueId,
        slotConfig: league.rosterSlots,
        proposerTeamId: row.proposerTeamId,
        counterpartyTeamId: row.counterpartyTeamId,
        proposerAssets: row.proposerAssets,
        counterpartyAssets: row.counterpartyAssets,
      });

      // THE SUPERSEDE SWEEP — one statement, not a loop, derived from the moved player ids.
      // `held` joins `open` (Plan D, Task 5): a held trade dies the same way an open one does.
      const movedPlayerIds = [...giveIds, ...getIds];
      const doomed = await openOrHeldProposalsNaming(tx, row.leagueId, movedPlayerIds, row.id);
      const supersededRows =
        doomed.length === 0
          ? []
          : await tx
              .update(tradeProposals)
              .set({ status: "superseded", settledAt: new Date(now) })
              .where(
                and(
                  or(eq(tradeProposals.status, "open"), eq(tradeProposals.status, "held")),
                  inArray(
                    tradeProposals.id,
                    doomed.map((proposal) => proposal.id),
                  ),
                ),
              )
              .returning();
      // The question died with them: any HELD offer this sweep just superseded had its own
      // `trade_hold` flag waiting on an operator, and that flag needs to close — but not here.
      // Fix round 1, Finding 1: closing it is a PLATFORM-scoped `flag_resolved` append, and this
      // transaction's own anchor is the LEAGUE chain — one transaction, one chain (Plan A ruling
      // 3). `supersededHeldTradeIds` rides this transaction's own result out to the AFTER-COMMIT
      // step below (`closeSupersededHoldFlagsQuietly`, `@/integrity-service/trade-fairness`),
      // mirroring `raiseTradeFairnessFlag`'s own post-commit shape exactly. `doomed` carries each
      // row's status as it stood a moment BEFORE this UPDATE, which is the only place "was this
      // one held" is still readable — the UPDATE's own `.returning()` answers only the AFTER
      // image. Intersected with `supersededRows` so a doomed candidate this UPDATE's own `WHERE`
      // did not actually match (raced by something else in between) is never closed.
      const actuallySupersededIds = new Set(supersededRows.map((s) => s.id));
      const supersededHeldTradeIds = doomed.filter((d) => d.status === "held" && actuallySupersededIds.has(d.id)).map((d) => d.id);

      // NOTICES — `trade_executed` to both parties, `trade_superseded` to BOTH parties of every
      // doomed offer (final review, LOW 9).
      const teamIds = [
        ...new Set([row.proposerTeamId, row.counterpartyTeamId, ...supersededRows.flatMap((s) => [s.proposerTeamId, s.counterpartyTeamId])]),
      ];
      const teamRows = await tx.select({ id: teams.id, name: teams.name, userId: teams.userId }).from(teams).where(inArray(teams.id, teamIds));
      const teamById = new Map(teamRows.map((t) => [t.id, t]));

      const playerRows =
        movedPlayerIds.length === 0
          ? []
          : await tx.select({ id: players.id, name: players.name, position: players.position }).from(players).where(inArray(players.id, movedPlayerIds));
      // `averagePoints` is unused by `summarizeAssets`/`describeAsset` (name/position only render)
      // — stubbed at 0 rather than paying for a second `assembleAdvisorContext` call just to fill
      // a field nothing reads.
      const movedPlayersById: Readonly<Record<string, ValuedPlayer>> = Object.fromEntries(
        playerRows.map((p) => [p.id, { playerId: p.id, name: p.name, position: p.position, averagePoints: 0 }]),
      );

      const proposerTeam = teamById.get(row.proposerTeamId)!;
      const counterpartyTeam = teamById.get(row.counterpartyTeamId)!;

      const proposerNotice = await notify(tx, {
        leagueId: row.leagueId,
        userId: proposerTeam.userId,
        noticeType: "trade_executed",
        context: {
          leagueName: league.name,
          counterpartyTeamName: counterpartyTeam.name,
          gaveSummary: summarizeAssets(row.proposerAssets, movedPlayersById),
          gotSummary: summarizeAssets(row.counterpartyAssets, movedPlayersById),
        },
        occurredAt: now,
        auditEventId: null,
      });
      const counterpartyNotice = await notify(tx, {
        leagueId: row.leagueId,
        userId: counterpartyTeam.userId,
        noticeType: "trade_executed",
        context: {
          leagueName: league.name,
          counterpartyTeamName: proposerTeam.name,
          gaveSummary: summarizeAssets(row.counterpartyAssets, movedPlayersById),
          gotSummary: summarizeAssets(row.proposerAssets, movedPlayersById),
        },
        occurredAt: now,
        auditEventId: null,
      });

      // BOTH parties of every doomed offer, not just its proposer (final review, LOW 9): the
      // counterparty had that offer in their inbox awaiting an answer, and something changed under
      // them — without this the card simply vanished on the next refetch with no word. Each reads
      // the sentence for their own side (`role`), naming the OTHER manager.
      const supersededNotices: MemberNotice[] = [];
      for (const superseded of supersededRows) {
        const doomedProposer = teamById.get(superseded.proposerTeamId)!;
        const doomedCounterparty = teamById.get(superseded.counterpartyTeamId)!;
        for (const recipient of [
          { team: doomedProposer, otherTeamName: doomedCounterparty.name, role: "proposer" as const },
          { team: doomedCounterparty, otherTeamName: doomedProposer.name, role: "counterparty" as const },
        ]) {
          supersededNotices.push(
            await notify(tx, {
              leagueId: row.leagueId,
              userId: recipient.team.userId,
              noticeType: "trade_superseded",
              context: { leagueName: league.name, counterpartyTeamName: recipient.otherTeamName, role: recipient.role },
              occurredAt: now,
              auditEventId: null,
            }),
          );
        }
      }

      // AUDIT — `trade_accepted` AND `roster_move`, ONE batch, the league chain.
      const events = await audit.recordAll(tx, [
        {
          eventType: "trade_accepted",
          actorId: input.userId,
          actorType: "user",
          leagueId: row.leagueId,
          payload: {
            tradeId: row.id,
            proposerTeamId: row.proposerTeamId,
            counterpartyTeamId: row.counterpartyTeamId,
            proposerAssetIds: giveIds,
            counterpartyAssetIds: getIds,
          },
          occurredAt: now,
        },
        {
          eventType: "roster_move",
          actorId: input.userId,
          actorType: "user",
          leagueId: row.leagueId,
          payload: {
            reason: "trade",
            tradeId: row.id,
            proposerTeamId: row.proposerTeamId,
            counterpartyTeamId: row.counterpartyTeamId,
            proposerAssetIds: giveIds,
            counterpartyAssetIds: getIds,
          },
          occurredAt: now,
        },
      ]);
      const tradeAcceptedEventId = events[0]!.eventId;
      await attachAuditEvent(tx, proposerNotice, tradeAcceptedEventId);
      await attachAuditEvent(tx, counterpartyNotice, tradeAcceptedEventId);
      for (const notice of supersededNotices) await attachAuditEvent(tx, notice, tradeAcceptedEventId);

      return {
        ok: true as const,
        outcome: "executed" as const,
        tradeId: row.id,
        supersededCount: supersededRows.length,
        supersededHeldTradeIds,
        fairness,
        weekNumber,
        notices: [proposerNotice, counterpartyNotice, ...supersededNotices],
      };
    });
  } catch (error: unknown) {
    if (error instanceof TransferRefusedError) {
      return { ok: false, status: 409, reason: error.message };
    }
    throw error;
  }

  if (!outcome.ok) return outcome;
  for (const notice of outcome.notices) await deliver(notice);

  if (outcome.outcome === "under_review") {
    // NOTHING FURTHER RUNS, same reasoning as `held`: no roster moved, no scores changed, and
    // the fairness flag question belongs to execution — the finalizer's own re-entry raises it
    // when the trade actually goes through.
    return { ok: true, outcome: "under_review", tradeId: outcome.tradeId, reviewEndsAt: outcome.reviewEndsAt, fairness: outcome.fairness };
  }

  if (outcome.outcome === "held") {
    // NOTHING FURTHER RUNS. No score-cache eviction (no roster moved, no week's scores changed),
    // no after-commit fairness-flag write (the `trade_hold` flag already committed INSIDE the
    // transaction that just returned — see `holdTradeInTx`'s own docblock and this function's own
    // "THE AUTO-HOLD" section for the full accounting of why there is no gap here to fill).
    return { ok: true, outcome: "held", tradeId: outcome.tradeId, fairness: outcome.fairness };
  }

  await invalidateScoreCacheQuietly(cache, input.leagueId, outcome.weekNumber);
  // Fix round 1, Finding 1: a SEPARATE transaction per superseded held trade, after this one has
  // already committed — the identical shape `raiseFairnessFlagQuietly` just below uses, and for
  // the identical reason (`closeSupersededHoldFlag`'s own docblock, `@/integrity-service/trade-
  // fairness`). A failure here never fails this function's own result: the superseding trade
  // already committed, and `npm run trades:sweep` is the re-run.
  await closeSupersededHoldFlagsQuietly(db, { tradeIds: outcome.supersededHeldTradeIds, leagueId: input.leagueId, occurredAt: now });
  // Task 6: a SEPARATE transaction, after this one has already committed — see
  // `raiseTradeFairnessFlag`'s own docblock for why, and `raiseFairnessFlagQuietly`'s for why a
  // failure here never fails this function's own result.
  await raiseFairnessFlagQuietly(raiseFairnessFlag, db, {
    tradeId: outcome.tradeId,
    leagueId: input.leagueId,
    balance: outcome.fairness.balance,
    gap: outcome.fairness.gap,
    giving: outcome.fairness.giving,
    receiving: outcome.fairness.receiving,
    basis: "accept_evaluation",
    occurredAt: now,
  });
  return { ok: true, outcome: "executed", tradeId: outcome.tradeId, supersededCount: outcome.supersededCount, fairness: outcome.fairness };
}

// ---------------------------------------------------------------------------------------------
// Plan D, Task 5: the two ways out of a hold. `resolveFlag`'s `trade_released`/`trade_blocked`
// branches (`@/integrity-service/flags`) are the only callers.
// ---------------------------------------------------------------------------------------------

export interface ReleaseHeldTradeInput {
  readonly tradeId: string;
  readonly leagueId: string;
  readonly operatorUserId: string;
  readonly clock?: Clock;
  readonly audit?: AuditLogger;
  readonly notify?: typeof notifyAffectedMember;
}

export type ReleaseHeldTradeResult =
  | {
      readonly ok: true;
      readonly tradeId: string;
      readonly weekNumber: number;
      readonly notices: readonly MemberNotice[];
      /** Fix round 1, Finding 1: every OTHER held offer THIS release just superseded, so the
       *  caller (`resolveFlag`'s own `trade_released` branch) can close each one's own
       *  `trade_hold` flag honestly, after this transaction commits. Empty on the healing branch
       *  — a retry never re-runs the sweep. */
      readonly supersededHeldTradeIds: readonly string[];
    }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * `trade_released`'s own execution: the trade the two managers agreed to actually goes through —
 * exactly what `acceptTrade` would have done had the gap never crossed the auto-hold threshold.
 * Called from `resolveFlag`'s own `trade_released` branch, in ITS OWN transaction, BEFORE
 * `resolveFlag`'s own ever opens — the identical two-transaction, two-chain shape
 * `reverseTradeInTx` already established for `trade_reversed` (`@/league-service/trade-reversal`,
 * whose own docblock states the full commit-order accounting this mirrors): this transaction's own
 * anchor is the LEAGUE chain (`trade_accepted` + `roster_move`, a fact two managers can already
 * see); `resolveFlag`'s is the PLATFORM chain (`flag_resolved`, a record about a decision). Plan
 * A's ruling 3 forbids one transaction spanning both, so two transactions is not a style choice —
 * it is the only shape either chain ruling allows.
 *
 * COMMIT ORDER, STATED, THE SAME REASONING `reverseTradeInTx` GIVES: this transaction commits
 * FIRST. A refusal here (a named player has moved on, or a race already decided this trade) leaves
 * the flag OPEN — `resolveFlag` never even opens its own transaction, so nothing false is ever
 * recorded. If THIS transaction commits and `resolveFlag`'s own later transaction then fails, the
 * trade IS genuinely released but the flag stays open — an operator resolving the SAME flag again
 * re-enters this function, and the HEALING branch below (`existing.status === "accepted"`) reports
 * success without re-running the transfer, so the retry reaches `resolveFlag`'s own stamp and the
 * flag actually closes. A held trade can only ever become `accepted` through THIS function — the
 * ordinary `acceptTrade` refuses a held row outright (`refusalFor`'s own held-specific message) —
 * so `accepted` on the trade this flag names is unambiguous proof this exact release already ran;
 * no second marker column is needed to tell it apart from an ordinary acceptance the way
 * `reversed_by_flag_id` has to for a reversal.
 *
 * THE WEEK IS RE-DERIVED HERE, NOT READ OFF THE HELD ROW (the C1 lesson, restated a third time in
 * this arc): `existing.weekNumber` is whatever week this trade was last VALUED at — the moment of
 * the hold, which can be days or weeks before an operator actually decides it. `currentWeekOf` is
 * asked again, fresh, the identical "the week is the server's to derive at the moment of the yes"
 * discipline `acceptTrade`'s own docblock states — a trade held on a Sunday and released on a
 * Wednesday is a Wednesday trade, priced and scored at the week it actually executes in, never the
 * week it happened to be frozen at.
 *
 * RE-VALIDATION, NOT ASSUMPTION: ownership is re-checked against the CURRENT roster, the identical
 * guard `acceptTrade`'s own STEP 4 makes, because the world can still have moved since the hold —
 * a named player traded away through some OTHER path this held trade's own supersede coverage
 * did not catch refuses here (409, naming what changed) rather than executing a transfer against a
 * roster that no longer matches the offer.
 *
 * The supersede sweep runs here exactly as it does in `acceptTrade`'s own execute branch: a
 * release is a real acceptance, and any OTHER open-or-held offer this release just invalidated
 * dies the same way it always does.
 */
export async function releaseHeldTradeInTx(tx: DbTx, input: ReleaseHeldTradeInput): Promise<ReleaseHeldTradeResult> {
  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const now = clock.now();

  // STEP 1 — a plain read, no write. Every refusal below through the guarded UPDATE can therefore
  // return a plain `{ ok: false, ... }` safely, the same discipline `acceptTrade` and
  // `reverseTradeInTx` both hold to.
  const [existing] = await tx
    .select()
    .from(tradeProposals)
    .where(and(eq(tradeProposals.id, input.tradeId), eq(tradeProposals.leagueId, input.leagueId)));
  if (existing === undefined) {
    return { ok: false, status: 404, reason: "We could not find that trade." };
  }
  if (existing.status === "accepted") {
    // THE HEALING BRANCH (mirroring `reverseTradeInTx`'s own) — see this function's own docblock.
    return { ok: true, tradeId: existing.id, weekNumber: existing.weekNumber, notices: [], supersededHeldTradeIds: [] };
  }
  if (existing.status !== "held") {
    return { ok: false, status: 409, reason: "This trade is no longer waiting on a decision." };
  }

  // THE WEEK, RE-DERIVED — see this function's own docblock.
  const weekNumber = await currentWeekOf(tx, input.leagueId);
  const [week] = await tx.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, weekNumber)).for("share");
  if (isLineupLocked(week?.status ?? "scheduled")) {
    return { ok: false, status: 409, reason: `Week ${weekNumber} has started, so rosters cannot change until it ends.` };
  }

  // Both teams' rows, FOR UPDATE, canonical sorted-by-id order — identical to `acceptTrade`'s own
  // ruling, and for the identical reason (a concurrent release racing a fresh accept, or another
  // release, on either of these two teams).
  const [firstTeamId, secondTeamId] = [existing.proposerTeamId, existing.counterpartyTeamId].sort();
  await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, firstTeamId)).for("update");
  await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, secondTeamId)).for("update");

  const giveIds = assetPlayerIds(existing.proposerAssets);
  const getIds = assetPlayerIds(existing.counterpartyAssets);

  // OWNERSHIP, RE-CHECKED HERE — the world may have moved since the hold.
  const currentRosterRows = await tx
    .select({ teamId: rosterSlots.teamId, playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .where(inArray(rosterSlots.teamId, [existing.proposerTeamId, existing.counterpartyTeamId]));
  const ownedByProposer = new Set(currentRosterRows.filter((r) => r.teamId === existing.proposerTeamId).map((r) => r.playerId));
  const ownedByCounterparty = new Set(currentRosterRows.filter((r) => r.teamId === existing.counterpartyTeamId).map((r) => r.playerId));
  if (!giveIds.every((id) => ownedByProposer.has(id)) || !getIds.every((id) => ownedByCounterparty.has(id))) {
    return { ok: false, status: 409, reason: "One of the players in this offer has already moved to another team. Ask for a fresh offer." };
  }

  // THE GUARDED UPDATE — the one-way stamp, `WHERE status = 'held'`, so a race (another operator,
  // or a concurrent supersede sweep) matches zero rows rather than a stale "yes".
  const [row] = await tx
    .update(tradeProposals)
    .set({ status: "accepted", settledAt: new Date(now), settledByUserId: input.operatorUserId, weekNumber })
    .where(and(eq(tradeProposals.id, input.tradeId), eq(tradeProposals.status, "held")))
    .returning();
  if (row === undefined) {
    return { ok: false, status: 409, reason: "This trade is no longer waiting on a decision." };
  }

  const [leagueRow] = await tx.select({ name: leagues.name, rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId));
  const league = leagueRow!;

  await applyTradeInTx(tx, {
    leagueId: input.leagueId,
    slotConfig: league.rosterSlots,
    proposerTeamId: row.proposerTeamId,
    counterpartyTeamId: row.counterpartyTeamId,
    proposerAssets: row.proposerAssets,
    counterpartyAssets: row.counterpartyAssets,
  });

  // THE SUPERSEDE SWEEP — a release is a real acceptance, so any OTHER open-or-held offer this
  // just invalidated dies the same way it always does.
  const movedPlayerIds = [...giveIds, ...getIds];
  const doomed = await openOrHeldProposalsNaming(tx, row.leagueId, movedPlayerIds, row.id);
  const supersededRows =
    doomed.length === 0
      ? []
      : await tx
          .update(tradeProposals)
          .set({ status: "superseded", settledAt: new Date(now) })
          .where(and(or(eq(tradeProposals.status, "open"), eq(tradeProposals.status, "held")), inArray(tradeProposals.id, doomed.map((p) => p.id))))
          .returning();
  // Fix round 1, Finding 1: closing any superseded held trade's own flag is a PLATFORM-scoped
  // `flag_resolved` append, and this transaction's own anchor is the LEAGUE chain — the identical
  // "rides the result out to an after-commit step" shape `acceptTrade`'s own supersede sweep
  // uses, and for the identical reason. The CALLER (`resolveFlag`'s `trade_released` branch)
  // does the closing, once THIS transaction has committed.
  const actuallySupersededIds = new Set(supersededRows.map((s) => s.id));
  const supersededHeldTradeIds = doomed.filter((d) => d.status === "held" && actuallySupersededIds.has(d.id)).map((d) => d.id);

  const teamIds = [...new Set([row.proposerTeamId, row.counterpartyTeamId, ...supersededRows.flatMap((s) => [s.proposerTeamId, s.counterpartyTeamId])])];
  const teamRows = await tx.select({ id: teams.id, name: teams.name, userId: teams.userId }).from(teams).where(inArray(teams.id, teamIds));
  const teamById = new Map(teamRows.map((t) => [t.id, t]));

  const playerRows =
    movedPlayerIds.length === 0 ? [] : await tx.select({ id: players.id, name: players.name, position: players.position }).from(players).where(inArray(players.id, movedPlayerIds));
  const movedPlayersById: Readonly<Record<string, ValuedPlayer>> = playersById(
    playerRows.map((p) => ({ playerId: p.id, name: p.name, position: p.position, averagePoints: 0 })),
  );

  const proposerTeam = teamById.get(row.proposerTeamId)!;
  const counterpartyTeam = teamById.get(row.counterpartyTeamId)!;

  const proposerNotice = await notify(tx, {
    leagueId: row.leagueId,
    userId: proposerTeam.userId,
    noticeType: "trade_executed",
    context: {
      leagueName: league.name,
      counterpartyTeamName: counterpartyTeam.name,
      gaveSummary: summarizeAssets(row.proposerAssets, movedPlayersById),
      gotSummary: summarizeAssets(row.counterpartyAssets, movedPlayersById),
    },
    occurredAt: now,
    auditEventId: null,
  });
  const counterpartyNotice = await notify(tx, {
    leagueId: row.leagueId,
    userId: counterpartyTeam.userId,
    noticeType: "trade_executed",
    context: {
      leagueName: league.name,
      counterpartyTeamName: proposerTeam.name,
      gaveSummary: summarizeAssets(row.counterpartyAssets, movedPlayersById),
      gotSummary: summarizeAssets(row.proposerAssets, movedPlayersById),
    },
    occurredAt: now,
    auditEventId: null,
  });

  const supersededNotices: MemberNotice[] = [];
  for (const superseded of supersededRows) {
    const doomedProposer = teamById.get(superseded.proposerTeamId)!;
    const doomedCounterparty = teamById.get(superseded.counterpartyTeamId)!;
    for (const recipient of [
      { team: doomedProposer, otherTeamName: doomedCounterparty.name, role: "proposer" as const },
      { team: doomedCounterparty, otherTeamName: doomedProposer.name, role: "counterparty" as const },
    ]) {
      supersededNotices.push(
        await notify(tx, {
          leagueId: row.leagueId,
          userId: recipient.team.userId,
          noticeType: "trade_superseded",
          context: { leagueName: league.name, counterpartyTeamName: recipient.otherTeamName, role: recipient.role },
          occurredAt: now,
          auditEventId: null,
        }),
      );
    }
  }

  // ANCHOR — LEAGUE chain, `trade_accepted` + `roster_move`, ONE batch, LAST — identical shape to
  // `acceptTrade`'s own.
  const events = await audit.recordAll(tx, [
    {
      eventType: "trade_accepted",
      actorId: input.operatorUserId,
      actorType: "user",
      leagueId: row.leagueId,
      payload: {
        tradeId: row.id,
        proposerTeamId: row.proposerTeamId,
        counterpartyTeamId: row.counterpartyTeamId,
        proposerAssetIds: giveIds,
        counterpartyAssetIds: getIds,
        releasedFromHold: true,
      },
      occurredAt: now,
    },
    {
      eventType: "roster_move",
      actorId: input.operatorUserId,
      actorType: "user",
      leagueId: row.leagueId,
      payload: {
        reason: "trade",
        tradeId: row.id,
        proposerTeamId: row.proposerTeamId,
        counterpartyTeamId: row.counterpartyTeamId,
        proposerAssetIds: giveIds,
        counterpartyAssetIds: getIds,
      },
      occurredAt: now,
    },
  ]);
  const tradeAcceptedEventId = events[0]!.eventId;
  await attachAuditEvent(tx, proposerNotice, tradeAcceptedEventId);
  await attachAuditEvent(tx, counterpartyNotice, tradeAcceptedEventId);
  for (const notice of supersededNotices) await attachAuditEvent(tx, notice, tradeAcceptedEventId);

  return { ok: true, tradeId: row.id, weekNumber, notices: [proposerNotice, counterpartyNotice, ...supersededNotices], supersededHeldTradeIds };
}

export interface BlockHeldTradeInput {
  readonly tradeId: string;
  readonly leagueId: string;
  readonly operatorUserId: string;
  /** The operator's own words — `resolveFlag`'s own `input.note`, carried through verbatim so
   *  `trade_blocked`'s notice can quote it (`quoteFor`), the same split `trade_reversed`'s note
   *  already keeps. */
  readonly note: string;
  readonly clock?: Clock;
  readonly notify?: typeof notifyAffectedMember;
}

export type BlockHeldTradeResult =
  | { readonly ok: true; readonly tradeId: string; readonly notices: readonly MemberNotice[] }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * `trade_blocked`'s own execution: the trade never happens, and both rosters stay exactly as they
 * were. Called from `resolveFlag`'s own `trade_blocked` branch, INSIDE `resolveFlag`'s own
 * transaction — unlike `trade_released`, this needs no second transaction and no second chain: a
 * block moves nothing, so there is no league-scoped fact to record at all, and this function's own
 * writes (the stamp and both notices) are exactly as platform-scoped as the hold itself was. The
 * `flag_resolved` event `resolveFlag` appends right after this returns IS the record.
 *
 * ONE WAY: the guard is the guarded UPDATE's own `WHERE status = 'held'`, not a prior read. The
 * healing branch (`existing.status === "blocked"`) mirrors `releaseHeldTradeInTx`'s own — a held
 * trade can only ever become `blocked` through this function, so finding it already there is
 * unambiguous proof this exact decision already landed, most likely because `resolveFlag`'s own
 * platform-chain stamp failed on a prior attempt after this part had already committed.
 */
export async function blockHeldTradeInTx(tx: DbTx, input: BlockHeldTradeInput): Promise<BlockHeldTradeResult> {
  const clock = input.clock ?? systemClock;
  const notify = input.notify ?? notifyAffectedMember;
  const now = clock.now();

  const [existing] = await tx
    .select()
    .from(tradeProposals)
    .where(and(eq(tradeProposals.id, input.tradeId), eq(tradeProposals.leagueId, input.leagueId)));
  if (existing === undefined) {
    return { ok: false, status: 404, reason: "We could not find that trade." };
  }
  if (existing.status === "blocked") {
    return { ok: true, tradeId: existing.id, notices: [] };
  }
  if (existing.status !== "held") {
    return { ok: false, status: 409, reason: "This trade is no longer waiting on a decision." };
  }

  const [row] = await tx
    .update(tradeProposals)
    .set({ status: "blocked", settledAt: new Date(now), settledByUserId: input.operatorUserId })
    .where(and(eq(tradeProposals.id, input.tradeId), eq(tradeProposals.status, "held")))
    .returning();
  if (row === undefined) {
    return { ok: false, status: 409, reason: "This trade is no longer waiting on a decision." };
  }

  const teamRows = await tx.select({ id: teams.id, name: teams.name, userId: teams.userId }).from(teams).where(inArray(teams.id, [row.proposerTeamId, row.counterpartyTeamId]));
  const teamById = new Map(teamRows.map((t) => [t.id, t]));
  const proposerTeam = teamById.get(row.proposerTeamId)!;
  const counterpartyTeam = teamById.get(row.counterpartyTeamId)!;
  const [leagueRow] = await tx.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, input.leagueId));
  const leagueName = leagueRow!.name;

  // BOTH managers, the SAME context object — BYTE-IDENTICAL words, unlike `trade_executed`'s own
  // pair, which deliberately swaps `counterpartyTeamName` per side. `NoticeContexts.trade_blocked`
  // carries no counterparty name at all for exactly that reason (see its own docblock,
  // `@/integrity/notices`): the product never signals which of the two, if either, the review was
  // actually about.
  const noticeContext = { leagueName, note: input.note };
  const proposerNotice = await notify(tx, {
    leagueId: row.leagueId,
    userId: proposerTeam.userId,
    noticeType: "trade_blocked",
    context: noticeContext,
    occurredAt: now,
    auditEventId: null,
  });
  const counterpartyNotice = await notify(tx, {
    leagueId: row.leagueId,
    userId: counterpartyTeam.userId,
    noticeType: "trade_blocked",
    context: noticeContext,
    occurredAt: now,
    auditEventId: null,
  });

  return { ok: true, tradeId: row.id, notices: [proposerNotice, counterpartyNotice] };
}

export interface ListTradesInput {
  readonly leagueId: string;
  readonly teamId: string;
}

/**
 * `nameById.get(...)!`: `proposerTeamId`/`counterpartyTeamId` carry a real foreign key onto
 * `teams.id` with `onDelete: "cascade"` — a team row cannot be deleted while a `trade_proposals`
 * row still references it, cascade removes the trade WITH it — so `listTrades`' own team-id
 * gather (`teamIds`, above) always finds a name for every id a row can carry. A fallback here
 * would defend against a state the schema itself makes impossible.
 */
function toProposalView(row: TradeProposal, nameById: ReadonlyMap<string, string>): TradeProposalView {
  const fromView: TradeSideView = {
    teamId: row.proposerTeamId,
    teamName: nameById.get(row.proposerTeamId)!,
    assets: row.proposerAssets,
  };
  const toView: TradeSideView = {
    teamId: row.counterpartyTeamId,
    teamName: nameById.get(row.counterpartyTeamId)!,
    assets: row.counterpartyAssets,
  };
  return {
    id: row.id,
    leagueId: row.leagueId,
    weekNumber: row.weekNumber,
    status: row.status,
    proposedAt: row.proposedAt,
    expiresAt: row.expiresAt,
    settledAt: row.settledAt,
    reversedAt: row.reversedAt,
    note: row.note,
    from: fromView,
    to: toView,
  };
}

/** The three bands `GET /api/leagues/[leagueId]/trades` answers with: offers to answer, offers
 *  sent, and history — the caller's own team's inbox/outbox, and (fix round 1, F1) the league's
 *  ACCEPTED trades plus the caller's own dead ones, never another pair's still-open or dead
 *  negotiation. Team names are resolved batched, once, never per row. */
export async function listTrades(db: Db, input: ListTradesInput): Promise<TradesPageBody> {
  const [inboxRows, outboxRows, historyRows] = await Promise.all([
    tradesQuery(db, { ...input, box: "inbox" }),
    tradesQuery(db, { ...input, box: "outbox" }),
    tradesQuery(db, { ...input, box: "history" }),
  ]);

  const allRows = [...inboxRows, ...outboxRows, ...historyRows];
  const teamIds = [...new Set(allRows.flatMap((row) => [row.proposerTeamId, row.counterpartyTeamId]))];
  const teamRows = teamIds.length === 0 ? [] : await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds));
  const nameById = new Map(teamRows.map((row) => [row.id, row.name]));

  return {
    leagueId: input.leagueId,
    meTeamId: input.teamId,
    inbox: inboxRows.map((row) => toProposalView(toTradeProposal(row), nameById)),
    outbox: outboxRows.map((row) => toProposalView(toTradeProposal(row), nameById)),
    history: historyRows.map((row) => toProposalView(toTradeProposal(row), nameById)),
  };
}
