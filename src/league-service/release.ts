import { and, eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { refundEntryFeeInTx } from "@/money-service/entry-fee";
import { isCommissionerOf, type LeagueAuthorityRow } from "./authority";

/**
 * Every reason `releaseSeat` declines to act, named once so the function and its tests never
 * hand-type a second copy of the same sentence — the same discipline `FILL_TRIGGER_REFUSALS`,
 * `KICKOFF_REFUSALS` and `ROLL_REFUSALS` already hold this branch to.
 */
export const RELEASE_REFUSALS = {
  leagueMissing: "That league does not exist.",
  /** A caller with no team in this league — nothing to release. Structurally reachable only for
   *  a member who already left, or one who never joined at all. */
  notMember: "You do not have a seat in this league to release.",
  /** Folds "no draft row at all" (structurally unreachable — `drafts_league_id_idx` is UNIQUE
   *  and every league gets one at creation) into the same sentence a genuinely started draft
   *  gets: either way, there is no seat left this call can free. */
  draftStarted: "This league's draft has already started, so there is no seat left to release.",
  /**
   * A member league whose commissioner walks away is a league with nobody to run it, and this
   * product has no transfer-of-commissioner path — the same dead end `HOUSE_AUTHORITY_REFUSALS`
   * names for the two doors a house league closes. A HOUSE league never reaches this: nobody is
   * ever `isCommissionerOf` one (`leagueAuthority`'s own `house` branch), so the same member
   * leaves through the ordinary path, no special case required.
   */
  commissioner: "You are this league's commissioner, and there is no way to hand that role to someone else yet, so you cannot leave until the league does.",
} as const;

export interface ReleaseSeatInput {
  readonly leagueId: string;
  readonly userId: string;
}

export type ReleaseSeatResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface ReleaseSeatDeps {
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Phase 4, Task 8: mints the refund posting's row ids. Defaults to `crypto.randomUUID` —
   *  injected only so tests can make money ids deterministic, the same reason `createLeague`
   *  takes one. A free league's release never calls it. */
  readonly newId?: () => string;
}

const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * `draft_fill_reversed`'s league-wide sentence — the other half of `DRAFT_FILL_TRIGGERED_SUMMARY`
 * (`./fill-trigger`). `SYSTEM_ACTION_VISIBILITY.draft_fill_reversed` (`@/integrity/system-actions`)
 * is `"everyone"`, on that constant's own reasoning: a fact about the league's shared calendar,
 * true for everyone still in it, about nobody's conduct.
 */
export const DRAFT_FILL_REVERSED_SUMMARY = "A seat opened up, so we put this league's draft back to waiting for a full room.";

/**
 * The escape hatch the roll requires (Phase 3.6, Task 8): a member leaves a league whose draft
 * has not started, freeing their seat immediately for someone else to take.
 *
 * **BINDING PRECONDITION, satisfied in this same commit.** This function may not land before
 * `startDraft`'s `teamRows` and `pool` reads move INSIDE the `DraftActionSource` thunk
 * (`@/draft-service/store`) — done above, in this commit. Before that move, a seat released
 * between `startDraft`'s out-of-transaction read and its `drafts FOR UPDATE` lock could persist a
 * departed team's id into `draftOrder`, which the reducer's replay rule then makes PERMANENT. See
 * `DraftActionSource`'s own docblock for the full proof.
 *
 * **WHAT A RELEASE DELETES, ENUMERATED (Step 2).** Deleting a `teams` row is only safe because of
 * what a pre-draft league does not have yet: `draft_picks` and `matchups` reference `teams`
 * WITHOUT `ON DELETE CASCADE` (`@research-ts/db/schema`), and both are structurally empty before a draft
 * runs — `matchups` is generated at `commitDraftResults`, and `draft_picks` only grows once a
 * draft has started. The refusal on `status !== 'scheduled'` below is therefore not politeness,
 * it is the precondition that makes the delete legal, and Postgres itself is the backstop: a row
 * in either non-cascading table would abort this transaction with a foreign key violation rather
 * than silently orphan anything. `rosterSlots`, `draftSlotPreferences`, `lineupSlots` and
 * `tradeProposals` all cascade — the first three are empty pre-draft for the identical reason,
 * and `tradeProposals` needs rosters that do not exist yet either.
 *
 * **FK ACQUISITIONS, ENUMERATED, and measured against a real Postgres rather than argued (final
 * whole-branch review's own "verify, don't assume" discipline).** `releaseSeat` takes
 * `leagues[X] FOR UPDATE` as its own FIRST statement — the identical first lock `joinLeagueInTx`
 * (`./join`) takes, so the seat count either one reads can never race the other on the same row.
 * Every other writer that touches both `leagues` and `drafts` in this branch (`joinLeagueInTx`,
 * `setDraftKickoff`, `rollUnfilledDraftInTx`, `applyAction`/`startDraft`) ALSO takes a `leagues`
 * row lock as its own first statement, so this one lock alone serializes `releaseSeat` against
 * every one of them for the duration of its own transaction — no second lock is needed to close
 * any cycle. The `DELETE FROM teams` that follows takes a row-exclusive lock on `teams` itself
 * plus cascading row-exclusive locks on its (empty, pre-draft) children — measured directly
 * against a real Postgres 17 instance, it takes NO lock on `leagues` or `users` at all: deleting a
 * row never needs to lock the rows it points to, only inserting or updating a foreign key column
 * does (`joinLeagueInTx`'s own `teams` INSERT is the case that does). The `fill_fired_at` clear
 * that follows (`UPDATE drafts SET fill_fired_at = null WHERE id = ...`) does not touch
 * `league_id`, so Postgres's own trigger-skip optimization for an UPDATE that leaves its foreign
 * key column untouched means it takes no new lock on `leagues` either — moot regardless, since
 * `leagues` is already held `FOR UPDATE` for this transaction's whole lifetime. The notice
 * inserts that follow take the ordinary `FOR KEY SHARE` on `leagues` (already held) and `users`
 * (a real, new lock, the same one `notifyAffectedMember`'s own docblock states for every notice
 * writer in this codebase) — BEFORE the anchor, per ruling 3. The audit anchor is written LAST.
 * `src/integrity-service/lock-order.test.ts`'s "release vs join" block drives the release-vs-join
 * race on the same seat on two real connections and proves exactly one winner.
 *
 * **THE AUDIT COMPROMISE (Step 3), stated rather than smuggled.** `AUDIT_EVENT_TYPES` is a frozen
 * pg enum with no `member_left`. A seat release has a real human actor, so it cannot ride
 * `system_action` (`actorId: null` by construction) — it rides `member_joined` instead, with
 * `payload.outcome: "seat_released"` telling the two apart, the in-code precedent
 * `trade_rejected`'s own `payload.outcome` already set for a withdrawal. `renderMemberJoined`
 * (`@/integrity/activity-view`) reads the outcome and says "left the league before the draft."
 *
 * **THE SIT-AND-GO BACK-TO-FILLING CASE.** Clears `drafts.fill_fired_at` back to `null` whenever
 * it was stamped (`fireWhenFullInTx`'s own docblock, `./fill-trigger`) — the exact write that
 * function's repeat-fire guard was always missing a clearer for. When that clear actually changes
 * something (the league had genuinely fired), every REMAINING seated team gets a
 * `draft_fill_reversed` notice: the room they were told was about to draft is no longer full, and
 * this is the sentence that says so. The member who just left never gets one — they already have
 * the Modal's own confirmation, in the same breath they chose it. A scheduled-trigger league (or
 * an unfired `when_full` one) never had `fill_fired_at` stamped, so this is a true no-op for it.
 *
 * NO-WRITE-BEFORE-REFUSAL holds throughout: every refusal branch below returns before the
 * `DELETE` is ever reached.
 */
export async function releaseSeat(db: Db, input: ReleaseSeatInput, deps: ReleaseSeatDeps = {}): Promise<ReleaseSeatResult> {
  const clock = deps.clock ?? systemClock;
  const audit = deps.audit ?? getAuditLogger();
  const nowIso = clock.now();

  return db.transaction(async (tx): Promise<ReleaseSeatResult> => {
    // LEAGUES FIRST, AS ITS OWN STATEMENT — see this function's own docblock. `FOR UPDATE`, the
    // same strength `joinLeagueInTx` takes: this function frees a seat the same way that one
    // claims one, and the two must serialize on the same row.
    const [league] = await tx
      .select({
        id: leagues.id,
        name: leagues.name,
        commissionerUserId: leagues.commissionerUserId,
        houseRung: leagues.houseRung,
        entryFeeCents: leagues.entryFeeCents,
      })
      .from(leagues)
      .where(eq(leagues.id, input.leagueId))
      .for("update");
    if (league === undefined) return { ok: false, reason: RELEASE_REFUSALS.leagueMissing };

    const [draft] = await tx
      .select({ id: drafts.id, status: drafts.status, fillFiredAt: drafts.fillFiredAt })
      .from(drafts)
      .where(eq(drafts.leagueId, league.id));
    if (draft === undefined || draft.status !== "scheduled") {
      return { ok: false, reason: RELEASE_REFUSALS.draftStarted };
    }

    const authorityRow: LeagueAuthorityRow = { commissionerUserId: league.commissionerUserId, houseRung: league.houseRung };
    if (isCommissionerOf(authorityRow, input.userId)) {
      return { ok: false, reason: RELEASE_REFUSALS.commissioner };
    }

    const [team] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, league.id), eq(teams.userId, input.userId)));
    if (team === undefined) return { ok: false, reason: RELEASE_REFUSALS.notMember };

    // BUSINESS WRITES FIRST. The delete is legal only because `draft_picks`/`matchups` are empty
    // pre-draft — see this function's own docblock — and Postgres enforces that rather than this
    // function assuming it.
    await tx.delete(teams).where(eq(teams.id, team.id));

    // THE SIT-AND-GO CLEARER. Only a genuine change writes anything or sends anything below.
    const wasFired = draft.fillFiredAt !== null;
    if (wasFired) {
      await tx.update(drafts).set({ fillFiredAt: null }).where(eq(drafts.id, draft.id));
    }

    // NOTICES BEFORE THE ANCHOR (ruling 3). Every remaining seated team, never the member who
    // just left.
    const reversedNotices: MemberNotice[] = [];
    if (wasFired) {
      const remaining = await tx.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, league.id));
      for (const member of remaining) {
        reversedNotices.push(
          await notifyAffectedMember(tx, {
            leagueId: league.id,
            userId: member.userId,
            noticeType: "draft_fill_reversed",
            context: { leagueName: league.name },
            occurredAt: nowIso,
            auditEventId: null,
          }),
        );
      }
    }

    // PHASE 4, TASK 8 — THE FEE COMES BACK WITH THE SEAT, in this same transaction (the whole
    // fee: pre-draft escrow was never anyone else's to keep, and the roll's humanity argument
    // rides on this door working for paid seats too). `refundEntryFeeInTx` reads the amount off
    // the book (a comped or seeded seat refunds nothing) and posts the mirror `entry_fee_refund`
    // with its own `entry_fee_refunded` append — which takes this league's chain anchor a step
    // before the `member_joined` append below, safe for exactly the reason the paid join's
    // docblock argues: this transaction has held `leagues[X] FOR UPDATE` since statement one,
    // and so must anything that could otherwise be holding the anchor or a money rollup row
    // while waiting on us. Its `money_accounts` locks are taken in the every-money-writer sorted
    // order, AFTER the notice inserts above took their `users FOR KEY SHARE` — a share-mode lock
    // no money writer conflicts with. A FREE league (`entry_fee_cents = 0`) never enters this
    // branch: zero money statements, the same spy-proven law as the free join.
    if (league.entryFeeCents > 0) {
      await refundEntryFeeInTx(
        tx,
        { leagueId: league.id, userId: input.userId },
        { audit, clock: { now: () => nowIso }, newId: deps.newId ?? (() => crypto.randomUUID()) },
      );
    }

    // THE ANCHOR, LAST. The departing member's own event first (the audit compromise, Step 3),
    // then the league-wide "back to filling" fact, when there is one — both on the SAME chain,
    // so the second write takes no NEW lock beyond the anchor the first already holds.
    await audit.record(tx, {
      eventType: "member_joined",
      actorId: input.userId,
      actorType: "user",
      leagueId: league.id,
      payload: { teamId: team.id, outcome: "seat_released" },
      occurredAt: nowIso,
    });

    if (wasFired) {
      const event = await audit.record(tx, {
        eventType: "system_action",
        actorId: null,
        actorType: "system",
        leagueId: league.id,
        payload: { action: "draft_fill_reversed", summary: DRAFT_FILL_REVERSED_SUMMARY },
        occurredAt: nowIso,
      });
      for (const notice of reversedNotices) await attachAuditEvent(tx, notice, event.eventId);
    }

    return { ok: true };
  });
}
