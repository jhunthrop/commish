import { and, asc, eq, lte } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, deliverNotice, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { enforcementAppliesTo } from "@/league-service/enforcement";
import { DRAFT_SERVICE_CONFIG } from "./config";
import type { DraftStore } from "./store";

/**
 * WHY THERE IS NO LOCK. `docs/decisions/data-layer-hardening.md` forbids `pg_advisory_lock` under
 * PgBouncer transaction pooling, so leader election among app instances is unavailable by
 * construction, and the ticker (`./ticker`) is a per-process `setInterval` with no coordination
 * beyond a non-overlap guard inside one process. Exclusion therefore comes from the WRITE, on the
 * precedent this codebase already has: the nudger claims a nudge with a `draft_nudges` row on
 * `(draftId, pickNumber)` and `onConflictDoNothing().returning()`, and an empty return means
 * somebody else got there first (`./nudge.ts`).
 *
 * The claim here is the guarded status transition itself:
 *
 *     UPDATE drafts SET status = 'in_progress'
 *      WHERE id = $1 AND status = 'scheduled'
 *      RETURNING id
 *
 * Zero rows means another instance already started it (or it was never scheduled in the first
 * place). One row means THIS caller owns the start. `store.startDraft` calls this from INSIDE
 * `applyAction`'s own transaction (its `alsoInTransaction` hook, `./store.ts`) — never as a
 * separate round trip first. That placement is not a style preference: a claim committed on its
 * own, followed later by a separate call that appends `START_DRAFT`, has a real crash window
 * between the two — a process that dies in that gap leaves `drafts.status = 'in_progress'` with an
 * EMPTY action log, a draft no scan will ever find again (`autoStartDueDrafts` only selects
 * `status = 'scheduled'`) and no `applyAction` retry ever reaches. Fused into one transaction, the
 * claim and the append commit together or neither does, so that state is unreachable — there is no
 * half-started draft to heal because there is no gap for a crash to land in.
 *
 * This is also why the manual "commissioner presses start" path (`POST
 * /api/drafts/[draftId]/start`) goes through the identical guarded UPDATE rather than the plain one
 * it used to run: one start implementation, used by both a human and the platform, is what makes
 * "no second start implementation" true in fact and not just in the two callers' intentions. Under
 * today's invariants the guard can never actually lose there — `applyAction` already holds
 * `drafts FOR UPDATE` for the whole transaction, and `admitCommand`/`reduceStart` (`@/draft-engine`)
 * already refuse a second `START_DRAFT` once the first one's row exists — so this is defense in
 * depth for a status column that must never say something the action log disagrees with, not a
 * new rejection path either caller needs to plan for.
 *
 * FK LOCK ENUMERATION: this `UPDATE` takes a row-exclusive lock on one `drafts` row (already held
 * `FOR UPDATE` by the caller's transaction) and an implicit `FOR KEY SHARE` on its `leagues`
 * parent. `joinLeagueInTx` takes `leagues FOR UPDATE` first and never touches `drafts`, so the two
 * are ordered leagues-then-drafts in both directions and cannot cycle — see
 * `src/integrity-service/lock-order.test.ts`.
 */
export async function claimAutoStart(tx: DbTx, draftId: string): Promise<boolean> {
  const claimed = await tx
    .update(drafts)
    .set({ status: "in_progress" })
    .where(and(eq(drafts.id, draftId), eq(drafts.status, "scheduled")))
    .returning({ id: drafts.id });
  return claimed.length > 0;
}

export interface AutoStartOutcome {
  readonly draftId: string;
  readonly started: boolean;
  /** Present only when `started` is `false` — a plain-language reason, never a driver message. */
  readonly reason?: string;
}

export interface AutoStartDeps {
  readonly store: DraftStore;
  readonly clock: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `deliverNotice`. Injectable so a test never needs a live Redis
   *  connection. */
  readonly deliver?: typeof deliverNotice;
}

interface DueDraftRow {
  readonly draftId: string;
  readonly leagueId: string;
  readonly leagueName: string;
}

/**
 * `drafts` where `status = 'scheduled' AND kickoff_at <= now`, joined to `leagues` on
 * `is_public_matchmade` — served by `drafts_status_idx` (`@/db/schema`), the expiry scan's own
 * index and this scan's second reader. Ordered by `id` for the same determinism reason the expiry
 * scan is, and bounded by `DRAFT_SERVICE_CONFIG.maxDraftsPerTick` so one tick can't starve the
 * event loop scanning a backlog.
 */
async function dueDraftRows(db: Db, nowIso: string): Promise<readonly DueDraftRow[]> {
  return db
    .select({ draftId: drafts.id, leagueId: leagues.id, leagueName: leagues.name })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(and(eq(drafts.status, "scheduled"), lte(drafts.kickoffAt, new Date(nowIso)), eq(leagues.isPublicMatchmade, true)))
    .orderBy(asc(drafts.id))
    .limit(DRAFT_SERVICE_CONFIG.maxDraftsPerTick);
}

/**
 * The notice half of an auto-start, run in its OWN transaction immediately after
 * `store.startDraft` has already committed the business fact — never inside `applyAction`'s own
 * transaction, because the store has no notion of league membership (a notice-worthy fact this
 * caller alone knows) and no reason to grow one for a single caller-specific announcement.
 *
 * `draft_auto_started` is league-scoped and `SYSTEM_ACTION_VISIBILITY` allows it to everyone
 * (Task 4) — a fact about the league's shared calendar, true for everyone in it, about nobody's
 * conduct — so unlike `draft_auto_picked` (one recipient) this sends ONE notice per TEAM in the
 * league, all referencing the SAME `system_action` event: the identical one-event-many-notices
 * shape `resolveFlag`'s `trade_blocked` branch already uses (`@/integrity-service/flags`).
 *
 * Exported (not folded into `startOneDraft` below) so `lock-order.test.ts` can drive it directly
 * against a real Postgres beside a concurrent join, the same way `recordTierBlockedJoin`
 * (`@/league-service/join`) is driven there — this function's own `member_notices` inserts take an
 * implicit `FOR KEY SHARE` on `leagues` and `users`, before its own league-chain anchor, which is
 * exactly the shape that lock order proves safe.
 */
