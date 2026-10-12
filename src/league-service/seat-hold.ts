import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db, DbTx, ReadonlyDb } from "@research/db/client";
import { drafts, leagues, seatHolds, teams } from "@/db/schema";
import { hasOpenSeat } from "@/matchmaking/filter";
import { plusMinutesIso } from "@/matchmaking/house-catalog";
import { SEAT_HOLD, SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";

export interface ClaimSeatHoldInput {
  readonly leagueId: string;
  /** An opaque random id minted by the caller (the API route) — this function never generates
   *  one itself, the same "identity never from the client, but the ID GENERATOR stays at the
   *  edge" shape `joinLeagueInTx`'s own `newId` parameter already follows. */
  readonly token: string;
  readonly now: string;
}

export type ClaimSeatHoldOutcome = { readonly ok: true; readonly expiresAt: string } | { readonly ok: false; readonly reason: string };

/**
 * Live holds against `leagueId` at `nowIso` — expiry is a PREDICATE (`expires_at > now`), never a
 * deletion somebody has to schedule (Step 2's own reasoning, and `seat_holds`'s own docblock in
 * `@research/db/schema`). `db` is `ReadonlyDb`, so a standalone caller (a plain `Db`, this function's own
 * exported use) and a caller mid-transaction (`claimSeatHold` and `joinLeagueInTx`, both handing
 * in their own `DbTx`) satisfy the same signature without a second copy of this query.
 */
export async function liveHoldsFor(db: ReadonlyDb, leagueId: string, nowIso: string): Promise<number> {
  const rows = await db
    .select({ token: seatHolds.token })
    .from(seatHolds)
    .where(and(eq(seatHolds.leagueId, leagueId), isNull(seatHolds.consumedAt), gt(seatHolds.expiresAt, new Date(nowIso))));
  return rows.length;
}

/**
 * Reserves a seat for a visitor who is not signed in yet, keyed by `input.token` and nothing else
 * (Step 3 — the token is not an identity and grants nothing beyond "the right to find a seat
 * still there"). Called from `POST /api/public/leagues/[leagueId]/hold`, the ONLY writer of this
 * table.
 *
 * **The lock, and why it is the identical one `joinLeagueInTx` already takes.** `leagues[X] FOR
 * UPDATE` first, as its own statement, before counting either real seats or live holds — the
 * global lock order this codebase holds every capacity writer to. A hold and a join for the same
 * league fully serialize against each other because both start here.
 *
 * **FK ACQUISITIONS, ENUMERATED (Step 2).** The `INSERT` below takes an implicit `FOR KEY SHARE`
 * on `leagues` (the `league_id` FK) — a lock this transaction is ALREADY holding `FOR UPDATE` by
 * the time the insert runs, so it is not a second edge, the identical reasoning `joinLeagueInTx`'s
 * own `teams` insert already rests on for the same row. Nothing else here takes a lock: `leagues`
 * is locked ALONE, in its own statement — never joined into the same `FOR UPDATE` as `drafts`,
 * which would ask Postgres to lock BOTH tables' rows in one statement and quietly widen this
 * transaction's own lock footprint beyond the one row every other capacity writer in this
 * codebase takes first. The draft-status read that follows is a plain, unlocked `SELECT`, the
 * identical shape `publicJoinPrecondition` (`@/league-service/join`) already reads it with, once
 * `leagues FOR UPDATE` is already held.
 *
 * Refuses a private league or one whose draft already started, the SAME two facts
 * `publicJoinPrecondition` checks before a real join — a hold on a league nobody could actually
 * join through this door would spend a visitor's ten minutes on a seat that was never really
 * reachable. It does NOT check tier eligibility: there is no identity yet to check one against
 * (Step 3), and the join door re-checks it for real once there is.
 */
export async function claimSeatHold(db: Db, input: ClaimSeatHoldInput): Promise<ClaimSeatHoldOutcome> {
  return db.transaction(async (tx) => {
    const [league] = await tx
      .select({ id: leagues.id, teamCount: leagues.teamCount, isPublicMatchmade: leagues.isPublicMatchmade })
      .from(leagues)
      .where(eq(leagues.id, input.leagueId))
      .for("update");
    if (league === undefined || !league.isPublicMatchmade) return { ok: false, reason: SEAT_HOLD_REFUSALS.noSeat };

    const [draft] = await tx.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, league.id));
    if (draft !== undefined && draft.status !== "scheduled") {
      return { ok: false, reason: SEAT_HOLD_REFUSALS.noSeat };
    }

    const filled = await tx.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, league.id));
    const liveHolds = await liveHoldsFor(tx, league.id, input.now);
    if (!hasOpenSeat({ teamCount: league.teamCount, filledTeams: filled.length }, liveHolds)) {
      return { ok: false, reason: SEAT_HOLD_REFUSALS.noSeat };
    }

    const expiresAt = plusMinutesIso(input.now, SEAT_HOLD.minutes);
    await tx.insert(seatHolds).values({ token: input.token, leagueId: league.id, expiresAt: new Date(expiresAt) });
    return { ok: true, expiresAt };
  });
}

