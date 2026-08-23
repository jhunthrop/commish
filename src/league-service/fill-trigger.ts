import { and, eq } from "drizzle-orm";
import type { DbTx } from "@/db/client";
import { drafts, leagues, memberNotices, teams } from "@/db/schema";
import { formatClockLength, MS_PER_SECOND } from "@/domain/duration";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import type { NoticeContexts } from "@/integrity/notices";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { hasOpenSeat } from "@/matchmaking/filter";

/**
 * The two shapes `fireWhenFullInTx`'s own house/member branch can send, PAIRED — `noticeType` and
 * `context` can never mismatch, because this is a union of two fully-known object types rather
 * than `{ noticeType: NoticeType; context: NoticeContexts[NoticeType] }` (which would let a
 * `house_league_filled` type carry a `draft_fill_triggered` context and vice versa). Fix round 1
 * (F3): a single `notifyAffectedMember` call site, spreading one of these into its input, type-
 * checks WITHOUT a cast — TypeScript matches each union member against `NotifyInput<T>`
 * separately, so `T` infers correctly per branch rather than widening to the bare `NoticeType`
 * union a naive single shape would. Verified by deliberately mismatching the two fields once
 * during review and confirming `tsc` refuses it.
 */
type FillNoticeInput =
  | { readonly noticeType: "house_league_filled"; readonly context: NoticeContexts["house_league_filled"] }
  | { readonly noticeType: "draft_fill_triggered"; readonly context: NoticeContexts["draft_fill_triggered"] };

/**
 * The league-wide sentence `draft_fill_triggered`'s `system_action` carries.
 * `SYSTEM_ACTION_VISIBILITY.draft_fill_triggered` (`@/integrity/system-actions`) is `"everyone"`,
 * on `DRAFT_AUTO_STARTED_SUMMARY`'s (`@/draft-service/store`) own reasoning: a fact about the
 * league's shared calendar, true for everyone in it, about nobody's conduct.
 */
export const DRAFT_FILL_TRIGGERED_SUMMARY = "The league filled up, so we set its draft to start soon.";

/**
 * Every reason `fireWhenFullInTx` declines to act, named once so the function and its tests never
 * hand-type a second copy of the same sentence. None of these reach a member directly — this
 * trigger has no human caller, unlike `KICKOFF_REFUSALS` or `ENFORCEMENT_REFUSALS` — but a test
 * asserting "it did nothing, and here is exactly why" reads better than a bare boolean, and a log
 * line reads better than one too.
 */
export const FILL_TRIGGER_REFUSALS = {
  /** No `drafts` row for this league, or its `start_trigger` isn't `'when_full'` — a scheduled
   *  draft's time is a time twelve people planned around, and filling early is not consent to
   *  move it (the one behavior that separates the two triggers). */
  notWhenFull: "This draft's kickoff is set by hand, not by the league filling.",
  /** The league genuinely has an open seat left — `hasOpenSeat`'s own answer, re-derived here
   *  rather than trusted from the caller. */
  notFull: "This league still has an open seat.",
  /** The draft has already left `'scheduled'` — nothing about a kickoff is left to set. */
  alreadyStarted: "This draft has already started.",
  /** A `draft_fill_triggered` notice already exists for this league — this call is a repeat,
   *  structurally impossible through `joinLeagueInTx` alone (a full league refuses every further
   *  join before it ever reaches this function again) but real for any other caller. */
  alreadyFired: "This league already fired its fill trigger.",
} as const;

export type FireWhenFullOutcome =
  | { readonly fired: true; readonly kickoffAt: string }
  | { readonly fired: false; readonly reason: string };

