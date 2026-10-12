import { and, eq, gt } from "drizzle-orm";
import type { Db, DbTx } from "@research/db/client";
import { drafts, leagues, mockRooms, teams, users } from "@/db/schema";
import type { Clock } from "@research/domain/timing";
import type { DraftStore } from "@/draft-service/store";
import { MOCK_CONFIG } from "@/mock-draft/config";

/**
 * The practice door's own refusals, named once so every layer — the writers here, Task 7's
 * routes, the tests — speaks the identical sentence for the identical failure, the
 * `SEAT_HOLD_REFUSALS`/`ENFORCEMENT_REFUSALS` shape. Every sentence passes `copyViolations`
 * (`@/integrity/copy-rules`), held by `claim.test.ts`'s own sweep. `missing` deliberately covers
 * both "never existed" and "the retention sweep already cleared it": a stranger holding a stale
 * code learns only that the room is gone, the same no-existence-oracle discipline
 * `joinLeagueInTx`'s shared draft-status refusal keeps for real leagues.
 */
export const MOCK_REFUSALS = {
  missing: "That mock draft does not exist. Check the link or start a new one.",
  started: "This mock draft has already started. Start a new one whenever you like.",
  full: "This mock draft is already full. Start a new one whenever you like.",
  /** `topUpBots`' structural guard (`./start`): a bot may only ever be seated into a league a
   *  `mock_rooms` row vouches for — a real league reached by mistake refuses before one bot row
   *  is drawn. */
  notMock: "That league is not a mock draft.",
} as const;

/**
 * The collaborators every mock lifecycle writer draws from, injected at the edge exactly like
 * `LeagueWriteDeps` (`@/league-service/creation`): the route (Task 7) supplies the real store,
 * the wall clock, `crypto.randomUUID` ids, a `crypto`-derived 32-bit `newSeed` and a
 * `crypto.getRandomValues`-backed `random` for the share code — a share code admits strangers to
 * a room, so like an invite code its randomness must be unpredictable. Tests supply
 * deterministic versions of all five. Each writer takes the `Pick` of what it actually uses, so
 * a test never builds a store for a function that never starts anything.
 *
 * Declared here, beside the first door that consumes it, because `./creation` imports `./start`
 * (the solo path calls `startMockDraft` after commit) and `./start` imports this module (the
 * refusals) — this file is the one module in the trio that imports neither sibling.
 */
export interface MockLifecycleDeps {
  readonly store: DraftStore;
  readonly clock: Clock;
  /** `crypto.randomUUID` at the edge — injected so ids are deterministic in a test. */
  readonly newId: () => string;
  /** The room's `botSeed`, drawn ONCE at creation and stored — `mock_rooms.bot_seed` is a 32-bit
   *  integer, so the edge derives one from `crypto` entropy and nothing ever re-draws it. */
  readonly newSeed: () => number;
  /** Uniform `[0, 1)` for the share-code draw (`generateInviteCode`, `@/league`). */
  readonly random: () => number;
}

export interface ClaimMockSeatInput {
  readonly code: string;
  readonly userId: string;
}

export type ClaimMockSeatOutcome =
  | {
      readonly ok: true;
      readonly leagueId: string;
      readonly draftId: string;
      readonly teamId: string;
      /** `true` when this person already held a seat — a re-entry, never an error, so a
       *  double-click or a reopened link resolves back to the same room. */
      readonly alreadySeated: boolean;
    }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/** The one wrapper production and the lock-order suite call: the in-tx core below, inside its
 *  own transaction. */
export async function claimMockSeat(db: Db, input: ClaimMockSeatInput, deps: Pick<MockLifecycleDeps, "clock" | "newId">): Promise<ClaimMockSeatOutcome> {
  return db.transaction((tx) => claimMockSeatInTx(tx, input, deps));
}

