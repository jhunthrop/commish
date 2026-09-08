import { asc, eq, sql } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { draftActions, drafts, leagues, players, teams } from "@/db/schema";
import { DRAFT_ACTION_VERSION, type DraftAction } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import {
  admitCommand,
  AUCTION_CONFIG,
  AUTOPICK_CONFIG,
  currentDeadline,
  DRAFT_SKIP_POLICY,
  draftActionSchema,
  draftEventsFor,
  newlySkippedPick,
  reduceDraft,
  replayDraft,
  type DraftState,
} from "@/draft-engine";
import { wakeMember, wakeSet, type WakeSet } from "@/jobs/wake";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { sweepQuietly } from "@/integrity-service/multi-account";
import { attachAuditEvent, deliverNotice, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { enqueueDraftGradesJobQuietly } from "@/jobs/defs/draft-grades-job";
import type { RealtimeEventType } from "@/lib/realtime/events";
import type { PublishFn } from "@/lib/realtime/publish";
import { hasOpenSeat } from "@/matchmaking/filter";
import { PUBLIC_ROOM_SHORT_REFUSAL } from "@/matchmaking/roll";
import { auditEventsForPicks, ownerIdsForContestedPicks } from "./audit";
import { claimAutoStart } from "./auto-start";
import { commitDraftState } from "./commit";
import { createKeyedMutex } from "./mutex";
import { draftOrderFor } from "./order";
import { buildDraftPool } from "./pool";
import { loadDraftConfig } from "./setup";
import { slotPreferencesFor } from "./slot-preference";

export type { PublishFn } from "@/lib/realtime/publish";

interface PublishFailureEvent {
  readonly type: RealtimeEventType;
  readonly leagueId: string;
}

export interface DraftStoreDeps {
  readonly db: Db;
  readonly publish: PublishFn;
  readonly clock: Clock;
  /** Optional sink for publish failures — mirrors `PublisherDeps.onError`. Defaults to a no-op. */
  readonly onPublishError?: (error: unknown, event: PublishFailureEvent) => void;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /**
   * Best-effort LIVE delivery for an autopick notice, called after the commit — mirrors
   * `broadcast`. Defaults to the real `deliverNotice` (`@/integrity-service/notify`), which
   * itself defaults to the process-wide publisher; injectable so `store.test.ts` never needs a
   * live Redis connection to exercise the transaction/rollback behavior around it.
   */
  readonly deliverNotice?: (notice: MemberNotice) => Promise<void>;
  /**
   * THE SWEEP'S WAKE NOTE (Neon cost audit 2026-09-07, finding 1). After every applied action the
   * store registers this draft's next clock deadline in the wake set (`@/jobs/wake`), so the
   * minute cron's draft sweep — the backstop for a room nobody is watching — fires at that instant
   * and stays asleep otherwise. A finished draft is forgotten. Resolved at CALL time when not
   * injected (`wakeSet()`), so a store built before `src/instrumentation.ts` installs the Redis
   * set still lands its notes; tests hand in a memory set.
   */
  readonly wake?: WakeSet;
}

export type ApplyResult =
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly reason: string };

export interface ApplyOptions {
  /**
   * Extra work to commit atomically with the action row (e.g. flipping `drafts.status`).
   *
   * Runs BEFORE the chain anchor is locked, deliberately: a caller-supplied callback may take any
   * lock at all, and ruling 3 makes the anchor the last lock a transaction takes. Running it
   * after the append would put an unknown lock on the far side of the anchor and reopen exactly
   * the cycle `src/integrity-service/lock-order.test.ts` exists to keep closed.
   *
   * May return notices it wrote and already attached to its OWN audit event (Task 7's
   * auto-start announcement, `startDraft` below) — merged into `createdNotices` for the SAME
   * post-commit best-effort delivery every other notice in this function gets. A callback with
   * nothing to announce returns nothing.
   */
  readonly alsoInTransaction?: (tx: DbTx) => Promise<readonly MemberNotice[] | void>;
  /** Who submitted this action. Absent means the clock acted (a `TIMER_EXPIRE`, never a person). */
  readonly actor?: { readonly id: string };
}

export type CommitResult =
  | { readonly ok: true; readonly picks: number; readonly teams: number; readonly alreadyCommitted: boolean }
  | { readonly ok: false; readonly reason: string };

export interface StartDraftOptions {
  /**
   * Set ONLY by `autoStartDueDrafts` (`./auto-start.ts`) — never by the manual
   * `POST /api/drafts/[draftId]/start` route, whose call stays a bare `startDraft(draftId)` and
   * whose behavior this flag leaves byte-identical. `true` fuses the `draft_auto_started`
   * notice-and-audit write into THIS SAME transaction, right after the claim succeeds — see
   * `startDraft`'s own implementation for why fusion (not a second, post-commit transaction) is
   * what makes a started-but-unannounced draft unrepresentable rather than merely unlikely.
   */
  readonly auto?: boolean;
}

/**
 * An action to apply, or HOW TO BUILD ONE once this store's transaction already holds the draft's
 * row lock (final whole-branch review, F9).
 *
 * Every action in this product is a plain value: a pick, a bid, a queue edit — a decision already
 * made by the time it reaches the store, with nothing left to read. `START_DRAFT` is the one
 * exception, and it is the exception for a reason worth stating rather than working around.
 * Its `draftOrder` is the OUTPUT of a draw (`draftOrderFor`, `./order`) over every team's saved
 * slot ranking, and ruling 27 makes that output the snapshot the log carries forever. Read outside
 * the transaction, that draw is decided against a `draft_slot_preferences` table a concurrent
 * `setSlotPreference` can still write to before the lock is taken — the racing write then commits,
 * answers `ok: true`, and changes nothing, because the draw that would have read it already ran.
 * A function here lets the ONE action with a read in it take that read under the SAME
 * `drafts FOR UPDATE` the append itself commits under, which is what makes `setSlotPreference`'s
 * own status re-check honest: a preference that lands first is drawn from, and one that arrives
 * second blocks on the lock and is then refused against a draft that has already started.
 *
 * Deliberately NOT a general "revise the action" hook. It runs exactly where a plain action would
 * have been consumed — after the row locks, before `admitCommand` — so every guard, every
 * reducer and the persisted row itself see one action, built once.
 *
 * PHASE 3.6, TASK 8's BINDING PRECONDITION extends this same reasoning to two MORE reads
 * `startDraft` used to take out of transaction: `teamRows` (the roster `draftOrder` is drawn
 * over) and `pool` (the draft board `START_DRAFT` snapshots). Read outside the lock, either one
 * could disagree with the room `releaseSeat` (`@/league-service/release`) is concurrently
 * editing — a team `releaseSeat` deletes between the outer read and the lock would otherwise
 * persist into `draftOrder`, which the reducer's replay rule then makes PERMANENT, exactly the
 * class of bug the slot-preference draw closed above. Both reads now happen inside `startDraft`'s
 * own thunk, under the identical `drafts FOR UPDATE` lock — see that function's own body.
 */
