import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { assembleAdvisorContext, valuePlayers } from "@/ai-advisor/context";
import type { Db, DbTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { leagues, teams, tradeProposals } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { Position } from "@/domain/player";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { assignSlot } from "@/draft-engine";
import { canonicalSerialize } from "@/integrity/canonical";
import type { NoticeContexts } from "@/integrity/notices";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, deliverNotice, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { tradeBalance, type TradeBalance, type ValuedPlayer } from "@/trades/fairness";
import { assetPlayerIds, describeAsset, type TradeAsset } from "@/trades/assets";
import { TRADE_CONFIG } from "@/trades/config";
import { isBalancedProposal } from "@/domain/trade";
import { nextStatusFor, type TradeStatus } from "@/trades/lifecycle";
import type { TradeProposalView, TradeSideView, TradesPageBody } from "@/trades/contract";

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

const systemClock: Clock = { now: () => new Date().toISOString() };

/** English, singular or joined naturally ("A", "A and B", "A, B, and C") — no hand-rolled comma
 *  logic to keep coverage-honest, and no dash either way. */
const ASSET_LIST_FORMAT = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

function summarizeAssets(assets: readonly TradeAsset[], playersById: Readonly<Record<string, ValuedPlayer>>): string {
  return ASSET_LIST_FORMAT.format(assets.map((asset) => describeAsset(asset, playersById).label));
}

function playersById(players: readonly ValuedPlayer[]): Readonly<Record<string, ValuedPlayer>> {
  return Object.fromEntries(players.map((player) => [player.playerId, player]));
}

/** Contains "no room" on purpose — `task-3-brief.md`'s own test greps for exactly that phrase. */
const NO_ROOM_REASON = "There's no room on that roster for one of the players you're asking for.";

/**
 * Whether ONE team's roster has a legal home for everything it is about to receive, once
 * everything it is sending away is gone first — the same "clear both sides before you fill
 * either" order Task 4's `plannedTransfer` formalizes later, run here as a preview so a manager
 * never wastes a yes on an offer the product would refuse at accept time anyway (Task 4 owns the
 * transfer itself; this is advisory only and touches no roster).
 *
 * Reuses `assignSlot` (`@/draft-engine`) — the one function that already decides where a player
 * lands — rather than a second placement policy.
 */
/** A roster entry `checkRoom` actually ever sees: always filled. `assembleAdvisorContext`'s own
 *  roster read (`@/ai-advisor/context`) already drops every empty slot before this is built —
 *  see `myRoster`/`theirRoster` below — so `RosterSlot`'s general `playerId: string | null` is a
 *  wider type than anything this function is ever called with. */
interface FilledRosterSlot {
  readonly slot: RosterSlot["slot"];
  readonly slotIndex: number;
  readonly playerId: string;
}

function checkRoom(
  currentRoster: readonly FilledRosterSlot[],
  outgoingIds: readonly string[],
  incomingIds: readonly string[],
  incomingPositions: ReadonlyMap<string, Position>,
  slotConfig: readonly RosterSlotConfig[],
): string | null {
  let remaining = currentRoster.filter((slot) => !outgoingIds.includes(slot.playerId));
  for (const playerId of incomingIds) {
    const position = incomingPositions.get(playerId)!;
    const assignment = assignSlot({ position, roster: remaining, slotConfig });
    if (!assignment.ok) return NO_ROOM_REASON;
    remaining = [...remaining, { slot: assignment.slot, slotIndex: assignment.slotIndex, playerId }];
  }
  return null;
}

export interface ProposeTradeInput {
  readonly leagueId: string;
  /** The offer resolves to a team from THIS, never from the request body — see the schema's own
   *  docblock for why there is no `proposerTeamId` field to spoof. */
  readonly userId: string;
  readonly counterpartyTeamId: string;
  readonly weekNumber: number;
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
 * `checkRoom`, before anybody has to answer it); the identical open offer already out (409, the
 * partial unique fingerprint index).
 *
 * The verdict returned on success is `tradeBalance` run for the PROPOSER'S OWN eyes only —
 * advisory, never stored, never shown to the counterparty and never conflated with Task 6's
 * after-acceptance detector, which runs its own valuation independently at a different moment
 * for a different audience.
 *
 * LOCK ORDER (ruling 3). Business rows first: the proposal row itself. Then the notice, which
 * takes `FOR KEY SHARE` on `users` and `leagues`. Then the anchor. Then `attachAuditEvent`. Then
 * commit, then `deliverNotice` outside the transaction entirely. Nothing here touches
 * `stat_weeks`: a proposal moves no roster.
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

  const proposerAssetIds = assetPlayerIds(input.proposerAssets);
  const counterpartyAssetIds = assetPlayerIds(input.counterpartyAssets);
  if (
    !isBalancedProposal({
      leagueId: input.leagueId,
      weekNumber: input.weekNumber,
      from: { teamId: proposerTeamId, playerIds: proposerAssetIds },
      to: { teamId: input.counterpartyTeamId, playerIds: counterpartyAssetIds },
    })
  ) {
    return { ok: false, status: 422, reason: "Both sides need to send at least one player." };
  }

  const [mine, theirs] = await Promise.all([
    assembleAdvisorContext(db, { leagueId: input.leagueId, teamId: proposerTeamId, weekNumber: input.weekNumber }),
    assembleAdvisorContext(db, { leagueId: input.leagueId, teamId: input.counterpartyTeamId, weekNumber: input.weekNumber }),
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

  const myRoomIssue = checkRoom(myRoster, proposerAssetIds, counterpartyAssetIds, theirPositions, slotConfig);
  if (myRoomIssue !== null) return { ok: false, status: 422, reason: myRoomIssue };
  const theirRoomIssue = checkRoom(theirRoster, counterpartyAssetIds, proposerAssetIds, myPositions, slotConfig);
  if (theirRoomIssue !== null) return { ok: false, status: 422, reason: theirRoomIssue };

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
      // THE FIRST LOCK, ahead of the count. `SELECT ... FOR UPDATE` on the proposer's own team
      // row serializes every concurrent `proposeTrade` from this team: without it, two proposals
      // arriving at once both read the SAME "N-1 open offers" snapshot and both insert, because a
      // row lock on the rows a count reads cannot fence a PHANTOM insert nobody has written yet.
      // Locking the team row first means the second caller's count only ever runs after the
      // first's insert has committed (or rolled back) and released it.
      //
      // LOCK ORDER (ruling 3): a business row, taken first, ahead of the notice's `FOR KEY SHARE`
      // on `leagues`/`users` and ahead of the anchor — the global order, unchanged. The insert
      // below takes the identical `FOR KEY SHARE` on this SAME row through its own foreign key;
      // re-taking a weaker lock on a row this transaction already holds `FOR UPDATE` on is not a
      // second lock. `src/integrity-service/lock-order.test.ts`'s `proposeTrade's insert order`
      // drives this against a real park on `leagues[X] FOR UPDATE` and proves no deadlock.
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, proposerTeamId)).for("update");

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
          weekNumber: input.weekNumber,
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
  // guarded UPDATE above failed to match is the one condition left: expiry.
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
 * UPDATE's own row lock, which also takes `FOR KEY SHARE` on `leagues` and both `teams` rows
 * through its foreign keys. Then the notice, which takes `FOR KEY SHARE` on `users` and
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
          gt(tradeProposals.expiresAt, new Date(now)),
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

/** Only the PROPOSER may withdraw. */
export async function withdrawTrade(db: Db, input: SettleTradeInput): Promise<SettleTradeResult> {
  return settleProposal(db, { ...input, transition: "withdraw" });
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
 *  sent, and the league's settled history — the caller's own team's inbox/outbox, the league's
 *  whole history. Team names are resolved batched, once, never per row. */
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
