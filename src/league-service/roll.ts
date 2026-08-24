import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { DRAFT_SERVICE_CONFIG } from "@/draft-service/config";
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
 * The roll, as a guarded write — one draft, one transaction, no preliminary lock. `claimAutoStart`
 * (`@/draft-service/auto-start`) and `fireWhenFullInTx` (`./fill-trigger`) both take `leagues FOR
 * UPDATE` before they ever reach `drafts`, but BOTH rely on a CALLER that already holds that lock
 * for its own reason (`applyAction`, `joinLeagueInTx`) — this function has no such caller (the
 * ticker calls straight in, on no lock at all), and taking the lock itself here would do the
 * WRONG thing: it would SERIALIZE two concurrent rolls of the same draft rather than letting them
 * RACE. A caller that blocks on `leagues FOR UPDATE`, then re-reads the row fresh once unblocked,
 * would see the WINNER's already-rolled kickoff and honestly roll it a SECOND time — a correct
 * roll in isolation, but not the "one write wins, the other reports a clean no-op" property this
 * function's own guarded `UPDATE` exists to guarantee. So this function reads `drafts`/`leagues`
 * PLAIN (no lock at all), exactly `fireWhenFullInTx`'s own initial read — the guarded `UPDATE`
 * below is the ONLY place a lock is taken, and it is the exclusion itself, not a guard in front
 * of one.
 *
 * NO-WRITE-BEFORE-REFUSAL holds throughout: every refusal branch below returns before the
 * guarded `UPDATE` is ever reached.
 *
 * THE GUARDED WRITE. `WHERE id = $1 AND status = 'scheduled' AND kickoff_at = $2` — the exact
 * kickoff this call read a moment earlier, BEFORE any lock. Zero rows means another instance's
 * own guarded `UPDATE` already rolled this exact kickoff first; `ROLL_REFUSALS.raced` reports
 * that cleanly, the identical "the write itself is the exclusion, no leader election required"
 * argument `claimAutoStart`'s own docblock makes for its status transition
 * (`docs/decisions/data-layer-hardening.md` forbids `pg_advisory_lock` under PgBouncer
 * transaction pooling). One row means this caller owns the roll, and only then does it write the
 * notices and the audit anchor — business writes, then notices, then the anchor (ruling 3).
 *
 * A KNOWN, NARROW GAP (flagged rather than silently closed): because this function takes no
 * `leagues` lock, a `setDraftKickoff` (`./draft-schedule.ts`) reschedule racing this exact draft
 * at this exact instant is a genuine — if rare — cross-transaction deadlock window (its own
 * `leagues FOR UPDATE` then `drafts FOR UPDATE`, against this function's `drafts` `UPDATE` then
 * implicit `leagues` `FOR KEY SHARE`, the two previously-cyclic orders `setDraftKickoff`'s own
 * docblock already reproduced once for a DIFFERENT pair). Postgres's own deadlock detector
 * resolves it (one side aborts with `SQLSTATE 40P01`), and this function's caller
 * (`rollDueDrafts`) already catches and retries any per-draft failure on the next tick — so the
 * failure mode is a rare aborted transaction, not a hang or a lost roll, but closing it fully
 * would require either serializing this function's own self-race (the wrong tradeoff, above) or a
 * version-token guard neither this task's brief nor its schema specifies. Left open, on purpose,
 * for the next reviewer to weigh rather than resolved silently in either direction.
 */
export async function rollUnfilledDraftInTx(
  tx: DbTx,
  params: { readonly draftId: string; readonly leagueId: string },
  nowIso: string,
  audit: AuditLogger = getAuditLogger(),
): Promise<RollOutcome> {
  const { draftId, leagueId } = params;

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
        context: { leagueName: row.leagueName, rollSentence, startTimingSentence, showReleaseParagraph },
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
