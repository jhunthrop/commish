import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, DbTx } from "@/db/client";
import { chatMessages, integrityFlags, leagues, moneyAccounts, moneyEntries, moneyTransactions, reviews, teams, tradeProposals, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { notifyAffectedMember } from "@/integrity-service/notify";
import { accountIdFor, type MoneyAccountId } from "@/money/accounts";
import { prizeTableInvariant, type PrizeTable } from "@/money/prize-table";
import { entryFeeContributionInTx } from "./entry-fee";
import { ensureAndLockMoneyAccounts, postMoneyTransaction, type MoneyEntryInput } from "./post";
import { accountBalance } from "./read";

/**
 * Every reason settlement (or a hold outcome) declines to act, named once — `DISSOLUTION_REFUSALS`'
 * own discipline (`./dissolution`), and the set `expectNoSettlementTookPlace` assertions read
 * verbatim (`@/money/config`'s own docblock names that helper for exactly this file). Money-first
 * copy on every sentence a money door speaks.
 */
export const SETTLEMENT_REFUSALS = {
  leagueMissing: "That league does not exist.",
  seasonNotComplete: "No money moved. This league's season has not finished yet, so there is nothing to settle.",
  standingsIncomplete: "No money moved. The standings must name a different seated member for every paid place.",
  /** The escrow-to-zero law's own sentence: the pot the table was published against is not the
   *  pot the escrow holds, and settlement refuses whole rather than pays what it can. */
  escrowMismatch: "No money moved. This league's escrow does not match its published prize table to the cent, so settlement refused rather than guessed.",
  nothingHeld: "No money moved. Nothing is held for review on this account.",
  /** The hold preview's own refusal — a read, so "No money moved" would be a strange thing to
   *  promise about an act that was never attempted. */
  memberMissing: "That member does not exist.",
} as const;

export interface SettlementPreviewRosterEntry {
  readonly userId: string;
  readonly teamName: string;
  readonly ownerDisplayName: string;
}

export type SettlementPreviewResult =
  | {
      readonly ok: true;
      readonly leagueName: string;
      readonly seasonCompleted: boolean;
      readonly entryFeeCents: number;
      readonly prizeTable: PrizeTable;
      readonly escrowCents: number;
      readonly roster: readonly SettlementPreviewRosterEntry[];
    }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * The read-then-confirm half of this door (operator review, 2026-08-27, findings D1/D3): what
 * `settleSeasonPayouts` is ABOUT to pay, before an operator commits standings that close a
 * league's escrow for good. `roster` names every seat by its owner's own display name
 * (`listTeamCards`'s own join, `@/draft-service/teams`, reproduced here rather than imported —
 * `@/draft-service` sits on this codebase's own server-only-module list, and a service module
 * importing a SIBLING service module's read helper would be a second, undocumented dependency
 * edge this file's own docblocks never argue for) so the confirm step can put a name, not a bare
 * id, beside every place the operator typed. `prizeTable` and `escrowCents` are the same two
 * figures `settleSeasonPayouts` itself checks under lock (`prizeTableInvariant`, the escrow
 * rollup) — read here WITHOUT a lock, because a preview is a snapshot an operator reads before
 * deciding, never the authority the real settlement re-derives for itself a moment later.
 */
export async function settlementPreview(db: Db, leagueId: string): Promise<SettlementPreviewResult> {
  const [league] = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      entryFeeCents: leagues.entryFeeCents,
      payoutTable: leagues.payoutTable,
      seasonCompletedAt: leagues.seasonCompletedAt,
    })
    .from(leagues)
    .where(eq(leagues.id, leagueId));
  if (league === undefined) return { ok: false, status: 404, reason: SETTLEMENT_REFUSALS.leagueMissing };

  const roster = await db
    .select({ userId: teams.userId, teamName: teams.name, ownerDisplayName: users.displayName })
    .from(teams)
    .innerJoin(users, eq(users.id, teams.userId))
    .where(eq(teams.leagueId, league.id))
    .orderBy(asc(teams.id));

  const escrowCents = await accountBalance(db, accountIdFor("league_escrow", league.id));

  return {
    ok: true,
    leagueName: league.name,
    seasonCompleted: league.seasonCompletedAt !== null,
    entryFeeCents: league.entryFeeCents,
    prizeTable: league.payoutTable ?? [],
    escrowCents,
    roster,
  };
}

