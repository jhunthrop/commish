import { collectPlayerFacts } from "@/capsules/collect-one";
import { rankWithinGroups, type RankableStat } from "@/capsules/rank";
import type {
  PlayerFactsAvailability,
  PlayerFactsBooksNumbers,
  PlayerFactsInjuryStatus,
  PlayerFactsLastSeasonStory,
  PlayerFactsMarket,
  PlayerFactsProjection,
  PlayerFactsTrend,
  PlayerFactsUsage,
} from "@/capsules/facts";
import type { Db } from "@/db/client";
import type { Position } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { allPositions } from "@/projections/backtest";
import { nflPlayerIdFor } from "@/projections/crosswalk";
import { BOARD_SOURCE, preseasonProjectionsAsOf, type PreseasonProjectionRow } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { describeScoring, roundPoints } from "@/scoring";

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

/** Which generation of evidence, and which scoring format, every number on this object was
 *  computed under — so a client can label a rank or a rate with its own basis rather than let a
 *  reader assume today's board or a league's own house rules. */
export interface PlayerDossierBasis {
  /** The evidence board's own `asOf` stamp, shared by every row under one generation — the exact
   *  value `draft-service/sim/evidence.ts`'s `evidencePoolFor` derives (`assertSingleGeneration`'s
   *  own invariant: every row under a live source shares one `asOf`). Read here off the SAME
   *  `preseasonProjectionsAsOf` pass this module already runs for the per-game rank below, rather
   *  than calling `evidencePoolFor` itself, which would pay for a SECOND whole-board read (its own
   *  crosswalk join and market-rank pass this dossier has no use for) just to get a string this
   *  one already has in hand. Empty when the board has no rows at all. */
  readonly boardGeneration: string;
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
 * `nameLedger`/`factsHash`/`identity`/`productSeason`/`byeWeek` are the capsule validator's own
 * vocabulary, not a client-facing fact — `PlayerSeasonBody`'s own `player`/`byeWeek`-adjacent
 * fields already answer those for the page), plus the two things `PlayerFacts` does not carry:
 * a per-GAME rate and its rank, and the basis both a rank and a rate need to be honest about.
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

/** The whole-board read `perGamePointsRanksFor` needs, plus the generation stamp it shares with
 *  every row under it — bundled so `dossierFactsFor` runs it exactly once regardless of whether
 *  the target player himself ends up ranked. */
async function boardWidePerGameFacts(db: Db, asOf: Date): Promise<{ readonly boardGeneration: string; readonly ranksByNflPlayerId: ReadonlyMap<string, PlayerDossierRank> }> {
  const rows = await preseasonProjectionsAsOf(db, { season: PRODUCT_SEASON, source: BOARD_SOURCE, asOf });
  if (rows.length === 0) return { boardGeneration: "", ranksByNflPlayerId: new Map() };
  const positions = await allPositions(db);
  return { boardGeneration: rows[0]!.asOf.toISOString(), ranksByNflPlayerId: perGamePointsRanksFor(rows, positions) };
}

/**
 * `PlayerSeasonBody.dossier` — `null` for exactly the players `collectPlayerFacts` (Task 1)
 * returns `null` for: the board never ranked him. Everything else is a reshape of that same call
 * plus one whole-board read for the per-game rank (`boardWidePerGameFacts`, run unconditionally
 * once `facts` resolves, never twice — see that function's own docblock).
 */
export async function dossierFactsFor(db: Db, playerId: string, asOf: Date = new Date()): Promise<PlayerDossierFacts | null> {
  const facts = await collectPlayerFacts(db, playerId, asOf);
  if (facts === null) return null;

  const nflPlayerId = await nflPlayerIdFor(db, playerId);
  const { boardGeneration, ranksByNflPlayerId } = await boardWidePerGameFacts(db, asOf);
  const perGamePositionRank = nflPlayerId === null ? null : (ranksByNflPlayerId.get(nflPlayerId) ?? null);

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
    basis: { boardGeneration, scoringLabel: describeScoring(PPR_SCORING) },
  };
}
