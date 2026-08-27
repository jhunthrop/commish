import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { refundEntryFeeInTx } from "./entry-fee";

/**
 * Every reason `dissolveLeague` declines to act, named once so the writer and its tests never
 * hand-type a second copy of the same sentence — `RELEASE_REFUSALS`' own discipline
 * (`@/league-service/release`), which this door's refusal shape mirrors closely on purpose: both
 * are "free a pre-draft seat" doors, one at a member's own request, one at an operator's.
 */
export const DISSOLUTION_REFUSALS = {
  leagueMissing: "That league does not exist.",
  /** PRE-DRAFT ONLY. A league whose draft has started is a season in motion — refunding out from
   *  under live rosters and a live schedule is a different, harder operation this task does not
   *  build. Folds "no draft row at all" (structurally unreachable, `drafts_league_id_idx` is
   *  UNIQUE and every league gets one at creation) into the same sentence a genuinely started
   *  draft gets, the identical collapse `RELEASE_REFUSALS.draftStarted` already makes. */
  draftStarted: "This league's draft has already started, so it cannot be dissolved.",
} as const;

export type DissolutionPreviewResult =
  | { readonly ok: true; readonly leagueName: string; readonly seatedCount: number }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * The read-then-confirm half of this door (operator review, 2026-08-27, findings D1/D3): what
 * `dissolveLeague` is ABOUT to do, named, before an operator presses the one-way button — the
 * league's own name and how many seats it would refund, neither of which `dissolveLeague` itself
 * needed to compute for a caller until now. Plain reads, no lock, no transaction: two operators
 * previewing the same league at once can never interfere with each other, and `dissolveLeague`'s
 * own `leagues[X] FOR UPDATE` is what makes the ACT safe, not this read — a preview that raced a
 * real dissolution would simply read whichever side of that transaction had or had not committed
 * yet, the same "a preview is a snapshot, not a lock" contract every read-only door in this
 * codebase already holds to.
 */
export async function dissolutionPreview(db: Db, leagueId: string): Promise<DissolutionPreviewResult> {
  const [league] = await db.select({ id: leagues.id, name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) return { ok: false, status: 404, reason: DISSOLUTION_REFUSALS.leagueMissing };

  const seated = await db.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, league.id));
  return { ok: true, leagueName: league.name, seatedCount: seated.length };
}

export interface DissolveLeagueInput {
  readonly leagueId: string;
  /** The operator's own verified id, from `withAdmin`'s session — never from a request body.
   *  Carried on the platform-visible audit payload for the operator console's own trail; the
   *  league-wide `system_action` this writer appends stays `actorType: "system"` regardless,
   *  `SYSTEM_ACTION_CODES`' own construction for every code in that vocabulary. */
  readonly operatorUserId: string;
}

export type DissolveLeagueResult =
  | { readonly ok: true; readonly refundedMembers: number; readonly totalRefundedCents: number }
  | { readonly ok: false; readonly status: number; readonly reason: string };

export interface DissolveLeagueDeps {
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Mints the refund postings' and notices' row ids. Defaults to `crypto.randomUUID` —
   *  injected only so tests can make ids deterministic, the same reason `releaseSeat` takes
   *  one for its own refund calls. */
  readonly newId?: () => string;
}

const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * The league-wide half of this action (`SYSTEM_ACTION_VISIBILITY.league_dissolved` is
 * `"everyone"`, `@/integrity/system-actions`): a fact about the room closing, true for every
 * seated member, about nobody's conduct. `NoticeContexts.league_dissolved`
 * (`@/integrity/notices`) is the personal half beside it, which is where the dollar figure that
 * came back to any ONE member actually lives — this sentence never states an amount, because it
 * is the same words whether the league that closed was free or paid.
 */
export const LEAGUE_DISSOLVED_SUMMARY = "An operator closed this league because it did not fill before its draft.";

