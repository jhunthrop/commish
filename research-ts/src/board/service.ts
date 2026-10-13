import { eq, inArray } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { players as playersTable, playerCrosswalk } from "@research-ts/db/schema";
import type { Position } from "@research-ts/domain/player";
import type { ScoringRules } from "@research-ts/scoring";
import { kdefSeasonLines } from "@research-ts/projections/kdef/season-lines";
import { compareBoardOrder } from "@research-ts/projections/decide/board-order-compare";
import type { LeagueShape } from "@research-ts/projections/decide/replacement";
import { valueBoardIndexed } from "@research-ts/projections/decide/replacement";
import { tiersOf } from "@research-ts/projections/decide/tiers";
import type { BoardReason } from "@research-ts/projections/preseason/board";
import { DEFAULT_BOARD_FORMAT, type BoardFormat } from "@research-ts/projections/preseason/board-formats";
import { boardReasons, preseasonProjectionsAsOf } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { rosterStatusNoteOf, type RosterStatusNote } from "@research-ts/projections/preseason/roster-status";
import { marketOrderPositions } from "@research-ts/projections/preseason/kdef-decision";
import { boardFormatResolution, type LeagueBoardFormat } from "@research-ts/board/format-resolution";
import { byeWeeksByTeam } from "@research-ts/reference/nfl-schedule";

/**
 * THE BOARD, READ FOR A PRODUCT SURFACE (spec §3) — joins the stored evidence board
 * (`preseason_projections`, one source per scoring format, keyed on `nfl_players.id`) back to the
 * product's own player directory (`players`, keyed on the stats provider's id) through
 * `player_crosswalk`, and recomputes the DRAFT-VALUE view (value over replacement, tiers, cliffs)
 * under whichever `LeagueShape` the caller asks for.
 *
 * WHAT IS RECOMPUTED AND WHAT IS NOT, stated plainly because it is the one place this module
 * could quietly overclaim. `projectedPoints`/`floorPoints`/`medianPoints`/`ceilingPoints` are a
 * SHIPPED board's own numbers, composed once, offline, under that board's format (the
 * scoring-formats round, 2026-09-08: `commish_board_v9_{ppr,half,std}_12`, each scored under its
 * exact preset and anchored to its own ADP feed; `board-formats.ts`). WHICH board is read is the
 * format: named directly by a league-free surface's selector (`BoardOptions.format`), or decided
 * by a league's own scoring rules when the caller resolved them (`BoardOptions.resolved`, the nearest
 * of the three for a custom sheet, with a note; the league read itself is the league app's). What changes per league on top of that is
 * the DRAFT-VALUE half: `valueOverReplacement`, `valueRank`, position rank-in-value-order and the
 * tier ladder, all rebuilt from the stored points against the CALLER'S OWN `teamCount`/`rosterSlots`
 * via `decide/replacement.ts`'s `valueBoard`, which is exactly the mechanism that moves fourteen
 * quarterbacks up a 2-QB league's board, and costs nothing because it is arithmetic over numbers
 * already in hand.
 */
/** A finished season, summed. See `BoardRow.lastSeason`. */
export interface BoardLastSeason {
  readonly season: number;
  readonly points: number;
  readonly games: number;
  readonly pointsPerGame: number;
}

