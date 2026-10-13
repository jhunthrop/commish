import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { draftActions, drafts, leagues, mockRooms } from "@/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { invalidateRankedPlayersCache } from "@/draft-service/pool";
import type { DraftStore } from "@/draft-service/store";
import { MOCK_CONFIG } from "@/mock-draft/config";

/**
 * The retention sweep (Phase 4.5, Task 6, Step 4): practice rooms past their window are deleted
 * whole — `DELETE FROM leagues` and the FK cascade does the rest (`mock_rooms`, `teams`,
 * `drafts`, `draft_actions`, `scoring_settings`, `chat_messages`, every child row).
 *
 * THE ARCHITECTURE'S LOAD-BEARING CLAUSE, verified per task since pre-flight: this DELETE is
 * legal ONLY because the mock lane never writes a trigger-protected row — no audit event, no
 * notice, no money (ruling 2, `MOCK_NOOP_AUDIT`'s carve-out, proven by Task 4's differential
 * trace) — so the audit spine's append-only `BEFORE DELETE` triggers never have a row to refuse
 * to lose. A REAL league is structurally unsweepable here twice over: candidacy requires a
 * `mock_rooms` row joined to `leagues.is_mock = true` (the join belt), and the writer itself
 * (`deleteMockLeagueRow`) carries `is_mock = true` in its own WHERE (the second belt), so even a
 * hand-corrupted sidecar row cannot aim this DELETE at a real league.
 *
 * Run by the minute sweep (`@/jobs/defs/draft-sweep-job`, the batched bots round: the dev ticker
 * that used to gate it by interval is gone) — retention windows are hours long, so a fire that
 * finds nothing expired costs three bounded scans and nothing else.
 */

/**
 * Ceiling on rooms each scan examines per run. Reuses `maxMockStartsPerTick` — the mock lanes'
 * shared per-run batch width — rather than minting a second number with no independent reason to
 * differ, the same sharing argument `DRAFT_SERVICE_CONFIG.maxDraftsPerTick` records for the
 * ticker's own two scans. A backlog wider than one batch drains across successive runs.
 */
const MAX_ROOMS_PER_SWEEP = MOCK_CONFIG.maxMockStartsPerTick;

export interface MockSweepDeps {
  /** Has its own per-draft state cache dropped for every swept room (`store.invalidate`). */
  readonly store: DraftStore;
  readonly clock: Clock;
  /** Seam for the sweep tests' spy; defaults to the real `invalidateRankedPlayersCache` —
   *  `pool.ts`'s Map would otherwise hold one dead ranking per swept mock forever. */
  readonly invalidateRanking?: (leagueId: string) => void;
  /** The bot driver's own per-draft meta cache, dropped per swept room (fix round, review
   *  MEDIUM) — the ticker wires `createMockBotDriver`'s `invalidateDraft` here. Optional so a
   *  direct caller without a driver (tests, the lock-order proof) owes nothing. */
  readonly invalidateDriverMeta?: (draftId: string) => void;
  /** The one writer, injectable so the lost-delete-race arm is a test's to reach (a concurrent
   *  instance deleting the row between this run's scan and its DELETE). Defaults to the real
   *  `deleteMockLeagueRow`. */
  readonly deleteLeague?: (db: Db, leagueId: string) => Promise<boolean>;
}

export interface SweptMockRoom {
  readonly leagueId: string;
  readonly draftId: string;
}

/**
 * Deletes ONE mock league — the writer of this lane, and the second `is_mock` belt: the WHERE
 * refuses `is_mock = false` at the statement itself, so no caller bug can ever delete a real
 * league through it. `false` means nothing was deleted (a non-mock league, or a row a concurrent
 * instance's sweep already won). Exported for `sweep.test.ts`'s direct writer-refusal proof.
 */
export async function deleteMockLeagueRow(db: Db, leagueId: string): Promise<boolean> {
  const deleted = await db
    .delete(leagues)
    .where(and(eq(leagues.id, leagueId), eq(leagues.isMock, true)))
    .returning({ id: leagues.id });
  return deleted.length > 0;
}

/**
 * Never-started rooms: `drafts.status = 'scheduled'` past `unstartedMs` from the room's own
 * `created_at`. Fully decided in SQL — an unstarted room has no log to consult.
 */
