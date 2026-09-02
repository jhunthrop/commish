import { and, eq, sql } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { playerPropObservations } from "@/db/schema";

/**
 * THE PLAYER-PROPS ARCHIVE'S TYPESCRIPT SEAM — parse, write, read. (vegas-laws Task 6.)
 *
 * See `player_prop_observations` in `@/db/schema` for the storage discipline this module writes
 * to: append-only, no upserts, no deletes, a repeated snapshot always inserts new rows. This file
 * is deliberately thin. It does not fetch — `scripts/odds-props-snapshot.ts` owns the network call
 * and the credit budget — and it does not resolve player names against the crosswalk. It turns one
 * event-odds response into rows, writes rows, and counts what landed.
 */

/** The four markets this tier's key was verified against (`progress.md`, founder update 2). Any
 *  other market key in a response is a contract change this store refuses to guess at. */
export const PROP_MARKETS = ["player_pass_yds", "player_reception_yds", "player_receptions", "player_rush_yds"] as const;
export type PropMarket = (typeof PROP_MARKETS)[number];

const PROP_MARKET_SET: ReadonlySet<string> = new Set(PROP_MARKETS);

export function isPropMarket(value: string): value is PropMarket {
  return PROP_MARKET_SET.has(value);
}

/** One Over/Under pair, for one player, at one bookmaker, in one market, as of one fetch. */
export interface PlayerPropObservation {
  readonly eventId: string;
  readonly commenceTime: Date;
  readonly bookmaker: string;
  readonly market: PropMarket;
  /** The API's own outcome `description`, verbatim. Never resolved to an `nfl_players.id` here —
   *  see the table's own docblock in `@/db/schema`. */
  readonly playerName: string;
  readonly point: number;
  readonly overPrice: number;
  readonly underPrice: number;
  /** When this snapshot run fetched the line — one instant, shared by every row one run writes. */
  readonly fetchedAt: Date;
}

