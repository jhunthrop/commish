import { eq, isNotNull } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { playerCrosswalk, players } from "@/db/schema";
import { SEASON_CONFIG } from "@/domain/season";
import type { RosterIdentity } from "./benchmarks";

/**
 * THE SEASON THE PRODUCT IS ACTUALLY PLAYING, and the roster spine that belongs to it.
 *
 * Everything else in this directory is built for a BACKTEST: a season that has finished, whose
 * week-one roster nflverse has archived, whose games produced the stamps `preseasonMomentFor`
 * derives a replay moment from. A league on this platform is playing a season that has not started,
 * and none of that machinery reaches it — see this module's `PRODUCT_SEASON` note below and the
 * account in `docs/research/2026-08-28-live-season.md`.
 *
 * What CAN reach it is the consensus, because a consensus is published before a season rather than
 * derived from one. This module supplies the one thing that ingestion needs and the backtest path
 * cannot give it: a set of people to resolve published names against.
 *
 * THE SPINE IS THE PRODUCT'S OWN ROSTER, CROSSED OVER. `resolveRankings` resolves published names
 * against a season's week-one roster, and its docblock is explicit that the narrowness of the spine
 * is what makes a name join defensible at all — the two Josh Allens problem does not arise because
 * the retired centre is not on anybody's roster. `players` is exactly that kind of spine for the
 * current season, and it is a better one for this purpose: it holds the men the product actually
 * drafts, so a consensus rank that resolves here is a rank somebody can be shown. The crosswalk
 * then carries each of them into the id space the store is keyed on, by id and never by name.
 */

/**
 * The NFL season every league on this platform belongs to.
 *
 * Derived from `SEASON_CONFIG.startedAt`, which that constant's docblock names as "THE ONE
 * PLACE 'this season' means a specific instant" and forbids re-deriving from `now()` or an NFL
 * calendar rule. The boundary is 1 August, so the calendar year of the boundary IS the season year
 * by construction, and this reads it rather than restating it. When season rollover ships, that
 * field rolls and this follows.
 */
export const PRODUCT_SEASON = new Date(SEASON_CONFIG.startedAt).getUTCFullYear();

/**
 * Every league player who has a counterpart in the historical universe, in the shape
 * `resolveRankings` takes, keyed to the gsis id the store requires.
 *
 * `playerId` IS THE GSIS ID, not the provider id, and that is the whole point of the join: the
 * resolver hands its output straight to `recordPreseasonRankings`, whose column is a foreign key
 * into `nfl_players`. A player the crosswalk could not place is simply not in the spine, so a
 * published name that would have matched him goes into `unresolved` and is reported — never
 * attached to somebody else who shares his name.
 */
export async function crossedRosterIdentities(db: ReadonlyDb): Promise<readonly RosterIdentity[]> {
  const rows = await db
    .select({
      playerId: playerCrosswalk.nflPlayerId,
      name: players.name,
      position: players.position,
      team: players.nflTeam,
    })
    .from(players)
    .innerJoin(playerCrosswalk, eq(playerCrosswalk.playerId, players.id))
    .where(isNotNull(playerCrosswalk.nflPlayerId));
  // The `isNotNull` predicate has already removed the unplaced; this narrows the type without a
  // non-null assertion, and it would drop a row rather than write a null into a foreign key if the
  // two ever disagreed.
  return rows.flatMap((row) => (row.playerId === null ? [] : [{ ...row, playerId: row.playerId }]));
}