export type HoldPreviewResult =
  | { readonly ok: true; readonly displayName: string; readonly heldCents: number }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * The read-then-confirm half of `releaseHold`/`confiscateHold` (operator review, finding D1/D3):
 * the member's own name and the exact amount either one-way exit would move, read with
 * `accountBalance` (`./read`) — the SAME entry-sum a real reconciliation trusts, never the
 * `money_accounts` rollup — but with no lock, because a preview commits nothing. Two operators
 * previewing the same member's hold at once simply both see the balance as it stood a moment
 * ago; `resolveHeldPayout`'s own locked re-read is what decides which of them (if either) still
 * finds money there when they actually press the button.
 */
export async function holdPreview(db: Db, userId: string): Promise<HoldPreviewResult> {
  const [user] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, userId));
  if (user === undefined) return { ok: false, status: 404, reason: SETTLEMENT_REFUSALS.memberMissing };

  const heldCents = await accountBalance(db, accountIdFor("held_for_review", userId));
  return { ok: true, displayName: user.displayName, heldCents };
}

/** One line of the operator's standings input: WHO finished at each place. Never an amount —
 *  the amounts are the league's own stored `payout_table`, read under lock. */
export interface SettlementStanding {
  readonly place: number;
  readonly userId: string;
}

export interface SettleSeasonPayoutsInput {
  readonly leagueId: string;
  /** From `withAdmin`'s verified session, never a request body — `dissolveLeague`'s own rule. */
  readonly operatorUserId: string;
  readonly standings: readonly SettlementStanding[];
}

export type SettleSeasonPayoutsResult =
  | {
      readonly ok: true;
      /** True when the book already held this league's settlement and THIS call wrote nothing. */
      readonly alreadySettled: boolean;
      readonly prizesPaidCents: number;
      readonly heldCents: number;
      readonly rakeCents: number;
    }
  | { readonly ok: false; readonly status: number; readonly reason: string };

export interface SettlementDeps {
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to `crypto.randomUUID` — injected only so tests can make ids deterministic. */
  readonly newId?: () => string;
  /**
   * Defaults to the real `postMoneyTransaction`. Injected ONLY so the escrow-to-zero invariant
   * below can be driven for real — the sabotage idiom: a test that skips or refuses one posting
   * is the only honest way to reach a state the pre-checks otherwise make unreachable, and the
   * invariant's rollback (undoing postings that DID land) is exactly what it must prove.
   */
  readonly postTransaction?: typeof postMoneyTransaction;
}

const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * The one throw that turns a mid-transaction settlement defect into a full rollback plus a
 * product-voiced refusal: returning `{ ok: false }` from inside `db.transaction` would COMMIT
 * whatever postings already landed, and a settlement that half-paid is precisely the state this
 * writer exists to make impossible. The same forced-rollback shape `ContentRemovalRefused` uses
 * in `resolveFlag` (`@/integrity-service/flags`).
 */
class SettlementInvariantError extends Error {}

/**
 * Which of `userIds` an OPEN integrity flag involves — the collusion-hold read, in-transaction,
 * against the flag store `raiseFlag`/`resolveFlag` own (this module READS flags, it never builds
 * a flag system). "Involves" is resolved from each flag's own SUBJECT, never from a caller's
 * claim, the same rule `affectedMemberFor` holds `resolveFlag` to — across all five subject
 * shapes: an `account_pair` names its two users in its own id; a `review` and a `chat_message`
 * name their author through their row; a `trade`/`held_trade` names both teams' managers through
 * `trade_proposals`. Four batched reads however many winners the page holds, `aboutFor`'s own
 * no-N+1 discipline. Plain SELECTs: the `leagues[X] FOR UPDATE` this caller already holds
 * serializes settlement itself, and a flag raised after this read is a flag raised after the
 * money moved — the hold exists for flags that were OPEN when the operator settled.
 */
