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
import { BOARD_SOURCE, boardReasons, preseasonProjectionsFor, type BoardStamp, type PreseasonProjectionRow } from "@/projections/preseason/board-store";
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

/** One product player's own identity row — the fields `factsInputFor` reads off `BoardRow`'s
 *  identity/market half, read here with a single `WHERE id = playerId` instead of `boardRows`'
 *  whole-board join. */
interface PlayerIdentity {
  readonly name: string;
  readonly position: Position;
  readonly team: string;
  readonly adp: number | null;
  readonly posAdp: string | null;
}

/** Whether the board ranks this player at all, resolved with the narrowest read available at each
 *  step, short-circuiting the moment any one of them comes back empty: an unknown product player
 *  id, a product player the crosswalk never placed against an nflverse id, or a placed player the
 *  stored board simply never ranked (his own `preseasonProjectionsFor` row absent) are three
 *  different reasons for the same honest `null` `collectPlayerFacts` returns for all of them. */
interface PlayerBoardMembership {
  readonly identity: PlayerIdentity;
  readonly nflPlayerId: string;
  readonly projection: PreseasonProjectionRow;
}

/** Assembles the narrow `FactsBoardRowInput` `factsInputFor` needs from the pieces
 *  `collectPlayerFacts` gathered separately (identity, board projection, his team's bye, his own
 *  stored reasons) — pulled out on its own so the caller's own body reads as one linear list of
 *  reads plus one merge, never a second sprawling object literal in the middle of it. */
function factsRowFor(playerId: string, identity: PlayerIdentity, projection: PreseasonProjectionRow, byeWeek: number | null, reasons: FactsBoardRowInput["reasons"]): FactsBoardRowInput {
  return {
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
    byeWeek,
    reasons,
  };
}