export interface BoardRow {
  readonly playerId: string;
  readonly nflPlayerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: string;
  readonly headshotUrl: string | null;
  /** The shipped board's own overall rank, by points — fixed, never recomputed per league.
   *  A provenance fact, NOT the display order: the board displays `overallRank`.
   *  `null` on a MARKET-ORDER row, which no stored board ever ranked. */
  readonly rank: number | null;
  /** The board's served order: rank in VALUE under the caller's shape (points over replacement),
   *  with no-value positions last. This is what "overall rank" means to a drafter, and what the
   *  Edge comparison against ADP (itself a value ordering) must use — founder ruling 2026-09-04.
   *  `null` on a MARKET-ORDER row: those rows are not on the value board at all. */
  readonly overallRank: number | null;
  /**
   * THE FOUR PROJECTION FIELDS, NULL ON A MARKET-ORDER ROW (the 2026-09-05 kicker and team defence
   * round). `null` and never `0`: the engine published nothing for that position, and a zero would
   * be a fabricated number reaching every reader and every consumer that sorts by points. See
   * `KDEF_DECISION` (`preseason/kdef-decision.ts`) and the results document it cites.
   */
  readonly projectedPoints: number | null;
  readonly floorPoints: number | null;
  readonly medianPoints: number | null;
  readonly ceilingPoints: number | null;
  /**
   * The row's 1-based place in its own position's MARKET order, for a position that ships in market
   * order. `null` on every projected row, where the honest lead is the value rank.
   *
   * A field of its own rather than borrowing `positionRankInValue`, because these rows have no
   * value: reusing that field would make "rank in value order" mean two different things depending
   * on which position a reader happened to be looking at.
   */
  readonly marketOrderRank: number | null;
  /**
   * WHAT HE ACTUALLY DID LAST SEASON, under the caller's own scoring — the one honest number a
   * market-order row can carry (the 2026-09-06 kicker and team defense round).
   *
   * `null` on every projected row and on any market-order row the archive holds no week for. It is
   * NOT a projection and no consumer may treat it as one: it is a record of games that were played,
   * which is precisely the thing the preregistered gates left this product still able to say.
   * `season` rides on the value so a surface can never print the figure without naming the year it
   * belongs to.
   */
  readonly lastSeason: BoardLastSeason | null;
  /** Recomputed under the caller's `LeagueShape`. `null` for a position the shape never starts
   *  at all (`valueBoard` leaves it out rather than pricing it at zero) — an honest "no draft
   *  value in this format" rather than a fabricated number. */
  readonly valueOverReplacement: number | null;
  readonly valueRank: number | null;
  readonly positionRankInValue: number | null;
  readonly tier: number | null;
  readonly playersLeftInTier: number | null;
  readonly dropToNextTier: number | null;
  /**
   * HIS PLACE IN THE BOARD'S OWN OVERALL LADDER (the Draft area round, 2026-09-12) — the same
   * triad as the three fields above, computed once across every draft-relevant player instead of
   * inside his position. The three fields above answer "how many receivers are left before the
   * drop"; these three answer "how many PLAYERS are left before the board drops", which is the
   * question the Overall list is in front of a reader to settle.
   *
   * The ladder runs on the key the board is ORDERED by, points over replacement, with the break
   * still measured as a share of real production (`tiersOf`'s own docblock). `null` on every row
   * the board holds no value for: a market-order row, a row off an active roster, a position the
   * shape never starts.
   */
  readonly overallTier: number | null;
  readonly overallPlayersLeftInTier: number | null;
  readonly overallDropToNextTier: number | null;
  readonly marketAdp: number | null;
  readonly marketPositionAdp: string | null;
  readonly byeWeek: number | null;
  readonly reasons: readonly BoardReason[];
  /**
   * HIS CURRENT ROSTER STATUS, when the board stored one (the roster-status gate, 2026-09-08):
   * read off the board's own `roster_status` reason, so every surface that lists him prints the
   * same dated, sourced observation. `null` for an active player and for one no source named. A
   * note with `excluded: true` is a "Not on an active roster" band row (`notOnActiveRosterRows`):
   * every projection field on it is `null`, it holds no place in the value order and no tier.
   */
  readonly rosterStatus: RosterStatusNote | null;
}

/**
 * A board row the engine actually projected — every projection field a number rather than a
 * maybe-number.
 *
 * The narrowing exists so a consumer that genuinely needs a projection (a capsule is written ABOUT
 * one; the home preview ranks BY one) can say so in its types and filter once, rather than sprinkling
 * non-null assertions or, worse, coercing an absence to a zero somebody later reads as a
 * measurement. See `isProjectedRow`.
 */