async function usersWithOpenFlagsAmong(tx: DbTx, userIds: readonly string[]): Promise<ReadonlySet<string>> {
  const flagged = new Set<string>();
  // A rake-only table pays nobody; `inArray` refuses an empty list, and there is nothing to ask.
  if (userIds.length === 0) return flagged;

  const pairFlags = await tx
    .select({ subjectId: integrityFlags.subjectId })
    .from(integrityFlags)
    .where(and(isNull(integrityFlags.resolvedAt), eq(integrityFlags.subjectType, "account_pair")));
  for (const flag of pairFlags) {
    for (const id of flag.subjectId.split(":")) if (userIds.includes(id)) flagged.add(id);
  }

  const reviewAuthors = await tx
    .select({ userId: reviews.userId })
    .from(integrityFlags)
    .innerJoin(reviews, eq(reviews.id, integrityFlags.subjectId))
    .where(and(isNull(integrityFlags.resolvedAt), eq(integrityFlags.subjectType, "review"), inArray(reviews.userId, userIds)));
  for (const row of reviewAuthors) flagged.add(row.userId);

  const chatAuthors = await tx
    .select({ userId: chatMessages.authorUserId })
    .from(integrityFlags)
    .innerJoin(chatMessages, sql`${chatMessages.id}::text = ${integrityFlags.subjectId}`)
    .where(and(isNull(integrityFlags.resolvedAt), eq(integrityFlags.subjectType, "chat_message"), inArray(chatMessages.authorUserId, userIds)));
  for (const row of chatAuthors) flagged.add(row.userId);

  const proposerTeam = alias(teams, "settlement_proposer_team");
  const counterpartyTeam = alias(teams, "settlement_counterparty_team");
  const tradeManagers = await tx
    .select({ proposerUserId: proposerTeam.userId, counterpartyUserId: counterpartyTeam.userId })
    .from(integrityFlags)
    .innerJoin(tradeProposals, eq(tradeProposals.id, integrityFlags.subjectId))
    .innerJoin(proposerTeam, eq(proposerTeam.id, tradeProposals.proposerTeamId))
    .innerJoin(counterpartyTeam, eq(counterpartyTeam.id, tradeProposals.counterpartyTeamId))
    .where(and(isNull(integrityFlags.resolvedAt), inArray(integrityFlags.subjectType, ["trade", "held_trade"])));
  for (const row of tradeManagers) {
    if (userIds.includes(row.proposerUserId)) flagged.add(row.proposerUserId);
    if (userIds.includes(row.counterpartyUserId)) flagged.add(row.counterpartyUserId);
  }

  return flagged;
}

