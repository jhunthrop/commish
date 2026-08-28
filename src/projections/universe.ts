import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import type { NflPlayerRow } from "./nflverse/players";

/**
 * WRITING THE HISTORICAL PLAYER UNIVERSE — the one table `player_week_observations` points at.
 *
 * Separate from `store.ts` on purpose. That file is the point-in-time store and every line of it is
 * about what was knowable when; a player's name and position carry no `as_of` and never will,
 * because identity is not a fact that gets restated by a Sunday-night correction. Mixing the two
 * would put a table with no stamp behind a docblock promising every read carries one.
 *
 * Upsert rather than insert-or-ignore: the universe is a live release, and a player who changed
 * team or retired since the last backfill should read as his current self. Nothing downstream keys
 * on these columns' history — the store keys on `id`, which never moves.
 */
export async function recordNflPlayers(db: Db, rows: readonly NflPlayerRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  /**
   * Postgres caps a statement at 65,535 bound parameters. Seven columns per row puts the hard
   * ceiling at 9,362, and the universe is roughly 25,000 people, so this is not a tuning knob —
   * without it the write fails outright. Rounded well down for headroom, matching
   * `recordObservations`' own chunk size.
   */
  const CHUNK_ROWS = 2_000;
  let written = 0;
  for (let start = 0; start < rows.length; start += CHUNK_ROWS) {
    const chunk = rows.slice(start, start + CHUNK_ROWS).map((row) => ({ ...row }));
    const result = await db
      .insert(nflPlayers)
      .values(chunk)
      .onConflictDoUpdate({
        target: nflPlayers.id,
        // `excluded` is the row this statement TRIED to insert — the fresh release. Naming the
        // table's own columns here would set each one to the value it already holds, which reads
        // like an update and is a no-op.
        set: {
          pfrId: sql`excluded.pfr_id`,
          name: sql`excluded.name`,
          position: sql`excluded.position`,
          latestTeam: sql`excluded.latest_team`,
          rookieSeason: sql`excluded.rookie_season`,
          lastSeason: sql`excluded.last_season`,
        },
      })
      .returning({ id: nflPlayers.id });
    written += result.length;
  }
  return written;
}
