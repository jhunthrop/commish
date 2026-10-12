import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db, DbTx } from "@research-ts/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { DRAFT_SERVICE_CONFIG } from "@/draft-service/config";
import { formatAbsoluteTime } from "@/league/terms";
import { describeStartTiming, nextKickoffAfter, ROLL_REFUSALS, roomIsFull, rollNoticeSentence, type StartTimingAuthority } from "@/matchmaking/roll";
import { ENFORCED_LEAGUE_SQL, enforcementIsSwitchedOn } from "./enforcement";

/**
 * The league-wide sentence `draft_kickoff_rolled`'s `system_action` carries.
 * `SYSTEM_ACTION_VISIBILITY.draft_kickoff_rolled` (`@/integrity/system-actions`) is `"everyone"`,
 * on `DRAFT_FILL_TRIGGERED_SUMMARY`'s (`./fill-trigger`) own reasoning: a fact about the league's
 * shared calendar, true for everyone in it, about nobody's conduct.
 */
export const DRAFT_KICKOFF_ROLLED_SUMMARY = "This draft's room was not full at its scheduled time, so we moved its kickoff.";

export interface RollOutcome {
  readonly draftId: string;
  readonly rolled: boolean;
  /** Present only when `rolled` is `true` — the ISO instant the kickoff moved to. */
  readonly kickoffAt?: string;
  /** Present only when `rolled` is `true` — the draft's new `kickoff_rolls` count. */
  readonly kickoffRolls?: number;
  /** Present only when `rolled` is `false` — a plain-language reason, never a driver message. */
  readonly reason?: string;
}

/**
 * Every SCHEDULED, public matchmade draft whose kickoff has passed and whose room is NOT full —
 * the founder's ruling's own negative space: `dueDraftsQuery`
 * (`@/draft-service/auto-start`) finds the FULL half of this same due population and starts it;
 * this finds the other half and rolls it instead. `startTrigger = 'scheduled'` is checked in SQL
 * here (Step 2's own model ruling: a `when_full` draft has no chosen time to be late for until it
 * fills, so it is exempt from the roll by construction, not by a runtime guard that could
 * disagree with this predicate).
 *
 * The seat count is a correlated subquery over `teams`, bounded by construction at a dozen rows
 * per league — the SAME shape `dueDraftsQuery`'s own widened SELECT uses, so the two queries'
 * plans are measured together in `src/db/index-plans.test.ts`.
 *
 * Exported as the query BUILDER, the shape every other due-scan in this codebase uses, so an
 * `EXPLAIN` assertion can wrap the real thing rather than a hand copy.
 *
 * HOUSE RUNGS NO LONGER EXERCISE THIS (founder directive 2026-08-26): every `HOUSE_CATALOG` rung
 * is `startTrigger: "when_full"` now, so `startTrigger = 'scheduled'` here only ever matches a
 * member-created league — this roll remains exactly as live for those.
 */
export function dueUnfilledScheduledDraftsQuery(db: Db, nowIso: string) {
  return db
    .select({ draftId: drafts.id, leagueId: drafts.leagueId })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(
      and(
        eq(drafts.status, "scheduled"),
        eq(drafts.startTrigger, "scheduled"),
        lte(drafts.kickoffAt, new Date(nowIso)),
        ENFORCED_LEAGUE_SQL,
        // `roomIsFull`'s own rule (`@/matchmaking/roll`), expressed in SQL here and re-derived in
        // TypeScript below immediately before the write — the identical "the query filters, the
        // code decides" discipline `browseQuery`/`matchesBrowseFilter` already hold each other to.
        sql`(select count(*)::int from ${teams} where ${teams.leagueId} = ${leagues.id}) < ${leagues.teamCount}`,
      ),
    )
    .orderBy(asc(drafts.id))
    .limit(DRAFT_SERVICE_CONFIG.maxDraftsPerTick);
}

