import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players as playersTable } from "@/db/schema";
import type { Position } from "@/domain/player";
import { allPositions } from "@/projections/backtest";
import { nflPlayerIdsFor } from "@/projections/crosswalk";
import { injurySnapshot } from "@/league-service/injuries";
import { newsForPlayers } from "@/league-service/news";
import { byeWeeksByTeam } from "@/league-service/nfl-schedule";
import { chipEligibleLaws, registry } from "@/projections/laws/registry";
import { BOARD_SOURCE, boardReasons, preseasonProjectionsFor, type BoardStamp } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import {
  currentSeasonSummaries,
  factsInputFor,
  lastSeasonStoriesFor,
  propsLinesByPlayer,
  usageTouchesAndTrendFactsFor,
  vegasWinTotalsByTeam,
  type ColorFacts,
  type FactsBoardRowInput,
} from "./collect";
import { buildPlayerFacts, type PlayerFacts } from "./facts";

/**
 * THE SINGLE-PLAYER FACT COLLECTOR — exactly the `PlayerFacts` shape `collectAllPlayerFacts`
 * (`collect.ts`) yields for one player, for a surface that needs one man's dossier and cannot
 * afford that function's own whole-board pass (a peek opened once per click). `null` when the
 * board never ranked him — the identical "absent, not a fabricated entry" contract
 * `collectAllPlayerFacts` upholds by simply never including such a player in its own array.
 *
 * REUSED, NOT DUPLICATED: every per-source query below is the SAME exported helper `collect.ts`
 * runs (`lastSeasonStoriesFor`, `usageTouchesAndTrendFactsFor`, `propsLinesByPlayer`,
 * `vegasWinTotalsByTeam`, `currentSeasonSummaries`, `factsInputFor`) — this module adds no new
 * query, it only calls the existing ones with a narrower argument. `collect.ts`'s own tests never
 * changed shape (only `factsInputFor`'s row parameter widened from `BoardRow` to the `Pick` a real
 * `BoardRow` still satisfies structurally), so `collectAllPlayerFacts` is byte-identical in
 * behavior.
 *
 * ROW-SCOPED READS (genuinely one player's own WHERE clause):
 *   - `playersTable` identity (`WHERE id = playerId`) instead of `boardRows`' whole-board join —
 *     this collector never runs `boardRows`' own value-over-replacement/tier recompute at all,
 *     which is safe because `factsInputFor` reads none of those shape-dependent fields (see
 *     `collect.ts`'s own top docblock: "this module reads no shape-dependent field off `BoardRow`").
 *   - `nflPlayerIdsFor(db, [playerId])` — already player-scoped upstream.
 *   - `preseasonProjectionsFor(db, stamp, [nflPlayerId])` — the player-scoped sibling of
 *     `preseasonProjectionsAsOf` the board-wide reader uses; same `DISTINCT ON` + `as_of <=` shape,
 *     so the one row it returns for this player is bit-for-bit what the whole-board read would
 *     have produced for him.
 *   - `newsForPlayers(db, [identity.name])` and `currentSeasonSummaries(db, [playerId], …)` — both
 *     already take a `playerIds`/`names` array upstream; called here with an array of one.
 *
 * NARROWED TO ONE POSITION, NOT ONE PLAYER (still correct, not a fallback): `lastSeasonStoriesFor`
 * and `usageTouchesAndTrendFactsFor` compute RANKS (`pointsRank`, `receivingYardsRank`,
 * `touchesRank`, `snapShareRank`, `targetShareRank`, `redZoneShareRank`) and a trend's own
 * materiality, all of which are meaningless without the full PEER population at the player's own
 * position — a rank of one is not a rank. Both functions already bucket their input `positions`
 * map BY POSITION internally (`rankWithinGroups`, `pooledDiscoveryValuesByPosition`), so passing a
 * `positions` map pre-filtered down to ONLY the target's own position is mathematically identical
 * to passing every position on the board: the other positions' rows never entered this player's
 * bucket either way. This is the real performance win (closing the whole-board-read-per-peek debt
 * named in the dossier plan's file map) — the expensive per-position stat-line/participation reads
 * inside those two functions now run for one position's peers instead of the whole skill-position
 * population.
 *
 * REMAINING WIDE READS, each with no player- or position-scoped query anywhere in the store, kept
 * exactly as `collect.ts` runs them for the whole board:
 *   - `allPositions(db)` — every `nfl_players` id-to-position row. Unavoidable even for the
 *     position-narrowing above: finding "who else plays his position" requires knowing every
 *     player's position first. Small table (the league's own player universe), not a stat read.
 *   - `boardReasons(db, BOARD_SOURCE, PRODUCT_SEASON)` — every stored board-reason row for the
 *     season; the store has no player-scoped variant, so the whole map is read and then indexed
 *     down to this one player's own array.
 *   - `propsLinesByPlayer(db, PRODUCT_SEASON)` — reads every archived pre-kickoff props line for
 *     the season (`loadArchivedPropLines` has no player filter) to compute medians; then indexed
 *     down to this one player's gsis id.
 *   - `vegasWinTotalsByTeam(db, PRODUCT_SEASON, asOf)` and `byeWeeksByTeam(db)` — both keyed by
 *     TEAM, not player, and both already small (32 teams); no team-scoped reader exists, and one
 *     would not meaningfully shrink a table this size.
 *   - `injurySnapshot(db)` — a single `LIMIT 1` row (the latest snapshot), not a per-player table
 *     scan; its JSON payload happens to name every player, but the READ ITSELF is already as
 *     narrow as the store allows.
 */
