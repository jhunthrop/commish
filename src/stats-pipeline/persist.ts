import { sql } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { playerStatLines, statWeeks } from "@research-ts/db/schema";
import type { StatLine } from "@research-ts/domain/player";
import { changedRowWhere, excludedSetFor } from "@research-ts/db/upsert";
import type { WeekStatus } from "./contract";

export interface PersistTickInput {
  readonly week: number;
  /** Absolute-valued lines whose digest moved since the prior tick, per `diffStatLines`. */
  readonly changed: readonly StatLine[];
  readonly status: WeekStatus;
  readonly games: { readonly total: number; readonly final: number };
  /** ISO timestamp for `stat_weeks.updated_at`, from the caller's injected `Clock` — never a wall clock read in here. */
  readonly now: string;
}

export interface PersistTickResult {
  readonly version: number;
  readonly changedCount: number;
}

/**
 * One agreed insertion order for a set of stat lines, and one line per player.
 *
 * **Order**, because two writers whose sets overlap but were built in different orders (each takes
 * "the first N games in `listGames` order" against a different `maxGamesPerTick` remainder) take
 * row locks on `player_stat_lines` in different orders, and two transactions taking the same two
 * locks in opposite orders is a deadlock (`40P01`) — one aborted tick, and Postgres picks which.
 *
 * **Uniqueness**, because a multi-row `ON CONFLICT DO UPDATE` whose values repeat a conflict key
 * is rejected WHOLE by Postgres (`21000`, "cannot affect row a second time"): one player appearing
 * in two of a week's box scores fails the entire write. `diffStatLines` already dedupes what the
 * worker passes in, but this is the last gate before the SQL and the seed reaches it by a
 * different road, so the guarantee belongs here rather than only upstream. Last line wins, the
 * same documented rule the digest uses.
 *
 * Both are free next to the round trip. Exported because it is the shared precondition of every
 * bulk write of stat lines in the repo, and because the properties are otherwise unobservable —
 * the SQL it protects looks identical either way.
 */
export function dedupedByPlayerId(lines: readonly StatLine[]): readonly StatLine[] {
  const byId = new Map<string, StatLine>();
  for (const line of lines) byId.set(line.playerId, line);
  // No equality case: the Map above has already made every id unique, so two entries can never
  // compare equal here.
  return [...byId.values()].sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
}

/**
 * The one write the ingestion worker makes to Postgres: the changed stat lines and the week's
 * rollup row, in a SINGLE transaction, so the two can never disagree about what a tick did.
 *
 * `version` on `stat_weeks` only advances when a stat line's stored value ACTUALLY moved — never
 * merely because the caller labeled it `changed`. That distinction matters because `changed`'s
 * source (`diffStatLines` against a Redis digest snapshot) can be wrong in one direction: if the
 * snapshot is ever lost or evicted, the next tick's diff has no "previous" to compare against and
 * marks every line changed again, even though Postgres already holds the exact same numbers. The
 * `onConflictDoUpdate` `where` (`changedRowWhere`) makes Postgres itself the arbiter — a
 * conflicting row whose incoming values are identical to what's stored is skipped by the update
 * and never appears in `RETURNING`, so `versionBump` is derived from what was truly written, not
 * from what the tick merely offered. The `stat_weeks` row is still upserted every call regardless,
 * because `status`/`gamesTotal`/`gamesFinal` are honest facts about the week that can move even
 * when no player's numbers did (a game kicking off, a week that just finished its last game).
 *
 * Absolute values upserted on `(player_id, week)` are what makes re-ingestion incapable of
 * double-counting: there is nothing to accumulate, only a row to overwrite with the same numbers
 * it already held.
 *
 * `status` is MONOTONIC at `final`: a week that has settled can never be written back to
 * `in_progress` or `scheduled`. Two instances ticking the same week partition its games
 * differently, and the one that fetched fewer of them computes `everyFinalGameIngested = false`
 * from markers the other has not committed yet — which used to let a stale tick regress a settled
 * week, re-arm the examination window and re-spend the request budget on a week that was done.
 * The correction sweep needs no exception to this: every game in the week it re-reads is final and
 * already marked, so the sweep re-persists `final` over `final`.
 *
 * Rows are inserted one per player, in `playerId` order — see `dedupedByPlayerId`.
 */
export async function persistTick(db: Db, input: PersistTickInput): Promise<PersistTickResult> {
  const ordered = dedupedByPlayerId(input.changed);
  return db.transaction(async (tx) => {
    let actuallyChanged = 0;
    if (ordered.length > 0) {
      const written = await tx
        .insert(playerStatLines)
        .values(ordered.map((line) => ({ ...line, week: input.week })))
        .onConflictDoUpdate({
          target: [playerStatLines.playerId, playerStatLines.week],
          set: excludedSetFor(playerStatLines, ["playerId", "week"]),
          where: changedRowWhere(playerStatLines, ["playerId", "week"]),
        })
        .returning({ playerId: playerStatLines.playerId });
      actuallyChanged = written.length;
    }

    // A fresh week starts at `versionBump` (0 or 1) — there is no prior row to add to. An
    // existing row's version increments by the SAME `versionBump` on conflict, referencing the
    // table's own (pre-conflict) column rather than `excluded`, which is what makes "nothing
    // really changed" a true no-op: `versionBump` is 0, so the update is `version = version + 0`.
    const versionBump = actuallyChanged > 0 ? 1 : 0;
    const updatedAt = new Date(input.now);
    const [row] = await tx
      .insert(statWeeks)
      .values({
        week: input.week,
        status: input.status,
        version: versionBump,
        gamesTotal: input.games.total,
        gamesFinal: input.games.final,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: statWeeks.week,
        set: {
          // Monotonic at `final` — see this function's docblock. `excluded.status` rather than a
          // bound parameter so both branches of the CASE are already the `week_status` enum and
          // Postgres needs no cast to reconcile them.
          status: sql`case when ${statWeeks.status} = 'final' then ${statWeeks.status} else excluded.status end`,
          version: sql`${statWeeks.version} + ${versionBump}`,
          gamesTotal: input.games.total,
          gamesFinal: input.games.final,
          updatedAt,
        },
      })
      .returning({ version: statWeeks.version });

    return { version: row!.version, changedCount: actuallyChanged };
  });
}
