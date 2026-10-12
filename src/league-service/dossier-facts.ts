import { collectPlayerFacts } from "@research/capsules/collect-one";
import { rankWithinGroups, type RankableStat } from "@research/capsules/rank";
import type {
  PlayerFacts,
  PlayerFactsAvailability,
  PlayerFactsBooksNumbers,
  PlayerFactsInjuryStatus,
  PlayerFactsLastSeasonStory,
  PlayerFactsMarket,
  PlayerFactsProjection,
  PlayerFactsTrend,
  PlayerFactsUsage,
} from "@research/capsules/facts";
import type { Db } from "@research/db/client";
import type { Position } from "@research/domain/player";
import { PPR_SCORING } from "@research/domain/scoring";
import { allPositions } from "@research/projections/backtest";
import { nflPlayerIdFor } from "@research/projections/crosswalk";
import { BOARD_SOURCE, preseasonProjectionsAsOf, type PreseasonProjectionRow } from "@research/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";
import { describeScoring, roundPoints } from "@research/scoring";

/** A per-game rank, honestly qualified — `rankWithinGroups`' own `RankedStat` minus
 *  `namedNeighbor`: a per-game rank has no consumer asking for the peer just above him (unlike
 *  the season-total ranks `PlayerFacts` already carries one for), so this collapses to the two
 *  numbers `PlayerDossierFacts` actually needs plus the honest qualifier count every rank on this
 *  product carries. */
export interface PlayerDossierRank {
  readonly value: number;
  readonly positionRank: number;
  readonly qualifierCount: number;
}

/** `PlayerFactsProjection` plus the one number the board's own stored fields don't carry directly:
 *  points per GAME rather than per season, and where that rate finishes among his position's
 *  board peers. Both `null` together exactly when he has no honest games-played denominator to
 *  divide by, or the board never ranked him at all — never an estimate standing in for either. */
export interface PlayerDossierProjection extends PlayerFactsProjection {
  readonly perGamePoints: number | null;
  readonly perGamePositionRank: PlayerDossierRank | null;
}

/** Which scoring format every number on this object was computed under — so a client can label a
 *  rate with its own basis rather than let a reader assume a league's own house rules. Fix round
 *  1: this used to also carry `boardGeneration` (the evidence board's own `asOf` stamp), computed
 *  every call and rendered nowhere — dropped rather than kept "for later" (this codebase's own
 *  "delete dead code completely" rule). `perGamePointsRanksFor`/`boardWidePerGameFacts` still read
 *  the board's `asOf` internally to bound the query; they simply no longer thread the stamp itself
 *  out to a client that never asked for it. */
export interface PlayerDossierBasis {
  /** The honest name (`scoring/describe.ts`'s `describeScoring`) of the scoring rules the facts
   *  path actually computed under — `PPR_SCORING`, the same fixed format `collect.ts`'s own
   *  `currentSeasonSummaries` docblock names and the shipped board itself is composed under
   *  (`draft-hq/board/service.ts`). Read from the real config, never a hardcoded label: a change
   *  to what this product ships as its default would change this string for free. */
  readonly scoringLabel: string;
}

/**
 * THE CLIENT-FACING PROJECTION OF A PLAYER'S FACT SHEET (dossier plan, Task 2) — a
 * serialization-safe reshaping of Task 1's `PlayerFacts` for `PlayerSeasonBody.dossier`: every
 * field is a plain object, array, string, number, boolean or `null` (no `Map`/`Set`), so a real
 * `JSON.stringify`/`JSON.parse` round trip through the wire is lossless — pinned by this module's
 * own test. Everything here is a narrower READ than `PlayerFacts` (`evidence`/`numberLedger`/
 * `nameLedger`/`factsHash`/`identity`/`productSeason` are the capsule validator's own vocabulary,
 * not a client-facing fact), plus the two things `PlayerFacts` does not carry: a per-GAME rate
 * and its rank, and the basis both a rank and a rate need to be honest about.
 *
 * `byeWeek` JOINED THIS SHAPE IN TASK 5: `PlayerSeasonBody` (`league-service/player.ts`) never
 * carried a bye week at all — the original docblock here assumed it did and was wrong — and the
 * dossier peek's own header needs one ("WR · NYG · Bye week 8 · …"). `facts.byeWeek` was already
 * computed by Task 1's collector (from the board's own bye-week join, `board-store.ts`'s
 * `byeWeeksByTeam`); this field is a straight pass-through, not a new read.
 */
export interface PlayerDossierFacts {
  readonly market: PlayerFactsMarket;
  readonly projection: PlayerDossierProjection;
  readonly availability: PlayerFactsAvailability | null;
  readonly usage: PlayerFactsUsage | null;
  readonly trend: PlayerFactsTrend | null;
  readonly books: PlayerFactsBooksNumbers;
  readonly lastSeasonStory: PlayerFactsLastSeasonStory | null;
  readonly injury: PlayerFactsInjuryStatus;
  /** A COUNT, not the headlines themselves — `PlayerSeasonBody.news` already carries the full
   *  list (title, link) for the page; the dossier only needs to know whether there is something
   *  to point a reader at. */
  readonly newsCount: number;
  readonly basis: PlayerDossierBasis;
  readonly byeWeek: number | null;
}

