import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { auditEvents, chatMessageReports, chatMessages, integrityFlags, leagues, reviewReports, reviews, rosterSlots, teams, tradeProposals, users } from "@/db/schema";
import type { AuditEvent, AuditEventType, JsonObject } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import type { Position } from "@/domain/player";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import {
  contentRemovalIsWiredFor,
  decisionIsWiredFor,
  RESOLUTION_DECISIONS,
  TRADE_FAIRNESS_BASES,
  type FlagSubjectType,
  type FlagType,
  type ResolutionDecision,
  type TradeFairnessBasis,
} from "@/integrity/flags";
import type { NoticeType } from "@/integrity/notices";
import {
  flagDetailFor,
  flagTrailRowFor,
  queueRowFor,
  tradeFairnessBasisPhrase,
  tradeFairnessGapPhrase,
  type FlagCursor,
  type FlagDetail,
  type FlagSubjectView,
  type HeldTradeManagerView,
  type QueueRow,
  type ReporterView,
  type TradedPlayerView,
} from "@/integrity/queue-view";
import { removeChatMessageInTx } from "@/chat-service/moderation";
import { completedSeasonsFor } from "@/league-service/participation";
import { reverseTradeInTx } from "@/league-service/trade-reversal";
import { TransferRefusedError } from "@/league-service/trade-transfer";
import { blockHeldTradeInTx, releaseHeldTradeInTx } from "@/league-service/trades";
import { getPublisher } from "@/lib/realtime/publisher";
import type { PublishFn } from "@/lib/realtime/publish";
import { removeReviewInTx } from "@/review-service/reviews";
import { REVIEW_CONFIG } from "@/reviews/config";
import type { ScoreCache } from "@/stats-pipeline/score-cache";
import { assetPlayerIds } from "@/trades/assets";
import { attachAuditEvent, notifyAffectedMember, type MemberNotice } from "./notify";
import { getAuditLogger, type AuditLogger } from "./audit-logger";
import { raiseFlag, type IntegrityFlag, type RaiseFlagInput, type RaiseFlagResult } from "./raise-flag";

const systemClock: Clock = { now: () => new Date().toISOString() };

// `raiseFlag` and its own input/result types moved to `./raise-flag` (Task 7) — see that module's
// own docblock for why (the fairness detector's reachability contract). Re-exported verbatim so
// every existing caller of `raiseFlag`/`IntegrityFlag`/`RaiseFlagInput`/`RaiseFlagResult` FROM
// THIS FILE (`review-service/reviews.ts`, `chat-service/moderation.ts`, `multi-account.ts`, this
// file's own test) is unaffected — this is a move, not a behavior change.
export { raiseFlag, type IntegrityFlag, type RaiseFlagInput, type RaiseFlagResult };

/**
 * What `canonicalPairId` (`@/integrity-service/multi-account`) joins an `account_pair` subject id
 * with — defined here, not imported from there, because `multi-account.ts` imports `raiseFlag`
 * (now re-exported from here, `./raise-flag`) and a reverse import would be a cycle.
 * `aboutFor`/`subjectFor`/`trailFor` below are the three readers that split on it; `canonicalPairId`
 * is the one writer.
 */
const PAIR_ID_SEPARATOR = ":";

/** `AcceptTradeInput.cache`'s own default, restated for the reversal branch: an eviction nobody
 *  injected does nothing, so a test never needs a live Redis connection. */
const NOOP_SCORE_CACHE: Pick<ScoreCache, "invalidate"> = { invalidate: async () => {} };

export interface ResolveFlagInput {
  readonly flagId: string;
  readonly decision: ResolutionDecision;
  /**
   * The operator's own words. Bound by `INTEGRITY_CONFIG.moderation.noteMaxLength` below, NOT by
   * `src/integrity/copy-rules.ts`'s denylist — that rulebook binds PLATFORM copy (the templates
   * `notices.ts` composes), and this is the operator speaking in their own voice, quoted rather
   * than paraphrased, the same distinction `operator_warning`'s own docblock draws.
   */
  readonly note: string;
  readonly operatorUserId: string;
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `notifyAffectedMember`. Injectable so a test can force its failure. */
  readonly notify?: typeof notifyAffectedMember;
  /**
   * Defaults to the real publisher. Threaded through to `removeChatMessageInTx` on a
   * `content_removed` decision against a `chat_message` subject — the ONLY decision this input
   * ever reaches a realtime publish from, mirroring `PostMessageInput.publish`'s own required-DI
   * shape rather than `audit`/`notify`'s optional one, because a test asserting the swallow needs
   * to inject a recorder the same way `chat.test.ts` already does.
   */
  readonly publish?: PublishFn;
  /**
   * The score cache to evict after a `trade_reversed` decision's reversal commits (final review,
   * MEDIUM 4). Defaults to a no-op, exactly as `AcceptTradeInput.cache` does and for the same
   * reason: a test never needs a live Redis connection, and the route supplies the real
   * `getScoreCache()` (`@/league-service/score-cache-instance`). A reversal is the fourth
   * roster-mutating writer in this codebase; the other three all evict, and this one used to be
   * the only one leaving `crossLeagueHome`'s cached scores stale until TTL.
   */
  readonly cache?: Pick<ScoreCache, "invalidate">;
}

export type ResolveFlagResult =
  | { readonly ok: true; readonly flagId: string; readonly decision: ResolutionDecision }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Which flag types get NOTICED at all when THIS decision resolves them, and with what notice
 * type — exhaustive over every declared `ResolutionDecision`, so a decision landing later with no
 * entry here fails to compile rather than silently inheriting "tell nobody" (the same deny-by-
 * default shape `ACTIVITY_VISIBILITY` uses).
 *
 * `no_action` is `null` ON PURPOSE (ruling 6): an investigation that closed with nothing
 * happening is not an event in the member's life, and "we looked into you and found nothing" is
 * precisely the accusation `INTEGRITY_CONFIG.notices.accusatoryTerms` exists to keep out of this
 * product.
 *
 * `content_removed` is ALSO `null` here — not because it notices nobody, but because its own
 * remover (`removeReview` and its `chat-service` sibling, landing in Tasks 4 and 6) already sends
 * its own notice inside the SAME transaction (`review_removed`, and the chat equivalent). A
 * second notice from here would tell the member twice about one decision.
 *
 * `trade_reversed` is `null` here too, for the SAME reason `content_removed` is: it already
 * notified. `reverseTradeInTx` (`@/league-service/trade-reversal`, Task 7) sends its own
 * `trade_reversed` notice to BOTH parties, inside its own (earlier, already-committed)
 * transaction — a third, generic notice from here would tell one of them twice, and this map has
 * no way to notice two people from one entry anyway.
 *
 * `trade_released` is `null` for the identical reason (Plan D, Task 5): the execution sends
 * `trade_executed` to both parties, exactly as `acceptTrade` does — `releaseHeldTradeInTx`
 * (`@/league-service/trades`) is that execution, run before this function's own transaction ever
 * opens. `trade_blocked` is ALSO `null`, for the same shape one more time: `blockHeldTradeInTx`
 * sends its own `trade_blocked` notice to both parties, from INSIDE this function's own
 * transaction rather than a separate one (a block moves nothing, so there is no second chain to
 * cross) — see this function's own `trade_blocked` branch below.
 */
const NOTICE_FOR_DECISION: Readonly<Record<ResolutionDecision, NoticeType | null>> = {
  no_action: null,
  warned_user: "operator_warning",
  content_removed: null,
  trade_reversed: null,
  trade_released: null,
  trade_blocked: null,
};

/**
 * Fix round 2, F1. Whether THIS decision's own `note` is ever read by anyone other than the
 * operator who wrote it (and a future operator revisiting the flag) — the shared seam the
 * accusatory-language guard below runs against. Exhaustive over `ResolutionDecision`, the same
 * "a new decision fails to compile without answering this" discipline `NOTICE_FOR_DECISION` and
 * `DECISION_LABEL` both hold to.
 *
 * `no_action` is `false`: ruling 6 notices nobody, so this note is operator-to-operator only, and
 * the guarantee below protects the person the note is written ABOUT — there is no such person
 * here. The other three are all `true`, for three different reasons: `warned_user`'s note quotes
 * VERBATIM in the member's own notice (`operator_warning`, `quoteFor`); `content_removed`'s note
 * becomes the permanent removal `reason` stored on the row (mapped to a generic phrase for the
 * removed author today, but the raw words persist as a written record about them regardless);
 * `trade_reversed`'s note quotes VERBATIM to BOTH managers (`reverseTradeInTx`'s own notice).
 *
 * `trade_released` is `false` (Plan D, Task 5): the release executes the trade the two managers
 * already agreed to, through the SAME `trade_executed` template `acceptTrade` sends for an
 * ordinary acceptance, which interpolates no operator note at all — this note is operator-to-
 * operator only, the identical reasoning `no_action`'s own entry states. `trade_blocked` is
 * `true`, for the identical reason `trade_reversed` is: `blockHeldTradeInTx`'s own notice quotes
 * it VERBATIM to both managers.
 */