export type DraftActionSource = DraftAction | ((tx: DbTx) => Promise<DraftAction>);

export interface DraftStore {
  getDraftState(draftId: string): Promise<DraftState | null>;
  applyAction(draftId: string, action: DraftActionSource, options?: ApplyOptions): Promise<ApplyResult>;
  invalidate(draftId: string): void;
  startDraft(draftId: string, options?: StartDraftOptions): Promise<ApplyResult>;
  commitDraftResults(draftId: string): Promise<CommitResult>;
}

/** The unique index `applyAction`'s append actually races on — see `schema.ts`. */
const SEQUENCE_UNIQUE_INDEX = "draft_actions_draft_sequence_idx";

/**
 * The league-wide activity-feed sentence for an auto-started draft (final review F7). A named
 * constant, not an inline literal, for the reason `LINEUP_AUTO_SET_SUMMARY`
 * (`@/league-service/auto-lineup`) is one: it is product copy, and copy this product ships lives
 * where the copy sweeps can find it.
 *
 * No league name and no member name: `listLeagueActivity` renders this INSIDE the league it
 * belongs to, so naming the league again would read as a message from somewhere else, and the
 * event is about the calendar rather than about a person. Present tense on the fact, first person
 * plural on the platform's own action, matching the notice body this same publisher sends.
 */
export const DRAFT_AUTO_STARTED_SUMMARY = "This draft reached its scheduled time, so we started it.";

/**
 * True only for the specific race `applyAction` retries on: two writers both inserting the
 * same `(draft_id, sequence)`. Keying on the constraint name — not just the SQLSTATE — matters
 * because 23505 is the generic "unique violation" code; a `draft_picks` primary-key clash
 * from `commitDraftState` running inside the same transaction is also a 23505, and mislabeling
 * that as "Someone else acted first. Try again." would hide a real commit bug behind a retry
 * message instead of surfacing it as the unexpected error it is.
 */
export function isSequenceConflict(error: unknown): boolean {
  return isUniqueViolation(error, SEQUENCE_UNIQUE_INDEX);
}

/**
 * Thrown from inside a `DraftActionSource` THUNK to refuse the action with a caller-facing
 * reason, without writing anything — Phase 3.6, Task 8's binding precondition moved `startDraft`'s
 * "there are no players to draft yet" check from an outer, pre-transaction read into the thunk
 * itself (see `DraftActionSource`'s own docblock for why the read moved), and a thunk may only
 * ever return a `DraftAction`, never an `ApplyResult`. This is the one escape hatch: the
 * transaction the thunk runs in rolls back on any thrown error exactly as it always has, and
 * `applyAction`'s own catch below turns THIS ONE error shape back into the ordinary
 * `{ ok: false, reason }` a caller already expects — a route or a test can't tell the refusal
 * moved. Nothing else in this module throws it, so catching it by `instanceof` here can never
 * mask an unrelated bug the way a bare string match could.
 */
export class DraftActionRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "DraftActionRefused";
  }
}

/**
 * The highest `sequence` this draft's action log holds, or 0 for a log with no rows.
 *
 * This is the whole cross-instance freshness mechanism. `DraftState.sequence` counts accepted
 * actions and is exactly the value written to `draft_actions.sequence` for the row that action
 * produced, so a cached state whose `sequence` equals this is provably a materialization of the
 * complete log and a cached state whose `sequence` is lower is provably behind. One row, served
 * by the existing unique index on `(draft_id, sequence)`.
 *
 * Takes `Db | DbTx` because Task 7's locked write path calls it INSIDE the transaction that
 * holds the draft's row lock, where using the outer `db` would read outside the lock.
 */
export async function latestActionSequence(db: Db | DbTx, draftId: string): Promise<number> {
  const [row] = await db
    .select({ latest: sql<number | null>`max(${draftActions.sequence})` })
    .from(draftActions)
    .where(eq(draftActions.draftId, draftId));
  return row?.latest ?? 0;
}

/**
 * The one query Task 7's autopick notice needs: the picked-for team's owner and the league's own
 * name, joined against the specific player the clock drafted. One row, only on the autopick path
 * (`auditEventsForPicks` only ever attributes ONE new pick to `actorType: "system"` per accepted
 * `TIMER_EXPIRE` — see its own docblock), so this never runs per-pick in a batch.
 *
 * Returns `undefined` only for a team/league/player combination that cannot exist through
 * ordinary use: `pick.teamId` and its league come from `drafts`/`teams` FKs this same transaction
 * already trusts, and `pick.playerId` came out of THIS draft's own snapshotted pool
 * (`buildDraftPool`, itself sourced from `players`). Guarded rather than asserted, because unlike
 * a pure lookup this is a database round trip — and a lookup failure here must never turn an
 * already-decided pick into a rolled-back transaction over a notification nicety.
 */
async function autopickNoticeContext(
  tx: DbTx,
  teamId: string,
  playerId: string,
): Promise<{ readonly userId: string; readonly leagueName: string; readonly playerName: string } | undefined> {
  const [row] = await tx
    .select({ userId: teams.userId, leagueName: leagues.name, playerName: players.name })
    .from(teams)
    .innerJoin(leagues, eq(leagues.id, teams.leagueId))
    .innerJoin(players, eq(players.id, playerId))
    .where(eq(teams.id, teamId));
  return row;
}

