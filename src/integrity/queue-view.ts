import type { IconName } from "@/components/ui/icon";
import type { AuditEvent, JsonObject } from "@/domain/audit";
import type { Position } from "@/domain/player";
import { decisionIsWiredFor, RESOLUTION_DECISIONS, type FlagType, type ResolutionDecision, type TradeFairnessBasis } from "@/integrity/flags";
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
 *
 * A NOTE FOR WHOEVER RENDERS `evidence` (final review, MEDIUM 9): the `device` score is derived
 * from two SELF-REPORTED headers (`User-Agent` and `Accept-Language`), so a high one is evidence
 * that two accounts SAID the same thing about themselves, not that the platform observed the same
 * device. It can be aimed: an attacker who knows a victim's exact headers and shares a league with
 * them can manufacture a pair flag naming that victim. That is why this is a flag and never an
 * action, and why an operator reads it beside the join dates and the other signals rather than as
 * a verdict. See `operators-and-moderation.md` §11.
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
  readonly decisions: readonly ResolutionDecision[]; // only those decisionIsWiredFor(d, subject.kind) allows, and only while open
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
/**
 * One traded player, as the detector valued it — the HISTORICAL number, not a live one. `Task 6`'s
 * `raiseTradeFairnessFlag` (`@/integrity-service/trade-fairness`) writes this into the flag's own
 * `evidence` once, at raise time, and `subjectFor` (`@/integrity-service/flags`) reads it back
 * from there rather than re-deriving it — the session data it was computed from will have moved
 * on by the time an operator looks (Plan B ruling 5), and that applies to a player's own form
 * exactly as it does to the multi-account signals that ruling was written for.
 */
export interface TradedPlayerView {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position | null;
  /** Points per week, at the week the trade was valued — never re-priced at read time. */
  readonly averagePoints: number;
}

export type FlagSubjectView =
  | { readonly kind: "review"; readonly reviewId: string; readonly body: string; readonly authorName: string; readonly removedAt: string | null }
  | { readonly kind: "chat_message"; readonly messageId: string; readonly body: string | null; readonly authorName: string; readonly removedAt: string | null }
  | { readonly kind: "account_pair"; readonly userIds: readonly [string, string]; readonly names: readonly [string, string] }
  | {
      readonly kind: "trade";
      readonly tradeId: string;
      readonly proposerTeamName: string;
      readonly counterpartyTeamName: string;
      readonly gave: readonly TradedPlayerView[];
      readonly got: readonly TradedPlayerView[];
      readonly acceptedAt: string;
      /** Non-null once an operator has already undone it. The detail page reads this to withhold
       *  `trade_reversed` from a trade that is already reversed, the same way `subjectIsRemoved`
       *  withholds `content_removed` from a message already gone (Plan B, MEDIUM 8) — see
       *  `subjectIsAlreadyReversed` below. Set by `reverseTradeInTx`'s own guarded UPDATE
       *  (`@/league-service/trade-reversal`), never rewound: a reversal is forward-only history. */
      readonly reversedAt: string | null;
      /**
       * Task 6 fix round 1 (review MEDIUM 1). Plain words for how `gave`/`got` were priced —
       * `tradeFairnessBasisPhrase`'s own output, computed once by `subjectFor`
       * (`@/integrity-service/flags`) from the flag's stored `evidence.basis` so the operator
       * reads a sentence, never a raw enum. Always a real sentence, even for a flag that predates
       * basis tracking — `tradeFairnessBasisPhrase(null)` answers that honestly rather than
       * leaving this field empty.
       */
      readonly valuationBasis: string;
      /**
       * Fix round 1 (LOW, M8 discipline). Whether a traded player has left the roster the trade
       * put him on since it was accepted — precomputed at READ time by `subjectFor`
       * (`@/integrity-service/flags`, `tradePlayersHaveMovedAgain`), the SAME ownership check
       * `reverseTradeInTx`'s own STEP 4 makes, so the two can never quietly disagree. The detail
       * page reads this to withhold `trade_reversed` with an explanation instead of letting an
       * operator click into a 409 — the same "never offer a decision that will refuse" discipline
       * `subjectIsRemoved`/`subjectIsAlreadyReversed` already hold `content_removed`/
       * `trade_reversed` to. Always `false` once `reversedAt` is set (a reversed trade withholds
       * the decision for a different reason, and this read is skipped rather than wasted).
       * A PREVIEW, not a guarantee: a write can still land between this read and the operator's
       * click, and `reverseTradeInTx`'s own check stays the authoritative one either way.
       */
      readonly playersMovedAgain: boolean;
    };

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

