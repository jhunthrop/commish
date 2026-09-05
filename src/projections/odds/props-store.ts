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

/**
 * The markets this tier's key was verified against. Any other market key in a response is a
 * contract change this store refuses to guess at.
 *
 * FOUR MARKETS verified at `progress.md`, founder update 2. A FIFTH, `player_pass_tds`, was added
 * in the props-anchor activation's fix round 1 (MEDIUM 2, 2026-09-05) after a single live
 * `/events/{id}/odds` request confirmed the paid tier serves it (`player_rush_tds`, requested in
 * the SAME call, was NOT served — six bookmakers returned zero rows for it, so it is deliberately
 * left off this list; see `docs/research/2026-09-05-props-anchor-backtest.md`'s own follow-ups
 * section for the full finding and credit cost).
 *
 * `player_pass_tds` IS CAPTURED AS A RAW ROW ONLY, going forward, from this commit on — it is
 * NOT wired into `props-anchor.ts`'s `propsPerGameLine` or the anchor rescale this round. A market
 * this store did not previously archive has no historical (2023-2025) coverage to fit against, and
 * QB is the one position `docs/research/2026-09-05-props-anchor-backtest.md`'s own backtest found
 * the current four-market anchor REGRESSES (the archived markets price passing yards but never
 * touchdowns) — adding this market to the price math without a proper fit is exactly the kind of
 * eyeballed change this engine's own discipline forbids. The next fit round is what prices it.
 */
export const PROP_MARKETS = ["player_pass_yds", "player_reception_yds", "player_receptions", "player_rush_yds", "player_pass_tds"] as const;
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

/** One player+point a market listed the SAME side of twice -- a real archive payload (2025
 *  backfill, week 2-ish: `duplicate Over outcome for "Jahmyr Gibbs" at point 2.5`) turned out to
 *  be a book leaving a stale price beside its own update in one snapshot, not a shape violation.
 *  Reported alongside `side`, the side that was ambiguous -- see `parseMarketOutcomes`'s own
 *  docblock for why the whole pair is dropped rather than picking one of the two prices. */
interface DuplicateOutcome {
  readonly playerName: string;
  readonly point: number;
  readonly side: "Over" | "Under";
}

/**
 * One market's outcomes, validated and paired into Over/Under by player name + point.
 *
 * The pairing key is `"${playerName} ${point}"`. A player name may itself contain spaces, but
 * `point` never does -- it is always a finite number's own string form -- so the text after the
 * LAST space in the key is always exactly `point`, and everything before it is always exactly
 * `playerName`. Two different (name, point) pairs can therefore never produce the same key.
 *
 * A SAME-SIDE DUPLICATE (two Overs, or two Unders, for one player+point) is AMBIGUOUS, not
 * malformed: a book's snapshot occasionally preserves a stale price beside its own update rather
 * than replacing it, and this store has no way to tell which of the two numbers is the live one.
 * Refusing to guess, the WHOLE pair for that player+point is dropped -- both sides, even a side
 * that arrived cleanly before the duplicate did -- and reported via the returned `duplicated` map
 * rather than either thrown (killing the whole response, and every OTHER book's honest prices in
 * it, over one book's mess) or silently resolved by picking a price arbitrarily. Once a key is
 * marked duplicated, any further entries for it (a book that lists the same side three times, not
 * two) are ignored rather than re-flagged, so one ambiguous player+point is reported exactly once.
 *
 * Every OTHER shape violation still throws: an unknown outcome `name`, a missing/non-finite
 * `point` or `price`, an empty player name -- these mean the response does not match the shape
 * this store was built against, which is a different failure than one book contradicting itself
 * about a price.
 */
function parseMarketOutcomes(
  outcomes: readonly unknown[],
  path: string,
): { readonly pairs: ReadonlyMap<string, OutcomePair>; readonly duplicated: ReadonlyMap<string, DuplicateOutcome> } {
  const pairs = new Map<string, OutcomePair>();
  const duplicated = new Map<string, DuplicateOutcome>();
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
    if (duplicated.has(key)) return; // already ambiguous for this pair -- further entries change nothing
    const pair = pairs.get(key) ?? { playerName, point };
    if (name === "Over") {
      if (pair.overPrice !== undefined) {
        duplicated.set(key, { playerName, point, side: "Over" });
        pairs.delete(key);
        return;
      }
      pair.overPrice = price;
    } else {
      if (pair.underPrice !== undefined) {
        duplicated.set(key, { playerName, point, side: "Under" });
        pairs.delete(key);
        return;
      }
      pair.underPrice = price;
    }
    pairs.set(key, pair);
  });
  return { pairs, duplicated };
}