/**
 * Task 5's own version of the query above, for the ONE thing a skip's notice needs that an
 * autopick's doesn't: no player, because a skip is precisely the transition where nobody was
 * chosen. Guarded the identical way `autopickNoticeContext` is — a lookup failure here must
 * never turn an already-decided skip into a rolled-back transaction over a notification nicety.
 */
async function skipNoticeContext(tx: DbTx, teamId: string): Promise<{ readonly userId: string; readonly leagueName: string } | undefined> {
  const [row] = await tx
    .select({ userId: teams.userId, leagueName: leagues.name })
    .from(teams)
    .innerJoin(leagues, eq(leagues.id, teams.leagueId))
    .where(eq(teams.id, teamId));
  return row;
}

/**
 * `draft_pick_skipped`'s league-wide (never seen — `SYSTEM_ACTION_VISIBILITY` is `subject_only`)
 * audit summary, the same "product copy lives where the copy sweeps can find it" discipline
 * `DRAFT_AUTO_STARTED_SUMMARY` and `LINEUP_AUTO_SET_SUMMARY` (`@/league-service/auto-lineup`)
 * both keep.
 */
export const DRAFT_PICK_SKIPPED_SUMMARY = "A manager's pick passed while they were away, and the draft moved on.";

/**
 * The durable draft session store.
 *
 * The `draft_actions` log is the source of truth; `cache` is only a materialization of it,
 * so losing the process loses nothing. Every accepted action is persisted BEFORE it reaches
 * the cache or the wire, and publishing is best-effort after the write — a Redis outage must
 * never make a committed pick look rejected.
 *
 * The mutex below is per-draft and NOT reentrant: `getDraftState` and `applyAction` each
 * acquire it once. Any method added to this store must never call the store's own public
 * methods while already holding the mutex — do reads before acquiring it (or after releasing
 * it), and drive same-transaction side effects through `alsoInTransaction` / the internal
 * helpers (`load`, `commitDraftState`) instead of recursing into `applyAction` or
 * `commitDraftResults`.
 */