const NOTE_REACHES_SOMEONE_ELSE: Readonly<Record<ResolutionDecision, boolean>> = {
  no_action: false,
  warned_user: true,
  content_removed: true,
  trade_reversed: true,
  trade_released: false,
  trade_blocked: true,
};

/**
 * The accusatory term `note` contains, or `null` for a clean note. Reuses `INTEGRITY_CONFIG.
 * notices.accusatoryTerms` — the SAME denylist `copyViolations` (`@/integrity/copy-rules`) checks
 * the platform's OWN template copy against — but narrower ON PURPOSE: an operator's own free-text
 * note is otherwise unrestricted (dashes, passive voice, length governed by its own cap above),
 * the same "trusted with what they choose to SAY" latitude `stripHiddenCharacters`'s own docblock
 * (`@/integrity-service/notify`) already gives it. Only the accusatory-language axis matters here,
 * because that is the one guarantee a note this decision's own notice repeats verbatim (or stores
 * permanently) is supposed to keep — `copyViolations`'s other two rules (dash, passive) are about
 * the PLATFORM's own voice, not an operator's.
 */
function accusatoryTermIn(note: string): string | null {
  const lower = note.toLowerCase();
  return INTEGRITY_CONFIG.notices.accusatoryTerms.find((term) => lower.includes(term)) ?? null;
}

/**
 * The phrase an already-resolved flag's OWN stored decision reads as, in the 409 a second
 * operator gets. Exhaustive over every declared decision for the same reason `NOTICE_FOR_DECISION`
 * above is: a decision with no entry here cannot compile, so this message can never fall back to
 * printing a raw stored token at an operator.
 */
const DECISION_LABEL: Readonly<Record<ResolutionDecision, string>> = {
  no_action: "no action",
  warned_user: "a warning",
  content_removed: "content removed",
  trade_reversed: "a trade reversal",
  trade_released: "released",
  trade_blocked: "blocked",
};

/**
 * The zero-rows branch of the stamp `UPDATE` in `resolveFlag` below: either no flag has this id,
 * or one already does — read back, inside the SAME transaction, to tell an operator which. The
 * same "judged by this write's own returned rows, one extra `SELECT` only on the refused path"
 * shape `removeReview` uses for its own already-removed check.
 */
async function alreadyResolvedOrMissing(tx: DbTx, flagId: string): Promise<ResolveFlagResult> {
  const [existing] = await tx.select({ resolution: integrityFlags.resolution }).from(integrityFlags).where(eq(integrityFlags.id, flagId));
  if (existing === undefined) return { ok: false, status: 404, reason: `No flag with id "${flagId}".` };

  const decision = existing.resolution;
  if (decision === null || !(RESOLUTION_DECISIONS as readonly string[]).includes(decision)) {
    // Unreachable through real Postgres: `resolution` is set in the SAME statement as
    // `resolved_at`, atomically, so a row this SELECT finds with `resolved_at` non-null (the only
    // way execution reaches here) always has a `resolution` from the closed set too. Same
    // "impossible-state guard, proved by a stub" discipline `raiseFlag`'s `existingOpenFlagFor` uses.
    throw new Error(`resolveFlag: flag "${flagId}" is resolved with no recognizable decision recorded — this should be impossible.`);
  }
  return {
    ok: false,
    status: 409,
    reason: `That flag was already resolved as "${DECISION_LABEL[decision as ResolutionDecision]}". A different decision is a new flag, not an edit.`,
  };
}

/**
 * The one case `removeSubject` below refuses to let `resolveFlag`'s transaction commit through:
 * `removeReviewInTx` (and, from Task 6, its chat sibling) answers a graceful `{ ok: false }` for
 * an ordinary, expected refusal — already removed, or a ghost id — and that refusal must roll
 * `resolveFlag`'s WHOLE transaction back (the flag's own stamp `UPDATE` included), not just skip
 * a step. Throwing is the only way to force that rollback from inside a `db.transaction`
 * callback; this class is what lets `resolveFlag` tell that throw apart from every OTHER one
 * (an unwired subject type, a failed audit append) that must keep propagating as a rejected
 * promise rather than becoming a normal `{ ok: false }` result.
 */
class ContentRemovalRefused extends Error {
  constructor(
    readonly status: number,
    reason: string,
  ) {
    super(reason);
  }
}

/**
 * `ContentRemovalRefused`'s own twin for `trade_blocked` (Plan D, Task 5): `blockHeldTradeInTx`
 * answers a graceful `{ ok: false }` for an ordinary, expected refusal (the trade is no longer
 * held — a race, or a second attempt on an already-blocked one), and that refusal must roll
 * `resolveFlag`'s WHOLE transaction back, the flag's own stamp `UPDATE` included, not just skip a
 * step. Throwing is the only way to force that rollback from inside a `db.transaction` callback.
 */
class HeldTradeDecisionRefused extends Error {
  constructor(
    readonly status: number,
    reason: string,
  ) {
    super(reason);
  }
}

/**
 * `content_removed`'s actual removal, dispatched by the flag's own `subjectType`. `review` was
 * wired first (Task 4): it calls `removeReviewInTx` (`@/review-service/reviews`) INSIDE
 * `resolveFlag`'s own transaction, passing the operator as `removedByUserId` and the operator's
 * note as the removal reason. `chat_message` (Task 6) calls `removeChatMessageInTx`
 * (`@/chat-service/moderation`) the identical way. Both removers already write their own audit
 * event and their own notice, and nothing about either path changes here, which is the whole
 * reason both are built as a stamp.
 *
 * A refusal from either remover (already removed, or a ghost id) is re-thrown as
 * `ContentRemovalRefused` rather than returned — see that class's own docblock — so `resolveFlag`
 * rolls its stamp back and answers a normal `{ ok: false }` instead of committing a flag stamped
 * "resolved: content_removed" for a removal that never landed.
 *
 * `account_pair`/`trade` still throw a plain `Error`, unwired by design (neither this plan nor
 * Plan C's `trade_reversed` removes content for those subject types): by the time this runs,
 * `resolveFlag`'s stamp `UPDATE` has already applied inside this same transaction, and the ONLY
 * way to undo it is Postgres's own `ROLLBACK` on a rejected promise — the identical audit-fails-
 * the-tx discipline `raiseFlag` and `grantAdmin` already lean on for a failed `audit.record`. A
 * caller getting back a flag stamped "resolved: content_removed" with no removal performed and
 * no `flag_resolved` event to explain it would be exactly the hole in the record this whole plan
 * exists to close.
 */
/**
 * EXPORTED for one narrow test and nothing else (final review, LOW 13). Its trailing throw is
 * unreachable through `resolveFlag`, which refuses an unwired subject type before its transaction
 * opens — and a guard nothing exercises is a guard nobody knows still works. `flags.test.ts`
 * calls it directly with `account_pair` to put the code in the state it defends against, the same
 * narrow-test discipline `vitest.config.mts`'s own docblock sanctions for every other
 * unreachable-through-Postgres branch in this directory. No production caller outside this file.
 */
export async function removeSubject(
  tx: DbTx,
  subjectType: FlagSubjectType,
  opts: {
    readonly subjectId: string;
    readonly flagId: string;
    readonly operatorUserId: string;
    readonly reason: string;
    readonly clock: Clock;
    readonly audit: AuditLogger;
    readonly notify: typeof notifyAffectedMember;
    readonly publish: PublishFn;
  },
): Promise<void> {
  if (subjectType === "review") {
    const result = await removeReviewInTx(tx, {
      reviewId: opts.subjectId,
      removedByUserId: opts.operatorUserId,
      reason: opts.reason,
      clock: opts.clock,
      audit: opts.audit,
      notify: opts.notify,
      flagId: opts.flagId,
    });
    if (!result.ok) throw new ContentRemovalRefused(409, result.reason);
    return;
  }
  if (subjectType === "chat_message") {
    const result = await removeChatMessageInTx(tx, {
      messageId: opts.subjectId,
      removedByUserId: opts.operatorUserId,
      reason: opts.reason,
      clock: opts.clock,
      audit: opts.audit,
      notify: opts.notify,
      publish: opts.publish,
      flagId: opts.flagId,
    });
    if (!result.ok) throw new ContentRemovalRefused(409, result.reason);
    return;
  }
  // Unreachable through `resolveFlag`, which refuses this before the transaction opens
  // (`contentRemovalIsWiredFor`, above). Kept as the backstop for a future direct caller, and for
  // a subject type somebody adds to `CONTENT_REMOVAL_WIRED_FOR` before wiring its remover here.
  throw new Error(`resolveFlag: content_removed has no remover wired for subject type "${subjectType}".`);
}