/**
 * "A league whose draft fires the moment the last seat fills" — a time, not a button. One write,
 * `drafts.kickoff_at`, moved to `now + MATCHMAKING_CONFIG.sitAndGo.graceSeconds`; the auto-start
 * machinery that already scans `drafts` for a passed `kickoff_at` (`dueDraftsQuery`,
 * `autoStartDueDrafts`, `@/draft-service/auto-start`) does the rest. There is no second start
 * path: a sit-and-go draft starts through the identical `autoStartDueDrafts` -> `claimAutoStart`
 * -> `store.startDraft({ auto: true })` chain a commissioner-scheduled draft does, the only
 * difference being who wrote `kickoff_at` and why.
 *
 * RUNS INSIDE `joinLeagueInTx` (`./join`), called unconditionally after every seat this codebase
 * ever seats — never a second call keyed to "was this the last seat", because that question is
 * exactly what this function answers for itself. `joinLeagueInTx` already holds `leagues FOR
 * UPDATE` before it ever inserts a team and has already counted the seats once, for its own
 * capacity check; this function re-derives fullness itself (`hasOpenSeat`, the SAME predicate)
 * rather than trusting a boolean the caller computed a moment earlier, because this file's own
 * tests call it directly, outside that caller entirely, and a function callable on its own must be
 * correct on its own.
 *
 * BOTH DOORS, FOR FREE. An invite accept and a public browse join both call `joinLeagueInTx`
 * (`acceptInvite` and `joinPublicLeague`, `./invites` and `./join`), and neither door knows this
 * function exists — it fires the same way whichever door seats the last member, because it lives
 * in the one place both doors already pass through.
 *
 * SIT-AND-GO IS PUBLIC-MATCHMADE ONLY, but this function never reads `isPublicMatchmade` — it
 * reads `drafts.start_trigger` instead, which `createLeagueSchema` (`./schemas`) already refuses
 * to set to `'when_full'` on anything but a public league (Step 5). A private league can therefore
 * never reach `'when_full'` in the first place; asking the same question twice, from two different
 * data sources, is how the two answers eventually disagree — the same reasoning `dueDraftsQuery`
 * (`@/draft-service/auto-start`) already follows by joining `leagues` rather than trusting a second
 * flag.
 *
 * EXACTLY ONCE, by construction and by a dedicated check. Construction: once a league is full,
 * `joinLeagueInTx`'s own capacity check refuses every further join before it ever reaches an
 * insert, so in ordinary use this function is invoked with a truly-just-filled league at most
 * once, ever. The dedicated check exists anyway, for a caller outside that guarantee: before
 * writing anything, it looks for an existing `draft_fill_triggered` notice on this league — the
 * same "read before you write, so a repeat asks for nothing twice" discipline
 * `recordTierBlockedJoin` (`./join`) already uses for an unrelated repeat. Found, it refuses
 * without writing kickoff, notice or audit event; not found, this call owns the fire.
 * NO-WRITE-BEFORE-REFUSAL holds throughout: every refusal branch below returns before the
 * `UPDATE` is ever reached.
 *
 * FK ACQUISITIONS, ENUMERATED (binding controller ruling, Plan C's H2 lesson: a lock-order review
 * must enumerate foreign keys). `UPDATE drafts SET kickoff_at` takes the draft row's own lock plus
 * an implicit `FOR KEY SHARE` on `leagues` (the `drafts.league_id` FK) — already held `FOR UPDATE`
 * by the caller (`joinLeagueInTx`). That draft-row lock IS a real edge, `leagues -> drafts`, and
 * naming it is what the final whole-branch review's F1 turned on: it is the direction the WHOLE
 * BRANCH now orders on (`setDraftKickoff` and `applyAction` both take the league row before the
 * draft row), and this call site is the reason that direction, not the other one, is the rule.
 * `joinLeagueInTx` now runs this function ABOVE its own `member_joined` append, so every one of
 * these acquisitions precedes the anchor rather than following it. The
 * `member_notices` inserts that follow take the identical `leagues`/`users` `FOR KEY SHARE` every
 * other notice writer in this codebase already takes (`notifyAffectedMember`'s own docblock) —
 * `leagues` already held, and no caller anywhere in this codebase takes a `users` row `FOR UPDATE`
 * (see `recordSessionSignals`' own proof, `src/integrity-service/lock-order.test.ts`). The audit
 * anchor (`audit.record`) is written last, per ruling 3 — business writes, then notices, then the
 * anchor.
 */