export async function collectPlayerFacts(db: Db, playerId: string, asOf: Date = new Date()): Promise<PlayerFacts | null> {
  const [identity] = await db
    .select({ id: playersTable.id, name: playersTable.name, position: playersTable.position, team: playersTable.nflTeam, adp: playersTable.adp, posAdp: playersTable.posAdp })
    .from(playersTable)
    .where(eq(playersTable.id, playerId));
  if (identity === undefined) return null;

  const gsisIdByPlayerId = await nflPlayerIdsFor(db, [playerId]);
  const nflPlayerId = gsisIdByPlayerId.get(playerId);
  if (nflPlayerId === undefined) return null;

  const stamp: BoardStamp = { season: PRODUCT_SEASON, source: BOARD_SOURCE, asOf };
  const [projection] = await preseasonProjectionsFor(db, stamp, [nflPlayerId]);
  if (projection === undefined) return null;

  const allPos = await allPositions(db);
  const targetPosition = allPos.get(nflPlayerId);
  const peerPositions = new Map<string, Position>([...allPos].filter(([, position]) => position === targetPosition));

  const laws = chipEligibleLaws(registry());
  const priorSeason = PRODUCT_SEASON - 1;

  const [byes, reasonsByNflId, injuries, news, seasons, lastSeasonStoryByGsisId, usageTouchesAndTrend, propsLinesByGsisId, winTotalByTeam] = await Promise.all([
    byeWeeksByTeam(db),
    boardReasons(db, BOARD_SOURCE, PRODUCT_SEASON),
    injurySnapshot(db),
    newsForPlayers(db, [identity.name]),
    currentSeasonSummaries(db, [playerId], new Map([[playerId, identity.position]])),
    lastSeasonStoriesFor(db, priorSeason, peerPositions, asOf),
    usageTouchesAndTrendFactsFor(db, priorSeason, peerPositions, asOf),
    propsLinesByPlayer(db, PRODUCT_SEASON),
    vegasWinTotalsByTeam(db, PRODUCT_SEASON, asOf),
  ]);

  const color: ColorFacts = {
    lastSeasonStoryByGsisId,
    touchesRankByGsisId: usageTouchesAndTrend.touchesRankByPlayerId,
    usageByGsisId: usageTouchesAndTrend.usageByPlayerId,
    trendByGsisId: usageTouchesAndTrend.trendByPlayerId,
    propsLinesByGsisId,
    winTotalByTeam,
    gsisIdByPlayerId,
  };

  const row: FactsBoardRowInput = {
    playerId,
    name: identity.name,
    position: identity.position,
    team: identity.team,
    marketAdp: identity.adp,
    marketPositionAdp: identity.posAdp,
    rank: projection.rank,
    projectedPoints: projection.projectedPoints,
    floorPoints: projection.floorPoints,
    medianPoints: projection.medianPoints,
    ceilingPoints: projection.ceilingPoints,
    byeWeek: byes.get(identity.team) ?? null,
    reasons: reasonsByNflId.get(nflPlayerId) ?? [],
  };

  return buildPlayerFacts(factsInputFor(row, seasons.get(playerId), injuries, news, laws, color));
}