/**
 * Who reads the operator's own words when a decision notices anyone at all: the author of the
 * flagged content, resolved from the flag's own SUBJECT rather than trusted from the caller — an
 * operator's claim about "who this affects" is exactly the kind of unchecked input a moderation
 * surface must not take on faith. Only the two report-driven subject types name a single,
 * unambiguous author; `account_pair` names two accounts and `trade` names a transaction, and
 * neither is a subject this plan's notice-bearing decision (`warned_user`) is ever sent for.
 */
async function affectedMemberFor(tx: DbTx, subjectType: FlagSubjectType, subjectId: string): Promise<string> {
  if (subjectType === "review") {
    const [author] = await tx.select({ userId: reviews.userId }).from(reviews).where(eq(reviews.id, subjectId));
    if (author === undefined) throw new Error(`resolveFlag: no review "${subjectId}" for a flag that named it as the subject.`);
    return author.userId;
  }
  if (subjectType === "chat_message") {
    const [author] = await tx.select({ authorUserId: chatMessages.authorUserId }).from(chatMessages).where(eq(chatMessages.id, Number(subjectId)));
    if (author === undefined) throw new Error(`resolveFlag: no chat message "${subjectId}" for a flag that named it as the subject.`);
    return author.authorUserId;
  }
  throw new Error(`resolveFlag: "${subjectType}" has no single affected member to notice.`);
}

/**
 * The league name `operator_warning`'s body interpolates. `leagueId` is nullable on the flag row
 * — a `review_report` flag has none, because reviews are platform-scoped, not league-scoped — so
 * this covers both. The fallback wording only matters for a `warned_user` decision on a
 * leagueless flag, a combination no caller exercises today, but the notice this feeds must not
 * crash composing itself if one ever is.
 */
async function leagueNameForFlag(tx: DbTx, leagueId: string | null): Promise<string> {
  if (leagueId === null) return "your league";
  const [league] = await tx.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
  return league?.name ?? leagueId;
}

/**
 * ONE WAY, ONCE, AND THE AUDIT EVENT IS THE RECORD.
 *
 * The note is the operator's own words and reaches the member verbatim when the decision is
 * `warned_user`, the same call `removalPhraseFor` already made in Phase 2: an operator writing
 * copy a member reads should know they are doing it.
 *
 * There is NO appeal path (founder decision 4), and the notice says where the decision came from
 * rather than implying a reply channel that does not exist.
 *
 * ONE WAY: the guard lives in the stamp `UPDATE`'s own `WHERE` (`isNull(resolvedAt)`), not in a
 * prior read — the same "judge by this write's own returned rows" discipline `toggleReaction` and
 * `removeReview` use. Two operators resolving the same flag at the same instant serialize on the
 * row lock; the loser's `UPDATE` matches zero rows because Postgres re-evaluates the `WHERE`
 * against the now-committed winner before it can match, so the second decision is refused rather
 * than silently overwriting the first.
 *
 * ONCE: refuses outright (before any write) a `content_removed` note past `REVIEW_CONFIG.
 * removalReason.maxLength` (the tighter removal-reason cap, checked first since it is the one the
 * note is ACTUALLY bound by on that branch), a note past `INTEGRITY_CONFIG.moderation.
 * noteMaxLength` otherwise, and a decision this SUBJECT can't carry out (`decisionIsWiredFor`,
 * `content_removed` and `trade_reversed` each get their own subject-aware check below) — all
 * checked before the transaction opens, the same "fail fast, no partial write" shape
 * `removeReviewInTx`'s own reason-length check uses. `resolveFlagSchema`'s own `.refine`
 * (`decisionIsAvailable`, `@/integrity-service/schemas`) is the boundary check for a decision
 * declared but wired for NO subject at all — none, today, since `DECISION_WIRED_FOR` is exhaustive
 * over every declared decision and a new one without a wiring row fails to compile — so this
 * function does not repeat that check: every `ResolutionDecision` the type system lets a caller
 * name here IS available.
 *
 * THE AUDIT EVENT IS THE RECORD: `flag_resolved`, on the PLATFORM chain (ruling 1, never the
 * league's — a record about a person under review is not the league's business), inside the SAME
 * transaction as the stamp, anchor LAST. A notice — only on the `warned_user` branch, per
 * `NOTICE_FOR_DECISION` — is written BEFORE the anchor and stamped with the event id afterwards
 * (`attachAuditEvent`), the identical lock order `grantAdmin` and `removeReview` already hold to:
 * `notifyAffectedMember`'s insert takes an implicit `FOR KEY SHARE` on `users` and `leagues`,
 * which must never follow the anchor lock.
 *
 * `trade_reversed` (Task 7) is the one decision whose consequence CANNOT live inside this
 * function's own transaction: `reverseTradeInTx` (`@/league-service/trade-reversal`) appends to the
 * LEAGUE chain and this function's own stamp appends to the PLATFORM chain, and one transaction
 * may append to at most one chain (`docs/decisions/operators-and-moderation.md` §5). So the
 * reversal runs FIRST, in its own transaction, before this function's own ever opens — see
 * `reverseTradeInTx`'s own docblock for the full commit-order accounting, including what happens
 * if this function's OWN transaction is the one that fails afterward.
 */
