// THE DRAFT GRADES JOB (Task 9, spec §9) — the storage half of the pure engine in
// `@/draft-service/grades/engine.ts`: after a REAL draft completes, this job loads its committed
// picks and rosters, runs `gradeDraft` against the evidence board, and writes one `draft_grades`
// row per team. `src/draft-service/store.ts`'s post-commit block (beside `sweepQuietly`) enqueues
// this job for a `!isMock` completion only — a mock draft never reaches this file at all, and
// never should (ruling 3: mock grades are read-time, Task 11's own call into the same engine).
//
// ONE bounded step, `sim-job.ts`'s own shape: idempotency check, load, compute, write, notify,
// deliver.
// IDEMPOTENT BY EARLY RETURN, not by re-running the write every time: a draft's committed picks
// and rosters never change once `commitDraftState` writes them, so a SECOND run for the same
// draft (a retried attempt, an operator re-enqueue) would recompute byte-identical rows — the
// only thing worth guarding is the NOTICE, which must never fire twice. Checking for an existing
// `draft_grades` row before doing any work makes both true at once: a re-run is a pure no-op,
// checked once, rather than a write guarded separately from a notify guarded separately.
//
// TERMINAL VS RETRYABLE: a `drafts` row that has vanished, or one that is not `'complete'` yet
// (the job firing before its own enqueue's commit is visible — should not happen, since the
// enqueue runs strictly after the transaction that set `status: 'complete'` commits, but a
// defensive read is cheap) are both refusals no retry fixes — terminal, the identical reasoning
// `sim-job.ts`'s own missing-row case uses. A DB blip while reading the evidence board, the
// roster, or writing the grades/notices is ordinary weather — retryable.
import { eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { players } from "@research-ts/db/schema";
import { draftGrades, draftPicks, drafts, leagues, rosterSlots, teams } from "@/db/schema";
import type { JsonObject } from "@/domain/audit";
import type { Position } from "@research-ts/domain/player";
import type { Clock } from "@research-ts/domain/timing";
import { excludedSetFor } from "@research-ts/db/upsert";
import type { GradeDraftInput } from "@/draft-service/grades/engine";
import { gradeDraft } from "@/draft-service/grades/engine";
import { gradeEvidenceMaps } from "@/draft-service/grades/evidence-maps";
import { evidencePoolFor } from "@/draft-service/sim/evidence";
import { deliverNotice, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { byeWeeksByTeam } from "@research-ts/reference/nfl-schedule";
import type { LeagueShape } from "@research-ts/projections/decide/replacement";
import { enqueueJob } from "../store";
import { defineJob, TerminalJobError, type AnyJobDefinition, type StepOutcome } from "../contract";

export const DRAFT_GRADES_JOB_NAME = "draft-grades";

export interface DraftGradesJobPayload {
  readonly draftId: string;
}

export function parseDraftGradesJobPayload(raw: JsonObject): DraftGradesJobPayload {
  const draftId = raw.draftId;
  if (typeof draftId !== "string" || draftId === "") {
    throw new Error(`draft-grades payload: draftId must be a non-empty string, got ${JSON.stringify(draftId)}.`);
  }
  return { draftId };
}

/**
 * Every team in the league, with its own committed roster (empty for a team the draft somehow
 * left rosterless — never omitted, since `gradeDraft` reads the ROOM from this map's own keys).
 */
async function rostersByTeam(db: Db, leagueId: string): Promise<ReadonlyMap<string, readonly { readonly playerId: string; readonly position: Position }[]>> {
  const leagueTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, leagueId));
  const rosters = new Map<string, { readonly playerId: string; readonly position: Position }[]>(leagueTeams.map((t) => [t.id, []]));

  const rows = await db
    .select({ teamId: rosterSlots.teamId, playerId: players.id, position: players.position })
    .from(rosterSlots)
    .innerJoin(teams, eq(teams.id, rosterSlots.teamId))
    .innerJoin(players, eq(players.id, rosterSlots.playerId))
    .where(eq(teams.leagueId, leagueId));
  for (const row of rows) {
    rosters.get(row.teamId)?.push({ playerId: row.playerId, position: row.position });
  }
  return rosters;
}

/** `players.nfl_team` for every rostered player — the resolver `byeWeeks` needs to mean anything
 *  for a roster (`GradeDraftInput.nflTeamByPlayerId`'s own docblock). */
