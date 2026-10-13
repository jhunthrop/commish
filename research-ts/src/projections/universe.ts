import { sql } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { nflPlayers } from "@research-ts/db/schema";
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
  await releaseMovedIds(db, rows);
  /**
   * Postgres caps a statement at 65,535 bound parameters. Eight columns per row puts the hard
   * ceiling at 8,191, and the universe is roughly 25,000 people, so this is not a tuning knob —
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
          espnId: sql`excluded.espn_id`,
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

/**
 * THE RELEASE OWNS THE SECONDARY IDS. `pfr_id` and `espn_id` are unique, and nflverse does move
 * them: on 2026-09-23 it reassigned two ESPN ids from legacy seed rows (a 1990 lineman, a 1976
 * defensive back, both with pfr-shaped ids and no observations) to two 2026 rookies. The upsert
 * above conflicts on `id`, so the rookie's row tried to take an espn_id the legacy row still held,
 * the unique index refused it, and `season-week` failed every run for three weeks (65 failures in
 * production before it was noticed). The release is the authority on who holds an id today, so any
 * row holding a secondary id that the release now gives to a different `id` gives it up first.
 * The row itself stays: its `id` is what observations point at, and nothing downstream reads the
 * secondary ids of a player the release no longer claims them for.
 */
async function releaseMovedIds(db: Db, rows: readonly NflPlayerRow[]): Promise<void> {
  const CHUNK = 2_000;
  for (const column of ["pfr_id", "espn_id"] as const) {
    const pairs = rows.filter((r) => (column === "pfr_id" ? r.pfrId : r.espnId) !== null);
    for (let start = 0; start < pairs.length; start += CHUNK) {
      const chunk = pairs.slice(start, start + CHUNK);
      const values = sql.join(
        chunk.map((r) => sql`(${r.id}, ${column === "pfr_id" ? r.pfrId : r.espnId})`),
        sql`, `,
      );
      await db.execute(
        sql`update ${nflPlayers} as p set ${sql.raw(column)} = null
            from (values ${values}) as v(id, secondary)
            where p.${sql.raw(column)} = v.secondary and p.id <> v.id`,
      );
    }
  }
}