/**
 * The live expiry of `token` for `leagueId`, or `null` when it names no live hold there — a
 * token for a different league, an already-consumed one, an expired one, or one that was never
 * real. `POST /api/public/leagues/[leagueId]/hold`'s own idempotency check: a visitor who refreshes
 * the interstitial (or whose click fires twice) reuses their existing live hold's own expiry
 * rather than minting a second row and quietly holding two seats' worth of capacity for one
 * person. Read-only — unlike `consumeSeatHoldInTx`, this never marks anything.
 */
export async function liveHoldExpiry(db: ReadonlyDb, token: string, leagueId: string, nowIso: string): Promise<string | null> {
  const [hold] = await db.select({ leagueId: seatHolds.leagueId, expiresAt: seatHolds.expiresAt, consumedAt: seatHolds.consumedAt }).from(seatHolds).where(eq(seatHolds.token, token));
  if (hold === undefined || hold.leagueId !== leagueId || hold.consumedAt !== null) return null;
  if (hold.expiresAt.getTime() <= Date.parse(nowIso)) return null;
  return hold.expiresAt.toISOString();
}

export interface ConsumeSeatHoldInput {
  readonly token: string;
  readonly leagueId: string;
  readonly now: string;
}

export type ConsumeSeatHoldOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "absent" | typeof SEAT_HOLD_REFUSALS.spent | typeof SEAT_HOLD_REFUSALS.expired };

/**
 * Redeems a hold INSIDE THE CALLER'S OWN TRANSACTION (`joinLeagueInTx`, `@/league-service/join`)
 * — never opens one of its own, unlike `claimSeatHold` above. Takes no new lock: this is an
 * `UPDATE ... WHERE token = ...` by primary key, and `token` carries no foreign key of its own, so
 * nothing here reaches for `leagues` at all. The `leagues[X] FOR UPDATE` the caller already holds
 * is what serializes this against a concurrent `claimSeatHold` on the same league — "adds no new
 * edge", per Step 2's own FK enumeration.
 *
 * Three ways to fail, told apart because the caller treats them differently: `"absent"` (no such
 * token, or one that names a different league — a stale or garbage cookie, silently treated the
 * same as no hold at all rather than a refusal); `SEAT_HOLD_REFUSALS.spent` (this exact token
 * already seated somebody — a real refusal); `SEAT_HOLD_REFUSALS.expired` (the token was real, but
 * its ten minutes ran out — `joinLeagueInTx` falls through to an ordinary capacity check rather
 * than refusing outright, and `returnFromSignIn` turns that into "we put you in it anyway").
 */
export async function consumeSeatHoldInTx(tx: DbTx, input: ConsumeSeatHoldInput): Promise<ConsumeSeatHoldOutcome> {
  const [hold] = await tx.select().from(seatHolds).where(eq(seatHolds.token, input.token));
  if (hold === undefined || hold.leagueId !== input.leagueId) {
    return { ok: false, reason: "absent" };
  }
  if (hold.consumedAt !== null) {
    return { ok: false, reason: SEAT_HOLD_REFUSALS.spent };
  }
  if (hold.expiresAt.getTime() <= Date.parse(input.now)) {
    return { ok: false, reason: SEAT_HOLD_REFUSALS.expired };
  }
  await tx.update(seatHolds).set({ consumedAt: new Date(input.now) }).where(eq(seatHolds.token, input.token));
  return { ok: true };
}