function unstartedCandidatesQuery(db: Db, cutoff: Date) {
  return db
    .select({ leagueId: mockRooms.leagueId, draftId: drafts.id })
    .from(mockRooms)
    .innerJoin(leagues, and(eq(leagues.id, mockRooms.leagueId), eq(leagues.isMock, true)))
    .innerJoin(drafts, eq(drafts.leagueId, mockRooms.leagueId))
    .where(and(eq(drafts.status, "scheduled"), lte(mockRooms.createdAt, cutoff)))
    .orderBy(asc(mockRooms.createdAt), asc(mockRooms.leagueId))
    .limit(MAX_ROOMS_PER_SWEEP);
}

/**
 * Started rooms whose last action (`MAX(draft_actions.timestamp)` — the log's own instant,
 * never a wall-clock guess) is at least `cutoff` old, split by `drafts.status`. Pure SQL both
 * ways (Task 6 fix round, ruled): the driver's `settleMockDraftCompletion` (`./driver`) makes
 * status trustworthy for mocks — `'complete'` is a finished room (judged at `completedMs`),
 * `'in_progress'` an abandoned one (judged at `inProgressMs`) — so no per-candidate replay is
 * needed. The one edge this accepts, documented rather than defended: a room that finished
 * inside the one-tick window before its settle AND whose server then stayed down past
 * `inProgressMs` is judged as abandoned on restart, trading (at most) the tail of its results
 * page for a sweep that needs no replay machinery.
 */
function startedExpiredQuery(db: Db, status: "complete" | "in_progress", cutoff: Date) {
  return db
    .select({ leagueId: mockRooms.leagueId, draftId: drafts.id })
    .from(mockRooms)
    .innerJoin(leagues, and(eq(leagues.id, mockRooms.leagueId), eq(leagues.isMock, true)))
    .innerJoin(drafts, eq(drafts.leagueId, mockRooms.leagueId))
    .innerJoin(draftActions, eq(draftActions.draftId, drafts.id))
    .where(eq(drafts.status, status))
    .groupBy(mockRooms.leagueId, drafts.id)
    // The cutoff rides as an ISO string: a bare `Date` inside a raw `sql` fragment has no
    // column to borrow an encoder from, and the driver refuses to serialize it.
    .having(sql`max(${draftActions.timestamp}) <= ${cutoff.toISOString()}`)
    .orderBy(asc(mockRooms.leagueId))
    .limit(MAX_ROOMS_PER_SWEEP);
}

/**
 * One sweep run: three pure-SQL scans (never started / finished / abandoned, each at its own
 * window), one deletion loop. Every deletion drops all three in-memory holds a swept room could
 * otherwise keep for the rest of the process's life: the ranking cache (`pool.ts`), the store's
 * own draft-state materialization, and the bot driver's per-draft meta.
 */
export async function sweepExpiredMocks(db: Db, deps: MockSweepDeps): Promise<readonly SweptMockRoom[]> {
  const invalidateRanking = deps.invalidateRanking ?? invalidateRankedPlayersCache;
  const deleteLeague = deps.deleteLeague ?? deleteMockLeagueRow;
  const nowMs = Date.parse(deps.clock.now());
  const { completedMs, unstartedMs, inProgressMs } = MOCK_CONFIG.retention;

  const expired: SweptMockRoom[] = [
    ...(await unstartedCandidatesQuery(db, new Date(nowMs - unstartedMs))),
    // A COMPLETED room keeps the longer window (its results page lives a day); an abandoned
    // in-progress room only its own. Status tells them apart since the driver settles a
    // finished mock (`settleMockDraftCompletion` — see `startedExpiredQuery`'s docblock).
    ...(await startedExpiredQuery(db, "complete", new Date(nowMs - completedMs))),
    ...(await startedExpiredQuery(db, "in_progress", new Date(nowMs - inProgressMs))),
  ];

  const swept: SweptMockRoom[] = [];
  for (const room of expired) {
    if (!(await deleteLeague(db, room.leagueId))) {
      // Either the delete race lost to another instance (the row is simply gone) or — the state
      // this writer exists to refuse — the league is not a mock. Both are worth a log line and
      // neither may stop the rooms after it.
      console.error("[mock-draft] sweep could not delete a league it judged expired", { leagueId: room.leagueId });
      continue;
    }
    invalidateRanking(room.leagueId);
    deps.store.invalidate(room.draftId);
    deps.invalidateDriverMeta?.(room.draftId);
    swept.push({ leagueId: room.leagueId, draftId: room.draftId });
  }
  return swept;
}