export function createDraftStore({
  db,
  publish,
  clock,
  onPublishError,
  audit = getAuditLogger(),
  deliverNotice: deliver = deliverNotice,
  wake,
}: DraftStoreDeps): DraftStore {
  const cache = new Map<string, DraftState>();
  const mutex = createKeyedMutex();

  /** See `DraftStoreDeps.wake`: the next deadline while a clock runs, forgotten once none does. */
  async function noteWake(state: DraftState): Promise<void> {
    const set = wake ?? wakeSet();
    const deadline = state.phase === "in_progress" ? currentDeadline(state) : null;
    if (deadline === null) await set.remove([wakeMember.draft(state.config.draftId)]);
    else await set.add(wakeMember.draft(state.config.draftId), Date.parse(deadline));
  }

  async function load(draftId: string, tx?: DbTx): Promise<DraftState | null> {
    const source = tx ?? db;
    const cached = cache.get(draftId);
    if (cached !== undefined) {
      // A cache built by THIS process can still be behind: another instance may have appended
      // to the same log. Verified, not assumed — see `latestActionSequence`.
      if ((await latestActionSequence(source, draftId)) === cached.sequence) return cached;
      cache.delete(draftId);
    }
    const config = await loadDraftConfig(source, draftId);
    if (config === null) return null;
    const rows = await source
      .select()
      .from(draftActions)
      .where(eq(draftActions.draftId, draftId))
      .orderBy(asc(draftActions.sequence));
    const state = replayDraft(config, rows.map((row) => draftActionSchema.parse(row.action)));
    cache.set(draftId, state);
    return state;
  }

  async function broadcast(previous: DraftState, next: DraftState, action: DraftAction): Promise<void> {
    for (const event of draftEventsFor(previous, next, action)) {
      try {
        await publish({ leagueId: next.config.leagueId, type: event.type, payload: event.payload });
      } catch (error: unknown) {
        // Best-effort by contract: the write is already committed and clients can refetch.
        onPublishError?.(error, { type: event.type, leagueId: next.config.leagueId });
      }
    }
  }

  const store: DraftStore = {
    async getDraftState(draftId) {
      return mutex.run(draftId, () => load(draftId));
    },

    invalidate(draftId) {
      cache.delete(draftId);
    },

    async applyAction(draftId, source, options?: ApplyOptions) {
      return mutex.run(draftId, async (): Promise<ApplyResult> => {
        // `previous` is captured out of the transaction so `broadcast` (which must run AFTER
        // the commit, because publishing is best-effort and must never fail a committed write)
        // still has the before-state to diff against. `createdNotices` is the same idea for
        // `deliverNotice`: the durable rows below are written and returned INSIDE the
        // transaction, but their live frames must only go out once that transaction has
        // actually committed — see `deliverNotice`'s own docblock.
        let previous: DraftState | null = null;
        // Set inside the transaction, on the ONE branch that turns a draft into a season, and
        // read after the commit by the multi-account sweep's second trigger below. Captured
        // there rather than re-derived here for the same reason `previous` is: the before-state
        // this transition is judged against only exists inside the transaction.
        let completedLeagueId: string | null = null;
        // The action this call actually applied — captured out of the transaction for the same
        // reason `previous` is, because a `DraftActionSource` function only resolves to a value
        // INSIDE it, and `broadcast` (which must run after the commit) diffs against it.
        let applied: DraftAction | null = null;
        const createdNotices: MemberNotice[] = [];

        try {
          const outcome = await db.transaction(async (tx): Promise<ApplyResult> => {
            /**
             * THE LEAGUE ROW, FIRST, AS ITS OWN STATEMENT (final whole-branch review, F1 — a
             * cycle reproduced with real `psql` sessions, SQLSTATE 40P01).
             *
             * This transaction was NEVER a leaf, and the docblock below used to claim it was.
             * Its autopick/skip notices insert into `member_notices`, and `commitDraftState`
             * inserts `draft_picks`/`roster_slots`/`matchups` — every one of those statements
             * takes an implicit `FOR KEY SHARE` on the `leagues` row through its own foreign key,
             * and `FOR KEY SHARE` conflicts with `FOR UPDATE`. So the true order was
             * drafts-then-leagues, while `joinLeagueInTx` (`@/league-service/join`) holds
             * `leagues FOR UPDATE` and then reaches `drafts` through `fireWhenFullInTx`'s
             * `UPDATE drafts SET kickoff_at`. Two transactions, two orders, one cycle — and
             * Postgres resolves a cycle by killing somebody's draft pick or somebody's join.
             *
             * THE GLOBAL RULE this branch now holds everywhere (stated in full in
             * `setDraftKickoff`'s own docblock, `@/league-service/draft-schedule`): ANY
             * TRANSACTION THAT TAKES BOTH A `leagues` ROW LOCK AND A `drafts` ROW LOCK ACQUIRES
             * `leagues` FIRST, AS ITS OWN STATEMENT.
             *
             * `FOR KEY SHARE`, not `FOR UPDATE`, and the weaker mode is the point: it is EXACTLY
             * the lock this transaction's own FK-carrying inserts take later anyway, so acquiring
             * it up front reorders nothing and strengthens nothing. Escalating to `FOR UPDATE`
             * here would be a genuine regression — `proposeTrade` (`@/league-service/trades`)
             * holds `teams FOR UPDATE` and then takes `leagues FOR KEY SHARE` through its own
             * notice insert, which coexists with this lock today and would start deadlocking
             * against `commitDraftState`'s `teams FOR KEY SHARE` the moment this row went
             * exclusive.
             *
             * `FOR KEY SHARE OF leagues` scopes the lock to the one row despite the join: the
             * `drafts` row is only READ here (reading is not locking), and it is locked by the
             * statement below, in the fixed order.
             */
            const [league] = await tx
              .select({ id: leagues.id })
              .from(leagues)
              .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
              .where(eq(drafts.id, draftId))
              .for("key share", { of: leagues });
            if (league === undefined) return { ok: false, reason: "That draft does not exist." };

            /**
             * THE CROSS-INSTANCE LOCK. Every accepted action for this draft passes through this
             * one row, so "replay the action log" becomes the single-writer path across any
             * number of app instances rather than only across restarts.
             *
             * `SELECT ... FOR UPDATE` and not `pg_advisory_lock`: this connection reaches
             * Postgres through PgBouncer in transaction pooling mode, where session-scoped state
             * does not survive statement boundaries. A row lock is transaction-scoped by
             * construction, so it is taken and released entirely inside this block — which is
             * exactly the property transaction pooling requires and exactly the trap the spec
             * warns about. See docs/decisions/data-layer-hardening.md.
             *
             * Lock order: `leagues` (above) then `drafts` then the audit anchor, the same order
             * `joinLeagueInTx` and `setDraftKickoff` take, so no cycle exists.
             */
            const [locked] = await tx.select({ id: drafts.id }).from(drafts).where(eq(drafts.id, draftId)).for("update");
            if (locked === undefined) return { ok: false, reason: "That draft does not exist." };

            // Loaded INSIDE the lock and validated against the log, so a state another instance
            // has already advanced can never be the state this action is admitted against.
            const state = await load(draftId, tx);
            if (state === null) return { ok: false, reason: "That draft does not exist." };
            previous = state;
            // TASK 4'S GUARD, READ ONCE. `config.isMock` never changes for a draft's lifetime
            // (it is set once by `loadDraftConfig` from the `mock_rooms` sidecar), so `state`'s
            // own config is as good a read of it as `result.state`'s would be after `reduceDraft`
            // runs. Everything this flag skips below is a REAL-WORLD consequence — an audit row,
            // a notice, a season commit — never the reducer, the clock, the cache or SSE, which
            // is what makes a mock draft "the real engine, none of the consequences" rather than
            // a second, parallel implementation of one.
            const isMock = state.config.isMock === true;

            // THE ACTION, RESOLVED UNDER THE LOCK (final review F9 — see `DraftActionSource`).
            // For every action but `START_DRAFT` this is the value the caller already handed in;
            // for `START_DRAFT` it is the slot-preference draw, run here rather than out in
            // `startDraft` so a `setSlotPreference` racing it either lands before the draw reads
            // it or is refused against a draft that has already started.
            const action = typeof source === "function" ? await source(tx) : source;
            applied = action;

            // Command-time preconditions — the tunable-reading guards the reducer must not own,
            // because it also runs on replay.
            const admitted = admitCommand(state, action);
            if (!admitted.ok) return admitted;

            const result = reduceDraft(state, action);
            if (!result.ok) return result;

            await tx.insert(draftActions).values({
              draftId,
              sequence: result.state.sequence,
              action,
              timestamp: new Date(action.timestamp),
            });
            // The audit append rides the draft's existing FOR UPDATE on `drafts`, and the chain
            // anchor is taken after it — the fixed lock order (ruling 3). Both this and the
            // action row commit together or neither does.
            //
            // EVERYTHING THAT TAKES A LOCK RUNS FIRST, and that is not a stylistic preference: a
            // `member_notices` insert takes an implicit `FOR KEY SHARE` on `leagues`, and
            // `commitDraftState` takes the same on `leagues`/`teams`/`players`. Held AFTER the
            // anchor, those are the second half of a real deadlock cycle against
            // `joinLeagueInTx`, which holds `leagues FOR UPDATE` (`join.ts`) and then waits for
            // the same anchor. So the order below is: business rows, then caller-supplied work,
            // then the commit-to-season, then the append, and only a `member_notices`-only
            // UPDATE after it (`attachAuditEvent`, which takes no lock outside that table).
            // `src/integrity-service/lock-order.test.ts` drives both transactions against a real
            // Postgres and proves the cycle is gone.
            const submittedActorId = options?.actor?.id ?? null;
            // A contested auction lot the clock closes (`TIMER_EXPIRE`, no submitting actor, but
            // `auto: false` — a real bidding war happened) needs its winner's identity resolved
            // from the team they play, not left unattributed. This plain read runs before the
            // anchor lock (ruling 3) and takes no lock of its own.
            //
            // TASK 4: a mock draft never produces a `draft_pick` audit event, so there is no
            // attribution to resolve — `ownerIdsForContestedPicks` is skipped outright rather
            // than run and thrown away.
            const contestedWinners = !isMock && submittedActorId === null
              ? result.state.picks.slice(state.picks.length).filter((p) => !p.auto).map((p) => p.teamId)
              : [];
            const ownerOf = isMock ? new Map<string, string>() : await ownerIdsForContestedPicks(tx, contestedWinners);
            // THE MOCK LANE'S FIRST CUT (Task 4, the phase's central law): `picked` is empty for
            // a mock by construction, not computed and discarded. Everything downstream that
            // reads its length — the autopick-notice loop right below, and `audit.recordAll`
            // further down — is what an empty array already turns into a no-op, so this one
            // guard is what keeps a mock from ever writing a `member_notices` or `audit_events`
            // row for a pick the clock made.
            const picked = isMock ? [] : auditEventsForPicks(state, result.state, submittedActorId, ownerOf);

            // Task 7's first real sender: the manager whose pick the clock made for them is told
            // nothing today, and this is that telling. `picked` and the new picks slice are built
            // from the SAME diff (`next.picks.slice(previous.picks.length)`), so index `i` names
            // the same pick in both — and `pickIndexOfNotice` carries that index forward so the
            // event minted below can be matched back to the notice that explains it. The durable
            // `member_notices` row IS the delivery (the inbox reads it — `listNotices`); each
            // notice is also pushed to `createdNotices` so `deliverNotice` can push a best-effort
            // LIVE frame for it AFTER this transaction commits — see the comment beside
            // `createdNotices` above.
            const newPicks = result.state.picks.slice(state.picks.length);
            const positionOf = new Map(result.state.pool.map((entry) => [entry.playerId, entry.position]));
            const pending: { readonly notice: MemberNotice; readonly pickIndex: number }[] = [];
            for (let i = 0; i < picked.length; i += 1) {
              if (picked[i]!.actorType !== "system") continue;
              const newPick = newPicks[i]!;
              const context = await autopickNoticeContext(tx, newPick.teamId, newPick.playerId);
              const position = positionOf.get(newPick.playerId);
              if (context === undefined || position === undefined) continue;
              const notice = await notifyAffectedMember(tx, {
                leagueId: result.state.config.leagueId,
                userId: context.userId,
                noticeType: "draft_auto_picked",
                context: { leagueName: context.leagueName, pickNumber: newPick.pickNumber, playerName: context.playerName, position },
                // The PICK's own timestamp, which is also what `auditEventsForPicks` stamps its
                // event with — the same instant, read from the same place, before either row
                // exists. Reading it back off the minted event would mean minting the event first.
                occurredAt: picked[i]!.occurredAt,
                auditEventId: null,
              });
              pending.push({ notice, pickIndex: i });
            }

            // Task 5's own telling: a skip records no PICK at all (`picked` above is built from
            // the picks diff, which a skip never grows), so it needs its own notice rather than
            // riding the `pending` loop above. `newlySkippedPick` diffs the owed-picks before and
            // after — the identical diff `draftEventsFor`'s `skipped` flag reads, so the two can
            // never disagree about which transition this was.
            // TASK 4: a mock never tells anyone their pick was skipped — there is no member to
            // notify (a bot owns no inbox) and no `system_action` event a practice room may
            // write. `skip` stays null outright rather than being diffed and its notice
            // discarded, the same discipline `picked` above keeps.
            const skip = isMock ? null : newlySkippedPick(state, result.state);
            let skipNotice: { readonly notice: MemberNotice; readonly userId: string } | null = null;
            if (skip !== null) {
              const context = await skipNoticeContext(tx, skip.teamId);
              if (context !== undefined) {
                const notice = await notifyAffectedMember(tx, {
                  leagueId: result.state.config.leagueId,
                  userId: context.userId,
                  noticeType: "draft_pick_skipped",
                  context: { leagueName: context.leagueName },
                  occurredAt: action.timestamp,
                  auditEventId: null,
                });
                skipNotice = { notice, userId: context.userId };
              }
            }

            if (options?.alsoInTransaction !== undefined) {
              const extraNotices = await options.alsoInTransaction(tx);
              if (extraNotices !== undefined) createdNotices.push(...extraNotices);
            }
            // A completed draft becomes a season in the same transaction that completed it.
            // `commitDraftState` writes `draft_picks`/`roster_slots` and the schedule, every one
            // of which takes an FK lock on `leagues`/`teams`/`players` — so it runs here, before
            // the anchor, not after it.
            //
            // TASK 4: A MOCK DRAFT NEVER BECOMES A SEASON. `!isMock` guards the ONE call site —
            // `counts` stays `null` for a mock even once every pick is in, which is also what
            // keeps `completedLeagueId` unset below (so `sweepQuietly`'s post-commit trigger
            // never fires for it) and the `draft_completed` audit write further down from ever
            // running (it is itself gated on `counts !== null`). `drafts.status` therefore never
            // reaches `'complete'` for a mock — this engine's `phase: "complete"` is the only
            // place a finished mock draft is ever recorded, and `state.config.isMock` came off
            // the `mock_rooms` sidecar, not off this row, so that is exactly the trace the
            // retention sweep (Task 6) is free to delete without the audit spine noticing.
            const counts =
              !isMock && result.state.phase === "complete" && state.phase !== "complete" ? await commitDraftState(tx, result.state) : null;
            if (counts !== null) completedLeagueId = result.state.config.leagueId;

            // THE ANCHOR, LAST. Nothing below takes a lock on any table another audited
            // transaction locks first.
            //
            // TASK 4: a mock takes no anchor lock at all — `audit.recordAll` is skipped outright
            // (not merely called with an empty `picked`) so this transaction never touches
            // `audit_chains` for a mock draft, the literal proof the trace tests hold this to.
            const pickedEvents = isMock ? [] : await audit.recordAll(tx, picked);
            if (counts !== null) {
              await audit.record(tx, {
                eventType: "draft_completed",
                actorId: null,
                actorType: "system",
                leagueId: result.state.config.leagueId,
                payload: { draftId, picks: counts.picks, teams: counts.teams },
                occurredAt: action.timestamp,
              });
            }

            for (const { notice, pickIndex } of pending) {
              createdNotices.push(await attachAuditEvent(tx, notice, pickedEvents[pickIndex]!.eventId));
            }
            if (skipNotice !== null) {
              // `subjectUserId` is what makes this event meaningful under `subject_only`
              // visibility (`SYSTEM_ACTION_VISIBILITY.draft_pick_skipped`, `@/integrity/system-
              // actions`) — the identical shape `lineup_auto_set`'s own write uses
              // (`@/league-service/auto-lineup`).
              const skipEvent = await audit.record(tx, {
                eventType: "system_action",
                actorId: null,
                actorType: "system",
                leagueId: result.state.config.leagueId,
                payload: { action: "draft_pick_skipped", subjectUserId: skipNotice.userId, pickNumber: skip!.pickNumber, summary: DRAFT_PICK_SKIPPED_SUMMARY },
                occurredAt: action.timestamp,
              });
              createdNotices.push(await attachAuditEvent(tx, skipNotice.notice, skipEvent.eventId));
            }
            return { ok: true, state: result.state };
          });

          if (!outcome.ok) {
            // A rejection may have been decided against a state we loaded inside the lock and
            // then rolled back with it. Drop the materialization rather than keep one whose
            // provenance is a rolled-back transaction.
            cache.delete(draftId);
            return outcome;
          }

          cache.set(draftId, outcome.state);
          if (previous !== null && applied !== null) await broadcast(previous, outcome.state, applied);
          await noteWake(outcome.state);
          // THE MULTI-ACCOUNT SWEEP'S SECOND TRIGGER (final review, HIGH 2), after the commit for
          // the same reason `broadcast` is: this transaction has just released `drafts` FOR
          // UPDATE, and the sweep appends to the PLATFORM chain — a third lock, on an anchor row,
          // which ruling 3 forbids taking while a business lock is held. `sweepQuietly` swallows
          // its own failures, so a detector that falls over never rolls back a finished draft.
          //
          // Fires on the TRANSITION only, and only here: a league's behavioral signal comes into
          // existence exactly when its draft finishes, and until then the join-time trigger's
          // arithmetic cannot reach `flagThreshold` at all (see `triggerMultiAccountSweep`).
          if (completedLeagueId !== null) await sweepQuietly(db, completedLeagueId, "draft_completed");
          // TASK 9'S OWN TRIGGER, beside the sweep above and for the identical reason: this
          // transaction has just released `drafts` FOR UPDATE, and the grades job's own writes
          // (a `draft_grades` insert per team, then a `member_notices` insert per seated member)
          // take locks this transaction cannot still be holding when they run (ruling 3). A mock
          // draft never sets `completedLeagueId` at all (Task 4's own guard, above) — an
          // isMock check here would be redundant, not a second gate. `enqueueDraftGradesJobQuietly`
          // swallows its own failures, the identical `sweepQuietly` discipline, so a queue outage
          // never rolls back a finished draft.
          if (completedLeagueId !== null) await enqueueDraftGradesJobQuietly(db, clock, draftId);
          // Best-effort, after the commit, beside `broadcast` — the inverse of `notifyAffectedMember`'s
          // own discipline: the durable row above already failed the transaction if it had to;
          // this frame never fails anything, because the write it announces already landed.
          for (const notice of createdNotices) {
            try {
              await deliver(notice);
            } catch (error: unknown) {
              onPublishError?.(error, { type: "notice.created", leagueId: notice.leagueId ?? "" });
            }
          }
          return outcome;
        } catch (error: unknown) {
          // Our view of the log is provably stale — drop it so the next read replays.
          cache.delete(draftId);
          // The unique index remains the backstop. With the row lock in place this should be
          // unreachable; if it fires, that is a real signal that something wrote outside the
          // lock, so it keeps its user-facing retry message rather than being swallowed.
          if (isSequenceConflict(error)) return { ok: false, reason: "Someone else acted first. Try again." };
          // See `DraftActionRefused`'s own docblock — the one refusal a `DraftActionSource`
          // thunk can raise from inside the transaction it runs in.
          if (error instanceof DraftActionRefused) return { ok: false, reason: error.reason };
          throw error;
        }
      });
    },

    async startDraft(draftId, options?: StartDraftOptions) {
      // Reads happen OUTSIDE the mutex — applyAction (below) takes it once. Acquiring it
      // here too would deadlock, since the mutex is not reentrant.
      const config = await loadDraftConfig(db, draftId);
      if (config === null) return { ok: false, reason: "That draft does not exist." };

      // Guards against a draft the reducer's own "already started"/"already finished" checks
      // cannot see: one whose `drafts.status` was written straight to "complete" (e.g. the
      // season-league seed, which deals rosters directly) without ever writing a single
      // action. Replaying that empty log yields phase "scheduled" — indistinguishable, to the
      // reducer, from a draft that has never run — so without this check START_DRAFT would be
      // admitted and would draft a second time over rosters that already exist.
      const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, draftId));
      if (row?.status === "complete") {
        const existingActions = await db.select({ id: draftActions.draftId }).from(draftActions).where(eq(draftActions.draftId, draftId)).limit(1);
        if (existingActions.length === 0) return { ok: false, reason: "This draft has already finished." };
      }

      // Fix round 1, M5 (controller ruling). The founder's "roll until full" ruling binds the
      // platform door absolutely; a PUBLIC MATCHMADE MEMBER league's commissioner pressing this
      // SAME button by hand is the one human door that could otherwise undercut it, so it is
      // refused rather than merely warned — `PUBLIC_ROOM_SHORT_REFUSAL`'s own docblock
      // (`@/matchmaking/roll`) states the full reasoning and why a PRIVATE league (no way at all
      // to ever draft otherwise) and a HOUSE league (no commissioner to press anything) are both
      // untouched by it. Scoped to a MANUAL press only (`options?.auto !== true`): the platform's
      // own auto-start already only ever reaches a full room (`dueDraftsQuery`'s own seat-count
      // predicate, `@/draft-service/auto-start`), so this would be a redundant, never-true check
      // on that path. NO-WRITE-BEFORE-REFUSAL: this reads `leagues`/`teams`, writes nothing, and
      // returns before `applyAction` (the one place this function writes) is ever reached.
      if (options?.auto !== true) {
        const [leagueRow] = await db
          .select({ isPublicMatchmade: leagues.isPublicMatchmade, houseRung: leagues.houseRung, teamCount: leagues.teamCount })
          .from(leagues)
          .where(eq(leagues.id, config.leagueId));
        if (leagueRow !== undefined && leagueRow.isPublicMatchmade && leagueRow.houseRung === null) {
          const seated = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, config.leagueId));
          if (hasOpenSeat({ teamCount: leagueRow.teamCount, filledTeams: seated.length })) {
            return { ok: false, reason: PUBLIC_ROOM_SHORT_REFUSAL };
          }
        }
      }

      // One instant for both the action's own timestamp and (when `auto`) the announcement's
      // `occurredAt` — read once here rather than twice, which could otherwise disagree by
      // however long the transaction below takes to reach the second read.
      const now = clock.now();
      // Phase 3.6, Task 8's BINDING PRECONDITION (the 3.5 fix-wave re-review): `teamRows` and
      // `pool` used to be read HERE, out of transaction, before `drafts FOR UPDATE` was ever
      // taken — a window `releaseSeat` (`@/league-service/release`) could commit inside, persisting
      // a departed team's id into `draftOrder`, which the reducer's replay rule then makes
      // PERMANENT. Both reads now happen INSIDE the `DraftActionSource` thunk below, under the
      // SAME `drafts FOR UPDATE` the slot-preference draw already runs under (`DraftActionSource`'s
      // own docblock) — `releaseSeat` takes `leagues FOR UPDATE` as ITS first statement, which
      // blocks this function's own `leagues FOR KEY SHARE` (`applyAction`'s first statement) for as
      // long as a release is in flight, so whichever of the two commits first is what the other
      // one's in-lock read sees. `teamRows` is captured into this outer, mutable binding so
      // `alsoInTransaction` below — which runs AFTER the thunk resolves, in the SAME transaction —
      // can reach the identical rows without a second, out-of-lock read; `applyAction` always calls
      // `source(tx)` before it ever reaches `alsoInTransaction`, so this is set by the time it is
      // read (see `applyAction`'s own body).
      let lockedTeamRows: readonly { readonly id: string; readonly userId: string; readonly leagueName: string }[] | null = null;
      return store.applyAction(
        draftId,
        // A `DraftActionSource` FUNCTION, not a value (final whole-branch review, F9). Every read
        // this action needs — the team roster, the draft pool, and Task 6's slot-preference draw —
        // now happens under the `drafts FOR UPDATE` this same transaction takes — see
        // `DraftActionSource`'s own docblock. Everything else here is already decided.
        async (tx) => {
          // `userId`/`leagueName` ride along with `id` on this ONE read (rather than a second query
          // later): `draftOrder.length < 2` is `reduceStart`'s own precondition, checked against
          // exactly this array's derived order, so if `applyAction` ever reaches
          // `alsoInTransaction` these rows are already provably >= 2 — there is nothing a second
          // re-query could learn that this one has not already established.
          const teamRows = await tx
            .select({ id: teams.id, userId: teams.userId, leagueName: leagues.name })
            .from(teams)
            .innerJoin(leagues, eq(leagues.id, teams.leagueId))
            .where(eq(teams.leagueId, config.leagueId))
            .orderBy(teams.id);
          lockedTeamRows = teamRows;
          const pool = await buildDraftPool(tx, config.leagueId);
          // A thunk may only ever return a `DraftAction` — never an `ApplyResult` — so this
          // refusal rides `DraftActionRefused` (this module's own escape hatch, see its docblock)
          // rather than an early `return { ok: false, ... }`, which is no longer reachable from here.
          if (pool.length === 0) throw new DraftActionRefused("There are no players to draft yet.");
          return {
            v: DRAFT_ACTION_VERSION,
            type: "START_DRAFT",
            timestamp: now,
            // Task 6: NFFC's Kentucky Derby System. The draw's OUTPUT is what rides the persisted
            // action from here on (`draftOrder` itself), so replay never re-reads this table and a
            // preference saved after this instant can never change history (ruling 27 — see
            // `draft_slot_preferences`'s own docblock in `@/db/schema`). What F9 changed is only
            // WHEN the input is read, never that the output is a snapshot.
            // Mock rooms grant a chosen seat outright ("ranked-first" — see `assignDraftSlots`);
            // real leagues keep the fair-lottery draw-order rule byte-identical.
            draftOrder: draftOrderFor(draftId, teamRows.map((t) => t.id), await slotPreferencesFor(tx, draftId), config.isMock === true ? "ranked-first" : "draw-order"),
            pool,
            // Command time is the ONE place the tunable is read — it rides the persisted
            // action from here on, so replay never consults AUCTION_CONFIG.
            minBid: AUCTION_CONFIG.minBid,
            // Task 5's identical discipline: the skip-and-owe allowance rides the action from
            // here on, so a later deploy that changes `DRAFT_SKIP_POLICY` can never change what
            // an already-persisted TIMER_EXPIRE did on replay.
            skipPolicy: DRAFT_SKIP_POLICY,
            // The need-aware autopick scoring rides the action the same way: `bestAvailableFor`
            // reads ONLY this snapshot while folding an expiry, so retuning `AUTOPICK_CONFIG`
            // changes future drafts and never what an already-persisted autopick WAS.
            autopick: AUTOPICK_CONFIG,
          };
        },
        {
          alsoInTransaction: async (tx) => {
            // `claimAutoStart` (`./auto-start.ts`), not a plain `UPDATE`: one start implementation
            // for both a commissioner's manual press and the platform's own auto-start, on the
            // SAME guarded transition. Under today's invariants this can never return `false`
            // here — `admitCommand`/`reduceStart` above already refused a second `START_DRAFT`
            // against a log that already has one, under the `drafts FOR UPDATE` lock this
            // transaction has held since before either check ran — so a `false` here is a real
            // invariant violation (the status column disagreeing with the action log it is
            // supposed to mirror), not a race either caller needs to plan for. Thrown, not
            // swallowed, for the same reason `lockAnchor`'s own "vanished between insert and
            // lock" throw is: a state this codebase's own locking makes unreachable is a bug to
            // surface loudly, not a rejection to hand back quietly.
            const claimed = await claimAutoStart(tx, draftId);
            if (!claimed) throw new Error(`Draft "${draftId}" was not "scheduled" when its own start transaction tried to claim it.`);
            // TASK 4 FIX ROUND (review MEDIUM 1). `config.isMock === true` sits in this ONE
            // condition beside `options?.auto !== true`, not as a separate early return: a mock
            // draft never announces itself, full stop, regardless of who calls `startDraft` with
            // `{ auto: true }`. `dueDraftsQuery`'s own `is_public_matchmade` predicate
            // (`./auto-start.ts`) already keeps a mock off the platform's real auto-start scan —
            // every mock ships `is_public_matchmade: false` — but that is a fact about the ONE
            // caller this codebase has today, not a guarantee this function can enforce on its
            // own. This is the belt over that suspenders (and over `leagues_mock_private_ck`'s
            // own CHECK, Task 2's fix round): a future caller class that somehow reached here
            // with `{ auto: true }` against a mock draft still writes no notice and no audit
            // event, the identical guarantee `applyAction`'s own `isMock` branches give every
            // other effect site.
            if (options?.auto !== true || config.isMock === true) return;

            // TASK 7'S ANNOUNCEMENT, FUSED HERE rather than in a second, post-commit transaction
            // (review fix round 1, F1): a crash between "the draft started" and "the league was
            // told" would otherwise leave a real started draft with no audit trail and no
            // notices, permanently — `autoStartDueDrafts`'s own scan only ever finds a draft
            // whose status is still `'scheduled'`, so nothing would ever revisit it. Fused into
            // this one transaction, that state is not merely unlikely, it is UNREPRESENTABLE:
            // either both halves commit or neither does, the identical property `claimAutoStart`
            // above already gives the start itself.
            //
            // `draft_auto_started` is league-scoped and `SYSTEM_ACTION_VISIBILITY` allows it to
            // everyone (Task 4) — a fact about the league's shared calendar, true for everyone in
            // it, about nobody's conduct — so this sends ONE notice per TEAM in the league, all
            // referencing the SAME `system_action` event: the identical one-event-many-notices
            // shape `resolveFlag`'s `trade_blocked` branch uses (`@/integrity-service/flags`).
            //
            // ONE-TRANSACTION DISCIPLINE, held to the same order as the rest of this function:
            // business rows (the claim above) -> notices -> audit.record -> attachAuditEvent ->
            // anchor last. `picked` is empty for a fresh `START_DRAFT` (no picks exist yet), so
            // the anchor `audit.recordAll(tx, picked)` below this callback's return is a no-op —
            // THIS event is the transaction's only anchor write, and nothing after it takes a
            // lock this callback's own `audit.record` has not already accounted for.
            //
            // `lockedTeamRows` is the THUNK's own read above (`id`/`userId`/`leagueName`
            // together, taken under `drafts FOR UPDATE`) — never re-queried here, and never
            // `null` at this point: `applyAction` always resolves `source(tx)` (which sets it)
            // before it ever reaches `alsoInTransaction`. `reduceDraft`/`reduceStart` already
            // admitted `draftOrder` (built from this exact array) as >= 2 teams before
            // `alsoInTransaction` ever runs, under the SAME lock, so by the time this line runs
            // `teamRows.length >= 2` is not assumed, it is ALREADY PROVEN.
            const teamRows = lockedTeamRows!;
            const created: MemberNotice[] = [];
            for (const teamRow of teamRows) {
              created.push(
                await notifyAffectedMember(tx, {
                  leagueId: config.leagueId,
                  userId: teamRow.userId,
                  noticeType: "draft_auto_started",
                  context: { leagueName: teamRow.leagueName },
                  occurredAt: now,
                  auditEventId: null,
                }),
              );
            }
            const event = await audit.record(tx, {
              eventType: "system_action",
              actorId: null,
              actorType: "system",
              leagueId: config.leagueId,
              // `summary` IS THE RENDERED SENTENCE, and without it this event was written, read
              // and discarded for every viewer, always: `renderSystemAction`
              // (`@/integrity/activity-view`) answers `null` for a `system_action` with no
              // summary, so a code granted `"everyone"` shipped as a declared-and-unimplemented
              // value (final review F7). Nothing failed and no test caught it, because the intent
              // was delivered by the per-team notice above.
              //
              // Written for the SANCTIONED AUDIENCE, which for this code is the whole league
              // (`SYSTEM_ACTION_VISIBILITY.draft_auto_started` is `"everyone"`: a fact about the
              // league's shared calendar, true for everyone in it, about nobody's conduct). So
              // the sentence names no member and says only what happened, in the same voice the
              // notice's own body opens with.
              payload: { action: "draft_auto_started", summary: DRAFT_AUTO_STARTED_SUMMARY },
              occurredAt: now,
            });
            const attached: MemberNotice[] = [];
            for (const notice of created) attached.push(await attachAuditEvent(tx, notice, event.eventId));
            return attached;
          },
        },
      );
    },

    async commitDraftResults(draftId) {
      return mutex.run(draftId, async (): Promise<CommitResult> => {
        // `load` (not `getDraftState`) — we already hold the mutex here.
        const state = await load(draftId);
        if (state === null) return { ok: false, reason: "That draft does not exist." };
        if (state.phase !== "complete") return { ok: false, reason: "This draft isn't finished yet." };
        const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, draftId));
        if (row?.status === "complete") {
          return { ok: true, picks: state.picks.length, teams: Object.keys(state.rosters).length, alreadyCommitted: true };
        }
        const counts = await db.transaction((tx) => commitDraftState(tx, state));
        return { ok: true, ...counts, alreadyCommitted: false };
      });
    },
  };

  return store;
}
