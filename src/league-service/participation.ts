import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DbTx, ReadonlyDb } from "@research/db/client";
import { leagues, matchups, teams } from "@/db/schema";

/**
 * The DB-reading half of participation. `@/participation` itself stays pure — no Postgres, no
 * clock, no I/O — so it can sit on the client-boundary exempt list; every read against `leagues`,
 * `teams` and `matchups` lives here instead.
 */

/**
 * The production read, exported as a builder — the same "EXPLAIN what production runs, never a
 * hand-copied lookalike" discipline `browseQuery`/`chatPageQuery`/`pendingFlagQuery`/`tradesQuery`
 * already use. A completed season is a completed LEAGUE this account has a team in — `teams` is
 * the account's own bounded set (one row per league joined), so this is a single indexed join,
 * never a per-league round trip and never a rollup row that could disagree with the leagues it
 * summarizes. `data-layer-hardening.md`'s threshold is unbounded growth: an account's own team
 * count is bounded by the leagues it has joined, and the unbounded half — every matchup in the
 * product — is exactly what `stampSeasonCompleteInTx` moved off this read path.
 */
export function completedSeasonsQuery(db: ReadonlyDb, userId: string) {
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(teams)
    .innerJoin(leagues, eq(leagues.id, teams.leagueId))
    .where(and(eq(teams.userId, userId), isNotNull(leagues.seasonCompletedAt)));
}

/** How many seasons this account has actually finished — the count `participationTierFor` and
 *  `isVerifiedPlayer` are both read through, never a second copy of the rule. */
export async function completedSeasonsFor(db: ReadonlyDb, userId: string): Promise<number> {
  // `count(*)` with no `GROUP BY` always returns exactly one row, even when nothing matches
  // (a count of 0) — there is no "no rows at all" case to fall back from.
  const [row] = await completedSeasonsQuery(db, userId);
  return row!.count;
}

/**
 * The batched sibling of `completedSeasonsFor`: one query for every id in `userIds`, grouped —
 * the same "batched, never one round trip per row" discipline `listLeagueActivity`'s own name
 * lookups use (`@/integrity-service/activity`). A `GROUP BY` reports no row at all for an id with
 * zero completed seasons, so a missing key reads as zero, never as an error — the review feed's
 * `verifiedFor` (`@/review-service/reviews`) is the first caller, batching the badge's own read
 * over a page's distinct author ids rather than one lookup per review.
 */
export async function completedSeasonsForMany(db: ReadonlyDb, userIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: teams.userId, count: sql<number>`count(*)::int` })
    .from(teams)
    .innerJoin(leagues, eq(leagues.id, teams.leagueId))
    .where(and(inArray(teams.userId, userIds), isNotNull(leagues.seasonCompletedAt)))
    .groupBy(teams.userId);
  return new Map(rows.map((row) => [row.userId, row.count]));
}

/**
 * LOCK NOTE, and the reason this is the LAST statement `finalizeWeekInTx` (`@/stats-pipeline/
 * finalize`) runs rather than the first. `joinLeagueInTx` (`@/league-service/join`) takes
 * `leagues[id] FOR UPDATE` before anything else it does, so a writer that touched `leagues`
 * BEFORE `matchups` inside a settlement transaction would be taking the same two rows in the
 * opposite order and could cycle with it. This statement is an `UPDATE … WHERE
 * season_completed_at IS NULL AND NOT EXISTS(unscored matchup)` — it takes a row-exclusive lock
 * on ONE `leagues` row and nothing else (there is no FK out of `leagues` this statement touches).
 * The ordering property that keeps it safe is not its position among `finalizeWeekInTx`'s own
 * statements but the fact that a settlement transaction takes NO other lock that `joinLeagueInTx`
 * also takes: a league whose last week is being scored has a complete draft
 * (`checkFinalizeGuards`), and a league with a complete draft refuses joins at
 * `publicJoinPrecondition` before it locks anything at all.
 *
 * A ONE-WAY STAMP, the same discipline `reviews.removed_at` and `integrity_flags.resolved_at`
 * both already use twice: the guard against re-stamping lives in the UPDATE's own `WHERE`, not in
 * a prior read, so `correctSettledWeek` re-running `finalizeWeekInTx` weeks later on an
 * already-completed season leaves the original date alone — a season ended when it ended.
 *
 * The `NOT EXISTS` sub-select reads `matchups` for this league where `home_score IS NULL`, served
 * by `matchups_unsettled_idx` when the week is known and a small per-league scan otherwise. It
 * runs once per settled week per league and never on a read path.
 *
 * Returns whether this call actually stamped the season complete — `false` for every week that
 * isn't the season's last, and for a season that was already stamped.
 */
export async function stampSeasonCompleteInTx(tx: DbTx, leagueId: string, occurredAt: string): Promise<boolean> {
  const written = await tx
    .update(leagues)
    .set({ seasonCompletedAt: new Date(occurredAt) })
    .where(
      and(
        eq(leagues.id, leagueId),
        isNull(leagues.seasonCompletedAt),
        sql`not exists (select 1 from ${matchups} where ${matchups.leagueId} = ${leagues.id} and ${matchups.homeScore} is null)`,
      ),
    )
    .returning({ id: leagues.id });
  return written.length > 0;
}
