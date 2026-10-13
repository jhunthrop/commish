/**
 * AUCTION VALUES (spec §3): a dollar figure for every board row, derived from evidence points
 * over replacement, never a second opinion invented for auction leagues. `$200` is the default
 * per-team budget (spec's own default); a league with an `auction_budget` on its `drafts` row
 * uses that instead (`AuctionShape.budget`, the caller's job to supply).
 *
 * THE STANDARD "DOLLARS PER VALUE-OVER-REPLACEMENT" METHOD, stated so a reviewer can check the
 * arithmetic against any published auction calculator:
 *
 *   1. Every drafted roster spot costs at least $1 — a full roster of N teams times S spots each
 *      reserves `N * S` dollars from the league's total `N * budget` before a single dollar is
 *      allocated by value.
 *   2. What is LEFT (`surplus`) is split across the players who will actually be drafted — the
 *      top `N * S` players by value over replacement, among those with POSITIVE value (a player
 *      below his position's replacement level has no value to auction off) — in proportion to
 *      each one's own share of the pool's total value.
 *   3. Every other player, including one whose value over replacement never enters the drafted
 *      pool, prices at the $1 floor: a real player can always be nominated for a dollar, and a
 *      calculator that priced him at $0 or a negative number would be printing a lie.
 *
 * WHAT THIS DOES NOT CLAIM: it does not reproduce what a real room's auction prices will be
 * (a nomination order, inflation as budgets deplete, and a manager's own preferences all move a
 * real auction) — it is the same PRE-AUCTION VALUE ESTIMATE every published calculator offers,
 * derived from this product's own evidence points rather than borrowed from anyone else's board.
 */
export interface AuctionValueInput {
  readonly playerId: string;
  /** `null` for a player the recomputed value-over-replacement view left out entirely (a
   *  position the league shape does not start) — priced at the $1 floor, the same as any player
   *  outside the drafted pool. */
  readonly valueOverReplacement: number | null;
}

export interface AuctionShape {
  readonly teamCount: number;
  /** Every roster spot a team fills, starters and bench together — the total number of players
   *  one team will actually draft. */
  readonly rosterSpots: number;
  /** Per-team budget. `200` is this product's own default (spec §3); a real auction league's
   *  `drafts.auction_budget` overrides it when one is set. */
  readonly budget: number;
}

const DOLLAR_FLOOR = 1;

/** Every player's whole-dollar auction value, keyed by id. Players outside the drafted pool (or
 *  with no positive value in this league's shape) price at the `$1` floor — never `$0`, never
 *  negative. Throws on a non-positive team count, roster-spot count or budget: an auction with
 *  no teams, no roster or no money to spend is not a shape this function can price a market
 *  against. */
export function auctionValues(players: readonly AuctionValueInput[], shape: AuctionShape): ReadonlyMap<string, number> {
  if (!Number.isFinite(shape.teamCount) || shape.teamCount <= 0) {
    throw new Error(`Auction values need a positive team count; got ${shape.teamCount}.`);
  }
  if (!Number.isFinite(shape.rosterSpots) || shape.rosterSpots <= 0) {
    throw new Error(`Auction values need a positive roster-spot count; got ${shape.rosterSpots}.`);
  }
  if (!Number.isFinite(shape.budget) || shape.budget <= 0) {
    throw new Error(`Auction values need a positive per-team budget; got ${shape.budget}.`);
  }

  const draftedCount = shape.teamCount * shape.rosterSpots;
  const totalDollars = shape.teamCount * shape.budget;
  const reserve = draftedCount * DOLLAR_FLOOR;
  const surplus = Math.max(0, totalDollars - reserve);

  const ranked = players
    .filter((player): player is AuctionValueInput & { readonly valueOverReplacement: number } => (player.valueOverReplacement ?? 0) > 0)
    .sort((a, b) => b.valueOverReplacement - a.valueOverReplacement || a.playerId.localeCompare(b.playerId));
  const pool = ranked.slice(0, draftedCount);
  const sumVor = pool.reduce((sum, player) => sum + player.valueOverReplacement, 0);

  const values = new Map<string, number>();
  for (const player of players) values.set(player.playerId, DOLLAR_FLOOR);
  for (const player of pool) {
    const share = sumVor > 0 ? player.valueOverReplacement / sumVor : 0;
    values.set(player.playerId, Math.max(DOLLAR_FLOOR, Math.round(DOLLAR_FLOOR + surplus * share)));
  }
  return values;
}