async function nflTeamsByPlayer(db: Db, leagueId: string): Promise<ReadonlyMap<string, string>> {
  const rows = await db
    .select({ playerId: players.id, nflTeam: players.nflTeam })
    .from(rosterSlots)
    .innerJoin(teams, eq(teams.id, rosterSlots.teamId))
    .innerJoin(players, eq(players.id, rosterSlots.playerId))
    .where(eq(teams.leagueId, leagueId));
  return new Map(rows.map((row) => [row.playerId, row.nflTeam] as const));
}

/**
 * The delivery twin of `enqueueDraftGradesJobQuietly`'s own "swallows its own failures"
 * discipline, mirroring `auto-lineup.ts`'s `deliverNoticeQuietly` exactly (same reasoning: the
 * durable `member_notices` row already committed by the time this runs, so a push failure here
 * must never be mistaken for the job itself having failed). `deliver` is an injected dependency
 * — the same seam `deliverNoticeQuietly` takes it through — so a test can fake it without a real
 * Redis connection.
 */
async function deliverNoticeQuietly(deliver: typeof deliverNotice, notice: MemberNotice): Promise<void> {
  try {
    await deliver(notice);
  } catch (error: unknown) {
    console.error("[draft-grades] notice delivery failed", { noticeId: notice.id, userId: notice.userId }, error);
  }
}

export interface DraftGradesJobDeps {
  /** Defaults to the real `deliverNotice` (`@/integrity-service/notify`), called once per
   *  recipient after the write transaction commits. Injectable so a test can fake it without a
   *  real Redis connection — the same seam `auto-lineup.ts`'s own `deliver` takes. */
  readonly deliver?: typeof deliverNotice;
}

export async function runDraftGradesJobStep(db: Db, payload: DraftGradesJobPayload, deps: DraftGradesJobDeps = {}): Promise<StepOutcome> {
  const deliver = deps.deliver ?? deliverNotice;
  const [draft] = await db.select({ leagueId: drafts.leagueId, status: drafts.status }).from(drafts).where(eq(drafts.id, payload.draftId));
  if (draft === undefined) {
    throw new TerminalJobError(`draft-grades: no drafts row for id ${payload.draftId}.`);
  }
  if (draft.status !== "complete") {
    throw new TerminalJobError(`draft-grades: draft ${payload.draftId} is not complete (status ${draft.status}).`);
  }

  // THE IDEMPOTENCY CHECK, FIRST — see the module docblock. Any row already here means this
  // draft was graded and (if visible) notified on a previous run; a retry or a re-enqueue is a
  // pure no-op rather than a second write and a second notice.
  const existing = await db.select({ teamId: draftGrades.teamId }).from(draftGrades).where(eq(draftGrades.draftId, payload.draftId)).limit(1);
  if (existing.length > 0) {
    return { summary: `draft-grades ${payload.draftId}: already computed (idempotent replay).`, detail: [] };
  }

  const [league] = await db
    .select({ id: leagues.id, name: leagues.name, teamCount: leagues.teamCount, rosterSlots: leagues.rosterSlots, isMock: leagues.isMock, draftGradesVisible: leagues.draftGradesVisible })
    .from(leagues)
    .where(eq(leagues.id, draft.leagueId));
  if (league === undefined) {
    throw new TerminalJobError(`draft-grades: draft ${payload.draftId}'s league ${draft.leagueId} does not exist.`);
  }
  // Defense in depth: `store.ts` only ever enqueues this job for a `!isMock` completion (ruling
  // 3), so this should be unreachable — but a mock draft storing a grade would be a real, quiet
  // violation of that ruling, and a terminal refusal here is louder than a row nobody meant to
  // write.
  if (league.isMock) {
    throw new TerminalJobError(`draft-grades: league ${draft.leagueId} is a mock; mock drafts never store grades (ruling 3).`);
  }

  const picks = await db
    .select({ pickNumber: draftPicks.pickNumber, teamId: draftPicks.teamId, playerId: draftPicks.playerId })
    .from(draftPicks)
    .where(eq(draftPicks.draftId, payload.draftId));

  const [rosters, nflTeamByPlayerId, byeWeeks, { pool, boardGeneration }] = await Promise.all([
    rostersByTeam(db, draft.leagueId),
    nflTeamsByPlayer(db, draft.leagueId),
    byeWeeksByTeam(db),
    evidencePoolFor(db),
  ]);

  const shape: LeagueShape = { teamCount: league.teamCount, rosterSlots: league.rosterSlots };
  const { pointsByPlayerId, valueByPlayerId } = gradeEvidenceMaps(pool, shape);

  const input: GradeDraftInput = { picks, rosters, slotConfig: league.rosterSlots, pointsByPlayerId, valueByPlayerId, byeWeeks, nflTeamByPlayerId };
  const grades = gradeDraft(input);

  // ONE TRANSACTION for the write and the notify together, not two sequential statements: a
  // process killed between them would otherwise leave `draft_grades` rows written with no notice
  // ever sent, and a retry would treat those rows as "already computed" (the idempotency check
  // above) and never get a second chance to notify. Wrapped together, either both land or neither
  // does, and a retry after a crash redoes the whole thing cleanly. No anchor lock is taken here
  // (this writes no audit event — the brief's own scope), so there is no ruling-3 ordering to
  // respect beyond the ordinary FK locks both inserts already take.
  const seats = league.draftGradesVisible ? await db.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, draft.leagueId)) : [];
  const occurredAt = new Date().toISOString();
  const createdNotices = await db.transaction(async (tx) => {
    if (grades.length > 0) {
      await tx
        .insert(draftGrades)
        .values(
          grades.map((grade) => ({
            draftId: payload.draftId,
            leagueId: draft.leagueId,
            teamId: grade.teamId,
            letter: grade.letter,
            components: grade.components,
            projectedRank: grade.projectedRank,
            boardGeneration,
          })),
        )
        .onConflictDoUpdate({
          target: [draftGrades.draftId, draftGrades.teamId],
          // `id` is not part of the conflict target, but it is excluded from the SET here too:
          // it is a surrogate serial with no meaning of its own, and letting `excludedSetFor`
          // restate it would reassign an existing row's id to whatever value the conflicting
          // insert's own (unused) sequence draw happened to be.
          set: excludedSetFor(draftGrades, ["id", "draftId", "teamId"]),
        });
    }
    const notices: MemberNotice[] = [];
    for (const seat of seats) {
      notices.push(
        await notifyAffectedMember(tx, {
          leagueId: draft.leagueId,
          userId: seat.userId,
          noticeType: "draft_grades_ready",
          context: { leagueName: league.name },
          occurredAt,
          auditEventId: null,
        }),
      );
    }
    return notices;
  });
  const notified = seats.length;
  // Best-effort, AFTER the commit — the inverse of `notifyAffectedMember`'s own discipline: the
  // durable row above already failed the transaction if it had to, so a live push failure here
  // must never look like the job itself failed. Without this, a member sitting on their league
  // home only learns grades are ready on their next page load/poll, never a live nudge.
  for (const notice of createdNotices) await deliverNoticeQuietly(deliver, notice);

  return {
    summary: `draft-grades ${payload.draftId}: ${grades.length} team grade${grades.length === 1 ? "" : "s"} written, ${notified} member${notified === 1 ? "" : "s"} notified`,
    detail: grades.map((grade) => `${grade.teamId}: ${grade.letter} (rank ${grade.projectedRank})`),
  };
}