/**
 * The lobby/link door: give this person a seat in the mock room this share code names.
 *
 * **LOCK ORDER, ENUMERATED** (the branch-wide law, `src/integrity-service/lock-order.test.ts`).
 * In statement order this transaction takes: a plain `mock_rooms` read by share code (no row
 * lock — the league id is not known until this answers); `leagues[X] FOR UPDATE`, the SAME first
 * lock `joinLeagueInTx`, `releaseSeat` and every other seat writer takes, which serializes every
 * claim, top-up and release for this league whatever door it came through; plain `drafts`/`teams`
 * /`users` reads under it; the `teams` INSERT (implicit `FOR KEY SHARE` on `leagues` — already
 * held — and on `users`, a row nothing ever takes `FOR UPDATE`); and, on the filling claim only,
 * an `UPDATE mock_rooms SET starts_at` — a non-key update of a row whose only other writers
 * (`createMockRoom` at birth, the Task 6 sweep's cascade) also hold `leagues[X]` first, so no
 * new edge. That is leagues-then-drafts-then-nothing.
 *
 * **THE ANCHOR LAW IS SATISFIED VACUOUSLY** (ruling 2). This writer appends NOTHING to the audit
 * chain, creates NO notice and posts NO money — a practice seat is free and consequence-free,
 * and the retention sweep's `DELETE` is only legal because no mock writer ever gives the audit
 * spine's append-only triggers a row to refuse to lose. With no anchor append there is no anchor
 * lock, so "anchor last" holds with nothing to order — proven by `claim.test.ts`'s statement-log
 * spy, not promised here.
 *
 * **NO seat holds, NO tier gate, NO money gate** (ruling 9): a practice seat costs nothing and
 * protects nothing — the hold machinery exists to make a PAID seat race humane, and the tier
 * wall exists for leagues whose outcomes count. The capacity rule and the unique
 * `(league_id, user_id)` index are the two protections a free practice room actually needs, and
 * both are the real ones every league already has.
 *
 * **Re-entry answers FIRST**, before the started refusal: a seated member reopening their link
 * mid-draft must land back in their room, not be told the room they are drafting in has started.
 * The identical "arriving twice is not an error, and costs nothing" rule `joinLeagueInTx` opens
 * with.
 *
 * Exported beside its wrapper for one consumer: the narrow stub-`DbTx` tests that put the two
 * vanished-row guards below into the state READ COMMITTED makes possible (each statement gets
 * its own snapshot, so the league CAN disappear between the un-locked code read and the lock)
 * but no real-Postgres test can schedule.
 */
export async function claimMockSeatInTx(tx: DbTx, input: ClaimMockSeatInput, deps: Pick<MockLifecycleDeps, "clock" | "newId">): Promise<ClaimMockSeatOutcome> {
  const [room] = await tx.select({ leagueId: mockRooms.leagueId }).from(mockRooms).where(eq(mockRooms.shareCode, input.code));
  if (room === undefined) return { ok: false, status: 404, reason: MOCK_REFUSALS.missing };

  const [league] = await tx.select({ id: leagues.id, teamCount: leagues.teamCount }).from(leagues).where(eq(leagues.id, room.leagueId)).for("update");
  if (league === undefined) return { ok: false, status: 404, reason: MOCK_REFUSALS.missing };

  const [draft] = await tx.select({ id: drafts.id, status: drafts.status }).from(drafts).where(eq(drafts.leagueId, league.id));
  if (draft === undefined) return { ok: false, status: 404, reason: MOCK_REFUSALS.missing };

  const [existing] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leagueId, league.id), eq(teams.userId, input.userId)));
  if (existing !== undefined) return { ok: true, leagueId: league.id, draftId: draft.id, teamId: existing.id, alreadySeated: true };

  if (draft.status !== "scheduled") return { ok: false, status: 409, reason: MOCK_REFUSALS.started };

  const filled = await tx.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, league.id));
  if (filled.length >= league.teamCount) return { ok: false, status: 409, reason: MOCK_REFUSALS.full };

  const [profile] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.userId));
  const teamId = deps.newId();
  await tx.insert(teams).values({ id: teamId, leagueId: league.id, userId: input.userId, name: profile?.displayName ?? "New team" });

  // The last human seat just filled: pull the room's window forward to the sit-and-go grace,
  // mock-sized. Every seat here is human-held by construction — a room only ever holds bots
  // once `seatBotsInTx` runs (solo creation, or the start's own top-up), and a solo room is
  // FULL from birth, so a claim that reaches this line filled a human seat in a room of humans.
  // GUARDED, forward-only (`starts_at > grace`): a window already nearer than the grace — a
  // room filling seconds before its fill window fires — is never pushed BACK, because a stamp
  // that delayed a start would be the opposite of the courtesy it exists to extend. No notice,
  // no audit: ruling 2, same as everything above.
  if (filled.length + 1 === league.teamCount) {
    const startsAt = new Date(Date.parse(deps.clock.now()) + MOCK_CONFIG.earlyStartGraceSeconds * 1000);
    await tx
      .update(mockRooms)
      .set({ startsAt })
      .where(and(eq(mockRooms.leagueId, league.id), gt(mockRooms.startsAt, startsAt)));
  }

  return { ok: true, leagueId: league.id, draftId: draft.id, teamId, alreadySeated: false };
}