export type ProjectedBoardRow = BoardRow & {
  readonly rank: number;
  readonly overallRank: number;
  readonly projectedPoints: number;
  readonly floorPoints: number;
  readonly medianPoints: number;
  readonly ceilingPoints: number;
};

/** Whether this row carries a projection at all. `false` for every market-order row. */
export function isProjectedRow(row: BoardRow): row is ProjectedBoardRow {
  return (
    row.rank !== null &&
    row.overallRank !== null &&
    row.projectedPoints !== null &&
    row.floorPoints !== null &&
    row.medianPoints !== null &&
    row.ceilingPoints !== null
  );
}

export interface BoardOptions {
  readonly shape: LeagueShape;
  readonly asOf?: Date;
  /**
   * Whose scoring rules decide the board: which of the three stored boards is read, and what
   * `lastSeason` is measured under, already resolved by the caller (a league's own rules through
   * `boardFormatForLeagueRules`). The research core never reads a league's settings itself; the
   * league app resolves them and hands the result here. Omitted means `format`.
   */
  readonly resolved?: LeagueBoardFormat;
  /**
   * A league-free surface's own choice of board (the scoring-formats round): the selector on the
   * Draft HQ board, the HQ card, the rankings export, the nightly run. Ignored when `resolved` is
   * given, because inside a league the league's own rules decide and no surface offers a selector.
   * Omitted with neither means PPR.
   */
  readonly format?: BoardFormat;
}

/** Which board this read resolves to: the caller's resolution when it has one, the chosen or
 *  default format otherwise. No query. */
export function resolveBoardFormat({ resolved, format }: Pick<BoardOptions, "resolved" | "format">): LeagueBoardFormat {
  return resolved ?? boardFormatResolution(format ?? DEFAULT_BOARD_FORMAT);
}

/** The tier standing a `valueBoard` position pool implies — the same aggregate
 *  `board.ts`'s own (private) `tierStandings` computes, kept local here since that function is
 *  not exported and this reader's whole job is a SECOND, per-league pass over stored points
 *  rather than a first build of the board. */
function tierStandingsOf(valuesDescending: readonly number[], productionByRow: readonly number[] = valuesDescending): readonly { readonly tier: number; readonly playersLeftInTier: number; readonly dropToNextTier: number }[] {
  const tiers = tiersOf(valuesDescending, productionByRow);
  return tiers.map((tier, index) => {
    const lastOfTier = tiers.lastIndexOf(tier);
    const firstOfNext = tiers.indexOf(tier + 1);
    return {
      tier,
      playersLeftInTier: lastOfTier - index + 1,
      dropToNextTier: firstOfNext === -1 ? 0 : valuesDescending[lastOfTier]! - valuesDescending[firstOfNext]!,
    };
  });
}

/** Every player the shipped board ranks, joined to the product's own player row and recomputed
 *  for `options.shape`. A stored board row whose player the crosswalk cannot resolve back to a
 *  product `players` row is dropped — a defensive symmetry with `boardReasons`' own drop-and-warn
 *  posture, though in practice every crosswalked player resolves both directions by construction. */
