import type { IconName } from "@/components/ui/icon";
import type { AuditEvent, JsonObject } from "@/domain/audit";
import { decisionIsAvailable, RESOLUTION_DECISIONS, type FlagType, type ResolutionDecision } from "@/integrity/flags";
import type { ActivityRow } from "@/integrity/activity-view";

/**
 * What an operator sees. The deliberate opposite number of `activity-view.ts`, which decides what
 * a MEMBER sees, and the reason the spec's exit criterion is provable: two named modules with two
 * field sets over the same underlying rows, rather than two page renders to scrape.
 *
 * The asymmetry is the product. `evidence` carries the raw similarity scores that raised a
 * multi-account flag, and no path exists from an audit event to a member-facing row that could
 * carry them: `flag_raised` is platform-chain-scoped, so `listLeagueActivity` never reads it at
 * all, and `ACTIVITY_VISIBILITY.flag_raised` is `hidden` besides. Two independent reasons, because
 * one of them is a one-line change away from being wrong.
 */
export interface FlagDetail {
  readonly flagId: string;
  readonly flagType: FlagType;
  readonly raisedAt: string;
  /** Where it happened, if anywhere — `null` for a `review_report`/`chat_report` flag (ruling 1:
   *  those subjects are platform-scoped, not league-scoped). The page's own lookup for the
   *  notice-preview's league name, and nothing else — never a chain scope (see `integrity_flags`'
   *  own docblock). */
  readonly leagueId: string | null;
  readonly subject: FlagSubjectView; // the reported content, or the account pair
  readonly evidence: JsonObject; // raw. admin-only. never leaves this module's consumers
  readonly reporters: readonly ReporterView[]; // derived at read time (ruling 5)
  readonly trail: readonly ActivityRow[]; // the relevant audit sequence
  /** `null` while open. Once resolved, `decisions` is empty — the record is the `flag_resolved`
   *  audit event on `trail`, not a second attempt this page could offer. */
  readonly resolution: FlagResolutionView | null;
  readonly decisions: readonly ResolutionDecision[]; // only those decisionIsAvailable() allows, and only while open
}

/**
 * The decision already recorded, for a flag `flagDetail` finds already resolved — fix round 1,
 * FIX 5: the detail page used to render a bare "This flag is already resolved." sentence with no
 * way for an operator to see what happened, or who decided it, without leaving the page for the
 * trail's own headline. `resolvedByName` is resolved at read time (ruling 5) rather than making a
 * caller resolve `resolvedByUserId` a second time — `resolvedByUserId` stays on the shape too,
 * for the same "keep the id alongside the derived name" provenance discipline `ReporterView`
 * already follows.
 */
export interface FlagResolutionView {
  readonly decision: ResolutionDecision;
  readonly note: string;
  readonly resolvedAt: string;
  readonly resolvedByUserId: string;
  readonly resolvedByName: string;
}

/**
 * The reported content, or the account pair, as an operator needs to see it — one shape per
 * `FlagSubjectType` (`@/integrity/flags`), never a JSON blob the page has to interpret. A subject
 * whose row is gone by the time an operator looks (a deleted account, a review row this plan
 * never deletes but a future one might) still renders an honest sentence rather than a crash —
 * the same "a former member" discipline `activity-view.ts`'s `buildActivityNames` uses.
 */
export type FlagSubjectView =
  | { readonly kind: "review"; readonly reviewId: string; readonly body: string; readonly authorName: string; readonly removedAt: string | null }
  | { readonly kind: "chat_message"; readonly messageId: string; readonly body: string | null; readonly authorName: string; readonly removedAt: string | null }
  | { readonly kind: "account_pair"; readonly userIds: readonly [string, string]; readonly names: readonly [string, string] }
  | { readonly kind: "trade"; readonly tradeId: string };

/**
 * Whether this subject's content is ALREADY gone — non-null `removed_at` on the row behind it.
 *
 * Final review, MEDIUM 8: a member can report a tombstoned message (`reportMessage` checks
 * existence and league, never `removed_at IS NULL`, and the open-subject unique index only
 * dedupes OPEN flags — both correct: a fresh report of already-removed content is a real
 * question, and the operator may still want to warn). The detail page was then offering
 * `content_removed` on it, which `removeChatMessageInTx`'s no-re-stamp guard refuses with a 409
 * and a full rollback, leaving the flag permanently unresolvable by the decision the UI offered.
 * The page reads this to show the removed state and to withhold that one decision.
 */
