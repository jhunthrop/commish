import { and, eq, gte, lt, lte } from "drizzle-orm";
import type { ReadonlyDb } from "@research/db/client";
import { playerPropObservations, propsPlayerMap } from "@research/db/schema";
import { isPropMarket, type PropMarket } from "../odds/props-store";
import { REGISTER_SCORING } from "./store";

/**
 * THE WEEK'S PROPS CONSENSUS — the third benchmark column, derived from the archive rather than
 * stored by it.
 *
 * `player_prop_observations` is a flat, append-only pile of Over/Under pairs: one row per
 * (event, market, bookmaker, player, fetch). Turning that into "what the market expected of this
 * man this week" needs four decisions, and every one of them is a place a number could quietly
 * become dishonest, so each is stated here rather than buried in a query.
 *
 * 1. WHICH ROWS BELONG TO THE WEEK. The archive carries no week column at all (see the table's own
 *    docblock — it is keyed on the odds API's event, not on the NFL's calendar). The week is taken
 *    from the SCHEDULE instead: an event belongs to week W when its `commence_time` falls at or
 *    after week W's own first kickoff and strictly before week W+1's. The final week of a season has
 *    no successor kickoff and therefore no upper bound, which is correct rather than a gap.
 *
 * 2. WHICH SNAPSHOT OF A LINE COUNTS. A book's number moves through the week, and the archive keeps
 *    every fetch. The freeze may only see what had been fetched by the freeze instant, so this reads
 *    `fetched_at <= asOf` and then, per (player, market, bookmaker), keeps the LATEST such fetch.
 *    That is the same "latest statement at or before the moment" rule every `DISTINCT ON` read in
 *    this engine uses, done in TypeScript because the identity here spans a join the archive does
 *    not carry.
 *
 * 3. WHAT "CONSENSUS" MEANS ACROSS BOOKS: the MEDIAN of the surviving points, not the mean. Books
 *    disagree by half a yard most of the time and by fifteen when one of them has not moved off a
 *    stale number, and a mean lets that one stale book drag the consensus. An even count averages
 *    the two middle values, the standard definition.
 *
 * 4. HOW A SET OF LINES BECOMES A POINT TOTAL: through `REGISTER_SCORING`, the same rules the board
 *    was composed under and the same rules the week's outcome is scored by. A player with SOME of
 *    the four markets is priced on the ones he has — a running back with a rushing line and no
 *    receiving line is a real, common case, and refusing to price him would silently restrict this
 *    benchmark to receivers.
 *
 * A PLAYER WITH NO LINE THAT WEEK IS ABSENT FROM THE RESULT, never present with a zero. The caller
 * turns that absence into a NULL column. A prop name the resolver never matched to a player id is
 * likewise absent: `props_player_map` holds only matches, deliberately, and inventing a join here
 * would put one man's line on another man's row permanently and invisibly.
 */

/** What the books collectively expected of one player in one week. */
export interface PropsStance {
  /** The four market medians priced through `REGISTER_SCORING`. */
  readonly points: number;
  /** The median line per market behind `points` — kept so the derived number stays checkable. */
  readonly markets: Readonly<Record<string, number>>;
}

/** The half-open window of kickoffs one week owns. `to` is `null` for a season's final week. */
export interface WeekWindow {
  readonly from: Date;
  readonly to: Date | null;
}

export interface PropsConsensusQuery {
  readonly season: number;
  readonly window: WeekWindow;
  /** The freeze instant. A line fetched after this is invisible, exactly as everywhere else. */
  readonly asOf: Date;
}

/**
 * How each market's median line is priced. Derived from `REGISTER_SCORING` rather than written
 * out, so a scoring change cannot leave this table saying something the board does not.
 *
 * A `Partial` record, not `Record<PropMarket, number>` (props-anchor fix round 1, MEDIUM 2,
 * 2026-09-05): `player_pass_tds` joined `PROP_MARKETS`'s raw capture this round, and this benchmark
 * reads whatever markets the archive actually holds, but pricing a market into `points` here is a
 * scoring-weight decision, not a rescale fit — unlike `props-anchor.ts`'s own rescale, which
 * genuinely cannot move without a re-fit, this ONE market's price is already sitting in
 * `REGISTER_SCORING.pointsPerPassingTouchdown` and adding it here would be entirely correct. It
 * stays out anyway, on purpose, to keep this round's change to exactly what was asked (raw capture
 * only) — see `getPropsConsensus`'s own loop below for how an unweighted-but-observed market still
 * reaches `PropsStance.markets` (the raw line, unpriced) rather than being silently dropped.
 */