export async function boardRows(db: Db, { shape, asOf = new Date(), resolved: given, format }: BoardOptions): Promise<readonly BoardRow[]> {
  const resolved = resolveBoardFormat({ resolved: given, format });
  const stamp = { season: PRODUCT_SEASON, source: resolved.source, asOf };
  const [projections, reasonsByNflId, byes] = await Promise.all([
    preseasonProjectionsAsOf(db, stamp),
    boardReasons(db, resolved.source, PRODUCT_SEASON),
    byeWeeksByTeam(db),
  ]);
  // Appended, never interleaved: a market-order position has no value rank, so it takes no part in
  // the value sort below and cannot perturb a single projected row. See `marketOrderRows`.
  const marketOrder = await marketOrderRows(db, byes, resolved.rules);
  if (projections.length === 0) return marketOrder;

  const projectedIds = new Set(projections.map((row) => row.playerId));
  // The gate's exclusions: players with a stored `roster_status` reason and no projection row.
  const excludedIds = [...reasonsByNflId].flatMap(([nflId, reasons]) => (!projectedIds.has(nflId) && rosterStatusNoteOf(reasons)?.excluded === true ? [nflId] : []));
  const byNflId = await crosswalkIdentities(db, [...projectedIds, ...excludedIds]);
  const band = notOnActiveRosterRows(excludedIds, byNflId, reasonsByNflId, byes);

  // The DRAFT-VALUE overlay: rebuilt from the stored points against the caller's own shape. Every
  // projection resolves a position (it always does — a stored board row was priced under a real
  // position), so `SeasonProjection.position` is safe to read straight off the crosswalked row.
  const withPosition = projections.flatMap((row) => {
    const identity = byNflId.get(row.playerId);
    return identity === undefined ? [] : [{ row, identity }];
  });

  const { sorted: valued, byPlayerId: valuedByPlayer } = valueBoardIndexed(
    withPosition.map(({ row, identity }) => ({ playerId: row.playerId, position: identity.position, projectedPoints: row.projectedPoints })),
    shape,
  );
  const valueRanks = new Map(valued.map((entry, index) => [entry.playerId, index + 1] as const));

  const standingsByPlayer = new Map<string, { readonly tier: number; readonly playersLeftInTier: number; readonly dropToNextTier: number }>();
  const positions = new Set(valued.map((entry) => entry.position));
  for (const position of positions) {
    const pool = valued.filter((entry) => entry.position === position);
    // Tiers are measured among DRAFT-RELEVANT players only (founder board audit, 2026-09-04):
    // below replacement level the isotonic plateaus pack players a hair apart, and letting that
    // texture into the pool distorts what a cliff means. Below-replacement rows carry no tier
    // and draw no band, which is itself the honest statement about them.
    const relevant = pool.filter((entry) => entry.valueOverReplacement > 0);
    const standings = tierStandingsOf(relevant.map((entry) => entry.projectedPoints));
    relevant.forEach((entry, index) => standingsByPlayer.set(entry.playerId, standings[index]!));
  }

  // THE OVERALL LADDER (the Draft area round, 2026-09-12): the same rule over one pool, the
  // draft-relevant board in its own order. `valued` is already sorted by points over replacement,
  // which IS the order the list is served in (`compareBoardOrder` differs only on ties, and two
  // players tied on value fall in the same tier under any tiebreak). The same above-replacement
  // filter the position pools keep: below it the isotonic plateaus pack players a hair apart, and
  // a band drawn over that texture would be a cliff nobody would name out loud.
  const overallByPlayer = new Map<string, { readonly tier: number; readonly playersLeftInTier: number; readonly dropToNextTier: number }>();
  const overallRelevant = valued.filter((entry) => entry.valueOverReplacement > 0);
  const overallStandings = tierStandingsOf(
    overallRelevant.map((entry) => entry.valueOverReplacement),
    overallRelevant.map((entry) => entry.projectedPoints),
  );
  overallRelevant.forEach((entry, index) => overallByPlayer.set(entry.playerId, overallStandings[index]!));

  return withPosition
    .map(({ row, identity }): ProjectedBoardRow => {
      const inValue = valuedByPlayer.get(row.playerId);
      const standing = standingsByPlayer.get(row.playerId);
      const overall = overallByPlayer.get(row.playerId);
      return {
        playerId: identity.playerId,
        nflPlayerId: row.playerId,
        name: identity.name,
        position: identity.position,
        team: identity.team,
        headshotUrl: identity.headshotUrl,
        rank: row.rank,
        overallRank: 0, // assigned below, after the value sort — see the docblock on the field
        marketOrderRank: null, // a projected row leads with its value rank, never a market place
        // A projected row's lead is what the engine EXPECTS, so a measured last season beside it
        // would be a second number competing for the same cell. Null here, always.
        lastSeason: null,
        projectedPoints: row.projectedPoints,
        floorPoints: row.floorPoints,
        medianPoints: row.medianPoints,
        ceilingPoints: row.ceilingPoints,
        valueOverReplacement: inValue?.valueOverReplacement ?? null,
        valueRank: valueRanks.get(row.playerId) ?? null,
        positionRankInValue: inValue?.positionRank ?? null,
        tier: standing?.tier ?? null,
        playersLeftInTier: standing?.playersLeftInTier ?? null,
        dropToNextTier: standing?.dropToNextTier ?? null,
        overallTier: overall?.tier ?? null,
        overallPlayersLeftInTier: overall?.playersLeftInTier ?? null,
        overallDropToNextTier: overall?.dropToNextTier ?? null,
        marketAdp: identity.adp,
        marketPositionAdp: identity.posAdp,
        byeWeek: byes.get(identity.team) ?? null,
        reasons: reasonsByNflId.get(row.playerId) ?? [],
        rosterStatus: rosterStatusNoteOf(reasonsByNflId.get(row.playerId) ?? []),
      };
    })
    // ONE comparator, shared with the Simulator's own read of this same board
    // (`@/draft-service/sim/value-order.ts`) — see its module docblock for why every rule in it
    // is the rule. Two copies would be two boards, and the two surfaces sit side by side.
    .sort(compareBoardOrder)
    .map((row, index) => ({ ...row, overallRank: index + 1 }))
    // The positional badge follows the SERVED order, so a tie the market just broke cannot
    // leave the badges contradicting the rows (RB2 listed above RB1). Only valued rows carry a
    // positional rank; a position the shape never starts keeps null, exactly as before.
    .map(
      (() => {
        const seen = new Map<string, number>();
        return (row: BoardRow): BoardRow => {
          if (row.valueRank === null) return row;
          const next = (seen.get(row.position) ?? 0) + 1;
          seen.set(row.position, next);
          return row.positionRankInValue === next ? row : { ...row, positionRankInValue: next };
        };
      })(),
    )
    // The band last of all, behind the market-order rows: not a ranking, a place to find him.
    .concat(marketOrder, band);
}