export function subjectIsRemoved(subject: FlagSubjectView): boolean {
  return (subject.kind === "review" || subject.kind === "chat_message") && subject.removedAt !== null;
}

/** One reporter's own account of it — who, why, and when. Derived at read time from
 *  `review_reports` (ruling 5): this row is never stored on the flag itself. */
export interface ReporterView {
  readonly userId: string;
  readonly name: string;
  readonly reason: string;
  readonly reportedAt: string;
}

/** One line of the queue list — never the raw row, and never `evidence`. */
export interface QueueRow {
  readonly flagId: string;
  readonly icon: IconName;
  /** What kind of question this is, in plain words — "A member reported a message" — never a
   *  severity label (ruling 30: there is no severity in this queue at all). */
  readonly question: string;
  /** Who or what it is about, resolved at read time from the subject. */
  readonly about: string;
  readonly raisedAt: string;
}

/**
 * One entry per `FlagType`, exhaustive by the same `Record` discipline `ACTIVITY_VISIBILITY`
 * uses: a flag type declared without a question here is a compile error, not a queue row that
 * silently renders "undefined". Never a severity word — ruling 30 is that a severity ordering
 * over a heuristic score is the platform quietly telling an operator which accusations to
 * believe, and a severity WORD in the row's own copy would smuggle the same judgment back in.
 */
const QUESTION_FOR_FLAG_TYPE: Readonly<Record<FlagType, string>> = {
  multi_account: "The platform flagged two accounts that may be the same person",
  review_report: "A member reported a review",
  chat_report: "A member reported a message",
  trade_fairness: "The platform flagged a trade for a fairness review",
};

const ICON_FOR_FLAG_TYPE: Readonly<Record<FlagType, IconName>> = {
  multi_account: "users",
  review_report: "alert-triangle",
  chat_report: "alert-triangle",
  trade_fairness: "refresh-cw",
};

export interface QueueRowInput {
  readonly flagId: string;
  readonly flagType: FlagType;
  readonly raisedAt: string;
  /** Resolved at read time by the caller (`listPendingFlags`, batched — never per-row). */
  readonly about: string;
}

/** Pure: `listPendingFlags` (`@/integrity-service/flags`) is the only caller, and it does every
 *  lookup `about` needed before calling this. */
export function queueRowFor(input: QueueRowInput): QueueRow {
  return {
    flagId: input.flagId,
    icon: ICON_FOR_FLAG_TYPE[input.flagType],
    question: QUESTION_FOR_FLAG_TYPE[input.flagType],
    about: input.about,
    raisedAt: input.raisedAt,
  };
}

/** What `flagDetail` (`@/integrity-service/flags`) has already fetched about the flag row
 *  itself, before this module decides how to show it. */
export interface FlagDetailInput {
  readonly id: string;
  readonly flagType: FlagType;
  readonly raisedAt: string;
  readonly leagueId: string | null;
  readonly evidence: JsonObject;
  readonly resolution: FlagResolutionView | null;
}

/**
 * Pure. `flagDetail` fetches the flag row, the subject, the reporters and the trail; this
 * function decides the shape an operator reads them in. `decisions` is `RESOLUTION_DECISIONS`
 * narrowed by `decisionIsAvailable` — an operator is never offered a decision this product
 * cannot carry out (`trade_reversed`, reserved for Plan C), the same refusal `resolveFlag` itself
 * enforces at the write.
 */
export function flagDetailFor(
  flag: FlagDetailInput,
  subject: FlagSubjectView,
  reporters: readonly ReporterView[],
  trail: readonly ActivityRow[],
): FlagDetail {
  return {
    flagId: flag.id,
    flagType: flag.flagType,
    raisedAt: flag.raisedAt,
    leagueId: flag.leagueId,
    subject,
    evidence: flag.evidence,
    reporters,
    trail,
    resolution: flag.resolution,
    // An already-resolved flag offers no decision at all: the record is the `flag_resolved`
    // event on `trail`, not a second attempt this page could invite.
    decisions: flag.resolution === null ? RESOLUTION_DECISIONS.filter(decisionIsAvailable) : [],
  };
}