function fail(path: string, reason: string): never {
  throw new Error(`odds-props-snapshot: ${path}: ${reason}`);
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, `expected an object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, `expected an array, got ${JSON.stringify(value)}`);
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(path, `expected a non-empty string, got ${JSON.stringify(value)}`);
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, `expected a finite number, got ${JSON.stringify(value)}`);
  return value;
}

function requireDate(value: unknown, path: string): Date {
  const raw = requireNonEmptyString(value, path);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) fail(path, `unparseable date "${raw}"`);
  return parsed;
}

/** One player+point's Over and/or Under side, while a market's outcomes are being paired up. */
interface OutcomePair {
  readonly playerName: string;
  readonly point: number;
  overPrice?: number;
  underPrice?: number;
}

/**
 * One market's outcomes, validated and paired into Over/Under by player name + point.
 *
 * The pairing key is `"${playerName} ${point}"`. A player name may itself contain spaces, but
 * `point` never does -- it is always a finite number's own string form -- so the text after the
 * LAST space in the key is always exactly `point`, and everything before it is always exactly
 * `playerName`. Two different (name, point) pairs can therefore never produce the same key.
 */
function parseMarketOutcomes(outcomes: readonly unknown[], path: string): ReadonlyMap<string, OutcomePair> {
  const pairs = new Map<string, OutcomePair>();
  outcomes.forEach((raw, index) => {
    const outcomePath = `${path}[${index}]`;
    const outcome = requireObject(raw, outcomePath);
    const name = requireNonEmptyString(outcome.name, `${outcomePath}.name`);
    if (name !== "Over" && name !== "Under") {
      fail(`${outcomePath}.name`, `expected "Over" or "Under", got ${JSON.stringify(name)} -- malformed outcome pair`);
    }
    const playerName = requireNonEmptyString(outcome.description, `${outcomePath}.description`);
    const point = requireFiniteNumber(outcome.point, `${outcomePath}.point`);
    const price = requireFiniteNumber(outcome.price, `${outcomePath}.price`);
    const key = `${playerName} ${point}`;
    const pair = pairs.get(key) ?? { playerName, point };
    if (name === "Over") {
      if (pair.overPrice !== undefined) {
        fail(outcomePath, `duplicate Over outcome for "${playerName}" at point ${point} -- malformed outcome pair`);
      }
      pair.overPrice = price;
    } else {
      if (pair.underPrice !== undefined) {
        fail(outcomePath, `duplicate Under outcome for "${playerName}" at point ${point} -- malformed outcome pair`);
      }
      pair.underPrice = price;
    }
    pairs.set(key, pair);
  });
  return pairs;
}

/** One player+point left with only one side priced, dropped rather than stored (see
 *  `parseEventOddsResponse`'s own docblock for why this is a skip, not a throw). */
export interface SkippedUnpairedOutcome {
  readonly bookmaker: string;
  readonly market: PropMarket;
  readonly playerName: string;
  readonly point: number;
  /** Which side the response DID carry — the missing side is whichever this is not. */
  readonly presentSide: "Over" | "Under";
}

export interface ParsedEventOdds {
  readonly observations: readonly PlayerPropObservation[];
  /** Every player+point this response priced on only one side. Reported rather than silently
   *  dropped, and rather than failing the whole response over it — see this function's docblock. */
  readonly skippedUnpaired: readonly SkippedUnpairedOutcome[];
}

/**
 * Parses one event-odds response (`GET /v4/sports/americanfootball_nfl/events/{id}/odds`) into
 * flat observation rows, pairing every market's Over and Under outcomes by player name and point.
 *
 * Rejects loudly, naming the offending path, on: an unknown market key, an outcome whose `name`
 * is neither "Over" nor "Under", a missing/non-finite `point` or `price`, an empty player name, and
 * a DUPLICATE Over or Under (two prices for the same side of the same player+point) -- every one
 * of these means the response does not match the shape this store was built against.
 *
 * A player+point priced on only ONE side is different: verified against a real live response
 * (`betrivers`, event `8c94552d022acec4a0458d70c19d3da9`, `player_receptions`, Cooper Kupp at
 * 2.5 -- an Over with no Under anywhere in that book's block), some books genuinely post a
 * single-sided line. That is a normal fact about the market, not a broken payload, and this
 * table's schema has no row shape for a price with no opposite number regardless. Storing an
 * observation always needs both prices, so an unpaired side is dropped rather than stored -- but
 * "dropped" is reported back in `skippedUnpaired`, never silent, so an operator can see exactly
 * which lines this run could not archive.
 *
 * ALL bookmakers the response carries are parsed, not one preferred book. A response with no
 * `bookmakers` at all (no book has posted this event's props yet) is valid and yields zero
 * observations, not an error.
 */
export function parseEventOddsResponse(payload: unknown, fetchedAt: Date): ParsedEventOdds {
  const root = requireObject(payload, "response");
  const eventId = requireNonEmptyString(root.id, "response.id");
  const commenceTime = requireDate(root.commence_time, "response.commence_time");
  const bookmakersRaw = root.bookmakers;
  if (bookmakersRaw === undefined || bookmakersRaw === null) return { observations: [], skippedUnpaired: [] };
  const bookmakers = requireArray(bookmakersRaw, "response.bookmakers");

  const observations: PlayerPropObservation[] = [];
  const skippedUnpaired: SkippedUnpairedOutcome[] = [];
  bookmakers.forEach((rawBookmaker, bookmakerIndex) => {
    const bookmakerPath = `response.bookmakers[${bookmakerIndex}]`;
    const bookmakerObj = requireObject(rawBookmaker, bookmakerPath);
    const bookmakerKey = requireNonEmptyString(bookmakerObj.key, `${bookmakerPath}.key`);
    const markets = requireArray(bookmakerObj.markets, `${bookmakerPath}.markets`);

    markets.forEach((rawMarket, marketIndex) => {
      const marketPath = `${bookmakerPath}.markets[${marketIndex}]`;
      const marketObj = requireObject(rawMarket, marketPath);
      const marketKey = requireNonEmptyString(marketObj.key, `${marketPath}.key`);
      if (!isPropMarket(marketKey)) {
        fail(`${marketPath}.key`, `unknown market "${marketKey}" -- expected one of ${PROP_MARKETS.join(", ")}`);
      }
      const outcomes = requireArray(marketObj.outcomes, `${marketPath}.outcomes`);
      const pairs = parseMarketOutcomes(outcomes, `${marketPath}.outcomes`);

      for (const pair of pairs.values()) {
        if (pair.overPrice === undefined || pair.underPrice === undefined) {
          skippedUnpaired.push({
            bookmaker: bookmakerKey,
            market: marketKey,
            playerName: pair.playerName,
            point: pair.point,
            presentSide: pair.overPrice !== undefined ? "Over" : "Under",
          });
          continue;
        }
        observations.push({
          eventId,
          commenceTime,
          bookmaker: bookmakerKey,
          market: marketKey,
          playerName: pair.playerName,
          point: pair.point,
          overPrice: pair.overPrice,
          underPrice: pair.underPrice,
          fetchedAt,
        });
      }
    });
  });

  return { observations, skippedUnpaired };
}

const INSERT_CHUNK_ROWS = 2_000;

/** Writes prop observations. ALWAYS a plain append -- no `onConflictDoNothing`, because there is
 *  no fact key this table treats as stable (see the table's own docblock). Returns the count
 *  written, which is always `rows.length`. */
export async function recordPropObservations(db: Db, rows: readonly PlayerPropObservation[]): Promise<number> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row }));
    await db.insert(playerPropObservations).values(chunk);
  }
  return rows.length;
}

/** Per-(event, market) row counts for one snapshot's own `fetched_at` stamp, plus the total —
 *  exactly what `odds-props-snapshot.ts` prints. */
export interface PropObservationCounts {
  readonly byEventMarket: ReadonlyMap<string, number>;
  readonly total: number;
}

/** Counts rows this store holds for one exact `fetched_at` instant, grouped by event and market. */
export async function countPropObservations(db: ReadonlyDb, fetchedAt: Date): Promise<PropObservationCounts> {
  const rows = await db
    .select({
      eventId: playerPropObservations.eventId,
      market: playerPropObservations.market,
      count: sql<number>`count(*)::int`,
    })
    .from(playerPropObservations)
    .where(and(eq(playerPropObservations.fetchedAt, fetchedAt)))
    .groupBy(playerPropObservations.eventId, playerPropObservations.market);

  const byEventMarket = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    byEventMarket.set(`${row.eventId}|${row.market}`, row.count);
    total += row.count;
  }
  return { byEventMarket, total };
}

/**
 * Every event id this store already holds at least one observation for -- `odds-props-backfill.ts`'s
 * resume/skip check (`backfill-plan.ts`'s `eventsNeedingFetch`). One archived snapshot per event is
 * this backfill's own invariant (never more than one historical fetch per event, ever), so "has any
 * row" is a sufficient, and cheap, "already done" test -- no `fetched_at` comparison needed.
 */
export async function archivedEventIds(db: ReadonlyDb): Promise<ReadonlySet<string>> {
  // `ReadonlyDb` exposes no `selectDistinct` (`db/client.ts`'s own narrowing) -- plain `select` plus
  // a `Set` gives the same distinct result, and this table's own row count keeps that cheap.
  const rows = await db.select({ eventId: playerPropObservations.eventId }).from(playerPropObservations);
  return new Set(rows.map((row) => row.eventId));
}