const MARKET_WEIGHT: Readonly<Partial<Record<PropMarket, number>>> = {
  player_pass_yds: REGISTER_SCORING.pointsPerPassingYard,
  player_rush_yds: REGISTER_SCORING.pointsPerRushingYard,
  player_reception_yds: REGISTER_SCORING.pointsPerReceivingYard,
  player_receptions: REGISTER_SCORING.pointsPerReception,
};

/** The middle value, or the mean of the two middle values. Never called with an empty list. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** One book's surviving line for one (player, market) — the latest fetch at or before the moment. */
interface LatestLine {
  readonly point: number;
  readonly fetchedAt: Date;
}

/**
 * The map key for one (player, market, bookmaker) line — `JSON.stringify` of the tuple, and not a
 * delimiter-joined string.
 *
 * THE DELIMITER PROBLEM IS REAL HERE, not hypothetical. A bookmaker key is free text the odds API
 * chooses, and a gsis id contains a hyphen; joining on any single printable character means picking
 * one that provably cannot appear in any of the three fields, and "provably" is a claim that has to
 * be re-earned every time a field's source changes. `JSON.stringify` needs no such claim: it is
 * injective over string tuples by construction, because it escapes the only two characters (`"` and
 * `\`) that could otherwise let one field's content imitate a field boundary. Two different tuples
 * cannot produce the same key, whatever the API starts returning.
 *
 * THE FIRST VERSION OF THIS FUNCTION JOINED ON LITERAL NUL BYTES (fix round 1). NUL is unambiguous
 * as a delimiter and was a bad choice anyway: it is a control character in a source file, it made
 * git classify this module as BINARY, and a binary file does not appear in a diff — so the module
 * was invisible to diff-based review at exactly the moment it was being reviewed. A key function is
 * not worth costing the file its readability, and this one is both correct and printable.
 */
export function propLineKey(playerId: string, market: PropMarket, bookmaker: string): string {
  return JSON.stringify([playerId, market, bookmaker]);
}

/**
 * Every player the books priced in the week's window, as of `asOf`, with each market's median line
 * and the point total those medians imply.
 */
export async function weekPropsConsensus(
  db: ReadonlyDb,
  { season, window, asOf }: PropsConsensusQuery,
): Promise<ReadonlyMap<string, PropsStance>> {
  const mapRows = await db
    .select({ propName: propsPlayerMap.propName, playerId: propsPlayerMap.playerId })
    .from(propsPlayerMap)
    .where(eq(propsPlayerMap.season, season));
  const playerIdByName = new Map(mapRows.map((row) => [row.propName, row.playerId]));
  if (playerIdByName.size === 0) return new Map();

  const observations = await db
    .select({
      playerName: playerPropObservations.playerName,
      market: playerPropObservations.market,
      bookmaker: playerPropObservations.bookmaker,
      point: playerPropObservations.point,
      fetchedAt: playerPropObservations.fetchedAt,
    })
    .from(playerPropObservations)
    .where(
      and(
        gte(playerPropObservations.commenceTime, window.from),
        window.to === null ? undefined : lt(playerPropObservations.commenceTime, window.to),
        lte(playerPropObservations.fetchedAt, asOf),
      ),
    );

  // Step 2: one surviving line per (player, market, book) — the latest fetch at or before `asOf`.
  const latest = new Map<string, LatestLine>();
  const marketsByPlayer = new Map<string, Map<PropMarket, string[]>>();
  for (const row of observations) {
    const playerId = playerIdByName.get(row.playerName);
    if (playerId === undefined) continue;
    if (!isPropMarket(row.market)) continue;
    const key = propLineKey(playerId, row.market, row.bookmaker);
    const held = latest.get(key);
    if (held !== undefined && held.fetchedAt.getTime() >= row.fetchedAt.getTime()) continue;
    latest.set(key, { point: row.point, fetchedAt: row.fetchedAt });
    const byMarket = marketsByPlayer.get(playerId) ?? new Map<PropMarket, string[]>();
    const books = byMarket.get(row.market) ?? [];
    if (!books.includes(key)) books.push(key);
    byMarket.set(row.market, books);
    marketsByPlayer.set(playerId, byMarket);
  }

  // Steps 3 and 4: median across books, then priced through the register's own scoring rules.
  const stances = new Map<string, PropsStance>();
  for (const [playerId, byMarket] of marketsByPlayer) {
    const markets: Record<string, number> = {};
    let points = 0;
    for (const [market, keys] of byMarket) {
      const line = median(keys.map((key) => latest.get(key)!.point));
      markets[market] = line;
      // Observed but unweighted (`player_pass_tds`, this round) still lands in `markets` above —
      // the raw line is never hidden — it just does not move `points` until a weight is added.
      const weight = MARKET_WEIGHT[market];
      if (weight !== undefined) points += line * weight;
    }
    stances.set(playerId, { points, markets });
  }
  return stances;
}
