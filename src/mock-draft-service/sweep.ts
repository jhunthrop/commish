import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { draftActions, drafts, leagues, mockRooms } from "@/db/schema";
import type { Clock } from "@/domain/timing";
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
 * Interval-gated by the ticker (`MOCK_CONFIG.sweepIntervalMs`, the `houseReconcileIntervalMs`
 * shape) rather than run every tick — retention windows are hours long, not seconds.
 */

/**
 * Ceiling on rooms each scan examines per run. Reuses `maxMockStartsPerTick` — the mock lanes'
 * shared per-run batch width — rather than minting a second number with no independent reason to
 * differ, the same sharing argument `DRAFT_SERVICE_CONFIG.maxDraftsPerTick` records for the
 * ticker's own two scans. A backlog wider than one batch drains across successive runs.
 */
const MAX_ROOMS_PER_SWEEP = MOCK_CONFIG.maxMockStartsPerTick;

export interface MockSweepDeps {
  /** Judges a started candidate's phase (completed rooms keep the longer window) and has its
   *  own per-draft state cache dropped for every swept room. */
  readonly store: DraftStore;
  readonly clock: Clock;
  /** Seam for the sweep tests' spy; defaults to the real `invalidateRankedPlayersCache` —
   *  `pool.ts`'s Map would otherwise hold one dead ranking per swept mock forever. */
  readonly invalidateRanking?: (leagueId: string) => void;
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

/** A room the scans consider sweepable pending (for started rooms) the per-state judgment. */
interface SweepCandidate extends SweptMockRoom {
  /** `MAX(draft_actions.timestamp)` — the completion/abandonment instant, read off the log
   *  itself, never a wall-clock guess. Null for the never-started scan (judged on `created_at`,
   *  already applied in SQL). */
  readonly lastActionAt: Date | null;
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
 * Started rooms whose last action is at least `inProgressMs` old — the SMALLER of the two
 * started windows, so this scan surfaces every possible candidate and the per-state judgment in
 * `sweepExpiredMocks` applies the longer `completedMs` to rooms whose replayed phase is
 * `complete`. `drafts.status` alone cannot make that split: a finished mock's status stays
 * `'in_progress'` forever (Task 4's law — `commitDraftState` never runs for a mock), which is
 * exactly why the phase is judged off the replayed log rather than off a column.
 */
function startedCandidatesQuery(db: Db, cutoff: Date) {
  // `mapWith` the column itself, so the aggregate decodes through the identical Date mapping
  // every plain read of `draft_actions.timestamp` already gets.
  const lastActionAt = sql<Date>`max(${draftActions.timestamp})`.mapWith(draftActions.timestamp);
  return db
    .select({ leagueId: mockRooms.leagueId, draftId: drafts.id, lastActionAt })
    .from(mockRooms)
    .innerJoin(leagues, and(eq(leagues.id, mockRooms.leagueId), eq(leagues.isMock, true)))
    .innerJoin(drafts, eq(drafts.leagueId, mockRooms.leagueId))
    .innerJoin(draftActions, eq(draftActions.draftId, drafts.id))
    .where(eq(drafts.status, "in_progress"))
    .groupBy(mockRooms.leagueId, drafts.id)
    // The cutoff rides as an ISO string: a bare `Date` inside a raw `sql` fragment has no
    // column to borrow an encoder from, and the driver refuses to serialize it.
    .having(sql`max(${draftActions.timestamp}) <= ${cutoff.toISOString()}`)
    .orderBy(asc(mockRooms.leagueId))
    .limit(MAX_ROOMS_PER_SWEEP);
}

/**
 * One sweep run: scan both candidate shapes, judge started rooms per replayed state, delete
 * whatever is genuinely past its window, and drop both in-memory caches for every deletion —
 * the ranking cache (`pool.ts`) and the store's own draft-state cache, either of which would
 * otherwise hold a swept room's data for the rest of the process's life.
 */
export async function sweepExpiredMocks(db: Db, deps: MockSweepDeps): Promise<readonly SweptMockRoom[]> {
  const invalidateRanking = deps.invalidateRanking ?? invalidateRankedPlayersCache;
  const nowMs = Date.parse(deps.clock.now());
  const { completedMs, unstartedMs, inProgressMs } = MOCK_CONFIG.retention;

  const unstarted = await unstartedCandidatesQuery(db, new Date(nowMs - unstartedMs));
  const started = await startedCandidatesQuery(db, new Date(nowMs - inProgressMs));

  const expired: SweepCandidate[] = unstarted.map((row) => ({ ...row, lastActionAt: null }));
  for (const row of started) {
    const state = await deps.store.getDraftState(row.draftId);
    // Vanished between the scan and this read — a concurrent instance's sweep already won.
    if (state === null) continue;
    // A COMPLETED room keeps the longer window (its results page lives a day); an abandoned
    // in-progress room only its own. Judged per state, because status cannot tell them apart.
    const windowMs = state.phase === "complete" ? completedMs : inProgressMs;
    if (nowMs < row.lastActionAt!.getTime() + windowMs) continue;
    expired.push(row);
  }

  const swept: SweptMockRoom[] = [];
  for (const room of expired) {
    if (!(await deleteMockLeagueRow(db, room.leagueId))) {
      // Either the delete race lost to another instance (the row is simply gone) or — the state
      // this writer exists to refuse — the league is not a mock. Both are worth a log line and
      // neither may stop the rooms after it.
      console.error("[mock-draft] sweep could not delete a league it judged expired", { leagueId: room.leagueId });
      continue;
    }
    invalidateRanking(room.leagueId);
    deps.store.invalidate(room.draftId);
    swept.push({ leagueId: room.leagueId, draftId: room.draftId });
  }
  return swept;
}