/**
 * "The season's end game: this is where winners get paid" (Phase 4, Task 10). Operator-triggered,
 * NEVER automatic — the two admin routes are its only production callers, held true by the
 * source-walk test in `settlement.test.ts` (`service-map.source.test.ts`'s own pattern). The
 * route carries WHO finished where; every amount comes from the league's own stored
 * `payout_table`, read under lock, never from a request.
 *
 * **THE ESCROW-TO-ZERO LAW, three layers.** (1) `prizeTableInvariant` re-checks the stored table
 * against the pot at settlement, exactly as creation checked it (`schema.ts`'s own docblock).
 * (2) Each seat's net contribution (`entryFeeContributionInTx`) must equal the published fee, and
 * the LOCKED escrow rollup must equal prizes plus rake — refused BEFORE any posting, with zero
 * writes. (3) After every posting lands, the escrow rollup is re-read under the same locks and a
 * non-zero balance throws `SettlementInvariantError`, rolling the WHOLE settlement back — the
 * in-transaction invariant, reachable only through a defect, proven by the sabotage tests.
 *
 * **PER-SEAT, PER-WINNER STATE ATTRIBUTION** (plan ruling 10, and the whole reason
 * `MoneyEntryInput.stateOfEntry` exists per-leg): each prize's pair of legs carries THAT winner's
 * attested state; each seat's rake pair carries THAT seat's state — the only attribution under
 * which "every row carries a true state" survives a multi-state league, and exactly what Phase
 * 5's per-state aggregation reads.
 *
 * **COLLUSION HOLDS.** A winner an OPEN flag involves (`usersWithOpenFlagsAmong`) is credited to
 * `held_for_review:<userId>` instead of their wallet, audited `payout_held` — hidden from member
 * feeds (the T2 pre-ruling: a hold names a suspicion) — with NO notice, and every other winner
 * is paid and told exactly as if no flag existed. `releaseHold`/`confiscateHold` below are the
 * two one-way exits.
 *
 * **IDEMPOTENT, argued.** Settling twice is a clean no-op, not a refusal: the operator's intent
 * ("this season is settled") is a state, and a double-click that surfaces an error for a success
 * would be the webhook-redelivery mistake all over again. Under the held `leagues[X] FOR UPDATE`,
 * one settlement-kind transaction naming this league is proof the whole settlement committed
 * (they commit atomically or not at all), so the second call answers `alreadySettled: true` with
 * zero writes — and every posting additionally carries a deterministic idempotency key
 * (`settlement:<leagueId>:place:<n>`, `settlement:<leagueId>:rake`) as the writer-level backstop
 * the plan names. A guard-style refusal was rejected because it would make the route's retry
 * semantics worse while protecting nothing the lock does not already protect.
 *
 * **FK ACQUISITIONS, ENUMERATED, in statement order** (the lock-order suite's discipline;
 * driven in `src/integrity-service/lock-order.test.ts`, "settleSeasonPayouts' lock order").
 * `leagues[X] FOR UPDATE`, FIRST, as its own statement — the global lock law, and the same first
 * lock `joinLeagueInTx`/`releaseSeat`/`dissolveLeague` take, so any concurrent league writer
 * serializes here before this function reads a single money row. Then plain SELECTs (teams, the
 * flag involvement reads, the per-seat book reads — no locks). Then the escrow rollup
 * `FOR UPDATE` via `ensureAndLockMoneyAccounts`. Then each posting's own statements
 * (`postMoneyTransaction`'s enumerated order: its `leagues` re-lock is a no-op on the row held
 * since statement one; its sorted account locks re-lock the escrow and add each destination; its
 * audit append lands on the league chain). The `member_notices` inserts run after the last
 * posting (implicit `FOR KEY SHARE` on `leagues` — already held — and each winner's `users`
 * row); no further chain append follows them, and any two writers that could contend on this
 * league's chain already serialized on `leagues[X]` at statement one — `dissolveLeague`'s own
 * composed shape. The winners' notices carry `auditEventId: null` deliberately: each corresponds
 * one-to-one to its `prize_paid` event in the SAME committed transaction, and
 * `postMoneyTransaction` does not surface its anchor's event id.
 *
 * **THE FREE-SEASON LAW**: a league whose `entry_fee_cents` is 0 settles as a pure no-op that
 * touches ZERO `money_*` tables — proven by the `recordStatements` spy exactly as join, release
 * and dissolution prove it.
 */