/**
 * The roll, as a guarded write — one draft, one transaction. `leagues[X] FOR KEY SHARE` is this
 * function's OWN first statement, PROVEN rather than argued (fix round 1, H1): an opus reviewer
 * reproduced a genuine `SQLSTATE 40P01` between this function's shipped no-lock shape and
 * `setDraftKickoff` (`./draft-schedule.ts`) on two real connections — a commissioner's own
 * reschedule can be the deadlock's VICTIM, not merely a theoretical bystander, exactly the same
 * `leagues`/`drafts` cycle `lock-order.test.ts`'s own "leagues-before-drafts" block already fixed
 * once for a DIFFERENT pair of writers. `KEY SHARE` is the fix that closes the cycle WITHOUT
 * reintroducing the earlier mistake (a first attempt at this used `FOR UPDATE`, which serializes
 * two concurrent rolls of the SAME draft into two sequential successes instead of one winner and
 * one clean no-op — see H2 below for what that attempt actually surfaced): `KEY SHARE` does not
 * conflict with another `KEY SHARE`, so two racing rolls both proceed past this statement
 * together, uncontended, and the guarded `UPDATE` below remains the sole exclusion between them
 * (`lock-order.test.ts`'s live two-connection proof, "roll vs. setDraftKickoff", and
 * `src/league-service/roll.test.ts`'s own self-race test both pin this). `KEY SHARE` DOES
 * conflict with `setDraftKickoff`'s `leagues FOR UPDATE`, so whichever of the two transactions
 * arrives first now blocks the other at the SAME row, in the SAME order, before either one has
 * touched `drafts` at all — the ordering-inversion the branch-wide rule exists to forbid never
 * has a chance to form.
 *
 * NO-WRITE-BEFORE-REFUSAL holds throughout: every refusal branch below returns before the
 * guarded `UPDATE` is ever reached.
 *
 * THE GUARDED WRITE. `WHERE id = $1 AND status = 'scheduled' AND kickoff_at = $2` — the exact
 * kickoff this call read a moment earlier. Zero rows means another instance's own guarded
 * `UPDATE` already rolled this exact kickoff first; `ROLL_REFUSALS.raced` reports that cleanly,
 * the identical "the write itself is the exclusion, no leader election required" argument
 * `claimAutoStart`'s own docblock makes for its status transition (`docs/decisions/data-layer-
 * hardening.md` forbids `pg_advisory_lock` under PgBouncer transaction pooling). One row means
 * this caller owns the roll, and only then does it write the notices and the audit anchor —
 * business writes, then notices, then the anchor (ruling 3).
 *
 * FIX ROUND 1, H2 — DUE-NESS IS RE-DERIVED TOO, NOT ONLY FULLNESS. The scan that found this draft
 * read `kickoff_at <= now` a moment ago; between that read and this transaction, a commissioner's
 * own `setDraftKickoff` reschedule can land — and without re-checking, this function would roll a
 * kickoff the commissioner just chose on purpose, and tell every seat "the room was not full" at
 * a target that was never actually due. `ROLL_REFUSALS.notDue` catches exactly that: this is also
 * what the FIRST, `FOR UPDATE`-based attempt at H1 actually exposed — that attempt's "double
 * roll" failure was not proof that racing is unsafe, it was this exact gap, surfaced by
 * serialization (the second, unblocked caller re-read a kickoff already moved into the future by
 * the first, and rolled it again because nothing here checked whether it was still due).
 */