/** Every board-ranked player's own points-per-game rate (`projectedPoints / expectedGames`,
 *  rounded the same way every other fantasy-points number on this product is), ranked within his
 *  own position — ONE whole-board `preseasonProjectionsAsOf` pass plus the SAME small
 *  `allPositions` read Task 1's `collect-one.ts` already runs for the identical "who else plays
 *  his position" question (see that module's own docblock on why no narrower query exists for
 *  either read). A row with a non-positive `expectedGames` is EXCLUDED from the ranked population
 *  entirely, never included as a manufactured zero-or-infinite rate — the same "no evidence, no
 *  estimate" rule every other rank in this product keeps. `rankWithinGroups`' own `name` field is
 *  fed the bare nflverse id here: this population is a hidden ranking computation, never rendered,
 *  so there is no honest name to look up and none is needed (`namedNeighbor` is dropped rather
 *  than surfaced — see `PlayerDossierRank`'s own docblock). */
function perGamePointsRanksFor(rows: readonly PreseasonProjectionRow[], positions: ReadonlyMap<string, Position>): ReadonlyMap<string, PlayerDossierRank> {
  const byPosition = new Map<Position, RankableStat[]>();
  for (const row of rows) {
    if (row.expectedGames <= 0) continue;
    const position = positions.get(row.playerId);
    if (position === undefined) continue;
    const entry: RankableStat = { playerId: row.playerId, name: row.playerId, value: roundPoints(row.projectedPoints / row.expectedGames) };
    const list = byPosition.get(position);
    if (list === undefined) byPosition.set(position, [entry]);
    else list.push(entry);
  }
  const ranked = rankWithinGroups(byPosition);
  const out = new Map<string, PlayerDossierRank>();
  for (const [playerId, rank] of ranked) out.set(playerId, { value: rank.value, positionRank: rank.positionRank, qualifierCount: rank.qualifierCount });
  return out;
}

/** The whole-board read `perGamePointsRanksFor` needs — bundled into its own function so
 *  `dossierFactsFor` runs it exactly once regardless of whether the target player himself ends up
 *  ranked. Exported for the precompute writer (`league-service/peek/peek-facts.ts`), which needs the same map
 *  ONCE for a whole sweep rather than once per player. */
export async function boardWidePerGameFacts(db: Db, asOf: Date): Promise<ReadonlyMap<string, PlayerDossierRank>> {
  const rows = await preseasonProjectionsAsOf(db, { season: PRODUCT_SEASON, source: BOARD_SOURCE, asOf });
  if (rows.length === 0) return new Map();
  const positions = await allPositions(db);
  return perGamePointsRanksFor(rows, positions);
}

/**
 * THE SHAPE, WITH NO READS OF ITS OWN — `PlayerFacts` plus the one rank that is not on it, reshaped
 * for the client. Pure on purpose (peek-facts round, 2026-09-07): it has TWO callers now and they
 * must produce byte-identical objects or the precomputed row and the live computation would render
 * differently for the same player. `dossierFactsFor` below is the live one, `league-service/peek/peek-facts.ts`
 * the precompute one, and neither has a copy of this mapping.
 */
export function dossierFactsFrom(facts: PlayerFacts, perGamePositionRank: PlayerDossierRank | null): PlayerDossierFacts {
  return {
    market: facts.market,
    projection: { ...facts.projection, perGamePoints: perGamePositionRank?.value ?? null, perGamePositionRank },
    availability: facts.availability,
    usage: facts.usage,
    trend: facts.trend,
    books: facts.booksNumbers,
    lastSeasonStory: facts.lastSeasonStory,
    injury: facts.injury,
    newsCount: facts.news.length,
    basis: { scoringLabel: describeScoring(PPR_SCORING) },
    byeWeek: facts.byeWeek,
  };
}

/**
 * `PlayerSeasonBody.dossier` — `null` for exactly the players `collectPlayerFacts` (Task 1)
 * returns `null` for: the board never ranked him. Everything else is a reshape of that same call
 * plus one whole-board read for the per-game rank (`boardWidePerGameFacts`, run unconditionally
 * once `facts` resolves, never twice — see that function's own docblock).
 *
 * THE PEEK NO LONGER CALLS THIS AT REQUEST TIME (peek-facts round, 2026-09-07): `playerSeason` reads
 * the precomputed `player_peek_facts` row instead, and this stays as the live computation the
 * precompute writer itself is built from and the parity test measures against.
 */
export async function dossierFactsFor(db: Db, playerId: string, asOf: Date = new Date()): Promise<PlayerDossierFacts | null> {
  const facts = await collectPlayerFacts(db, playerId, asOf);
  if (facts === null) return null;

  const nflPlayerId = await nflPlayerIdFor(db, playerId);
  const ranksByNflPlayerId = await boardWidePerGameFacts(db, asOf);
  return dossierFactsFrom(facts, nflPlayerId === null ? null : (ranksByNflPlayerId.get(nflPlayerId) ?? null));
}