/**
 * "Give this operator a door to close a room nobody is coming back to fill" (Phase 4, Task 9):
 * the refund path Phase 3.6 never built, because Phase 3.6 had no money to refund. A paid league
 * that can wait forever holding twelve entry fees with no way out is not shippable — this is the
 * smallest honest version of the door: operator-only (the caller's own `withAdmin` gate, never
 * re-checked here — see `operatorUserId`'s own docblock), PRE-DRAFT ONLY, every seated member's
 * fee refunded in the SAME transaction, every seated member told.
 *
 * **THE MARK.** The league's own season state is `drafts.status` — the identical column
 * `@/league-service/read.ts` reads for every "what state is this league's season in" question
 * this codebase already asks, and the one `@/league-service/browse.ts`'s `browseQuery` already
 * filters `WHERE ... AND drafts.status = 'scheduled'` alongside `ENFORCED_LEAGUE_SQL`. Stamping
 * it `'dissolved'` is therefore the WHOLE mechanism a dissolved league needs to leave the public
 * browse shelf — no new predicate, no second flag: a league that no longer matches `'scheduled'`
 * simply stops matching a filter that was already there. The guarded `UPDATE ... WHERE status =
 * 'scheduled'` is `autoStartDueDrafts`'s own mechanism (`@/draft-service/auto-start`), copied
 * deliberately — the same "the guard lives in the UPDATE's own WHERE" discipline every one-way
 * state stamp in this codebase holds to (`setSelfExclusion`, `clearSelfExclusion`, `grantAdmin`).
 * Nothing in the live draft engine (`@/draft-engine`, `@/draft-room`) ever reads or assigns this
 * value — see `DraftStatus`'s own docblock (`@/domain/draft`) for why that is safe by
 * construction rather than by omission.
 *
 * **THE REFUND, COMPOSED PER SEAT.** `refundEntryFeeInTx` (`./entry-fee`, Task 8's own mirror
 * writer) runs once per currently-seated member, inside THIS transaction — never a second,
 * dissolution-specific posting shape. Each call reads that member's own net entry-fee
 * contribution off the book and posts the identical `entry_fee_refund` a voluntary release
 * posts, so "the escrow closes at exactly zero" is the SAME arithmetic guarantee
 * `refundEntryFeeInTx`'s own docblock already proves for one seat, applied once per row here. A
 * FREE league (`entryFeeCents === 0`) never reaches this loop at all — the free-season law,
 * `releaseSeat`'s own gate copied verbatim, held by the statement-log spy in
 * `dissolution.test.ts` exactly as Task 8 proves it for join and release.
 *
 * **FK ACQUISITIONS, ENUMERATED, in statement order.** `leagues[X] FOR UPDATE`, FIRST — the
 * global lock law, and the identical first lock `joinLeagueInTx`/`releaseSeat` both take, so a
 * concurrent join or release on this league serializes against this dissolution on the same row.
 * The `drafts` read is a plain `SELECT`, no lock beyond what `leagues[X]` already implies for
 * every writer that touches both rows (the branch-wide leagues-before-drafts rule). The guarded
 * `drafts` `UPDATE` locks only the row it writes. Each `refundEntryFeeInTx` call takes its OWN
 * `leagues[X] FOR UPDATE` re-lock (no new edge — this transaction has held it since statement
 * one) and its own sorted `money_accounts FOR UPDATE` pair, then its `entry_fee_refunded` append
 * on this league's chain. The `member_notices` inserts that follow take the ordinary `FOR KEY
 * SHARE` on `leagues` (already held) and each member's `users` row — BEFORE the anchor, per
 * ruling 3. The `league_dissolved` anchor is written LAST, after every FK-carrying write above,
 * and every notice is stamped with its event id once it exists.
 * `src/integrity-service/lock-order.test.ts`'s "dissolveLeague vs. joinLeagueInTx" block drives
 * this against a concurrent join on two real connections.
 *
 * NO-WRITE-BEFORE-REFUSAL holds throughout: both refusal branches return before the `drafts`
 * `UPDATE` is ever reached, proven over the whole book AND the whole league surface by
 * `expectNoDissolutionTookPlace` in `dissolution.test.ts`.
 */