export async function fireWhenFullInTx(
  tx: DbTx,
  leagueId: string,
  nowIso: string,
  audit: AuditLogger = getAuditLogger(),
): Promise<FireWhenFullOutcome> {
  const [row] = await tx
    .select({
      draftId: drafts.id,
      status: drafts.status,
      startTrigger: drafts.startTrigger,
      teamCount: leagues.teamCount,
      leagueName: leagues.name,
      houseRung: leagues.houseRung,
    })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(eq(drafts.leagueId, leagueId));
  if (row === undefined || row.startTrigger !== "when_full") {
    return { fired: false, reason: FILL_TRIGGER_REFUSALS.notWhenFull };
  }
  if (row.status !== "scheduled") {
    return { fired: false, reason: FILL_TRIGGER_REFUSALS.alreadyStarted };
  }

  const seated = await tx.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, leagueId));
  if (hasOpenSeat({ teamCount: row.teamCount, filledTeams: seated.length })) {
    return { fired: false, reason: FILL_TRIGGER_REFUSALS.notFull };
  }

  // Phase 3.5 addendum, Task 14, Step 4: a HOUSE league's members get `house_league_filled`
  // instead of `draft_fill_triggered` — the one sentence a house league can say that a
  // member-run one cannot (the shelf refills itself). The two never both fire for the same
  // league (below), so the dedup check reads whichever type THIS call would actually write.
  const isHouse = row.houseRung !== null;
  const noticeType = isHouse ? "house_league_filled" : "draft_fill_triggered";
  const [alreadyFired] = await tx
    .select({ id: memberNotices.id })
    .from(memberNotices)
    .where(and(eq(memberNotices.leagueId, leagueId), eq(memberNotices.noticeType, noticeType)))
    .limit(1);
  if (alreadyFired !== undefined) {
    return { fired: false, reason: FILL_TRIGGER_REFUSALS.alreadyFired };
  }

  const kickoffAt = new Date(Date.parse(nowIso) + MATCHMAKING_CONFIG.sitAndGo.graceSeconds * MS_PER_SECOND);
  await tx.update(drafts).set({ kickoffAt }).where(eq(drafts.id, row.draftId));

  // `SYSTEM_ACTION_VISIBILITY.draft_fill_triggered` is `"everyone"`, so this sends ONE notice per
  // TEAM in the league, all referencing the SAME `system_action` event — the identical
  // one-event-many-notices shape `startDraft`'s own auto-start announcement uses
  // (`@/draft-service/store`). The audit event's own `action` stays `draft_fill_triggered`
  // regardless of `isHouse` — it is still the identical fact about the league's shared calendar
  // either way, and `SYSTEM_ACTION_CODES` gains no second code for a distinction that only ever
  // shows up in the PERSONAL notice's own wording.
  const graceLabel = formatClockLength(MATCHMAKING_CONFIG.sitAndGo.graceSeconds);
  // `FillNoticeInput`'s own docblock: computed ONCE (it is loop-invariant), the union keeps
  // `noticeType` and `context` paired, so the single loop below cannot send a house league's
  // notice type with a member league's context or vice versa.
  const fillNotice: FillNoticeInput = isHouse
    ? { noticeType: "house_league_filled", context: { leagueName: row.leagueName } }
    : { noticeType: "draft_fill_triggered", context: { leagueName: row.leagueName, graceLabel } };
  const created: MemberNotice[] = [];
  for (const member of seated) {
    created.push(
      await notifyAffectedMember(tx, {
        leagueId,
        userId: member.userId,
        ...fillNotice,
        occurredAt: nowIso,
        auditEventId: null,
      }),
    );
  }
  const event = await audit.record(tx, {
    eventType: "system_action",
    actorId: null,
    actorType: "system",
    leagueId,
    payload: { action: "draft_fill_triggered", summary: DRAFT_FILL_TRIGGERED_SUMMARY },
    occurredAt: nowIso,
  });
  for (const notice of created) await attachAuditEvent(tx, notice, event.eventId);

  return { fired: true, kickoffAt: kickoffAt.toISOString() };
}