export async function rollUnfilledDraftInTx(
  tx: DbTx,
  params: { readonly draftId: string; readonly leagueId: string },
  nowIso: string,
  audit: AuditLogger = getAuditLogger(),
): Promise<RollOutcome> {
  const { draftId, leagueId } = params;

  // LEAGUES FIRST, ON ITS OWN, KEY SHARE — see this function's own docblock (fix round 1, H1)
  // for why this is the mode that closes the `setDraftKickoff` cycle without serializing this
  // function's own self-race.
  await tx.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, leagueId)).for("key share");

  const [row] = await tx
    .select({
      status: drafts.status,
      startTrigger: drafts.startTrigger,
      kickoffAt: drafts.kickoffAt,
      teamCount: leagues.teamCount,
      leagueName: leagues.name,
      houseRung: leagues.houseRung,
    })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(eq(drafts.id, draftId));

  if (row === undefined || row.status !== "scheduled") {
    return { draftId, rolled: false, reason: ROLL_REFUSALS.alreadyStarted };
  }
  if (row.startTrigger !== "scheduled") {
    return { draftId, rolled: false, reason: ROLL_REFUSALS.notScheduled };
  }
  // Fix round 1, H2: re-derived fresh, immediately before the write — see `ROLL_REFUSALS.notDue`'s
  // own docblock for the false-sentence bug this closes.
  if (row.kickoffAt.getTime() > Date.parse(nowIso)) {
    return { draftId, rolled: false, reason: ROLL_REFUSALS.notDue };
  }

  const seated = await tx.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, leagueId));
  if (roomIsFull({ teamCount: row.teamCount, filledTeams: seated.length })) {
    return { draftId, rolled: false, reason: ROLL_REFUSALS.full };
  }

  const next = nextKickoffAfter(row.kickoffAt.toISOString(), nowIso);
  const rolled = await tx
    .update(drafts)
    .set({ kickoffAt: new Date(next), kickoffRolls: sql`${drafts.kickoffRolls} + 1` })
    .where(and(eq(drafts.id, draftId), eq(drafts.status, "scheduled"), eq(drafts.kickoffAt, row.kickoffAt)))
    .returning({ id: drafts.id, kickoffRolls: drafts.kickoffRolls });

  if (rolled.length === 0) {
    return { draftId, rolled: false, reason: ROLL_REFUSALS.raced };
  }
  const kickoffRolls = rolled[0]!.kickoffRolls;

  // F11: a house league has no commissioner to name; a member league's commissioner can start
  // the room early (`draft-schedule-panel.tsx`'s own short-room warning), so its sentence names
  // both ways the draft can start.
  const authority: StartTimingAuthority = row.houseRung !== null ? "house" : "member";
  const rollSentence = rollNoticeSentence(kickoffRolls);
  const startTimingSentence = describeStartTiming({ startTrigger: "scheduled", authority });
  // Fix round 1, M2: the notice names the NEW kickoff, pre-rendered here (the "template composes
  // a sentence, it never re-derives one from a payload shape" discipline `graceLabel`
  // established for `draft_fill_triggered`) — the plan's own Step 6 example ("...so its draft
  // moves to Friday 8:00 PM") is the sentence this answers, not merely "it moved" with no target.
  const newKickoffAt = formatAbsoluteTime(next);
  // F12: the release door is named from the SECOND roll onward, never the first — offering the
  // exit the first time something slips reads as the product giving up on its own room.
  const showReleaseParagraph = kickoffRolls >= 2;

  const created: MemberNotice[] = [];
  for (const member of seated) {
    created.push(
      await notifyAffectedMember(tx, {
        leagueId,
        userId: member.userId,
        noticeType: "draft_kickoff_rolled",
        context: { leagueName: row.leagueName, newKickoffAt, rollSentence, startTimingSentence, showReleaseParagraph },
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
    payload: { action: "draft_kickoff_rolled", summary: DRAFT_KICKOFF_ROLLED_SUMMARY },
    occurredAt: nowIso,
  });
  for (const notice of created) await attachAuditEvent(tx, notice, event.eventId);

  return { draftId, rolled: true, kickoffAt: next, kickoffRolls };
}

export interface RollDueDraftsDeps {
  readonly clock: Clock;
  readonly audit?: AuditLogger;
}

/**
 * The scan + the roll, over every due, unfilled, `'scheduled'`-trigger public matchmade draft —
 * the platform's own hand on the OTHER button Task 6 built: a room that reached its target time
 * without filling does not fire, it slips, silently to nobody but honestly to everyone in it.
 *
 * Gated on `enforcementIsSwitchedOn()` FIRST, before any query — the identical deploy-wide switch
 * `autoStartDueDrafts` (`@/draft-service/auto-start`) already asks, and for the same reason: a
 * private league's draft is never touched by the platform, however late its unfilled room is,
 * because that trust is the whole premise of a private league. `ENFORCED_LEAGUE_SQL` narrows the
 * scan itself to public matchmade leagues on top of that switch, the same belt-and-braces pair
 * `dueDraftsQuery` already holds itself to.
 *
 * NEVER THROWS PAST ONE DRAFT'S OWN FAILURE — `autoStartDueDrafts`'s own discipline, restated
 * here rather than assumed: a real DB error rolling one draft is caught, logged and reported as a
 * `{ rolled: false }` outcome, and the scan continues for every other due-unfilled draft. A
 * failed roll is retried on the next tick because its `kickoff_at` LITERALLY never left the value
 * this scan found it at.
 */
export async function rollDueDrafts(db: Db, deps: RollDueDraftsDeps): Promise<readonly RollOutcome[]> {
  if (!enforcementIsSwitchedOn()) return [];

  const now = deps.clock.now();
  const audit = deps.audit ?? getAuditLogger();
  const rows = await dueUnfilledScheduledDraftsQuery(db, now);

  const outcomes: RollOutcome[] = [];
  for (const row of rows) {
    try {
      outcomes.push(await db.transaction((tx) => rollUnfilledDraftInTx(tx, { draftId: row.draftId, leagueId: row.leagueId }, now, audit)));
    } catch (error: unknown) {
      console.error("[league] roll failed for draft", row.draftId, error);
      outcomes.push({ draftId: row.draftId, rolled: false, reason: "Something went wrong moving this draft's kickoff." });
    }
  }
  return outcomes;
}