export async function dissolveLeague(db: Db, input: DissolveLeagueInput, deps: DissolveLeagueDeps = {}): Promise<DissolveLeagueResult> {
  const clock = deps.clock ?? systemClock;
  const audit = deps.audit ?? getAuditLogger();
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const nowIso = clock.now();

  return db.transaction(async (tx): Promise<DissolveLeagueResult> => {
    // LEAGUES FIRST, AS ITS OWN STATEMENT — see this function's own docblock.
    const [league] = await tx
      .select({ id: leagues.id, name: leagues.name, entryFeeCents: leagues.entryFeeCents })
      .from(leagues)
      .where(eq(leagues.id, input.leagueId))
      .for("update");
    if (league === undefined) return { ok: false, status: 404, reason: DISSOLUTION_REFUSALS.leagueMissing };

    const [draft] = await tx.select({ id: drafts.id, status: drafts.status }).from(drafts).where(eq(drafts.leagueId, league.id));
    if (draft === undefined || draft.status !== "scheduled") {
      return { ok: false, status: 409, reason: DISSOLUTION_REFUSALS.draftStarted };
    }

    // THE MARK — see "THE MARK" above. `leagues[X] FOR UPDATE` has been held since statement
    // one, so nothing could have raced this guard between the read above and here; it stays
    // anyway, the same belt-and-suspenders discipline every guarded state stamp in this
    // codebase holds to.
    await tx.update(drafts).set({ status: "dissolved" }).where(and(eq(drafts.id, draft.id), eq(drafts.status, "scheduled")));

    const seated = await tx.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, league.id));

    // THE REFUND, PER SEAT — see "THE REFUND, COMPOSED PER SEAT" above. A free league's loop body
    // never runs, so it posts not one money statement (the free-season law).
    const refundedByUser = new Map<string, number>();
    if (league.entryFeeCents > 0) {
      for (const member of seated) {
        const refund = await refundEntryFeeInTx(tx, { leagueId: league.id, userId: member.userId }, { audit, clock: { now: () => nowIso }, newId });
        refundedByUser.set(member.userId, refund.refundedCents);
      }
    }
    let totalRefundedCents = 0;
    for (const cents of refundedByUser.values()) totalRefundedCents += cents;

    // NOTICES BEFORE THE ANCHOR (ruling 3). Every seated member, paid or free — a member whose
    // league just closed is owed the sentence that says so whether or not any money moved.
    const notices: MemberNotice[] = [];
    for (const member of seated) {
      notices.push(
        await notifyAffectedMember(
          tx,
          {
            leagueId: league.id,
            userId: member.userId,
            noticeType: "league_dissolved",
            context: { leagueName: league.name, refundedCents: refundedByUser.get(member.userId) ?? 0 },
            occurredAt: nowIso,
            auditEventId: null,
          },
          { newId },
        ),
      );
    }

    // THE ANCHOR, LAST. `actorType: "system"` and `actorId: null` by `SYSTEM_ACTION_CODES`' own
    // construction (`@/integrity/system-actions`) — a `system_action` event has no actor; the
    // operator who pressed the button is carried on the payload instead, for the operator
    // console's own trail, never rendered to a member (`renderSystemAction`,
    // `@/integrity/activity-view`, reads only `action`, `summary` and `subjectUserId`).
    const event = await audit.record(tx, {
      eventType: "system_action",
      actorId: null,
      actorType: "system",
      leagueId: league.id,
      payload: {
        action: "league_dissolved",
        summary: LEAGUE_DISSOLVED_SUMMARY,
        operatorUserId: input.operatorUserId,
        refundedCents: totalRefundedCents,
      },
      occurredAt: nowIso,
    });
    for (const notice of notices) await attachAuditEvent(tx, notice, event.eventId);

    return { ok: true, refundedMembers: seated.length, totalRefundedCents };
  });
}