export async function settleSeasonPayouts(db: Db, input: SettleSeasonPayoutsInput, deps: SettlementDeps = {}): Promise<SettleSeasonPayoutsResult> {
  const clock = deps.clock ?? systemClock;
  const audit = deps.audit ?? getAuditLogger();
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const post = deps.postTransaction ?? postMoneyTransaction;
  const nowIso = clock.now();
  const postDeps = { audit, clock: { now: () => nowIso }, newId };

  try {
    return await db.transaction(async (tx): Promise<SettleSeasonPayoutsResult> => {
      // LEAGUES FIRST, AS ITS OWN STATEMENT — see the docblock's lock enumeration.
      const [league] = await tx
        .select({
          id: leagues.id,
          name: leagues.name,
          teamCount: leagues.teamCount,
          entryFeeCents: leagues.entryFeeCents,
          platformFeeCents: leagues.platformFeeCents,
          payoutTable: leagues.payoutTable,
          seasonCompletedAt: leagues.seasonCompletedAt,
        })
        .from(leagues)
        .where(eq(leagues.id, input.leagueId))
        .for("update");
      if (league === undefined) return { ok: false, status: 404, reason: SETTLEMENT_REFUSALS.leagueMissing };

      // The season's mark is `stampSeasonCompleteInTx`'s one-way stamp — the same column every
      // "has this season finished?" read in the product answers from — not the draft's status.
      if (league.seasonCompletedAt === null) return { ok: false, status: 409, reason: SETTLEMENT_REFUSALS.seasonNotComplete };

      // THE FREE-SEASON LAW: return before any money-table statement can run.
      if (league.entryFeeCents === 0) return { ok: true, alreadySettled: false, prizesPaidCents: 0, heldCents: 0, rakeCents: 0 };

      // IDEMPOTENT NO-OP — see the docblock's argument. Read under the held league lock.
      const [settled] = await tx
        .select({ id: moneyTransactions.id })
        .from(moneyTransactions)
        .where(and(eq(moneyTransactions.leagueId, league.id), eq(moneyTransactions.kind, "settlement")))
        .limit(1);
      if (settled !== undefined) return { ok: true, alreadySettled: true, prizesPaidCents: 0, heldCents: 0, rakeCents: 0 };

      // Layer 1: the stored table must still balance against the pot, exactly as creation held it.
      const table = league.payoutTable ?? [];
      const invariant = prizeTableInvariant(league.entryFeeCents, league.platformFeeCents, league.teamCount, table);
      if (!invariant.ok) return { ok: false, status: 409, reason: invariant.reason };

      const seated = await tx.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, league.id));
      const seatedIds = new Set(seated.map((member) => member.userId));

      // WHO finished where — validated against the table and the seats, never trusted whole.
      const winnersByPlace = new Map<number, string>();
      const seenWinners = new Set<string>();
      for (const standing of input.standings) winnersByPlace.set(standing.place, standing.userId);
      for (const entry of table) {
        const winnerId = winnersByPlace.get(entry.place);
        if (winnerId === undefined || !seatedIds.has(winnerId) || seenWinners.has(winnerId)) {
          return { ok: false, status: 400, reason: SETTLEMENT_REFUSALS.standingsIncomplete };
        }
        seenWinners.add(winnerId);
      }

      // Layer 2a: every seat's net contribution IS the published fee — the book's own proof that
      // the escrow holds one whole fee per seat, and the source of each seat's attributed state.
      const seatStates = new Map<string, string>();
      for (const member of seated) {
        const contribution = await entryFeeContributionInTx(tx, { leagueId: league.id, userId: member.userId });
        if (contribution.netCents !== league.entryFeeCents) {
          return { ok: false, status: 409, reason: SETTLEMENT_REFUSALS.escrowMismatch };
        }
        // A member whose net equals a positive fee has at least one fee row, and every entry row
        // carries a NOT NULL state — so `lastFeeState` cannot be null here.
        seatStates.set(member.userId, contribution.lastFeeState!);
      }

      // Layer 2b: the LOCKED escrow rollup equals prizes plus rake, decided while nothing can
      // move it — the authoritative pre-check, `collectEntryFeeInTx`'s locked re-check idiom.
      const escrowId = accountIdFor("league_escrow", league.id);
      const lockedEscrow = await ensureAndLockMoneyAccounts(tx, [escrowId]);
      const totalPrizes = table.reduce((sum, entry) => sum + entry.amountCents, 0);
      const totalRake = league.platformFeeCents * league.teamCount;
      if (lockedEscrow.get(escrowId)!.balanceCents !== totalPrizes + totalRake) {
        return { ok: false, status: 409, reason: SETTLEMENT_REFUSALS.escrowMismatch };
      }

      const flagged = await usersWithOpenFlagsAmong(tx, [...seenWinners]);

      // THE PRIZES, one posting per paid place, each with its own prize_paid/payout_held record.
      let prizesPaidCents = 0;
      let heldCents = 0;
      const paidWinners: { readonly userId: string; readonly place: number; readonly amountCents: number }[] = [];
      for (const entry of [...table].sort((a, b) => a.place - b.place)) {
        const winnerId = winnersByPlace.get(entry.place)!;
        const winnerState = seatStates.get(winnerId)!;
        const held = flagged.has(winnerId);
        const destination = held ? accountIdFor("held_for_review", winnerId) : accountIdFor("user_available", winnerId);
        const payload = { winnerUserId: winnerId, place: entry.place, amountCents: entry.amountCents, operatorUserId: input.operatorUserId };
        const auditEvent = held
          ? ({ eventType: "payout_held", actorId: null, actorType: "system", leagueId: league.id, payload } as const)
          : ({ eventType: "prize_paid", actorId: null, actorType: "system", leagueId: league.id, payload } as const);
        const posted = await post(
          tx,
          {
            kind: "settlement",
            leagueId: league.id,
            idempotencyKey: `settlement:${league.id}:place:${entry.place}`,
            stateOfEntry: winnerState,
            entries: [
              { accountId: escrowId, direction: "debit", amountCents: entry.amountCents },
              { accountId: destination, direction: "credit", amountCents: entry.amountCents },
            ],
            auditEvent,
          },
          postDeps,
        );
        if (!posted.ok) throw new SettlementInvariantError(SETTLEMENT_REFUSALS.escrowMismatch);
        if (held) heldCents += entry.amountCents;
        else {
          prizesPaidCents += entry.amountCents;
          paidWinners.push({ userId: winnerId, place: entry.place, amountCents: entry.amountCents });
        }
      }

      // THE RAKE SWEEP (plan ruling 6: swept HERE, never skimmed at collection): one posting,
      // one debit/credit pair per seat, each pair in that seat's own attested state. Recorded as
      // an `admin_action` on the league's own record — hidden from member feeds
      // (`ACTIVITY_VISIBILITY.admin_action`), named for the operator console's trail.
      if (totalRake > 0) {
        const rakeEntries: MoneyEntryInput[] = [...seated]
          .sort((a, b) => a.userId.localeCompare(b.userId))
          .flatMap((member) => {
            const state = seatStates.get(member.userId)!;
            return [
              { accountId: escrowId, direction: "debit" as const, amountCents: league.platformFeeCents, stateOfEntry: state },
              { accountId: accountIdFor("platform_rake"), direction: "credit" as const, amountCents: league.platformFeeCents, stateOfEntry: state },
            ];
          });
        const swept = await post(
          tx,
          {
            kind: "settlement",
            leagueId: league.id,
            idempotencyKey: `settlement:${league.id}:rake`,
            // Every leg overrides with its own seat's state; this transaction-level default is
            // required by the type and never reaches a row.
            stateOfEntry: rakeEntries[0]!.stateOfEntry!,
            entries: rakeEntries,
            auditEvent: {
              eventType: "admin_action",
              actorId: input.operatorUserId,
              actorType: "user",
              leagueId: league.id,
              payload: { action: "rake_swept", amountCents: totalRake, perSeatCents: league.platformFeeCents, seats: league.teamCount, operatorUserId: input.operatorUserId },
            },
          },
          postDeps,
        );
        if (!swept.ok) throw new SettlementInvariantError(SETTLEMENT_REFUSALS.escrowMismatch);
      }

      // Layer 3, THE IN-TRANSACTION INVARIANT: the escrow rollup — held FOR UPDATE by this
      // transaction since layer 2b, advanced by every posting above — must now read exactly
      // zero, or the whole settlement (postings included) rolls back as a refusal.
      const [escrowAfter] = await tx.select({ balanceCents: moneyAccounts.balanceCents }).from(moneyAccounts).where(eq(moneyAccounts.id, escrowId));
      if (escrowAfter!.balanceCents !== 0) throw new SettlementInvariantError(SETTLEMENT_REFUSALS.escrowMismatch);

      // Winners are told, money-first — held payouts notice NOBODY (the accusatory-surface rule).
      for (const winner of paidWinners) {
        await notifyAffectedMember(
          tx,
          {
            leagueId: league.id,
            userId: winner.userId,
            noticeType: "prize_paid",
            context: { leagueName: league.name, place: winner.place, amountCents: winner.amountCents },
            occurredAt: nowIso,
            auditEventId: null,
          },
          { newId },
        );
      }

      return { ok: true, alreadySettled: false, prizesPaidCents, heldCents, rakeCents: totalRake };
    });
  } catch (error: unknown) {
    if (error instanceof SettlementInvariantError) return { ok: false, status: 409, reason: error.message };
    throw error;
  }
}