export async function resolveFlag(db: Db, input: ResolveFlagInput): Promise<ResolveFlagResult> {
  // `content_removed`'s note becomes a REMOVAL REASON (`removeSubject` passes it straight through
  // as `removeReviewInTx`'s `reason`), not an `operator_warning` notice body — so it is bound by
  // `REVIEW_CONFIG.removalReason.maxLength` (200), the tighter cap `removeReviewInTx` itself
  // enforces, not the looser `INTEGRITY_CONFIG.moderation.noteMaxLength` (500) below. Checked HERE,
  // with PRODUCT copy, before any write: without this, a 201-500 char note passed the general cap
  // just below, reached `removeReviewInTx` inside the transaction, and surfaced the CLI-flavored
  // `"--reason must be … characters or fewer."` — written for `scripts/remove-review.ts`'s
  // operator, not for whatever calls `resolveFlag`. That script's own door is untouched: it still
  // calls `removeReviewInTx` directly and still gets that exact message.
  if (input.decision === "content_removed" && input.note.length > REVIEW_CONFIG.removalReason.maxLength) {
    return { ok: false, status: 400, reason: `Notes on a removal are limited to ${REVIEW_CONFIG.removalReason.maxLength} characters.` };
  }
  if (input.note.length > INTEGRITY_CONFIG.moderation.noteMaxLength) {
    return { ok: false, status: 400, reason: `Keep the note to ${INTEGRITY_CONFIG.moderation.noteMaxLength} characters or fewer. The member reads it.` };
  }
  // THE ACCUSATORY-NOTE SEAM (fix round 2, F1). `INTEGRITY_CONFIG.notices.accusatoryTerms` has
  // always bound the PLATFORM's own template copy (`copyViolations`, `@/integrity/copy-rules`,
  // enforced on `notices.ts`'s templates by `notices.test.ts`) — never `context.note`, the
  // operator's own free-text words. Plan B shipped two decisions whose note reaches someone else
  // and guarded neither: `warned_user`'s note quotes VERBATIM in the member's own notice
  // (`operator_warning`, `quoteFor`), and `content_removed`'s note becomes the permanent removal
  // reason stored on the row (`removeReviewInTx`/`removeChatMessageInTx`'s own `reason`) — mapped
  // to a generic phrase for the removed author today, but the operator's raw words persist as a
  // written record about that person regardless. Plan C's `trade_reversed` would have been a
  // third instance of the identical gap. One check, at the shared seam every decision passes
  // through, closes the class rather than the one decision that happened to surface it.
  // `no_action` is the one exception: ruling 6 notices nobody, so its note is read by an operator
  // revisiting the flag and nobody else — the accusatory-language guarantee protects the person
  // being written ABOUT, and there is no such person here.
  if (NOTE_REACHES_SOMEONE_ELSE[input.decision]) {
    const term = accusatoryTermIn(input.note);
    if (term !== null) {
      return { ok: false, status: 400, reason: `Your note can't include "${term}". Describe what happened without naming what you suspect, then try again.` };
    }
  }
  // SUBJECT-AWARE, and before the transaction opens (final review, LOW 13). `content_removed`
  // only has a remover for the two content subject types; against an `account_pair` flag it used
  // to reach `removeSubject`'s unwired branch, throw a plain `Error`, and surface as a 500. The
  // rollback made that fail-safe rather than dangerous, but a crash is not a refusal — the
  // boundary says no here, in product copy, and `removeSubject`'s throw stays as the backstop for
  // a subject type somebody wires halfway. One read, on this branch only; the page filters the
  // decision out of the UI already (`decisionsFor`), so only a direct POST ever reaches this.
  if (input.decision === "content_removed") {
    const [flag] = await db.select({ subjectType: integrityFlags.subjectType }).from(integrityFlags).where(eq(integrityFlags.id, input.flagId));
    if (flag !== undefined && !contentRemovalIsWiredFor(flag.subjectType as FlagSubjectType)) {
      return { ok: false, status: 400, reason: "There is no content to remove on this flag. Close it with no action, or warn the member." };
    }
  }
  // SUBJECT-AWARE, and before ANY transaction opens — `trade_reversed`'s own version of the
  // `content_removed` check just above. A `trade_fairness` flag always names a real `trade`
  // subject; a direct POST of `trade_reversed` against any other flag type is refused here, in
  // product copy, rather than reaching `reverseTradeInTx` with a subject it was never built for.
  if (input.decision === "trade_reversed") {
    const [flag] = await db
      .select({ subjectType: integrityFlags.subjectType, subjectId: integrityFlags.subjectId, leagueId: integrityFlags.leagueId })
      .from(integrityFlags)
      .where(eq(integrityFlags.id, input.flagId));
    if (flag !== undefined) {
      if (!decisionIsWiredFor("trade_reversed", flag.subjectType as FlagSubjectType)) {
        return { ok: false, status: 400, reason: "There is no trade on this flag to reverse. Close it with no action, or warn the member." };
      }
      // A `trade` subject's flag ALWAYS carries a real `leagueId` — `raiseTradeFairnessFlag`'s own
      // `leagueId` input is required, never optional — so this is never actually null here.
      const leagueId = flag.leagueId!;

      // THE REVERSAL, IN ITS OWN TRANSACTION, COMMITTED BEFORE THIS FUNCTION'S OWN EVER OPENS —
      // see `reverseTradeInTx`'s own docblock and `resolveFlag`'s own docblock above for why. A
      // refusal here (`{ ok: false }`) is returned straight through: this function's own
      // transaction never opens, so the flag stays open with nothing written at all.
      let reversal: Awaited<ReturnType<typeof reverseTradeInTx>>;
      try {
        reversal = await db.transaction((tx) =>
          reverseTradeInTx(tx, {
            tradeId: flag.subjectId,
            leagueId,
            flagId: input.flagId,
            operatorUserId: input.operatorUserId,
            note: input.note,
            clock: input.clock,
            audit: input.audit,
            notify: input.notify,
          }),
        );
      } catch (error: unknown) {
        if (error instanceof TransferRefusedError) {
          return { ok: false, status: 409, reason: error.message };
        }
        throw error;
      }
      if (!reversal.ok) return reversal;

      // THE SCORE-CACHE EVICTION, after the reversal's own transaction has committed and before
      // this function's own opens — `acceptTrade`'s post-commit scope, mirrored exactly (final
      // review, MEDIUM 4). Both rosters just moved, so `crossLeagueHome`'s cached scores for the
      // league's current week are stale, and this is the fourth roster-mutating writer joining
      // `setLineup`, `finalizeWeek` and `acceptTrade` in saying so. `reversal.weekNumber` is the
      // week the reversal itself derived — a value this branch previously ignored entirely.
      // Best-effort and swallowed, the identical failure asymmetry `invalidateScoreCacheQuietly`
      // (`@/league-service/trades`) accepts: a missed eviction is one stale read bounded by the
      // key's TTL, never worth failing a reversal that already committed.
      try {
        await (input.cache ?? NOOP_SCORE_CACHE).invalidate(leagueId, reversal.weekNumber);
      } catch (error: unknown) {
        console.error("[integrity-service] score cache invalidation failed after a trade reversal", { leagueId, week: reversal.weekNumber }, error);
      }

      // Fall through to this function's own transaction below: the PLATFORM-chain record of the
      // decision that ordered the reversal which just committed. `trade_reversed`'s own notices
      // were already sent, inside the transaction above — `NOTICE_FOR_DECISION.trade_reversed`
      // stays `null` so nothing here sends a third, generic one.
    }
    // `flag === undefined`: fall through. The guarded UPDATE below will match no row either, and
    // `alreadyResolvedOrMissing` answers the same 404 every other unknown flagId gets.
  }

  // SUBJECT-AWARE, and before ANY transaction opens — Plan D's own version of `trade_reversed`'s
  // check just above. A `trade_hold` flag always names a real `held_trade` subject; a direct POST
  // of `trade_released` against any other flag type is refused here, in product copy, rather than
  // reaching `releaseHeldTradeInTx` with a subject it was never built for.
  if (input.decision === "trade_released") {
    const [flag] = await db
      .select({ subjectType: integrityFlags.subjectType, subjectId: integrityFlags.subjectId, leagueId: integrityFlags.leagueId })
      .from(integrityFlags)
      .where(eq(integrityFlags.id, input.flagId));
    if (flag !== undefined) {
      if (!decisionIsWiredFor("trade_released", flag.subjectType as FlagSubjectType)) {
        return { ok: false, status: 400, reason: "There is no held trade on this flag to release. Close it with a block instead." };
      }
      // A `held_trade` subject's flag ALWAYS carries a real `leagueId` — `raiseFlag`'s own call
      // from `holdTradeInTx` (`@/league-service/trades`) passes the trade's own league, never
      // `null` — so this is never actually null here.
      const leagueId = flag.leagueId!;

      // THE EXECUTION, IN ITS OWN TRANSACTION, COMMITTED BEFORE THIS FUNCTION'S OWN EVER OPENS —
      // see `releaseHeldTradeInTx`'s own docblock and `resolveFlag`'s own docblock above for why.
      // A refusal here (`{ ok: false }`) is returned straight through: this function's own
      // transaction never opens, so the flag stays open with nothing written at all.
      let release: Awaited<ReturnType<typeof releaseHeldTradeInTx>>;
      try {
        release = await db.transaction((tx) =>
          releaseHeldTradeInTx(tx, {
            tradeId: flag.subjectId,
            leagueId,
            operatorUserId: input.operatorUserId,
            clock: input.clock,
            audit: input.audit,
            notify: input.notify,
          }),
        );
      } catch (error: unknown) {
        if (error instanceof TransferRefusedError) {
          return { ok: false, status: 409, reason: error.message };
        }
        throw error;
      }
      if (!release.ok) return release;

      // THE SCORE-CACHE EVICTION, after the execution's own transaction has committed and before
      // this function's own opens — `acceptTrade`'s post-commit scope, mirrored exactly, the same
      // way `trade_reversed`'s own branch already mirrors it above. `release.weekNumber` is the
      // week `releaseHeldTradeInTx` itself re-derived (the C1 lesson, a third time in this arc).
      try {
        await (input.cache ?? NOOP_SCORE_CACHE).invalidate(leagueId, release.weekNumber);
      } catch (error: unknown) {
        console.error("[integrity-service] score cache invalidation failed after a held-trade release", { leagueId, week: release.weekNumber }, error);
      }

      // Fall through to this function's own transaction below: the PLATFORM-chain record of the
      // decision that ordered the release which just committed. `trade_released`'s own notices
      // were already sent, inside the transaction above — `NOTICE_FOR_DECISION.trade_released`
      // stays `null` so nothing here sends a third, generic one.
    }
    // `flag === undefined`: fall through, same reasoning `trade_reversed`'s own branch states.
  }

  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const publish = input.publish ?? ((event) => getPublisher().publish(event));
  const now = new Date(clock.now());

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(integrityFlags)
        .set({ resolvedAt: now, resolvedByUserId: input.operatorUserId, resolution: input.decision, resolutionNote: input.note })
        .where(and(eq(integrityFlags.id, input.flagId), isNull(integrityFlags.resolvedAt)))
        .returning();
      if (row === undefined) return alreadyResolvedOrMissing(tx, input.flagId);

      // content_removed performs the removal INSIDE this transaction, so a decision and its
      // consequence cannot come apart. Tasks 4 and 6 supply the two removers; see `removeSubject`.
      // An ORDINARY refusal (already removed, a ghost id) throws `ContentRemovalRefused`, caught
      // below and turned into this function's own `{ ok: false }` — see that class's docblock.
      if (input.decision === "content_removed") {
        await removeSubject(tx, row.subjectType as FlagSubjectType, {
          subjectId: row.subjectId,
          flagId: row.id,
          operatorUserId: input.operatorUserId,
          reason: input.note,
          clock,
          audit,
          notify,
          publish,
        });
      }

      // trade_blocked performs the block INSIDE this transaction too (Plan D, Task 5) — a block
      // moves nothing, so unlike `trade_released` it needs no second transaction and no second
      // chain, and belongs beside `content_removed` here rather than beside `trade_reversed`
      // above. An ORDINARY refusal (the trade is no longer held) throws `HeldTradeDecisionRefused`,
      // caught below and turned into this function's own `{ ok: false }` — the identical
      // rollback-the-stamp discipline `ContentRemovalRefused` already established.
      let tradeBlockNotices: readonly MemberNotice[] = [];
      if (input.decision === "trade_blocked") {
        const blocked = await blockHeldTradeInTx(tx, {
          tradeId: row.subjectId,
          leagueId: row.leagueId!, // a `held_trade` subject's flag always carries a real leagueId
          operatorUserId: input.operatorUserId,
          note: input.note,
          clock,
          notify,
        });
        if (!blocked.ok) throw new HeldTradeDecisionRefused(blocked.status, blocked.reason);
        tradeBlockNotices = blocked.notices;
      }

      const noticeType = NOTICE_FOR_DECISION[input.decision];
      const notice =
        noticeType === "operator_warning"
          ? await notify(tx, {
              leagueId: row.leagueId,
              userId: await affectedMemberFor(tx, row.subjectType as FlagSubjectType, row.subjectId),
              noticeType,
              context: { leagueName: await leagueNameForFlag(tx, row.leagueId), note: input.note },
              occurredAt: clock.now(),
              auditEventId: null,
            })
          : null;

      const event = await audit.record(tx, {
        eventType: "flag_resolved",
        actorId: input.operatorUserId,
        actorType: "user",
        leagueId: null, // platform chain — ruling 1
        payload: { flagId: row.id, flagType: row.flagType, decision: input.decision, subjectType: row.subjectType, subjectId: row.subjectId, leagueId: row.leagueId },
        occurredAt: clock.now(),
      });
      if (notice !== null) await attachAuditEvent(tx, notice, event.eventId);
      for (const blockNotice of tradeBlockNotices) await attachAuditEvent(tx, blockNotice, event.eventId);
      return { ok: true, flagId: row.id, decision: input.decision };
    });
  } catch (err: unknown) {
    if (err instanceof ContentRemovalRefused) return { ok: false, status: err.status, reason: err.message };
    if (err instanceof HeldTradeDecisionRefused) return { ok: false, status: err.status, reason: err.message };
    throw err;
  }
}