async function resolvePlayerBoardMembership(db: Db, playerId: string, stamp: BoardStamp): Promise<PlayerBoardMembership | null> {
  const [identity] = await db
    .select({ name: playersTable.name, position: playersTable.position, team: playersTable.nflTeam, adp: playersTable.adp, posAdp: playersTable.posAdp })
    .from(playersTable)
    .where(eq(playersTable.id, playerId));
  if (identity === undefined) return null;

  const gsisIdByPlayerId = await nflPlayerIdsFor(db, [playerId]);
  const nflPlayerId = gsisIdByPlayerId.get(playerId);
  if (nflPlayerId === undefined) return null;

  const [projection] = await preseasonProjectionsFor(db, stamp, [nflPlayerId]);
  if (projection === undefined) return null;

  return { identity, nflPlayerId, projection };
}

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
 * ROW-SCOPED READS (genuinely one player's own WHERE clause, or an existing helper already
 * parameterized by a `playerIds`/`names` array, called here with an array of one):
 *   - `playersTable` identity (`WHERE id = playerId`, `resolvePlayerBoardMembership`) instead of
 *     `boardRows`' whole-board join — this collector never runs `boardRows`' own
 *     value-over-replacement/tier recompute at all, which is safe because `factsInputFor` reads
 *     none of those shape-dependent fields (see `collect.ts`'s own top docblock: "this module
 *     reads no shape-dependent field off `BoardRow`").
 *   - `nflPlayerIdsFor(db, [playerId])` — already player-scoped upstream.
 *   - `preseasonProjectionsFor(db, stamp, [nflPlayerId])` — the player-scoped sibling of
 *     `preseasonProjectionsAsOf` the board-wide reader uses; same `DISTINCT ON` + `as_of <=` shape,
 *     so the one row it returns for this player is bit-for-bit what the whole-board read would
 *     have produced for him.
 *   - `currentSeasonSummaries(db, [playerId], …)` — its own `inArray(playerStatLines.playerId, …)`
 *     genuinely narrows to this one player.
 *
 * NARROWED TO ONE POSITION, NOT ONE PLAYER, FOR `lastSeasonStoriesFor` ONLY (still correct, not a
 * fallback, and a genuine DB-level narrowing): its own `statLinesAsOfForLiveSurface` call accepts
 * a `playerIds` list, so restricting the `positions` map passed in to just the target's own
 * position peers (rather than every position `allPositions` names) shrinks that query's actual
 * `WHERE … IN (…)` list. This is safe for the RANKS it computes (`pointsRank`, `receivingYardsRank`,
 * `touchesRank`) because `rankWithinGroups` buckets by position internally — the other positions'
 * rows were never going to enter this player's bucket either way, narrowed or not.
 *
 * THE SAME NARROWING DOES **NOT** SHRINK `usageTouchesAndTrendFactsFor`'s OWN READS, despite taking
 * the identical `peerPositions` argument — named explicitly here rather than left to look like a
 * matching win. `discoveryFactsForSeason` (`projections/laws/discovery-facts.ts`) resolves through
 * `seasonContext` to `seasonScoring`/`seasonParticipation`/`seasonTeams`
 * (`projections/laws/populations.ts`) plus its own `seasonUsageAggregates`/`seasonSnapCounts`/
 * `seasonTeamPaceByTeam`/`incomingWinTotalByTeam`/`seasonActualWinsByTeam` — NONE of these eight
 * readers accept a `playerIds` parameter at all; every one of them runs `statLinesAsOf(For…)`/
 * `observationsAsOf`/`teamObservationsAsOf`/`playerTeamsAsOf` for the WHOLE season regardless of
 * how large or small the `positions` map handed in is, and only filters down to the given
 * positions in memory afterward (`positions.get(line.playerId)`). Passing `peerPositions` instead
 * of the full board keeps the RANKING math correct (same "buckets by position" reasoning as
 * above) but is a REMAINING WIDE READ for the underlying query cost — named here rather than
 * implied closed. `trendsFor`'s own extra `seasonYardsAndTargetsFor` calls (inside
 * `usageTouchesAndTrendFactsFor`) are the one exception: they DO take a `playerIds` list
 * (`discoveryFacts.keys()`, which already reflects the narrowed `peerPositions` passed in), so
 * that one sub-read genuinely shrinks.
 *
 * REMAINING WIDE READS, each with no player- or position-scoped query anywhere in the store, kept
 * exactly as `collect.ts` runs them for the whole board:
 *   - `allPositions(db)` — every `nfl_players` id-to-position row. Unavoidable even for the
 *     position-narrowing above: finding "who else plays his position" requires knowing every
 *     player's position first. Small table (the league's own player universe), not a stat read.
 *   - `usageTouchesAndTrendFactsFor`'s own `discoveryFactsForSeason` reads — see above.
 *   - `boardReasons(db, BOARD_SOURCE, PRODUCT_SEASON)` — every stored board-reason row for the
 *     season; the store has no player-scoped variant, so the whole map is read and then indexed
 *     down to this one player's own array.
 *   - `propsLinesByPlayer(db, PRODUCT_SEASON)` — reads every archived pre-kickoff props line for
 *     the season (`loadArchivedPropLines` has no player filter) to compute medians; then indexed
 *     down to this one player's gsis id.
 *   - `vegasWinTotalsByTeam(db, PRODUCT_SEASON, asOf)` and `byeWeeksByTeam(db)` — both keyed by
 *     TEAM, not player, and both already small (32 teams); no team-scoped reader exists, and one
 *     would not meaningfully shrink a table this size.
 *   - `injurySnapshot(db)` and `newsForPlayers(db, [identity.name])` — both already the smallest
 *     read the store offers: a single `LIMIT 1` snapshot row apiece, whose JSON payload happens to
 *     name every player and is filtered down to this one player in memory. Passing a one-element
 *     array to `newsForPlayers` narrows nothing at the DB level (the snapshot read itself has no
 *     `WHERE`), so it belongs in this list rather than among the genuinely row-scoped reads above.
 */
export async function collectPlayerFacts(db: Db, playerId: string, asOf: Date = new Date()): Promise<PlayerFacts | null> {
  const stamp: BoardStamp = { season: PRODUCT_SEASON, source: BOARD_SOURCE, asOf };
  const membership = await resolvePlayerBoardMembership(db, playerId, stamp);
  if (membership === null) return null;
  const { identity, nflPlayerId, projection } = membership;

  const allPos = await allPositions(db);
  const targetPosition = allPos.get(nflPlayerId);
  const peerPositions = new Map<string, Position>([...allPos].filter(([, position]) => position === targetPosition));

  const laws = chipEligibleLaws(registry());
  const priorSeason = PRODUCT_SEASON - 1;
  const gsisIdByPlayerId = new Map([[playerId, nflPlayerId]]);

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

  const row = factsRowFor(playerId, identity, projection, byes.get(identity.team) ?? null, reasonsByNflId.get(nflPlayerId) ?? []);
  return buildPlayerFacts(factsInputFor(row, seasons.get(playerId), injuries, news, laws, color));
}