function payloadStr(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * The verb phrase an operator reads for each decision — "closed this flag with no action",
 * "sent the member a warning". Exhaustive over every declared `ResolutionDecision` for the same
 * "cannot silently fall through" reason `resolveFlag`'s own `DECISION_LABEL` is. Exported (fix
 * round 1, FIX 5): the trail (`flagTrailRowFor`, below) and the detail page's own already-
 * resolved summary both read the same decision as the same words — "an operator {phrase}" in the
 * trail, "{name} {phrase} on {date}" in the resolution summary — so there is exactly one place
 * that phrasing is decided, not two copies that could drift.
 */
export const DECISION_PHRASE: Readonly<Record<ResolutionDecision, string>> = {
  no_action: "closed this flag with no action",
  warned_user: "sent the member a warning",
  content_removed: "removed the reported content",
  trade_reversed: "reversed the trade",
};

function isResolutionDecision(value: string): value is ResolutionDecision {
  return (RESOLUTION_DECISIONS as readonly string[]).includes(value);
}

/**
 * The operator-facing rendering of ONE audit event on this flag's trail — `flag_raised`,
 * `flag_resolved`, `review_removed` and the `member_joined` context an account-pair investigation
 * pulls from the league chain. Deliberately its OWN switch rather than a call into
 * `activity-view.ts`'s `renderPayload`: those types are all `"hidden"` in `ACTIVITY_VISIBILITY`
 * (or, for `member_joined`, rendered in the MEMBER's voice, "X joined the league" without the
 * operator framing this trail needs), so reusing that renderer would mean teaching it about an
 * audience it must never serve.
 *
 * Returns `null` for anything this trail does not know how to explain — deny-by-default, the same
 * guarantee `activityRowFor`'s own unreachable `default` case documents.
 */
export function flagTrailRowFor(event: AuditEvent): ActivityRow | null {
  if (event.eventType === "flag_raised") {
    return { eventId: event.eventId, occurredAt: event.occurredAt, icon: "alert-triangle", headline: "This flag was opened.", detail: null };
  }
  if (event.eventType === "flag_resolved") {
    const decision = payloadStr(event.payload, "decision");
    const phrase = decision !== undefined && isResolutionDecision(decision) ? DECISION_PHRASE[decision] : "resolved this flag";
    return { eventId: event.eventId, occurredAt: event.occurredAt, icon: "check", headline: `An operator ${phrase}.`, detail: null };
  }
  if (event.eventType === "review_removed") {
    return { eventId: event.eventId, occurredAt: event.occurredAt, icon: "x", headline: "The reported review was removed.", detail: null };
  }
  if (event.eventType === "member_joined") {
    return { eventId: event.eventId, occurredAt: event.occurredAt, icon: "users", headline: "This account joined the league.", detail: null };
  }
  return null;
}

/**
 * The queue's own pagination cursor — a timestamp AND the id of the row it belongs to, the same
 * two-field shape `ReviewCursor` (`@/reviews/cursor`) uses and for the identical reason: `raised_
 * at` alone is not unique (two flags can be raised in the same millisecond), so `pendingFlagQuery`
 * orders and pages by `(raised_at, id)` as a total ordering, and the cursor has to carry both
 * halves of it or the boundary could silently drop a row. Defined here, not in `@/integrity-
 * service/flags` (the query's own home), because it is wire vocabulary a page's `searchParams`
 * decodes — pure, no I/O, same reasoning that keeps `ReviewCursor` out of `@/review-service`.
 */
export interface FlagCursor {
  readonly raisedAt: string;
  readonly id: string;
}

const CURSOR_SEPARATOR = "|";
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The opaque `?before=` value `listPendingFlags`' own `nextBefore` hands a page. */
export function formatFlagCursor(cursor: FlagCursor): string {
  return `${cursor.raisedAt}${CURSOR_SEPARATOR}${cursor.id}`;
}

/**
 * The parsed cursor, or `null` for anything the queue did not itself hand out — a hand-edited
 * query string or garbage. The page turns `null` into "no cursor" (the newest, i.e. oldest-first
 * FIRST, page) rather than passing it through to the query — the same "untrusted query param,
 * fails closed to no-cursor" discipline the league activity page's own `parseBefore` uses.
 */
export function parseFlagCursor(raw: string): FlagCursor | null {
  const separatorAt = raw.indexOf(CURSOR_SEPARATOR);
  if (separatorAt <= 0) return null;

  const raisedAt = raw.slice(0, separatorAt);
  const id = raw.slice(separatorAt + 1);
  if (id === "" || !ISO_INSTANT.test(raisedAt) || Number.isNaN(Date.parse(raisedAt))) return null;
  return { raisedAt, id };
}