/** A stored row, as `flagTrailRowFor` wants it — the same three-field spread `activity.ts`'s own
 *  `toEvent` uses, kept local for the same reason: not worth a cross-module dependency. */
function toEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}

export type { FlagCursor };

export interface ListPendingFlagsInput {
  readonly limit?: number;
  /** A cursor from a previous page's `nextBefore` — named to match `feedQuery`'s own `before`
   *  even though this queue reads OLDEST first (ruling 30): it names "continue from here", not a
   *  direction, and giving it a second name for one query would be a second vocabulary to keep
   *  in step with `feedQuery`'s for no reader benefit. */
  readonly before?: FlagCursor;
}

export interface PendingFlagsPage {
  readonly rows: readonly QueueRow[];
  readonly nextBefore: FlagCursor | null;
}

/**
 * The queue's own query — exported as a builder, mirroring `feedQuery` (`@/review-service/
 * reviews`) and `browseQuery` (`@/league-service/browse`), so `flags.test.ts` can assert the
 * TABLE SET this query touches (`tablesIn`, the same helper `reviews.test.ts` established)
 * rather than a hand-copied lookalike. `evidence` and `resolution_note` are not in the SELECT
 * list at all — not filtered out for the queue row, never fetched — the same "a stronger claim
 * than 'no field leaked'" discipline `feedQuery`'s own docblock states for `rating`.
 *
 * Open-only (`resolved_at IS NULL`) and oldest-first (`raised_at ASC`), served by
 * `integrity_flags_queue_idx`: NO severity sort (ruling 30) — a severity ordering over a
 * heuristic score is the platform quietly telling an operator which accusations to believe.
 */
export function pendingFlagQuery(db: Db, input: ListPendingFlagsInput) {
  const pageSize = input.limit ?? INTEGRITY_CONFIG.queue.pageSize;
  const cursor =
    input.before === undefined
      ? undefined
      : sql`(${integrityFlags.raisedAt}, ${integrityFlags.id}) > (${input.before.raisedAt}::timestamptz, ${input.before.id})`;
  return db
    .select({
      id: integrityFlags.id,
      flagType: integrityFlags.flagType,
      subjectType: integrityFlags.subjectType,
      subjectId: integrityFlags.subjectId,
      raisedAt: integrityFlags.raisedAt,
    })
    .from(integrityFlags)
    .where(cursor === undefined ? isNull(integrityFlags.resolvedAt) : and(isNull(integrityFlags.resolvedAt), cursor))
    .orderBy(asc(integrityFlags.raisedAt), asc(integrityFlags.id))
    .limit(pageSize + 1);
}

type PendingFlagRow = Awaited<ReturnType<typeof pendingFlagQuery>>[number];

/**
 * Who or what each row in `rows` is about, batched by subject type rather than one query per
 * row — the same N+1 `listLeagueActivity`'s batched name lookups avoid. However many rows the
 * page holds, this costs at most FIVE queries: the distinct reported reviews, the distinct
 * reported messages, the distinct account-pair user ids, the distinct trades (Task 6), and the
 * distinct teams those trades name — the last two skipped outright when the page holds no trade
 * row, the same "0 or 1 round trips" shape the first three already keep.
 */
async function aboutFor(db: Db, rows: readonly PendingFlagRow[]): Promise<ReadonlyMap<string, string>> {
  const reviewIds = [...new Set(rows.filter((r) => r.subjectType === "review").map((r) => r.subjectId))];
  const chatIds = [...new Set(rows.filter((r) => r.subjectType === "chat_message").map((r) => r.subjectId))];
  const pairUserIds = [...new Set(rows.filter((r) => r.subjectType === "account_pair").flatMap((r) => r.subjectId.split(PAIR_ID_SEPARATOR)))];
  // `held_trade` (Plan D, Task 5) joins `trade` here: both name a real `trade_proposals` row by
  // the identical id, and "about" reads the same either way — which of the two flag types raised
  // the question is the queue row's own `flagType`, not something `about` needs to restate.
  const tradeIds = [...new Set(rows.filter((r) => r.subjectType === "trade" || r.subjectType === "held_trade").map((r) => r.subjectId))];

  const [reviewRows, chatRows, pairRows, tradeRows] = await Promise.all([
    reviewIds.length === 0
      ? []
      : db.select({ id: reviews.id, authorName: users.displayName }).from(reviews).innerJoin(users, eq(users.id, reviews.userId)).where(inArray(reviews.id, reviewIds)),
    chatIds.length === 0
      ? []
      : db
          .select({ id: chatMessages.id, authorName: users.displayName })
          .from(chatMessages)
          .innerJoin(users, eq(users.id, chatMessages.authorUserId))
          .where(inArray(chatMessages.id, chatIds.map(Number))),
    pairUserIds.length === 0 ? [] : db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, pairUserIds)),
    tradeIds.length === 0
      ? []
      : db
          .select({ id: tradeProposals.id, proposerTeamId: tradeProposals.proposerTeamId, counterpartyTeamId: tradeProposals.counterpartyTeamId })
          .from(tradeProposals)
          .where(inArray(tradeProposals.id, tradeIds)),
  ]);

  const tradeTeamIds = [...new Set(tradeRows.flatMap((row) => [row.proposerTeamId, row.counterpartyTeamId]))];
  const tradeTeamRows = tradeTeamIds.length === 0 ? [] : await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, tradeTeamIds));

  const reviewAuthor = new Map(reviewRows.map((r) => [r.id, r.authorName]));
  const chatAuthor = new Map(chatRows.map((r) => [String(r.id), r.authorName]));
  const pairName = new Map(pairRows.map((r) => [r.id, r.name]));
  const tradeById = new Map(tradeRows.map((r) => [r.id, r]));
  const tradeTeamName = new Map(tradeTeamRows.map((r) => [r.id, r.name]));

  const about = new Map<string, string>();
  for (const row of rows) {
    if (row.subjectType === "review") about.set(row.id, `A review by ${reviewAuthor.get(row.subjectId) ?? "a former member"}`);
    else if (row.subjectType === "chat_message") about.set(row.id, `A message from ${chatAuthor.get(row.subjectId) ?? "a former member"}`);
    else if (row.subjectType === "account_pair") {
      // `subjectId.split(PAIR_ID_SEPARATOR)` on a non-empty string always yields a first element
      // (`a` is a real `string`, never `undefined`, no matter what TypeScript's own
      // destructuring type claims without `noUncheckedIndexedAccess`) — only the SECOND element
      // is genuinely optional, for a malformed pair with no separator at all. `b ?? ""` is the
      // guard that fact actually needs; a matching guard on `a` would be dead code defending
      // against a state `.split()` cannot produce.
      const [a, b] = row.subjectId.split(PAIR_ID_SEPARATOR);
      about.set(row.id, `${pairName.get(a) ?? "A former member"} and ${pairName.get(b ?? "") ?? "a former member"}`);
    } else {
      // "trade" or "held_trade" — the only two remaining `FlagSubjectType`s, and both point at
      // the same `trade_proposals` table by the same id. A trade row this old (or never
      // committed, for a test fixture pinning the honest fallback) still names itself by its
      // bare id rather than crash the queue over a subject that has moved on. Once the row IS
      // found, its two team names are never missing — `trade_proposals`' own foreign keys onto
      // `teams.id` (`onDelete: "cascade"`) guarantee it, the same "FK-guaranteed, no fallback"
      // reasoning `subjectFor`'s own trade branch uses for the identical lookup.
      const trade = tradeById.get(row.subjectId);
      about.set(
        row.id,
        trade === undefined
          ? `A trade (${row.subjectId})`
          : `${tradeTeamName.get(trade.proposerTeamId)!} and ${tradeTeamName.get(trade.counterpartyTeamId)!}`,
      );
    }
  }
  return about;
}