/** One product identity per universe id, through the crosswalk. Shared by the ranked rows and the
 *  band rows so the two can never disagree about who a gsis id is. */
async function crosswalkIdentities(db: Db, nflIds: readonly string[]): Promise<ReadonlyMap<string, CrosswalkedIdentity>> {
  if (nflIds.length === 0) return new Map();
  const rows = await db
    .select({
      nflPlayerId: playerCrosswalk.nflPlayerId,
      playerId: playersTable.id,
      name: playersTable.name,
      position: playersTable.position,
      team: playersTable.nflTeam,
      headshotUrl: playersTable.headshotUrl,
      adp: playersTable.adp,
      posAdp: playersTable.posAdp,
    })
    .from(playerCrosswalk)
    .innerJoin(playersTable, eq(playersTable.id, playerCrosswalk.playerId))
    .where(inArray(playerCrosswalk.nflPlayerId, [...nflIds]));
  return new Map(rows.flatMap((row) => (row.nflPlayerId === null ? [] : [[row.nflPlayerId, row] as const])));
}

interface CrosswalkedIdentity {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: string;
  readonly headshotUrl: string | null;
  readonly adp: number | null;
  readonly posAdp: string | null;
}

/**
 * THE "NOT ON AN ACTIVE ROSTER" BAND (the roster-status gate, 2026-09-08): every player the gate
 * took off the board, so a manager can still find him and read why. Each row carries his identity,
 * his ADP and his dated status, and NOTHING the board did not measure: every projection field is
 * `null`, there is no rank in any order and no tier. Ordered by ADP, then id, so the list is stable
 * and a man the market still prices leads it. A player the crosswalk cannot place is absent, the
 * same rule the ranked rows keep.
 */