export interface HoldOutcomeInput {
  readonly userId: string;
  /** From `withAdmin`'s verified session, never a request body. */
  readonly operatorUserId: string;
}

export type HoldOutcomeResult =
  | { readonly ok: true; readonly amountCents: number }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/** The held account's positive net per `state_of_entry` — read back from the BOOK so the outcome
 *  posting can mirror each held dollar in the state it arrived under (ruling 10's attribution,
 *  carried through the hold rather than flattened by it). */
async function heldBalanceByState(tx: DbTx, heldAccountId: MoneyAccountId): Promise<ReadonlyMap<string, number>> {
  const rows = await tx
    .select({
      stateOfEntry: moneyEntries.stateOfEntry,
      direction: moneyEntries.direction,
      totalCents: sql<number>`sum(${moneyEntries.amountCents})::float8`,
    })
    .from(moneyEntries)
    .where(eq(moneyEntries.accountId, heldAccountId))
    .groupBy(moneyEntries.stateOfEntry, moneyEntries.direction);
  const byState = new Map<string, number>();
  for (const row of rows) {
    const delta = row.direction === "credit" ? row.totalCents : -row.totalCents;
    byState.set(row.stateOfEntry, (byState.get(row.stateOfEntry) ?? 0) + delta);
  }
  return new Map([...byState].filter(([, cents]) => cents > 0));
}