/**
 * The operator's queue: open flags, oldest first, no severity sort (ruling 30). Exactly TWO
 * queries regardless of the page's contents — `pendingFlagQuery` itself, and `aboutFor`'s single
 * `Promise.all` of at most three batched lookups (which itself costs 0-3 round trips, never one
 * per row) — the same "batched, not per-row" discipline `listLeagueActivity` established.
 */
export async function listPendingFlags(db: Db, input: ListPendingFlagsInput = {}): Promise<PendingFlagsPage> {
  const pageSize = input.limit ?? INTEGRITY_CONFIG.queue.pageSize;
  const rows = await pendingFlagQuery(db, input);
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const about = await aboutFor(db, page);

  return {
    // `about.get(row.id)!`: `aboutFor`'s own loop is exhaustive over every `FlagSubjectType`
    // (`review`/`chat_message`/`account_pair`/else-`trade`), so it sets an entry for every row
    // in `page` — a fallback here would defend against a state `aboutFor` cannot produce.
    rows: page.map((row) =>
      queueRowFor({
        flagId: row.id,
        flagType: row.flagType as FlagType,
        raisedAt: row.raisedAt.toISOString(),
        about: about.get(row.id)!,
      }),
    ),
    nextBefore: hasMore
      ? (() => {
          const last = page[page.length - 1]!;
          return { raisedAt: last.raisedAt.toISOString(), id: last.id };
        })()
      : null,
  };
}

const FALLBACK_SUBJECT_MEMBER = "A former member";
const FALLBACK_SUBJECT_TEAM = "A former team";

/**
 * `evidence[key]`, narrowed to the `TradedPlayerView[]` `raiseTradeFairnessFlag`'s own
 * `evidenceFor` wrote (`@/integrity-service/trade-fairness`) — read back rather than re-derived,
 * per that function's own docblock (Plan B ruling 5: the session data a value was computed from
 * has moved on by the time an operator looks). An entry missing a field, or a field of the wrong
 * type, is dropped rather than half-rendered — the same "malformed payload renders nothing"
 * discipline `activity-view.ts`'s `str`/`num`/`strArray` hold every stored field to; a flag raised
 * before this shape existed reads as an empty list rather than a crash.
 */
function tradedPlayersFromEvidence(evidence: JsonObject, key: "giving" | "receiving"): readonly TradedPlayerView[] {
  const value = evidence[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): readonly TradedPlayerView[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { playerId, name, position, averagePoints } = entry as Record<string, unknown>;
    if (typeof playerId !== "string" || typeof name !== "string" || typeof averagePoints !== "number") return [];
    return [{ playerId, name, position: typeof position === "string" ? (position as Position) : null, averagePoints }];
  });
}

/**
 * `evidence.basis`, narrowed to `TradeFairnessBasis` — Task 6 fix round 1 (review MEDIUM 1).
 * `null` for anything that isn't one of the two declared values, which covers both a flag raised
 * before this field existed on `evidence` at all (`undefined`) and a malformed one (any other
 * type) with the SAME honest answer, the same "absent and wrong read alike" discipline
 * `tradedPlayersFromEvidence` just above already holds every stored field to.
 */
function basisFromEvidence(evidence: JsonObject): TradeFairnessBasis | null {
  const value = evidence.basis;
  return typeof value === "string" && (TRADE_FAIRNESS_BASES as readonly string[]).includes(value) ? (value as TradeFairnessBasis) : null;
}

/** `evidence[key]`, narrowed to a real `number` — the same "absent and wrong read alike"
 *  discipline `basisFromEvidence`/`tradedPlayersFromEvidence` already hold every other stored
 *  field to. Fix round 2, F3's own reader for `evidence.gap`/`evidence.threshold`. */