/**
 * Whether this trade has ALREADY been put back — `subjectIsRemoved`'s own twin for Task 7.
 * `resolveFlag`/`reverseTradeInTx` refuse a second reversal with a 409 (the guard lives in the
 * reversal's own guarded `UPDATE`), but an operator should never be OFFERED the decision in the
 * first place once the answer is already known from the row this page already has in hand — the
 * same "never offer a decision that will refuse" discipline `subjectIsRemoved` established.
 */
export function subjectIsAlreadyReversed(subject: FlagSubjectView): boolean {
  return subject.kind === "trade" && subject.reversedAt !== null;
}

/**
 * Fix round 1 (LOW, M8 discipline). Whether a traded player has moved on since — `subject.
 * playersMovedAgain`'s own honest read, narrowed to the `trade` kind. `subjectIsAlreadyReversed`'s
 * own twin for the SECOND way a reversal can refuse: not because the trade already happened, but
 * because the world moved on since. Both withhold `trade_reversed` for the same "never offer a
 * decision that will refuse" reason.
 */
export function subjectPlayersMovedAgain(subject: FlagSubjectView): boolean {
  return subject.kind === "trade" && subject.playersMovedAgain;
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
 * function decides the shape an operator reads them in. `decisions` narrows on the SUBJECT, not
 * on availability alone (Task 7) — `RESOLUTION_DECISIONS` filtered by `decisionIsWiredFor(d,
 * subject.kind)`, which is what stops the detail page ever offering a trade reversal on a chat
 * report, the same refusal `resolveFlag` itself enforces at the write. `trade_reversed` is
 * withheld TWO further ways on top of that, both the same "never offer a decision that will
 * refuse" discipline `subjectIsRemoved` already holds `content_removed` to: a trade already put
 * back (`subjectIsAlreadyReversed`) never offers a second one, and a trade whose players have
 * moved on since (`subjectPlayersMovedAgain`, fix round 1) never offers one that would 409 on
 * submit.
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
    decisions:
      flag.resolution === null
        ? RESOLUTION_DECISIONS.filter(
            (decision) =>
              decisionIsWiredFor(decision, subject.kind) &&
              (decision !== "trade_reversed" || (!subjectIsAlreadyReversed(subject) && !subjectPlayersMovedAgain(subject))),
          )
        : [],
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
 * The plain-language restatement of `TradeFairnessBasis` (`@/integrity/flags`) an operator reads
 * on a trade flag's detail — Task 6 fix round 1 (review MEDIUM 1). Active voice, no em dashes,
 * the same house style `DECISION_PHRASE`'s own sentences keep. Exhaustive over both declared
 * bases, so a third one added later fails to compile here rather than rendering silently blank.
 *
 * Plan B's historical-vs-live framing, made explicit for the third time this plan needs it
 * (`TradedPlayerView`'s own docblock is the first, `subjectIsRemoved`'s the second): a number an
 * operator reads here was true WHEN IT WAS COMPUTED, and this is what tells them when that was.
 */
export const TRADE_FAIRNESS_BASIS_PHRASE: Readonly<Record<TradeFairnessBasis, string>> = {
  accept_evaluation: "The platform valued this trade the moment it was accepted.",
  sweep_rederivation: "The fairness sweep valued this trade later, from the rosters as they stood when it ran.",
};

/**
 * `TRADE_FAIRNESS_BASIS_PHRASE[basis]`, with an honest fallback for `null` — a flag raised before
 * this field existed on `evidence` at all. `subjectFor` (`@/integrity-service/flags`) is the one
 * caller, and it passes `null` rather than guessing one of the two real bases for a row that
 * simply predates them.
 */
export function tradeFairnessBasisPhrase(basis: TradeFairnessBasis | null): string {
  return basis === null ? "This flag predates valuation-basis tracking, so the method isn't recorded." : TRADE_FAIRNESS_BASIS_PHRASE[basis];
}

/** An actor's own display name for the trail's voice — "Alice offered this trade.", never "You"
 *  or a bare id. `actorNames` is resolved once, batched, by the caller (`trailFor`,
 *  `@/integrity-service/flags`) — the same "resolved at read time, never per-row" discipline
 *  `aboutFor`'s own docblock states. `null` (a system actor) and an id the map has no entry for
 *  (a former member) both read the same honest fallback every other subject-view branch uses. */
function trailActorName(actorId: string | null, actorNames: ReadonlyMap<string, string>): string {
  if (actorId === null) return "A former member";
  return actorNames.get(actorId) ?? "A former member";
}

/**
 * The operator-facing rendering of ONE audit event on this flag's trail — `flag_raised`,
 * `flag_resolved`, `review_removed`, the `member_joined` context an account-pair investigation
 * pulls from the league chain, and (Task 6) the `trade_proposed` / `trade_accepted` /
 * `roster_move` sequence a trade-fairness flag's own trail pulls from that same league chain.
 * Deliberately its OWN switch rather than a call into `activity-view.ts`'s `renderPayload`: those
 * types are all `"hidden"` in `ACTIVITY_VISIBILITY` (or, for `member_joined`/`trade_accepted`/
 * `roster_move`, rendered in the MEMBER's voice — "X joined the league", "A and B completed a
 * trade" — without the operator framing this trail needs, and `trade_proposed` is `"hidden"`
 * outright), so reusing that renderer would mean teaching it about an audience it must never
 * serve.
 *
 * `actorNames` is the trade branch's own name lookup — every other branch ignores it, the same
 * way `member_joined` renders with no name at all today. Defaults to an empty map so every
 * existing single-argument call site (a `.map(flagTrailRowFor)` over a non-trade trail) is
 * unaffected; `trailFor`'s trade branch is the one caller that ever supplies a populated one.
 *
 * Returns `null` for anything this trail does not know how to explain — deny-by-default, the same
 * guarantee `activityRowFor`'s own unreachable `default` case documents. A `roster_move` whose own
 * `reason` isn't `"trade"` (a future `"trade_reversed"` entry, once that decision ships) denies
 * the same way rather than guess at a sentence this task does not own yet.
 */
export function flagTrailRowFor(event: AuditEvent, actorNames: ReadonlyMap<string, string> = new Map()): ActivityRow | null {
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
  if (event.eventType === "trade_proposed") {
    return {
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      icon: "refresh-cw",
      headline: `${trailActorName(event.actorId, actorNames)} offered this trade.`,
      detail: null,
    };
  }
  if (event.eventType === "trade_accepted") {
    return {
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      icon: "check",
      headline: `${trailActorName(event.actorId, actorNames)} accepted it.`,
      detail: null,
    };
  }
  if (event.eventType === "roster_move") {
    const reason = payloadStr(event.payload, "reason");
    if (reason === "trade") {
      return { eventId: event.eventId, occurredAt: event.occurredAt, icon: "refresh-cw", headline: "Two players changed teams.", detail: null };
    }
    // Task 7: `reverseTradeInTx`'s own compensating transfer, on the SAME league chain, with the
    // SAME event type — a reversal is a roster_move, not a second trade-typed event
    // (`AUDIT_EVENT_TYPES` is frozen). `payload.reason` is the honest spelling that tells the two
    // apart, the identical "one type, `payload.outcome` distinguishes" shape `trade_rejected`/
    // `trade_withdrawn` already share.
    if (reason === "trade_reversed") {
      return { eventId: event.eventId, occurredAt: event.occurredAt, icon: "refresh-cw", headline: "An operator put the trade back.", detail: null };
    }
    return null;
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
