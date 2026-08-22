import { and, asc, eq, lte } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { drafts, leagues } from "@/db/schema";
import type { Clock } from "@/domain/timing";
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
 * separate round trip first, and (review fix round 1, F1) `startDraft`'s own auto-start
 * announcement (the `draft_auto_started` notices and their `system_action` event) is fused into
 * that SAME transaction too, right after this claim succeeds. That placement is not a style
 * preference: a claim committed on its own, followed later by a separate call that appends
 * `START_DRAFT` (or announces it), has a real crash window between the two — a process that dies
 * in that gap leaves `drafts.status = 'in_progress'` with an EMPTY action log or a real started
 * draft with no audit trail, either one a draft no scan will ever find again (`autoStartDueDrafts`
 * only selects `status = 'scheduled'`) and no `applyAction` retry ever reaches. Fused into one
 * transaction, the claim, the append and the announcement commit together or none of them do, so
 * that state is unreachable — there is no half-started, half-announced draft to heal because there
 * is no gap for a crash to land in.
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
}

/**
 * `drafts` where `status = 'scheduled' AND kickoff_at <= now`, joined to `leagues` on
 * `is_public_matchmade` — served by `drafts_status_idx` (`@/db/schema`), the expiry scan's own
 * index and this scan's second reader (measured over a realistic corpus,
 * `src/db/index-plans.test.ts`'s "auto-start's due-kickoff scan" — review fix round 1, F3).
 * Ordered by `id` for the same determinism reason the expiry scan is, and bounded by
 * `DRAFT_SERVICE_CONFIG.maxDraftsPerTick` so one tick can't starve the event loop scanning a
 * backlog.
 *
 * Exported as the query BUILDER (not yet awaited) rather than folded into `dueDraftIds` below, the
 * same shape `browseQuery`/`chatPageQuery`/`pendingFlagQuery` already use — the one seam an
 * `EXPLAIN` assertion can wrap without running the query twice or duplicating its shape.
 */
export function dueDraftsQuery(db: Db, nowIso: string) {
  return db
    .select({ draftId: drafts.id })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(and(eq(drafts.status, "scheduled"), lte(drafts.kickoffAt, new Date(nowIso)), eq(leagues.isPublicMatchmade, true)))
    .orderBy(asc(drafts.id))
    .limit(DRAFT_SERVICE_CONFIG.maxDraftsPerTick);
}

async function dueDraftIds(db: Db, nowIso: string): Promise<readonly string[]> {
  const rows = await dueDraftsQuery(db, nowIso);
  return rows.map((row) => row.draftId);
}

/**
 * Starts one due draft through the REAL start path (`store.startDraft` — the identical seam
 * `POST /api/drafts/[draftId]/start` calls, per `claimAutoStart`'s own docblock), with `auto: true`
 * so `startDraft`'s own `alsoInTransaction` hook fuses the `draft_auto_started` announcement into
 * the SAME transaction as the claim and the `START_DRAFT` append (`./store.ts`).
 *
 * `store.startDraft` already refuses a league that cannot draft (an empty league, or one seat
 * filled) with its own plain-language reason, and already refuses a draft another instance beat
 * this one to (via `claimAutoStart`); this never re-derives either refusal, it only reports the
 * one `store.startDraft` gives back. And because the announcement is now fused rather than a
 * second transaction (review fix round 1, F1/F2), EVERY failure path out of `store.startDraft` —
 * a clean `{ ok: false }` refusal or a thrown error from anywhere inside the fused transaction,
 * announcement included — leaves `drafts.status` exactly where it started: `'scheduled'`. There is
 * no longer a way to reach "the draft actually started but this outcome says it didn't."
 */
async function startOneDraft(store: DraftStore, draftId: string): Promise<AutoStartOutcome> {
  const result = await store.startDraft(draftId, { auto: true });
  if (!result.ok) return { draftId, started: false, reason: result.reason };
  return { draftId, started: true };
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
 * Never throws: one draft's failure (a real DB error, an unexpected rejection, or — fix round 1 —
 * the fused announcement itself failing and rolling the whole transaction back) is caught, logged
 * and reported as a `{ started: false }` outcome — the scan continues for every other due draft,
 * and a failed draft is retried on the next tick because its status LITERALLY never left
 * `scheduled`: `startOneDraft`'s own docblock is what makes that claim true rather than aspirational.
 * The exact "never an exception that stops the scan" discipline `ticker.tick()` already holds
 * itself to.
 */
export async function autoStartDueDrafts(db: Db, deps: AutoStartDeps): Promise<readonly AutoStartOutcome[]> {
  if (!enforcementAppliesTo({ isPublicMatchmade: true })) return [];

  const now = deps.clock.now();
  const draftIds = await dueDraftIds(db, now);

  const outcomes: AutoStartOutcome[] = [];
  for (const draftId of draftIds) {
    try {
      outcomes.push(await startOneDraft(deps.store, draftId));
    } catch (error: unknown) {
      console.error("[draft] auto-start failed for draft", draftId, error);
      outcomes.push({ draftId, started: false, reason: "Something went wrong starting this draft." });
    }
  }
  return outcomes;
}
