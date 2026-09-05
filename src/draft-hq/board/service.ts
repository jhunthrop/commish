import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players as playersTable, playerCrosswalk } from "@/db/schema";
import type { Position } from "@/domain/player";
import type { LeagueShape } from "@/projections/decide/replacement";
import { valueBoard } from "@/projections/decide/replacement";
import { tiersOf } from "@/projections/decide/tiers";
import type { BoardReason } from "@/projections/preseason/board";
import { BOARD_SOURCE, boardReasons, preseasonProjectionsAsOf } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { byeWeeksByTeam } from "@/league-service/nfl-schedule";

/**
 * THE BOARD, READ FOR A PRODUCT SURFACE (spec §3) — joins the stored evidence board
 * (`preseason_projections`, `BOARD_SOURCE`, keyed on `nfl_players.id`) back to the product's own
 * player directory (`players`, keyed on the stats provider's id) through `player_crosswalk`, and
 * recomputes the DRAFT-VALUE view (value over replacement, tiers, cliffs) under whichever
 * `LeagueShape` the caller asks for.
 *
 * WHAT IS RECOMPUTED AND WHAT IS NOT, stated plainly because it is the one place this module
 * could quietly overclaim. `projectedPoints`/`floorPoints`/`medianPoints`/`ceilingPoints` are the
 * SHIPPED board's own numbers — composed once, offline, under `BOARD_SOURCE`'s fixed PPR,
 * 12-team scoring (`board-store.ts`'s own docblock: the per-game season line that would let a
 * different scoring FORMAT be re-priced live is deliberately not persisted). What genuinely
 * changes per league here is the DRAFT-VALUE half: `valueOverReplacement`, `valueRank`, position
 * rank-in-value-order and the tier ladder, all rebuilt from those same stored points against the
 * CALLER'S OWN `teamCount`/`rosterSlots` via `decide/replacement.ts`'s `valueBoard` — which is
 * exactly the mechanism that moves fourteen quarterbacks up a 2-QB league's board (a roster-shape
 * effect, not a scoring-format one), and costs nothing offline because it is arithmetic over
 * numbers already in hand. A genuine points recompute under a different scoring FORMAT (Standard
 * vs. Half vs. full PPR) would require storing the season stat line and re-running
 * `computeFantasyPoints` per format; that is real, undone engineering work, reported as deferred
 * rather than faked (see the report this task ships with).
 */
export interface BoardRow {
  readonly playerId: string;
  readonly nflPlayerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: string;
  readonly headshotUrl: string | null;
  /** The shipped board's own overall rank, by points — fixed, never recomputed per league.
   *  A provenance fact, NOT the display order: the board displays `overallRank`. */
  readonly rank: number;
  /** The board's served order: rank in VALUE under the caller's shape (points over replacement),
   *  with no-value positions last. This is what "overall rank" means to a drafter, and what the
   *  Edge comparison against ADP (itself a value ordering) must use — founder ruling 2026-09-04. */
  readonly overallRank: number;
  readonly projectedPoints: number;
  readonly floorPoints: number;
  readonly medianPoints: number;
  readonly ceilingPoints: number;
  /** Recomputed under the caller's `LeagueShape`. `null` for a position the shape never starts
   *  at all (`valueBoard` leaves it out rather than pricing it at zero) — an honest "no draft
   *  value in this format" rather than a fabricated number. */
  readonly valueOverReplacement: number | null;
  readonly valueRank: number | null;
  readonly positionRankInValue: number | null;
  readonly tier: number | null;
  readonly playersLeftInTier: number | null;
  readonly dropToNextTier: number | null;
  readonly marketAdp: number | null;
  readonly marketPositionAdp: string | null;
  readonly byeWeek: number | null;
  readonly reasons: readonly BoardReason[];
}

export interface BoardOptions {
  readonly shape: LeagueShape;
  readonly asOf?: Date;
}

/** The tier standing a `valueBoard` position pool implies — the same aggregate
 *  `board.ts`'s own (private) `tierStandings` computes, kept local here since that function is
 *  not exported and this reader's whole job is a SECOND, per-league pass over stored points
 *  rather than a first build of the board. */