function notOnActiveRosterRows(
  excludedIds: readonly string[],
  byNflId: ReadonlyMap<string, CrosswalkedIdentity>,
  reasonsByNflId: ReadonlyMap<string, readonly BoardReason[]>,
  byes: ReadonlyMap<string, number>,
): readonly BoardRow[] {
  return excludedIds
    .flatMap((nflId) => {
      const identity = byNflId.get(nflId);
      const reasons = reasonsByNflId.get(nflId) ?? [];
      const rosterStatus = rosterStatusNoteOf(reasons);
      if (identity === undefined || rosterStatus === null) return [];
      const row: BoardRow = {
        playerId: identity.playerId,
        nflPlayerId: nflId,
        name: identity.name,
        position: identity.position,
        team: identity.team,
        headshotUrl: identity.headshotUrl,
        rank: null,
        overallRank: null,
        marketOrderRank: null,
        lastSeason: null,
        projectedPoints: null,
        floorPoints: null,
        medianPoints: null,
        ceilingPoints: null,
        valueOverReplacement: null,
        valueRank: null,
        positionRankInValue: null,
        tier: null,
        playersLeftInTier: null,
        dropToNextTier: null,
        overallTier: null,
        overallPlayersLeftInTier: null,
        overallDropToNextTier: null,
        marketAdp: identity.adp,
        marketPositionAdp: identity.posAdp,
        byeWeek: byes.get(identity.team) ?? null,
        reasons,
        rosterStatus,
      };
      return [row];
    })
    .sort((a, b) => (a.marketAdp ?? Infinity) - (b.marketAdp ?? Infinity) || a.playerId.localeCompare(b.playerId));
}

/** The season `lastSeason` reports: the one before the season being drafted for. */
export const BOARD_LAST_SEASON = PRODUCT_SEASON - 1;

/**
 * Last season's measured points for a set of market-order players, under one set of rules: the
 * league's own row (`resolveBoardFormat`, falling back to `PPR_SCORING` for a league whose row has
 * not been written) or, for a league-free board, the chosen format's exact preset. The same
 * fallback `rankedPlayers` and `playerSeason` already make, so the readers cannot disagree about
 * what a ruleless league scores like.
 */
async function lastSeasonLines(db: Db, playerIds: readonly string[], rules: ScoringRules): Promise<ReadonlyMap<string, BoardLastSeason>> {
  const lines = await kdefSeasonLines(db, { season: BOARD_LAST_SEASON, playerIds, rules });
  return new Map(
    [...lines].map(([playerId, line]) => [
      playerId,
      { season: line.season, points: line.points, games: line.games, pointsPerGame: line.pointsPerGame },
    ]),
  );
}

