import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leagueWaivers, teams, waiverClaims } from "@/db/schema";
import type { Clock } from "@/domain/timing";

const systemClock: Clock = { now: () => new Date().toISOString() };
import { claimPlayer } from "./claims";

/**
 * How long a dropped player sits on waivers before he can be won — the incumbent's default
 * (roadmap item 4, 2026-08-30). One constant, one spelling.
 */
export const WAIVER_PERIOD_HOURS = 24;

/**
 * WAIVERS v1. The model, in three sentences: a player dropped through a claim enters a
 * {@link WAIVER_PERIOD_HOURS}-hour window (`league_waivers`); a claim on a waivered player is
 * FILED (`waiver_claims`, pending) rather than executed; when the window closes, the filed
 * claims resolve by waiver priority — lowest `teams.waiver_priority` wins, the winner moves to
 * last (max+1), and the order NEVER resets, which is exactly the reference product's default
 * ("Move to Last After Claim, Never Reset Order").
 *
 * PROCESSING IS LAZY, NOT SCHEDULED. `processWaivers` runs at the top of every pool read and
 * every claim, so an expired window resolves on the next touch. A cron can fail silently for a
 * week; a read-path processor cannot — the manager who opens the board IS the tick. The cost is
 * one indexed query when nothing is due.
 */
export async function processWaivers(db: Db, clock: Clock = systemClock): Promise<{ readonly awarded: number }> {
  const now = new Date(clock.now());
  const due = await db.select().from(leagueWaivers).where(lte(leagueWaivers.until, now));
  let awarded = 0;

  for (const window of due) {
    const bids = await db
      .select({
        id: waiverClaims.id,
        teamId: waiverClaims.teamId,
        dropPlayerId: waiverClaims.dropPlayerId,
        priority: teams.waiverPriority,
        ownerUserId: teams.userId,
        createdAt: waiverClaims.createdAt,
      })
      .from(waiverClaims)
      .innerJoin(teams, eq(teams.id, waiverClaims.teamId))
      .where(
        and(
          eq(waiverClaims.leagueId, window.leagueId),
          eq(waiverClaims.addPlayerId, window.playerId),
          eq(waiverClaims.status, "pending"),
        ),
      )
      .orderBy(asc(teams.waiverPriority), asc(waiverClaims.createdAt));

    let winner: (typeof bids)[number] | undefined;
    for (const bid of bids) {
      // The award runs through `claimPlayer` itself — every guard a live claim has (membership,
      // capacity, the drop's validity, undroppables) rules here too, and a bid that fails its
      // guards loses with the refusal as its note while the next priority gets its chance.
      const result = await claimPlayer(
        db,
        { leagueId: window.leagueId, userId: bid.ownerUserId, addPlayerId: window.playerId, dropPlayerId: bid.dropPlayerId },
        { viaWaivers: true, clock },
      );
      if (result.ok) {
        winner = bid;
        await db
          .update(waiverClaims)
          .set({ status: "won", resolvedAt: now })
          .where(eq(waiverClaims.id, bid.id));
        // Move to last, never reset: max priority in the league plus one.
        const [maxRow] = await db
          .select({ max: sql<number>`coalesce(max(${teams.waiverPriority}), 0)::int` })
          .from(teams)
          .where(eq(teams.leagueId, window.leagueId));
        await db.update(teams).set({ waiverPriority: (maxRow?.max ?? 0) + 1 }).where(eq(teams.id, bid.teamId));
        awarded += 1;
        break;
      }
      await db
        .update(waiverClaims)
        .set({ status: "lost", note: result.reason, resolvedAt: now })
        .where(eq(waiverClaims.id, bid.id));
    }

    // Everyone behind the winner lost to priority, in those words.
    if (winner !== undefined) {
      await db
        .update(waiverClaims)
        .set({ status: "lost", note: "A team with better waiver priority won him.", resolvedAt: now })
        .where(
          and(
            eq(waiverClaims.leagueId, window.leagueId),
            eq(waiverClaims.addPlayerId, window.playerId),
            eq(waiverClaims.status, "pending"),
          ),
        );
    }

    // The window is spent either way: no bids means he simply clears to first-come-first-served.
    await db
      .delete(leagueWaivers)
      .where(and(eq(leagueWaivers.leagueId, window.leagueId), eq(leagueWaivers.playerId, window.playerId)));
  }
  return { awarded };
}