/** What tells `releaseHold` and `confiscateHold` apart — everything else is `resolveHeldPayout`. */
interface HoldOutcomeShape {
  readonly kind: "hold_release" | "hold_confiscation";
  readonly destinationFor: (userId: string) => MoneyAccountId;
  readonly auditEvent: (input: HoldOutcomeInput, amountCents: number) => {
    readonly eventType: "payout_released" | "admin_action";
    readonly payload: Record<string, string | number>;
  };
  /** Only the release notices — a confiscation tells the member nothing here; the flag
   *  resolution that justified it is the surface that speaks (`resolveFlag`'s own vocabulary). */
  readonly noticeMember: boolean;
}

/**
 * The shared spine of the two one-way hold outcomes, shaped like `resolveFlag`: judged by the
 * LOCKED balance (two operators racing serialize on the held account's row lock; the loser finds
 * zero and refuses), refusal before any write, audit in the same transaction. League-less on
 * purpose — the held account pools every held prize a member has, so the outcome names the
 * PERSON, not a league, and its audit event rides the platform chain exactly as `flag_resolved`
 * does (a record about a person under review is not any league's business).
 *
 * DELIBERATELY NO "flags resolved?" CHECK (Task 10 review, MEDIUM): neither outcome verifies the
 * member's integrity flags before acting. The brief shapes both as one-way operator actions the
 * operator reaches FROM the flag decision that justified them — the pairing is the console's
 * workflow, not a database constraint. A wired "no open flags remain on this member" guard would
 * wrongly BLOCK a legitimate release whenever an UNRELATED open flag exists on the same member
 * (a chat report has no claim on a prize a trade-fairness flag held), and settlement would
 * simply re-hold any future prize while anything stays open — so the guard protects nothing the
 * hold mechanism does not already protect, while taking a member's cleared money hostage.
 *
 * FK ACQUISITIONS, in statement order: `money_accounts FOR UPDATE` for the held account and the
 * destination, in sorted order (`ensureAndLockMoneyAccounts` — no `leagues` lock: the posting
 * names no league). Then the book read (plain SELECT), the posting's own statements, the
 * platform-chain anchor, and — on the release only — the member's notice (`users FOR KEY SHARE`).
 */