export async function announceDraftAutoStarted(
  db: Db,
  input: {
    readonly leagueId: string;
    readonly leagueName: string;
    readonly occurredAt: string;
    readonly audit?: AuditLogger;
    readonly deliver?: typeof deliverNotice;
  },
): Promise<readonly MemberNotice[]> {
  const audit = input.audit ?? getAuditLogger();
  const deliver = input.deliver ?? deliverNotice;
  const teamRows = await db.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, input.leagueId)).orderBy(teams.id);
  // Unreachable through `autoStartDueDrafts` itself — `store.startDraft` already refused any
  // league with fewer than two teams before this is ever called — but a directly-driven league
  // with none writes no anchor for nobody to attach it to, the same guard `autoSetLineupInTx`
  // (`@/league-service/auto-lineup`) keeps for the identical reason.
  if (teamRows.length === 0) return [];

  const notices = await db.transaction(async (tx) => {
    const created: MemberNotice[] = [];
    for (const row of teamRows) {
      created.push(
        await notifyAffectedMember(tx, {
          leagueId: input.leagueId,
          userId: row.userId,
          noticeType: "draft_auto_started",
          context: { leagueName: input.leagueName },
          occurredAt: input.occurredAt,
          auditEventId: null,
        }),
      );
    }
    // THE ANCHOR, LAST — one event, shared by every notice minted above.
    const event = await audit.record(tx, {
      eventType: "system_action",
      actorId: null,
      actorType: "system",
      leagueId: input.leagueId,
      payload: { action: "draft_auto_started" },
      occurredAt: input.occurredAt,
    });
    const attached: MemberNotice[] = [];
    for (const notice of created) attached.push(await attachAuditEvent(tx, notice, event.eventId));
    return attached;
  });

  // Best-effort LIVE frames, after the commit — the durable rows above already carry the delivery.
  for (const notice of notices) {
    try {
      await deliver(notice);
    } catch {
      // Never surfaced: the durable notice already committed, and the inbox reads it next load.
    }
  }
  return notices;
}

/**
 * Starts one due draft through the REAL start path (`store.startDraft` — the identical seam
 * `POST /api/drafts/[draftId]/start` calls, per `claimAutoStart`'s own docblock), then announces
 * it. `store.startDraft` already refuses a league that cannot draft (an empty league, or one seat
 * filled) with its own plain-language reason, and already refuses a draft another instance beat
 * this one to (via `claimAutoStart`, fused into its transaction) — this never re-derives either
 * refusal, it only reports the one `store.startDraft` gives back.
 */
async function startOneDraft(
  db: Db,
  store: DraftStore,
  row: DueDraftRow,
  occurredAt: string,
  audit: AuditLogger,
  deliver: typeof deliverNotice,
): Promise<AutoStartOutcome> {
  const result = await store.startDraft(row.draftId);
  if (!result.ok) return { draftId: row.draftId, started: false, reason: result.reason };

  await announceDraftAutoStarted(db, { leagueId: row.leagueId, leagueName: row.leagueName, occurredAt, audit, deliver });
  return { draftId: row.draftId, started: true };
}

/**
 * The platform's own hand on the button Task 6 built: every public matchmade league's draft whose
 * scheduled kickoff has passed, started without a human pressing anything. A private league's
 * draft is never touched, however late its commissioner is — that trust is the whole premise of a
 * private league, and a platform that starts it anyway has taken the decision away from the one
 * person who owns it.
 *
 * `enforcementAppliesTo({ isPublicMatchmade: true })` (`@/league-service/enforcement`) is checked
 * FIRST, before any query: it is the same deploy-wide switch (`INTEGRITY_CONFIG.participation.
 * enforceTierSegregation`) every other automated action in this plan asks, and "enforcement is off"
 * means this scan does not run at all, not merely that every row it would have found gets refused
 * one at a time.
 *
 * Never throws: one draft's failure (a real DB error, an unexpected rejection) is caught, logged
 * and reported as an `{ started: false }` outcome — the scan continues for every other due draft,
 * and a failed draft is retried on the next tick since its status never left `scheduled`. The exact
 * "never an exception that stops the scan" discipline `ticker.tick()` already holds itself to.
 */
export async function autoStartDueDrafts(db: Db, deps: AutoStartDeps): Promise<readonly AutoStartOutcome[]> {
  if (!enforcementAppliesTo({ isPublicMatchmade: true })) return [];

  const audit = deps.audit ?? getAuditLogger();
  const deliver = deps.deliver ?? deliverNotice;
  const now = deps.clock.now();
  const rows = await dueDraftRows(db, now);

  const outcomes: AutoStartOutcome[] = [];
  for (const row of rows) {
    try {
      outcomes.push(await startOneDraft(db, deps.store, row, now, audit, deliver));
    } catch (error: unknown) {
      console.error("[draft] auto-start failed for draft", row.draftId, error);
      outcomes.push({ draftId: row.draftId, started: false, reason: "Something went wrong starting this draft." });
    }
  }
  return outcomes;
}