function tierStandingsOf(valuesDescending: readonly number[]): readonly { readonly tier: number; readonly playersLeftInTier: number; readonly dropToNextTier: number }[] {
  const tiers = tiersOf(valuesDescending);
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
export async function boardRows(db: Db, { shape, asOf = new Date() }: BoardOptions): Promise<readonly BoardRow[]> {
  const stamp = { season: PRODUCT_SEASON, source: BOARD_SOURCE, asOf };
  const [projections, reasonsByNflId, byes] = await Promise.all([
    preseasonProjectionsAsOf(db, stamp),
    boardReasons(db, BOARD_SOURCE, PRODUCT_SEASON),
    byeWeeksByTeam(db),
  ]);
  if (projections.length === 0) return [];

  const nflIds = projections.map((row) => row.playerId);
  const crosswalkRows = await db
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
    .where(inArray(playerCrosswalk.nflPlayerId, nflIds));

  const byNflId = new Map(crosswalkRows.map((row) => [row.nflPlayerId as string, row]));

  // The DRAFT-VALUE overlay: rebuilt from the stored points against the caller's own shape. Every
  // projection resolves a position (it always does — a stored board row was priced under a real
  // position), so `SeasonProjection.position` is safe to read straight off the crosswalked row.
  const withPosition = projections.flatMap((row) => {
    const identity = byNflId.get(row.playerId);
    return identity === undefined ? [] : [{ row, identity }];
  });

  const valued = valueBoard(
    withPosition.map(({ row, identity }) => ({ playerId: row.playerId, position: identity.position, projectedPoints: row.projectedPoints })),
    shape,
  );
  const valueRanks = new Map(valued.map((entry, index) => [entry.playerId, index + 1] as const));
  const valuedByPlayer = new Map(valued.map((entry) => [entry.playerId, entry] as const));

  const standingsByPlayer = new Map<string, { readonly tier: number; readonly playersLeftInTier: number; readonly dropToNextTier: number }>();
  const positions = new Set(valued.map((entry) => entry.position));
  for (const position of positions) {
    const pool = valued.filter((entry) => entry.position === position);
    // Tiers are measured among DRAFT-RELEVANT players only (founder board audit, 2026-09-04):
    // below replacement level the isotonic plateaus pack players a hair apart, and letting that
    // texture into the pool distorts what a cliff means. Below-replacement rows carry no tier
    // and draw no band, which is itself the honest statement about them.
    const relevant = pool.filter((entry) => entry.valueOverReplacement > 0);
    const standings = tierStandingsOf(relevant.map((entry) => entry.valueOverReplacement));
    relevant.forEach((entry, index) => standingsByPlayer.set(entry.playerId, standings[index]!));
  }

  return withPosition
    .map(({ row, identity }): BoardRow => {
      const inValue = valuedByPlayer.get(row.playerId);
      const standing = standingsByPlayer.get(row.playerId);
      return {
        playerId: identity.playerId,
        nflPlayerId: row.playerId,
        name: identity.name,
        position: identity.position,
        team: identity.team,
        headshotUrl: identity.headshotUrl,
        rank: row.rank,
        overallRank: 0, // assigned below, after the value sort — see the docblock on the field
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
        marketAdp: identity.adp,
        marketPositionAdp: identity.posAdp,
        byeWeek: byes.get(identity.team) ?? null,
        reasons: reasonsByNflId.get(row.playerId) ?? [],
      };
    })
    .sort((a, b) => {
      // THE BOARD ORDERS BY VALUE, NOT RAW POINTS (founder, 2026-09-04: "we have way too many
      // QBs ranked too high"). Raw season points crown quarterbacks because everyone starts one
      // and replacement-level QB scoring is high; draft VALUE is points over replacement under
      // the league's shape, which the auction dollars and the tier bands already used. A row
      // with no value rank (a position this shape never starts) sinks to the bottom, points as
      // the tiebreak within it.
      const aValue = a.valueRank ?? Number.POSITIVE_INFINITY;
      const bValue = b.valueRank ?? Number.POSITIVE_INFINITY;
      // TIES DEFER TO THE MARKET (founder audit, 2026-09-04: two RBs identical to the hundredth
      // in points AND value were split RB1/RB2 by a sort artifact, against the market's order).
      // When our own evidence cannot separate two players, the market's preference is
      // information — the same doctrine as the thin-evidence shrinkage. Ceiling is deliberately
      // NOT the tiebreak: at an equal mean a wider band is more variance, not more player, and
      // risk preference belongs to the drafter's slot (the Simulator's question), never baked
      // into the board's order.
      if (a.valueOverReplacement !== null && a.valueOverReplacement === b.valueOverReplacement) {
        const aAdp = a.marketAdp ?? Number.POSITIVE_INFINITY;
        const bAdp = b.marketAdp ?? Number.POSITIVE_INFINITY;
        if (aAdp !== bAdp) return aAdp - bAdp;
      }
      return aValue - bValue || a.rank - b.rank;
    })
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
    );
}
