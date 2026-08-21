import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, ne, or } from "drizzle-orm";
import { assembleAdvisorContext, valuePlayers } from "@/ai-advisor/context";
import type { Db, DbTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { leagues, players, rosterSlots, statWeeks, teams, tradeProposals } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { Position } from "@/domain/player";
import { isLineupLocked } from "@/league";
import { canonicalSerialize } from "@/integrity/canonical";
import type { NoticeContexts } from "@/integrity/notices";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, deliverNotice, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { evaluateTradeBeforeExecute, raiseTradeFairnessFlag, type TradeFairnessEvaluation } from "@/integrity-service/trade-fairness";
import { tradeBalance, type TradeBalance, type ValuedPlayer } from "@/trades/fairness";
import { assetPlayerIds, describeAsset, type TradeAsset } from "@/trades/assets";
import { TRADE_CONFIG } from "@/trades/config";
import { isBalancedProposal } from "@/domain/trade";
import { nextStatusFor, type TradeStatus } from "@/trades/lifecycle";
import type { TradeProposalView, TradeSideView, TradesPageBody } from "@/trades/contract";
import type { ScoreCache } from "@/stats-pipeline/score-cache";
import { currentWeekOf } from "./schedule";
import { applyTradeInTx, plannedTransfer, TransferRefusedError, type FilledRosterSlot, type TransferAsset } from "./trade-transfer";

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
    return { ok: false, status: 403, reason: "You don't have a team in this league." };
  }
  const proposerTeamId = proposerTeam.id;

  if (proposerTeamId === input.counterpartyTeamId) {
    return { ok: false, status: 422, reason: "You can't trade with your own team." };
  }

  // THE WEEK, DERIVED — see this function's own docblock. One read, one definition.
  const weekNumber = await currentWeekOf(db, input.leagueId);

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
    return { ok: false, status: 404, reason: "We couldn't find that team in this league." };
  }

  const myPlayers = playersById(myContext.me.players);
  const theirPlayers = playersById(theirs.me.players);
  const myOwnedIds = new Set(Object.keys(myPlayers));
  const theirOwnedIds = new Set(Object.keys(theirPlayers));

  if (!proposerAssetIds.every((id) => myOwnedIds.has(id))) {
    return { ok: false, status: 422, reason: "One of those players isn't on your team." };
  }
  if (!counterpartyAssetIds.every((id) => theirOwnedIds.has(id))) {
    return { ok: false, status: 422, reason: "One of those players isn't on that team." };
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
  if (row === undefined) return { ok: false, status: 404, reason: "We couldn't find that offer." };

  const authorizedTeamId = input.transition === "withdraw" ? row.proposerTeamId : row.counterpartyTeamId;
  if (authorizedTeamId !== input.actorTeamId) {
    // Same answer for "doesn't exist" and "isn't yours" — an id must tell a prober nothing.
    return { ok: false, status: 404, reason: "We couldn't find that offer." };
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
    if (existing === undefined) return { ok: false as const, status: 404, reason: "We couldn't find that offer." };

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
 * Every OTHER open offer in this league naming a player the just-accepted trade moved — the
 * supersede sweep's own read. ONE bounded query over `trade_proposals_league_idx` (this league's
 * rows), filtered in TypeScript with `assetPlayerIds`: the asset lists are `jsonb` and bounded at
 * `TRADE_CONFIG.maxAssetsPerSide` per row, so a `jsonb` containment predicate per moved player
 * would buy nothing and cost an index this plan does not have. `excludeTradeId` is the trade that
 * just accepted — belt over the brace that its own `status` is no longer `'open'` by the time
 * this runs, so the filter below would already exclude it either way.
 */
async function openProposalsNaming(
  tx: DbTx,
  leagueId: string,
  movedPlayerIds: readonly string[],
  excludeTradeId: string,
): Promise<readonly (typeof tradeProposals.$inferSelect)[]> {
  const rows = await tx
    .select()
    .from(tradeProposals)
    .where(and(eq(tradeProposals.leagueId, leagueId), eq(tradeProposals.status, "open")));
  const moved = new Set(movedPlayerIds);
  return rows.filter(
    (row) =>
      row.id !== excludeTradeId &&
      [...assetPlayerIds(row.proposerAssets), ...assetPlayerIds(row.counterpartyAssets)].some((id) => moved.has(id)),
  );
}

export interface AcceptTradeInput {
  readonly tradeId: string;
  readonly leagueId: string;
  readonly userId: string;
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
   *  function's own result. */
  readonly raiseFairnessFlag?: typeof raiseTradeFairnessFlag;
}

export type AcceptTradeResult =
  | {
      readonly ok: true;
      readonly tradeId: string;
      /** How many other open offers this acceptance just made unhonorable. */
      readonly supersededCount: number;
      /** The seam Plan D needs: computed inside this same transaction, from the rosters as they
       *  stood a moment before this trade moved them. Rides to Task 6's after-commit flag write. */
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
 * transaction, after the ownership re-check and after the guarded UPDATE (both rosters
 * confirmed current and the acceptance itself confirmed live) and before `applyTradeInTx` moves
 * anything — the rosters as they stand a moment before they move. Its verdict rides this
 * function's own result for Task 6 to act on after commit; `hold` is always `false` while
 * `INTEGRITY_CONFIG.trade.autoHoldThreshold` is `null`, which is every trade this plan executes.
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
        readonly tradeId: string;
        readonly supersededCount: number;
        readonly fairness: TradeFairnessEvaluation;
        readonly weekNumber: number;
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
        return { ok: false as const, status: 404, reason: "We couldn't find that offer." };
      }

      // STEP 2 — THE WEEK, DERIVED AT THE MOMENT OF THE YES (final review, CRITICAL 1), then
      // locked. Never `existing.weekNumber`: a 72-hour offer can straddle a week boundary, and
      // the week that governs an execution is the one the league is actually living in when the
      // rosters move — which is also the only week whose scores this trade can change, and the
      // only lock that coordinates with `persistTick` flipping the LIVE week. `currentWeekOf`
      // runs on `tx`, so the answer is the one this transaction will act on.
      const weekNumber = await currentWeekOf(tx, input.leagueId);
      const [week] = await tx.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, weekNumber)).for("share");
      if (isLineupLocked(week?.status ?? "scheduled")) {
        return { ok: false as const, status: 409, reason: `Week ${weekNumber} has started, so rosters can't change until it ends.` };
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

      // STEP 5 — THE GUARDED UPDATE, the one true authorization gate and the LAST write before
      // the transfer itself. Still safe as a plain return on failure: a `WHERE` that matches zero
      // rows changes nothing, whether that is because the caller was never the counterparty, the
      // offer already settled, or a concurrent settlement won the race since the plain read at
      // step 1. From here on, every remaining refusal is a THROW, never a plain return —
      // `applyTradeInTx`'s own `TransferRefusedError`, caught outside the transaction below.
      const [row] = await tx
        .update(tradeProposals)
        // `weekNumber` is RE-STAMPED to the accept-time week, not left at the propose-time one
        // (final review, CRITICAL 1): the row records the week this trade actually happened in,
        // which is what `sweepUnflaggedTrades` re-derives its own valuation at long afterward
        // (`reDeriveAcceptedTradeValue`, `@/integrity-service/trade-fairness`). A trade proposed
        // on Sunday and accepted on Tuesday is a Tuesday trade. Not a foreign-key column, so this
        // still takes no lock beyond the ones step 5's own docblock already enumerates.
        .set({ status: "accepted", settledAt: new Date(now), settledByUserId: input.userId, weekNumber })
        .where(
          and(
            eq(tradeProposals.id, input.tradeId),
            eq(tradeProposals.leagueId, input.leagueId),
            eq(tradeProposals.status, "open"),
            gt(tradeProposals.expiresAt, new Date(now)),
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

      const [leagueRow] = await tx.select({ name: leagues.name, rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId));
      // FK-guaranteed: `trade_proposals.league_id` references `leagues.id`, cascading — a row this
      // transaction just guarded-updated always names a league that is still there.
      const league = leagueRow!;

      // THE SEAM, computed from the rosters a moment before they move — see this function's own
      // docblock and `evaluateTradeBeforeExecute`'s. Valued at the DERIVED accept-time week (the
      // same one just stamped onto `row`), never at a week the proposal was allowed to name.
      const fairness = await evaluateTradeBeforeExecute(tx, {
        leagueId: input.leagueId,
        weekNumber,
        proposerTeamId: row.proposerTeamId,
        counterpartyTeamId: row.counterpartyTeamId,
        proposerAssetIds: giveIds,
        counterpartyAssetIds: getIds,
      });

      await applyTradeInTx(tx, {
        leagueId: input.leagueId,
        slotConfig: league.rosterSlots,
        proposerTeamId: row.proposerTeamId,
        counterpartyTeamId: row.counterpartyTeamId,
        proposerAssets: row.proposerAssets,
        counterpartyAssets: row.counterpartyAssets,
      });

      // THE SUPERSEDE SWEEP — one statement, not a loop, derived from the moved player ids.
      const movedPlayerIds = [...giveIds, ...getIds];
      const doomed = await openProposalsNaming(tx, row.leagueId, movedPlayerIds, row.id);
      const supersededRows =
        doomed.length === 0
          ? []
          : await tx
              .update(tradeProposals)
              .set({ status: "superseded", settledAt: new Date(now) })
              .where(
                and(
                  eq(tradeProposals.status, "open"),
                  inArray(
                    tradeProposals.id,
                    doomed.map((proposal) => proposal.id),
                  ),
                ),
              )
              .returning();

      // NOTICES — `trade_executed` to both parties, `trade_superseded` to every doomed proposer.
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

      const supersededNotices: MemberNotice[] = [];
      for (const superseded of supersededRows) {
        const doomedProposer = teamById.get(superseded.proposerTeamId)!;
        const doomedCounterparty = teamById.get(superseded.counterpartyTeamId)!;
        supersededNotices.push(
          await notify(tx, {
            leagueId: row.leagueId,
            userId: doomedProposer.userId,
            noticeType: "trade_superseded",
            context: { leagueName: league.name, counterpartyTeamName: doomedCounterparty.name },
            occurredAt: now,
            auditEventId: null,
          }),
        );
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
        tradeId: row.id,
        supersededCount: supersededRows.length,
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
  await invalidateScoreCacheQuietly(cache, input.leagueId, outcome.weekNumber);
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
  return { ok: true, tradeId: outcome.tradeId, supersededCount: outcome.supersededCount, fairness: outcome.fairness };
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