function numberFromEvidence(evidence: JsonObject, key: "gap" | "threshold"): number | null {
  const value = evidence[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One manager's own standing, for `held-trade-detail.tsx` (Plan D, Task 5) — see
 * `HeldTradeManagerView`'s own docblock (`@/integrity/queue-view`) for why this exists at all.
 * `joinedAt` is read off the league chain's own `member_joined` event for this user (the SAME
 * fact `member_joined`'s own trail row already renders for an `account_pair` investigation),
 * bounded to one row since a team's own owner joins a league exactly once. `null` for a member
 * whose join predates this chain (there is none), never a crash: an operator reads "unknown" as
 * an honest answer, the same "malformed or missing reads as absent" discipline every other
 * evidence reader in this file holds to. `completedSeasons` is the SAME count
 * `participationTierFor`/`isVerifiedPlayer` both read through (`@/league-service/participation`) —
 * this account's whole platform history, not just this one league's.
 */
async function heldTradeManagerViewFor(db: Db, leagueId: string, team: { readonly userId: string; readonly name: string }): Promise<HeldTradeManagerView> {
  const [joined, completedSeasons] = await Promise.all([
    db
      .select({ occurredAt: auditEvents.occurredAt })
      .from(auditEvents)
      .where(and(eq(auditEvents.chainScope, leagueId), eq(auditEvents.eventType, "member_joined"), eq(auditEvents.actorId, team.userId)))
      .limit(1),
    completedSeasonsFor(db, team.userId),
  ]);
  return { userId: team.userId, name: team.name, joinedAt: joined[0]?.occurredAt.toISOString() ?? null, completedSeasons };
}

/** The reported content, or the account pair, as an operator needs to see it — one query per
 *  subject type, dispatched by `flagDetail`'s own single lookup of the flag row. `evidence` is
 *  that same lookup's own `evidence` column, threaded through for the `trade`/`held_trade`
 *  branches only (Task 6, and Plan D Task 5) — every other branch ignores it, unused parameters
 *  costing nothing here. */
async function subjectFor(db: Db, subjectType: FlagSubjectType, subjectId: string, evidence: JsonObject): Promise<FlagSubjectView> {
  if (subjectType === "review") {
    const [row] = await db
      .select({ body: reviews.body, authorName: users.displayName, removedAt: reviews.removedAt })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(eq(reviews.id, subjectId));
    return row === undefined
      ? { kind: "review", reviewId: subjectId, body: "This review is no longer here.", authorName: FALLBACK_SUBJECT_MEMBER, removedAt: null }
      : { kind: "review", reviewId: subjectId, body: row.body, authorName: row.authorName, removedAt: row.removedAt?.toISOString() ?? null };
  }
  if (subjectType === "chat_message") {
    const [row] = await db
      .select({ body: chatMessages.body, authorName: users.displayName, removedAt: chatMessages.removedAt })
      .from(chatMessages)
      .innerJoin(users, eq(users.id, chatMessages.authorUserId))
      .where(eq(chatMessages.id, Number(subjectId)));
    return row === undefined
      ? { kind: "chat_message", messageId: subjectId, body: null, authorName: FALLBACK_SUBJECT_MEMBER, removedAt: null }
      : { kind: "chat_message", messageId: subjectId, body: row.body, authorName: row.authorName, removedAt: row.removedAt?.toISOString() ?? null };
  }
  if (subjectType === "account_pair") {
    // `idA` is always a real `string` — `subjectId.split(PAIR_ID_SEPARATOR)` on a non-empty
    // string always yields a first element, whatever TypeScript's own destructuring type claims
    // without `noUncheckedIndexedAccess`. Only `idB` is genuinely optional (a malformed pair with
    // no separator at all), so `ids` always holds at least `idA` and the ternary `aboutFor`'s
    // sibling block used to need here would be dead code defending against a state this can't
    // produce.
    const [idA, idB] = subjectId.split(PAIR_ID_SEPARATOR);
    const ids = idB === undefined ? [idA] : [idA, idB];
    const rows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids));
    const nameOf = (id: string | undefined) => rows.find((r) => r.id === id)?.name ?? FALLBACK_SUBJECT_MEMBER;
    return { kind: "account_pair", userIds: [idA, idB ?? ""], names: [nameOf(idA), nameOf(idB)] };
  }

  // "trade" or "held_trade" — the two remaining `FlagSubjectType`s. `gave`/`got` come straight
  // from `evidence` (Task 6, `tradedPlayersFromEvidence`) either way — never re-priced from a
  // live roster read, the same "what was true when it was raised" discipline every other field on
  // this row already keeps.
  const gave = tradedPlayersFromEvidence(evidence, "giving");
  const got = tradedPlayersFromEvidence(evidence, "receiving");
  // Task 6 fix round 1 (review MEDIUM 1): plain words for WHICH evaluation priced `gave`/`got` —
  // the accept-time one, frozen inside the accept transaction, or a later sweep re-derivation.
  const valuationBasis = tradeFairnessBasisPhrase(basisFromEvidence(evidence));
  // Fix round 2, F3: plain words for the number that actually raised this flag.
  const fairnessGapSummary = tradeFairnessGapPhrase(numberFromEvidence(evidence, "gap"), numberFromEvidence(evidence, "threshold"));

  if (subjectType === "held_trade") {
    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, subjectId));
    if (row === undefined) {
      const missing: HeldTradeManagerView = { userId: "", name: FALLBACK_SUBJECT_MEMBER, joinedAt: null, completedSeasons: 0 };
      return {
        kind: "held_trade",
        tradeId: subjectId,
        proposerTeamName: FALLBACK_SUBJECT_TEAM,
        counterpartyTeamName: FALLBACK_SUBJECT_TEAM,
        gave,
        got,
        valuationBasis,
        fairnessGapSummary,
        proposerManager: missing,
        counterpartyManager: missing,
      };
    }
    const teamRows = await db.select({ id: teams.id, name: teams.name, userId: teams.userId }).from(teams).where(inArray(teams.id, [row.proposerTeamId, row.counterpartyTeamId]));
    // No fallback here — the identical "FK-guaranteed" reasoning the `trade` branch below states
    // for the same lookup.
    const teamOf = (id: string) => teamRows.find((t) => t.id === id)!;
    return {
      kind: "held_trade",
      tradeId: subjectId,
      proposerTeamName: teamOf(row.proposerTeamId).name,
      counterpartyTeamName: teamOf(row.counterpartyTeamId).name,
      gave,
      got,
      valuationBasis,
      fairnessGapSummary,
      proposerManager: await heldTradeManagerViewFor(db, row.leagueId, teamOf(row.proposerTeamId)),
      counterpartyManager: await heldTradeManagerViewFor(db, row.leagueId, teamOf(row.counterpartyTeamId)),
    };
  }

  const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, subjectId));
  if (row === undefined) {
    return {
      kind: "trade",
      tradeId: subjectId,
      proposerTeamName: FALLBACK_SUBJECT_TEAM,
      counterpartyTeamName: FALLBACK_SUBJECT_TEAM,
      gave,
      got,
      acceptedAt: "",
      reversedAt: null,
      valuationBasis,
      fairnessGapSummary,
      playersMovedAgain: false,
    };
  }

  const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, [row.proposerTeamId, row.counterpartyTeamId]));
  // `teamRows.find(...)!`: `trade_proposals.proposer_team_id`/`.counterparty_team_id` carry real
  // foreign keys onto `teams.id` with `onDelete: "cascade"` — a `trade_proposals` row this branch
  // finds always names two teams that are still there (deleting either would cascade the trade
  // row away with it). No fallback here, the same "FK-guaranteed, no fallback" discipline
  // `resolverNameFor` uses for its own `resolved_by_user_id` lookup, a few functions up.
  const teamNameOf = (id: string) => teamRows.find((t) => t.id === id)!.name;

  // Fix round 1 (LOW, M8 discipline): the SAME ownership check `reverseTradeInTx`'s own STEP 4
  // makes, precomputed at READ time so the queue detail can withhold `trade_reversed` with an
  // explanation instead of letting an operator click into a 409. Only worth asking once the trade
  // is NOT already reversed — `flagDetailFor` withholds the decision for a reversed trade on its
  // own, for a different reason, and this read would be wasted work in that state. A read at
  // display time can still race a write between the preview and the click — the service's own
  // check stays the authoritative one — the same "preview, not a guarantee" honesty `subjectIsRemoved`
  // already keeps for `content_removed`.
  const playersMovedAgain = row.reversedAt !== null ? false : await tradePlayersHaveMovedAgain(db, row);

  return {
    kind: "trade",
    tradeId: subjectId,
    proposerTeamName: teamNameOf(row.proposerTeamId),
    counterpartyTeamName: teamNameOf(row.counterpartyTeamId),
    gave,
    got,
    // `row.settledAt!`: a `trade_fairness` flag is only ever raised for a trade `acceptTrade`
    // already stamped `accepted`, and that stamp sets `settled_at` in the SAME statement — a row
    // this branch finds is never mid-negotiation.
    acceptedAt: row.settledAt!.toISOString(),
    reversedAt: row.reversedAt?.toISOString() ?? null,
    valuationBasis,
    fairnessGapSummary,
    playersMovedAgain,
  };
}

/**
 * Whether undoing this trade would take a player off a team that never agreed to anything —
 * `reverseTradeInTx`'s own STEP 4 ownership check (`@/league-service/trade-reversal`), read here
 * rather than re-implemented, so the two can never silently disagree about what "moved again"
 * means. Every traded asset must still be exactly where the trade put it: what the PROPOSER gave
 * (now the counterparty's) still on the counterparty's roster, and what the COUNTERPARTY gave
 * (now the proposer's) still on the proposer's.
 */