/** One player+point dropped rather than stored — either it priced only one side, or a book
 *  contradicted itself about one (see `parseMarketOutcomes`'s own docblock for the second case).
 *  Both land here, under the SAME reported tally, because both are the identical operator
 *  question — "which lines couldn't this run archive" — with two different reasons. */
export interface SkippedUnpairedOutcome {
  readonly bookmaker: string;
  readonly market: PropMarket;
  readonly playerName: string;
  readonly point: number;
  /** `"unpaired"`: the response priced only one side. `"duplicate"`: the response priced one side
   *  twice (ambiguously), so the whole pair was dropped even if the other side WAS present. */
  readonly reason: "unpaired" | "duplicate";
  /** `"unpaired"`: the side the response DID carry — the missing side is whichever this is not.
   *  `"duplicate"`: the side that was ambiguous. Always present either way. */
  readonly presentSide: "Over" | "Under";
}

export interface ParsedEventOdds {
  readonly observations: readonly PlayerPropObservation[];
  /** Every player+point this response could not archive, unpaired or ambiguous alike. Reported
   *  rather than silently dropped, and rather than failing the whole response over it — see
   *  `parseMarketOutcomes` and this function's own docblocks. */
  readonly skippedUnpaired: readonly SkippedUnpairedOutcome[];
}

/**
 * Parses one event-odds response (`GET /v4/sports/americanfootball_nfl/events/{id}/odds`) into
 * flat observation rows, pairing every market's Over and Under outcomes by player name and point.
 *
 * Rejects loudly, naming the offending path, on: an unknown market key, an outcome whose `name`
 * is neither "Over" nor "Under", a missing/non-finite `point` or `price`, and an empty player name
 * -- every one of these means the response does not match the shape this store was built against.
 *
 * TWO THINGS ARE NOT SHAPE VIOLATIONS, and both are dropped-and-reported instead of thrown:
 *
 * A player+point priced on only ONE side: verified against a real live response (`betrivers`,
 * event `8c94552d022acec4a0458d70c19d3da9`, `player_receptions`, Cooper Kupp at 2.5 -- an Over
 * with no Under anywhere in that book's block), some books genuinely post a single-sided line.
 *
 * A player+point priced on the SAME side TWICE (`parseMarketOutcomes`'s own `duplicated`):
 * verified against a real archive payload (the 2025 historical backfill, week 2-ish --
 * `duplicate Over outcome for "Jahmyr Gibbs" at point 2.5`), a book's snapshot occasionally
 * preserves a stale price beside its own update rather than replacing it. This USED to throw --
 * which is what killed that whole backfill run over one book's mess -- and now skips instead,
 * exactly like the single-sided case.
 *
 * Neither is a broken payload, and this table's schema has no row shape for either (a price with
 * no opposite number, or two conflicting prices for one side) regardless. Storing an observation
 * always needs exactly one unambiguous price per side, so both are dropped rather than stored --
 * but "dropped" is reported back in `skippedUnpaired`, never silent, so an operator can see
 * exactly which lines this run could not archive, and why.
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
      const { pairs, duplicated } = parseMarketOutcomes(outcomes, `${marketPath}.outcomes`);

      for (const duplicate of duplicated.values()) {
        skippedUnpaired.push({
          bookmaker: bookmakerKey,
          market: marketKey,
          playerName: duplicate.playerName,
          point: duplicate.point,
          reason: "duplicate",
          presentSide: duplicate.side,
        });
      }

      for (const pair of pairs.values()) {
        if (pair.overPrice === undefined || pair.underPrice === undefined) {
          skippedUnpaired.push({
            bookmaker: bookmakerKey,
            market: marketKey,
            playerName: pair.playerName,
            point: pair.point,
            reason: "unpaired",
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