async function resolveHeldPayout(db: Db, input: HoldOutcomeInput, deps: SettlementDeps, shape: HoldOutcomeShape): Promise<HoldOutcomeResult> {
  const clock = deps.clock ?? systemClock;
  const audit = deps.audit ?? getAuditLogger();
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const post = deps.postTransaction ?? postMoneyTransaction;
  const nowIso = clock.now();

  return db.transaction(async (tx): Promise<HoldOutcomeResult> => {
    const heldId = accountIdFor("held_for_review", input.userId);
    const destinationId = shape.destinationFor(input.userId);
    const locked = await ensureAndLockMoneyAccounts(tx, [heldId, destinationId]);
    const heldCents = locked.get(heldId)!.balanceCents;
    // ONE WAY: the first outcome drains the account to zero, so the second — release after
    // confiscation, a double-click, either order — reads zero under the lock and refuses.
    if (heldCents <= 0) return { ok: false, status: 409, reason: SETTLEMENT_REFUSALS.nothingHeld };

    const byState = await heldBalanceByState(tx, heldId);
    const entries: MoneyEntryInput[] = [...byState]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([state, cents]) => [
        { accountId: heldId, direction: "debit" as const, amountCents: cents, stateOfEntry: state },
        { accountId: destinationId, direction: "credit" as const, amountCents: cents, stateOfEntry: state },
      ]);
    const event = shape.auditEvent(input, heldCents);
    const posted = await post(
      tx,
      {
        kind: shape.kind,
        stateOfEntry: entries[0]!.stateOfEntry!,
        entries,
        auditEvent: {
          eventType: event.eventType,
          actorId: input.operatorUserId,
          actorType: "user",
          leagueId: null, // platform chain — a record about a person, not a league
          payload: event.payload,
        },
      },
      { audit, clock: { now: () => nowIso }, newId },
    );
    // A refusal here has no honest ordinary meaning — the debits equal the account's own locked
    // balance, so the floor cannot trip — and committing a stamped outcome without its money
    // motion would be the half-written record this module exists to prevent. Throw, roll back.
    if (!posted.ok) throw new Error(`resolveHeldPayout: the ${shape.kind} posting refused: ${posted.reason}`);

    if (shape.noticeMember) {
      await notifyAffectedMember(
        tx,
        {
          leagueId: null,
          userId: input.userId,
          noticeType: "payout_released",
          context: { amountCents: heldCents },
          occurredAt: nowIso,
          auditEventId: null,
        },
        { newId },
      );
    }
    return { ok: true, amountCents: heldCents };
  });
}

/**
 * The flag resolved in the member's favor: the whole held balance goes back to the member's own
 * wallet, state by state, audited `payout_released` (hidden from member feeds — the T2
 * pre-ruling), and the member is told money-first with no mention of the hold.
 */
export async function releaseHold(db: Db, input: HoldOutcomeInput, deps: SettlementDeps = {}): Promise<HoldOutcomeResult> {
  return resolveHeldPayout(db, input, deps, {
    kind: "hold_release",
    destinationFor: (userId) => accountIdFor("user_available", userId),
    auditEvent: (holdInput, amountCents) => ({
      eventType: "payout_released",
      payload: { subjectUserId: holdInput.userId, amountCents },
    }),
    noticeMember: true,
  });
}

/**
 * The flag resolved against the member: the whole held balance forfeits to the platform
 * (`platform_forfeiture`, the brief's named destination), audited `admin_action` with the full
 * payload — and NO notice from here: the flag resolution that justified this is the surface that
 * speaks to the member, in `resolveFlag`'s own vocabulary, never a second sentence from the book.
 */
export async function confiscateHold(db: Db, input: HoldOutcomeInput, deps: SettlementDeps = {}): Promise<HoldOutcomeResult> {
  return resolveHeldPayout(db, input, deps, {
    kind: "hold_confiscation",
    destinationFor: () => accountIdFor("platform_forfeiture"),
    auditEvent: (holdInput, amountCents) => ({
      eventType: "admin_action",
      payload: { action: "payout_confiscated", subjectUserId: holdInput.userId, amountCents },
    }),
    noticeMember: false,
  });
}
