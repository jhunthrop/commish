import { asc, eq, sql } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { draftActions, drafts, leagues, players, teams } from "@/db/schema";
import { DRAFT_ACTION_VERSION, type DraftAction } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import {
  admitCommand,
  AUCTION_CONFIG,
  DRAFT_SKIP_POLICY,
  draftActionSchema,
  draftEventsFor,
  newlySkippedPick,
  reduceDraft,
  replayDraft,
  type DraftState,
} from "@/draft-engine";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { sweepQuietly } from "@/integrity-service/multi-account";
import { attachAuditEvent, deliverNotice, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import type { RealtimeEventType } from "@/lib/realtime/events";
import type { PublishFn } from "@/lib/realtime/publish";
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

export interface DraftStore {
  getDraftState(draftId: string): Promise<DraftState | null>;
  applyAction(draftId: string, action: DraftAction, options?: ApplyOptions): Promise<ApplyResult>;
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
}: DraftStoreDeps): DraftStore {
  const cache = new Map<string, DraftState>();
  const mutex = createKeyedMutex();

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

    async applyAction(draftId, action, options?: ApplyOptions) {
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
            if (league === undefined) return { ok: false, reason: "That draft doesn't exist." };

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
            if (locked === undefined) return { ok: false, reason: "That draft doesn't exist." };

            // Loaded INSIDE the lock and validated against the log, so a state another instance
            // has already advanced can never be the state this action is admitted against.
            const state = await load(draftId, tx);
            if (state === null) return { ok: false, reason: "That draft doesn't exist." };
            previous = state;

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
            const contestedWinners = submittedActorId === null
              ? result.state.picks.slice(state.picks.length).filter((p) => !p.auto).map((p) => p.teamId)
              : [];
            const ownerOf = await ownerIdsForContestedPicks(tx, contestedWinners);
            const picked = auditEventsForPicks(state, result.state, submittedActorId, ownerOf);

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
            const skip = newlySkippedPick(state, result.state);
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
            const counts =
              result.state.phase === "complete" && state.phase !== "complete" ? await commitDraftState(tx, result.state) : null;
            if (counts !== null) completedLeagueId = result.state.config.leagueId;

            // THE ANCHOR, LAST. Nothing below takes a lock on any table another audited
            // transaction locks first.
            const pickedEvents = await audit.recordAll(tx, picked);
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
          if (previous !== null) await broadcast(previous, outcome.state, action);
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
          throw error;
        }
      });
    },

    async startDraft(draftId, options?: StartDraftOptions) {
      // Reads happen OUTSIDE the mutex — applyAction (below) takes it once. Acquiring it
      // here too would deadlock, since the mutex is not reentrant.
      const config = await loadDraftConfig(db, draftId);
      if (config === null) return { ok: false, reason: "That draft doesn't exist." };

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

      // `userId`/`leagueName` ride along with `id` on this ONE read (rather than a second query
      // inside the transaction below): `draftOrder.length < 2` is `reduceStart`'s own precondition,
      // checked against exactly this array's derived order, so if `applyAction` ever reaches
      // `alsoInTransaction` these rows are already provably >= 2 — there is nothing an inner
      // re-query could learn that this one has not already established.
      const teamRows = await db
        .select({ id: teams.id, userId: teams.userId, leagueName: leagues.name })
        .from(teams)
        .innerJoin(leagues, eq(leagues.id, teams.leagueId))
        .where(eq(teams.leagueId, config.leagueId))
        .orderBy(teams.id);
      const pool = await buildDraftPool(db, config.leagueId);
      if (pool.length === 0) return { ok: false, reason: "There are no players to draft yet." };
      // Task 6: NFFC's Kentucky Derby System. Read once, here, at command time — the exact same
      // discipline `minBid`/`skipPolicy` below already follow: the draw's OUTPUT is what rides
      // the persisted action from here on (`draftOrder` itself), so replay never re-reads this
      // table and a preference saved or changed after this instant can never change history
      // (ruling 27 — see `draft_slot_preferences`'s own docblock in `@/db/schema`).
      const preferences = await slotPreferencesFor(db, draftId);
      // One instant for both the action's own timestamp and (when `auto`) the announcement's
      // `occurredAt` — read once here rather than twice, which could otherwise disagree by
      // however long the transaction below takes to reach the second read.
      const now = clock.now();
      return store.applyAction(
        draftId,
        {
          v: DRAFT_ACTION_VERSION,
          type: "START_DRAFT",
          timestamp: now,
          draftOrder: draftOrderFor(draftId, teamRows.map((t) => t.id), preferences),
          pool,
          // Command time is the ONE place the tunable is read — it rides the persisted
          // action from here on, so replay never consults AUCTION_CONFIG.
          minBid: AUCTION_CONFIG.minBid,
          // Task 5's identical discipline: the skip-and-owe allowance rides the action from
          // here on, so a later deploy that changes `DRAFT_SKIP_POLICY` can never change what
          // an already-persisted TIMER_EXPIRE did on replay.
          skipPolicy: DRAFT_SKIP_POLICY,
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
            if (options?.auto !== true) return;

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
            // `teamRows` is the OUTER read above (`id`/`userId`/`leagueName` together, taken once
            // before this transaction opened) — never re-queried here. `reduceDraft`/`reduceStart`
            // already admitted `draftOrder` (built from this exact array) as >= 2 teams before
            // `alsoInTransaction` ever runs, under the SAME `drafts FOR UPDATE` lock this
            // transaction has held since before that check, so by the time this line runs
            // `teamRows.length >= 2` is not assumed, it is ALREADY PROVEN.
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
        if (state === null) return { ok: false, reason: "That draft doesn't exist." };
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
