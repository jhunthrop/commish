import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { playerStatLines, statWeeks } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import { changedRowWhere, excludedSetFor } from "@/db/upsert";
import type { WeekStatus } from "./contract";

export interface PersistTickInput {
  readonly week: number;
  /** Absolute-valued lines whose digest moved since the prior tick, per `diffStatLines`. */
  readonly changed: readonly StatLine[];
  /**
   * Player ids to remove from this week's stored lines. Only ever populated from an EXPLICIT
   * upstream absence within a game the tick actually fetched — never inferred from "this tick
   * returned fewer rows than last time," which is exactly the upstream hiccup this parameter
   * must not react to.
   */
  readonly dropped?: readonly string[];
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
 */
export async function persistTick(db: Db, input: PersistTickInput): Promise<PersistTickResult> {
  return db.transaction(async (tx) => {
    let actuallyChanged = 0;
    if (input.changed.length > 0) {
      const written = await tx
        .insert(playerStatLines)
        .values(input.changed.map((line) => ({ ...line, week: input.week })))
        .onConflictDoUpdate({
          target: [playerStatLines.playerId, playerStatLines.week],
          set: excludedSetFor(playerStatLines, ["playerId", "week"]),
          where: changedRowWhere(playerStatLines, ["playerId", "week"]),
        })
        .returning({ playerId: playerStatLines.playerId });
      actuallyChanged = written.length;
    }

    if (input.dropped !== undefined && input.dropped.length > 0) {
      await tx
        .delete(playerStatLines)
        .where(and(eq(playerStatLines.week, input.week), inArray(playerStatLines.playerId, [...input.dropped])));
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
          status: input.status,
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