async function tradePlayersHaveMovedAgain(db: Db, row: typeof tradeProposals.$inferSelect): Promise<boolean> {
  const gaveIds = assetPlayerIds(row.proposerAssets);
  const gotIds = assetPlayerIds(row.counterpartyAssets);
  const currentRosterRows = await db
    .select({ teamId: rosterSlots.teamId, playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .where(inArray(rosterSlots.teamId, [row.proposerTeamId, row.counterpartyTeamId]));
  const ownedByProposer = new Set(currentRosterRows.filter((r) => r.teamId === row.proposerTeamId).map((r) => r.playerId));
  const ownedByCounterparty = new Set(currentRosterRows.filter((r) => r.teamId === row.counterpartyTeamId).map((r) => r.playerId));
  return !gotIds.every((id) => ownedByProposer.has(id)) || !gaveIds.every((id) => ownedByCounterparty.has(id));
}

/**
 * `review_report` and `chat_report` flags have reporters — `review_reports` and
 * `chat_message_reports` are this plan's two insert-only signal tables (ruling 5). Every other
 * subject type answers empty — a platform detector or a future report table names its own
 * reporters when it lands.
 *
 * Fix round 1 (review HIGH): the `chat_report` branch was missing entirely — `chat_message_
 * reports` was populated by `reportMessage` from the first commit but never read back here, so
 * every chat flag's detail view showed zero reporters no matter how many people reported it.
 * Shaped exactly like the review branch: reporters itemized individually, in report order, never
 * aggregated into a count or a verdict — the operator reads who and why, not a tally.
 */
async function reportersFor(db: Db, subjectType: FlagSubjectType, subjectId: string): Promise<readonly ReporterView[]> {
  if (subjectType === "review") {
    const rows = await db
      .select({ userId: reviewReports.reporterUserId, name: users.displayName, reason: reviewReports.reason, reportedAt: reviewReports.createdAt })
      .from(reviewReports)
      .innerJoin(users, eq(users.id, reviewReports.reporterUserId))
      .where(eq(reviewReports.reviewId, subjectId))
      .orderBy(asc(reviewReports.createdAt));
    return rows.map((row) => ({ userId: row.userId, name: row.name, reason: row.reason, reportedAt: row.reportedAt.toISOString() }));
  }
  if (subjectType === "chat_message") {
    const rows = await db
      .select({ userId: chatMessageReports.reporterUserId, name: users.displayName, reason: chatMessageReports.reason, reportedAt: chatMessageReports.createdAt })
      .from(chatMessageReports)
      .innerJoin(users, eq(users.id, chatMessageReports.reporterUserId))
      .where(eq(chatMessageReports.messageId, Number(subjectId)))
      .orderBy(asc(chatMessageReports.createdAt));
    return rows.map((row) => ({ userId: row.userId, name: row.name, reason: row.reason, reportedAt: row.reportedAt.toISOString() }));
  }
  return [];
}

/** `trailFor`'s own return — the events to render, and (Task 6's trade branch only) the actor
 *  names `flagTrailRowFor` needs to say "Alice offered this trade." instead of a bare id. Every
 *  other branch answers an empty map, matching `flagTrailRowFor`'s own default parameter. */
interface TrailResult {
  readonly events: readonly AuditEvent[];
  readonly actorNames: ReadonlyMap<string, string>;
}

/** The three event types a trade's own lifecycle can ever put on its league chain — the *"full
 *  propose → accept audit sequence for that trade"* the spec asks for by name. `trade_rejected`
 *  is deliberately absent: a flag only ever names an ACCEPTED trade, and a trade that was rejected
 *  never reaches acceptance to be valued at all. */
const TRADE_TRAIL_EVENT_TYPES: readonly AuditEventType[] = ["trade_proposed", "trade_accepted", "roster_move"];

/**
 * The relevant audit trail. For MOST subject types, that is the PLATFORM chain's events about
 * this flag by id (`flag_raised`, `flag_resolved`, and `review_removed` when `content_removed`
 * reached it — all three carry `payload.flagId`), plus, for `account_pair`, that league's own
 * `member_joined` context for the two accounts named — the investigation an operator actually
 * needs.
 *
 * `trade` (Task 6) is one EXCEPTION, deliberately: it answers the league chain's own
 * propose/accept/roster-move sequence for this trade (`payload.tradeId`, never by actor — the
 * proposer and the accepter are two different people) and NOTHING from the platform chain. The
 * `flag_raised`/`flag_resolved` story is already told elsewhere on `FlagDetail` (`raisedAt`,
 * `resolution`) — the trade's own trail is the *"full propose → accept audit sequence for that
 * trade"* the spec asks for by name, not a merged timeline of both.
 *
 * `held_trade` (Plan D, Task 5) is the SECOND exception, and shares `trade`'s own league-chain
 * read (the SAME `TRADE_TRAIL_EVENT_TYPES`, filtered by the identical `payload.tradeId`) PLUS one
 * more: the PLATFORM chain's own `system_action` event for the hold itself (`payload.tradeId`,
 * `eventType = 'system_action'`) — the one platform-chain fact this trade's own trail needs, since
 * the hold never touched the league chain at all. `flagTrailRowFor` (`@/integrity/queue-view`) is
 * what turns that event into "The platform held this trade for a fairness review." Still never the
 * generic `flag_raised`/`flag_resolved` platform rows every OTHER subject type reads — those tell
 * the SAME story `FlagDetail.resolution` already does.
 *
 * Bounded at two queries for `trade` (the trail read plus its own batched actor-name lookup),
 * three for `held_trade` (one more for the hold's own `system_action` row), and two for
 * `account_pair` (the platform read plus the league read); one otherwise.
 */
async function trailFor(db: Db, flagId: string, leagueId: string | null, subjectType: FlagSubjectType, subjectId: string): Promise<TrailResult> {
  if (leagueId !== null && (subjectType === "trade" || subjectType === "held_trade")) {
    const tradeRows = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.chainScope, leagueId),
          sql`${auditEvents.payload} ->> 'tradeId' = ${subjectId}`,
          inArray(auditEvents.eventType, TRADE_TRAIL_EVENT_TYPES),
        ),
      )
      .orderBy(asc(auditEvents.occurredAt))
      .limit(INTEGRITY_CONFIG.queue.trailLimit);

    const holdRows =
      subjectType !== "held_trade"
        ? []
        : await db
            .select()
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.chainScope, INTEGRITY_CONFIG.chain.platformScope),
                eq(auditEvents.eventType, "system_action"),
                sql`${auditEvents.payload} ->> 'tradeId' = ${subjectId}`,
              ),
            )
            .orderBy(asc(auditEvents.occurredAt))
            .limit(INTEGRITY_CONFIG.queue.trailLimit);

    const combinedRows = [...tradeRows, ...holdRows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const actorIds = [...new Set(combinedRows.flatMap((row) => (row.actorId === null ? [] : [row.actorId])))];
    const nameRows = actorIds.length === 0 ? [] : await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, actorIds));

    return {
      events: combinedRows.map(toEvent),
      actorNames: new Map(nameRows.map((row) => [row.id, row.name])),
    };
  }

  const platformRows = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.chainScope, INTEGRITY_CONFIG.chain.platformScope), sql`${auditEvents.payload} ->> 'flagId' = ${flagId}`))
    .orderBy(asc(auditEvents.occurredAt));

  if (leagueId === null || subjectType !== "account_pair") return { events: platformRows.map(toEvent), actorNames: new Map() };

  const actorIds = subjectId.split(PAIR_ID_SEPARATOR).filter((id) => id.length > 0);
  const leagueRows =
    actorIds.length === 0
      ? []
      : await db
          .select()
          .from(auditEvents)
          .where(and(eq(auditEvents.chainScope, leagueId), inArray(auditEvents.actorId, actorIds)))
          .orderBy(asc(auditEvents.occurredAt))
          .limit(INTEGRITY_CONFIG.queue.trailLimit);

  return {
    events: [...platformRows.map(toEvent), ...leagueRows.map(toEvent)].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    actorNames: new Map(),
  };
}

/**
 * The resolving operator's own display name — fix round 1, FIX 5: the detail page needs to say
 * WHO decided, not just render a bare "already resolved" sentence. A single query, run only
 * when a flag actually IS resolved (`flagDetail`'s own caller already knows `resolvedByUserId`
 * is non-null by the time this is called).
 *
 * No fallback, unlike `subjectFor`/`aboutFor`'s "a former member": `integrity_flags.
 * resolved_by_user_id` carries a REAL foreign key onto `users.id` (`references(() => users.id)`,
 * no `onDelete`, so Postgres refuses either write — the flag's own stamp `UPDATE`, or a later
 * `DELETE FROM users` — the moment the other would leave this column dangling). A missing row
 * here is not a rare edge case to degrade gracefully from; it is a constraint violation that
 * would already have stopped the write that tried to produce it. `row!.name` says that plainly
 * rather than writing a fallback branch no test could ever legitimately reach.
 */
async function resolverNameFor(db: Db, resolvedByUserId: string): Promise<string> {
  const [row] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, resolvedByUserId));
  return row!.name;
}

/**
 * The detail read: one flag, its subject, its reporters and its relevant audit trail — bounded
 * at exactly FIVE queries for an OPEN, non-trade flag regardless of how much history either
 * chain holds: the flag row itself, `subjectFor` (one), `reportersFor` (one), and `trailFor`'s
 * own two. An OPEN TRADE flag costs one query more (`subjectFor`'s own `tradePlayersHaveMovedAgain`
 * read, fix round 1, LOW — skipped entirely once the trade is already reversed) — six. A RESOLVED
 * flag of either shape costs one query more still (`resolverNameFor`, sequenced after the batch
 * since it only runs once `resolution` is known non-null) — six or seven total. `flags.test.ts`
 * asserts these bounds with `countingDb`.
 *
 * Returns `null` for a flag id that names nothing — the route (`GET`-equivalent Server Component
 * per Task 5's brief) turns that into `notFound()`, never a 403 or a 500.
 */
export async function flagDetail(db: Db, flagId: string): Promise<FlagDetail | null> {
  const [flagRow] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flagId));
  if (flagRow === undefined) return null;

  const subjectType = flagRow.subjectType as FlagSubjectType;
  const [subject, reporters, trailResult] = await Promise.all([
    subjectFor(db, subjectType, flagRow.subjectId, flagRow.evidence),
    reportersFor(db, subjectType, flagRow.subjectId),
    trailFor(db, flagRow.id, flagRow.leagueId, subjectType, flagRow.subjectId),
  ]);

  const trail = trailResult.events
    .map((event) => flagTrailRowFor(event, trailResult.actorNames))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  // `resolveFlag`'s stamp UPDATE sets `resolved_at`, `resolved_by_user_id`, `resolution` and
  // `resolution_note` together, in the one statement — a row where the first three are non-null
  // but `resolution_note` is somehow still null cannot come from that write, so it is folded
  // into the same "not resolved" guard rather than given its own fallback (`?? ""`) to defend a
  // state this table's one writer cannot produce.
  const resolution =
    flagRow.resolvedAt === null || flagRow.resolvedByUserId === null || flagRow.resolution === null || flagRow.resolutionNote === null
      ? null
      : {
          decision: flagRow.resolution as ResolutionDecision,
          note: flagRow.resolutionNote,
          resolvedAt: flagRow.resolvedAt.toISOString(),
          resolvedByUserId: flagRow.resolvedByUserId,
          resolvedByName: await resolverNameFor(db, flagRow.resolvedByUserId),
        };

  return flagDetailFor(
    { id: flagRow.id, flagType: flagRow.flagType as FlagType, raisedAt: flagRow.raisedAt.toISOString(), leagueId: flagRow.leagueId, evidence: flagRow.evidence, resolution },
    subject,
    reporters,
    trail,
  );
}