/**
 * THE ROWS FOR A POSITION THAT SHIPS IN MARKET ORDER (the 2026-09-05 kicker and team defence round).
 *
 * Both the kicker and the team defence failed their preregistered gates on 2025
 * (`docs/research/2026-09-05-kicker-defense-preregistration-results.md`), so `KDEF_DECISION` says
 * the engine publishes no projection for either and `preseason_projections` holds not one row for
 * them. Without this reader their tabs on the Draft HQ board read "No players match this filter",
 * which is not what the spec's decision rule asks for and is not even true: the players exist and
 * the market has an opinion about them. It is the ordering and the numbers the engine has nothing to
 * say about.
 *
 * SO THE ROWS COME FROM THE PRODUCT'S OWN DIRECTORY AND CARRY THE MARKET'S OWN ORDER, and every
 * projection field is `null`. Not zero, anywhere: `projectedPoints`, the three band figures,
 * `valueOverReplacement`, `valueRank`, the tier triad, `rank` and `overallRank` are all absent,
 * because absence is the honest rendering of "we did not measure this" and a zero is a claim.
 *
 * A PLAYER THE MARKET HAS NO OPINION ABOUT IS ABSENT ENTIRELY, rather than listed at the bottom with
 * a blank ADP. The whole basis of the row is the market's order; without an ADP there is no basis
 * and therefore no row. Measured on the 2025 board: 23 of the kickers and 9 of the defences with a
 * real season carry no published average draft position at all.
 *
 * NOT PART OF THE VALUE SORT. These are concatenated after it, so they cannot perturb a single
 * projected row, which is the same guarantee gate G4 makes for the offline board.
 *
 * AND THEY CARRY LAST SEASON (the 2026-09-06 round). The engine has nothing to project for these
 * positions and that stays true. It is not the same as having nothing to SAY about them: the
 * archive holds thirteen seasons of weekly kicking and team-defense history, and `kdefSeasonLines`
 * scores last season's out of it under this league's own rules. A drafter reading a tab of dashes
 * learns nothing; a drafter reading what each of these kickers actually scored last year under his
 * own scoring is reading a measurement, which is the only currency this product deals in.
 */
async function marketOrderRows(db: Db, byes: ReadonlyMap<string, number>, rules: ScoringRules): Promise<readonly BoardRow[]> {
  const positions = marketOrderPositions();
  if (positions.length === 0) return [];

  const rows = await db
    .select({
      playerId: playersTable.id,
      name: playersTable.name,
      position: playersTable.position,
      team: playersTable.nflTeam,
      headshotUrl: playersTable.headshotUrl,
      adp: playersTable.adp,
      posAdp: playersTable.posAdp,
    })
    .from(playersTable)
    .where(inArray(playersTable.position, [...positions]));

  // Only a PRICED player becomes a row (see the docblock), so only priced players are worth a
  // read of the archive.
  const priced = rows.flatMap((row) => (row.adp === null ? [] : [{ ...row, adp: row.adp }]));
  const lastSeason = await lastSeasonLines(db, priced.map((row) => row.playerId), rules);

  const rankedByPosition = new Map<string, number>();
  return priced
    .sort((a, b) => a.adp - b.adp || a.playerId.localeCompare(b.playerId))
    .map((row): BoardRow => {
      const place = (rankedByPosition.get(row.position) ?? 0) + 1;
      rankedByPosition.set(row.position, place);
      return {
        lastSeason: lastSeason.get(row.playerId) ?? null,
        playerId: row.playerId,
        // A market-order row is not joined through the crosswalk at all: its basis is the product's
        // own directory and the market's own order, neither of which needs a gsis id. The field is
        // the product id so nothing downstream can mistake it for an engine-keyed row.
        nflPlayerId: row.playerId,
        name: row.name,
        position: row.position,
        team: row.team,
        headshotUrl: row.headshotUrl,
        rank: null,
        overallRank: null,
        marketOrderRank: place,
        projectedPoints: null,
        floorPoints: null,
        medianPoints: null,
        ceilingPoints: null,
        valueOverReplacement: null,
        valueRank: null,
        positionRankInValue: null,
        tier: null,
        playersLeftInTier: null,
        dropToNextTier: null,
        overallTier: null,
        overallPlayersLeftInTier: null,
        overallDropToNextTier: null,
        marketAdp: row.adp,
        marketPositionAdp: row.posAdp,
        byeWeek: byes.get(row.team) ?? null,
        // No reasons: a reason explains a number this row does not carry. The surface says why the
        // whole POSITION has none, once, above the table (`marketOrderNoteFor`).
        reasons: [],
        // The gate reads the projected board's candidates; a market-order position never passes
        // through it, so nothing is known here and nothing is claimed.
        rosterStatus: null,
      };
    });
}