export const draftGradesJob: AnyJobDefinition = defineJob<DraftGradesJobPayload>({
  name: DRAFT_GRADES_JOB_NAME,
  maxAttempts: 3,
  // Comfortably above what a handful of DB reads plus one evidence-board read cost — this job
  // does no network I/O and no per-run arithmetic that scales with draft size beyond a single
  // league's own roster count.
  timeoutMs: 30_000,
  backoff: { baseMs: 5_000, maxMs: 30_000 },
  parsePayload: parseDraftGradesJobPayload,
  steps: [{ name: "grade", run: (ctx, payload) => runDraftGradesJobStep(ctx.db, payload) }],
});

/**
 * The store's own best-effort enqueue (`src/draft-service/store.ts`'s post-commit block, beside
 * `sweepQuietly`) — mirrors that function's own "swallows its own failures" discipline exactly:
 * a queue insert that fails must never roll back, or even fail loudly for, a draft that has
 * already committed as a season. `idempotencyKey` is `draft-grades:<draftId>`, one job per draft
 * ever, the same one-key-per-subject shape `sim/service.ts`'s own `sim:<id>` key uses.
 */
export async function enqueueDraftGradesJobQuietly(db: Db, clock: Clock, draftId: string): Promise<void> {
  try {
    await enqueueJob(db, clock, {
      name: DRAFT_GRADES_JOB_NAME,
      idempotencyKey: `draft-grades:${draftId}`,
      payload: { draftId },
      maxAttempts: draftGradesJob.maxAttempts,
      runAt: new Date(),
    });
  } catch (error: unknown) {
    console.error("[draft-grades] enqueue failed", { draftId }, error);
  }
}
