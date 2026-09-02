import { and, gte, lt } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { playerPropObservations, propsPlayerMap } from "@/db/schema";
import { STAT_FIELDS, type Position, type StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { isPropMarket, type PropMarket } from "../odds/props-store";
import { seasonOfKickoff } from "../odds/player-map";
import { computeFantasyPoints } from "@/scoring/compute";
import { isCurvePosition, type ImpliedGamesByPosition } from "./curve";

/**
 * THE PROPS ANCHOR (fit-round Task 3, deliverable C) — a second, independent opinion about how good a
 * player is, built from the sportsbooks' own archived pre-kickoff player props and expressed in the
 * market curve's own units so the blend can anchor on a mixture of the two.
 *
 * WHY A SECOND ANCHOR AT ALL. The blend's incumbent anchor is ADP: what twelve real fantasy managers
 * paid for a player in late August. That is a real price and it is slow — it moves on name
 * recognition and it is set by amateurs. A sportsbook's week-one receiving-yards line is also a real
 * price, set by people with money at risk against a market that corrects them within hours, and it is
 * about a DIFFERENT thing (this player's expected production per game) than ADP is (this player's
 * expected value over a whole season, availability included). Neither dominates, which is exactly the
 * shape of question a fitted weight answers.
 *
 * THE LEAKAGE GATE IS THE FIRST THING THIS FILE DOES, and it is unconditional. Season S's anchor may
 * only read rows whose `fetched_at` is STRICTLY BEFORE season S's own first kickoff. A line fetched
 * after week one has watched football happen, and a board built from it is not a preseason board. The
 * gate is re-applied here even when a caller has already narrowed its query, because a gate that
 * lives only in a caller is a gate that a second caller does not have.
 *
 * THE MAPPING, and every choice in it stated plainly. This is deliberately the SIMPLEST HONEST
 * version, not the cleverest one:
 *
 *   1. WEEK-ONE-ADJACENT ONLY. Only lines for games kicking off inside `WEEK_ONE_WINDOW_DAYS` of the
 *      season's first kickoff. Later weeks' lines are mostly unposted before kickoff anyway, and one
 *      week is what a preseason board is entitled to see. The signal wanted here is a level, and week
 *      one is where the whole league has one.
 *   2. MEDIAN ACROSS BOOKS AND SNAPSHOTS, per (player, market). Books disagree by half-points and one
 *      of them is occasionally stale by a mile; a median is unmoved by that and a mean is not.
 *   3. THE FOUR MARKETS BECOME ONE PER-GAME POINTS NUMBER through the engine's OWN scoring path.
 *      `computeFantasyPoints` on a synthetic per-game line (`propsPerGameLine`) rather than a private
 *      weights table: one definition of what a receiving yard is worth, TE reception bonus included.
 *   4. SEASON STRENGTH = per-game points times the market's OWN implied games played at that position
 *      (`BlendConstants.impliedGamesByPosition`) — the same attrition assumption the anchor it is
 *      being blended against already carries, so the two sides are commensurable before the rescale.
 *   5. RESCALED ONTO THE MARKET'S OWN UNITS, per position, by a SINGLE multiplicative factor: the
 *      ratio of the anchored population's total market points to its total raw props points. One
 *      parameter, no intercept, computed from the same season's own pre-kickoff facts and nothing
 *      else. It is order-preserving by construction (a positive scalar), and it is what makes step 4
 *      honest about its own known gap: the four archived markets price no touchdowns at all, so raw
 *      props points understate every player's fantasy scoring by roughly a position-wide factor, and
 *      a position-wide factor is exactly what this step removes. An intercept was deliberately NOT
 *      fitted — `market/blend.ts`'s own history with the unlisted rescale (a fitted intercept that
 *      turned out to be dead code and collapsed an ordering on the way) is why this file spends one
 *      parameter rather than two.
 *
 * WHERE IT DECLINES TO SPEAK. A position with fewer than `MINIMUM_ANCHORED_PER_POSITION` anchored
 * players, or with no positive raw total, gets NO anchor: the scale would be an artefact of two or
 * three men. A player whose position is unknown, or who has no market price to scale against, is not
 * anchored either. Every one of those cases lands the blend on the ADP-only null cell for that player,
 * which is the same place a season with no archive at all lands (2021 and 2022: the archive holds 2023
 * and 2024).
 */

/** How far past the season's first kickoff a game may start and still count as week one. Seven days
 *  covers a real week-one slate (Thursday through the following Monday night) with room for a
 *  Saturday game, and excludes week two everywhere. */
export const WEEK_ONE_WINDOW_DAYS = 7;

/** How many anchored players a position needs before its rescale factor means anything. Ten is
 *  deliberately modest: a real archived week one prices dozens of players per position, so this is a
 *  floor against a broken or half-fetched archive, not a quality bar. */
export const MINIMUM_ANCHORED_PER_POSITION = 10;

/** One archived prop line, already resolved to a player id through `odds/player-map.ts`. */
export interface ArchivedPropLine {
  readonly playerId: string;
  readonly market: PropMarket;
  /** The line itself — receiving yards, receptions, rushing yards or passing yards. */
  readonly point: number;
  /** The game's own kickoff, which is what makes a line "week one". */
  readonly commenceTime: Date;
  /** When the snapshot was fetched — the leakage gate reads THIS, never `commenceTime`. */
  readonly fetchedAt: Date;
}

export interface PropsAnchorInputs {
  /** Season S's own first kickoff. The leakage gate and the week-one window both key off it. */
  readonly firstKickoff: Date;
  readonly positionByPlayerId: ReadonlyMap<string, Position>;
  /** The ADP-derived season points the rescale matches units with — `MarketPriorEntry.marketPoints`
   *  for the same season, by player id. */
  readonly marketPointsByPlayerId: ReadonlyMap<string, number>;
  /** The blend's own fitted implied games played per position — see step 4 above. */
  readonly impliedGamesByPosition: ImpliedGamesByPosition;
}

/** The synthetic per-game stat line one player's median prop lines compose into. Every field the
 *  four markets do not price stays zero, touchdowns included — see step 5 on why that is a level
 *  effect the rescale removes rather than a bias left in. */
function propsPerGameLine(playerId: string, medians: ReadonlyMap<PropMarket, number>): StatLine {
  return {
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
    playerId,
    week: 1,
    passingYards: medians.get("player_pass_yds") ?? 0,
    receivingYards: medians.get("player_reception_yds") ?? 0,
    receptions: medians.get("player_receptions") ?? 0,
    rushingYards: medians.get("player_rush_yds") ?? 0,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * THE ANCHOR — player id to his props-implied season points, in the market curve's own units.
 *
 * Pure: every fact it needs is in its arguments, so the leakage gate and the mapping are testable
 * without a database and the same function serves a fit and a live board.
 */
export function propsAnchorPoints(lines: readonly ArchivedPropLine[], inputs: PropsAnchorInputs): ReadonlyMap<string, number> {
  const windowEnd = new Date(inputs.firstKickoff.getTime() + WEEK_ONE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const pointsByPlayerMarket = new Map<string, number[]>();
  for (const entry of lines) {
    // THE LEAKAGE GATE. Strictly before, never at: a line stamped at the instant of kickoff is a line
    // that may already know the inactives.
    if (entry.fetchedAt.getTime() >= inputs.firstKickoff.getTime()) continue;
    if (entry.commenceTime.getTime() < inputs.firstKickoff.getTime()) continue;
    if (entry.commenceTime.getTime() >= windowEnd.getTime()) continue;
    if (!Number.isFinite(entry.point)) continue;
    const key = `${entry.playerId}|${entry.market}`;
    const held = pointsByPlayerMarket.get(key) ?? [];
    held.push(entry.point);
    pointsByPlayerMarket.set(key, held);
  }

  const mediansByPlayer = new Map<string, Map<PropMarket, number>>();
  for (const [key, values] of pointsByPlayerMarket) {
    const separator = key.lastIndexOf("|");
    const playerId = key.slice(0, separator);
    const market = key.slice(separator + 1);
    if (!isPropMarket(market)) continue;
    const forPlayer = mediansByPlayer.get(playerId) ?? new Map<PropMarket, number>();
    forPlayer.set(market, median(values));
    mediansByPlayer.set(playerId, forPlayer);
  }

  /** Raw props season points, before the per-position rescale. */
  const rawByPlayer = new Map<string, { readonly position: Position; readonly raw: number }>();
  for (const [playerId, medians] of mediansByPlayer) {
    const position = inputs.positionByPlayerId.get(playerId);
    if (position === undefined || !isCurvePosition(position)) continue;
    const perGame = computeFantasyPoints(propsPerGameLine(playerId, medians), position, PPR_SCORING);
    const raw = perGame * inputs.impliedGamesByPosition[position];
    if (!(raw > 0)) continue;
    rawByPlayer.set(playerId, { position, raw });
  }

  // THE RESCALE, per position, over the players who carry BOTH a raw props number and a market price
  // — the only population in which the two units can be compared at all.
  const totals = new Map<Position, { marketPoints: number; raw: number; anchored: number }>();
  for (const [playerId, { position, raw }] of rawByPlayer) {
    const marketPoints = inputs.marketPointsByPlayerId.get(playerId);
    if (marketPoints === undefined) continue;
    const cell = totals.get(position) ?? { marketPoints: 0, raw: 0, anchored: 0 };
    cell.marketPoints += marketPoints;
    cell.raw += raw;
    cell.anchored += 1;
    totals.set(position, cell);
  }

  const scaleByPosition = new Map<Position, number>();
  for (const [position, cell] of totals) {
    if (cell.anchored < MINIMUM_ANCHORED_PER_POSITION) continue;
    if (!(cell.raw > 0) || !(cell.marketPoints > 0)) continue;
    scaleByPosition.set(position, cell.marketPoints / cell.raw);
  }

  const anchor = new Map<string, number>();
  for (const [playerId, { position, raw }] of rawByPlayer) {
    const scale = scaleByPosition.get(position);
    if (scale === undefined) continue;
    anchor.set(playerId, raw * scale);
  }
  return anchor;
}

/**
 * EVERY ARCHIVED PROP LINE ONE SEASON'S ANCHOR MAY SEE, resolved to player ids.
 *
 * TWO NARROWINGS IN SQL, both for size rather than for correctness: kickoffs inside season S's own
 * calendar span (August of S through February of S+1, `seasonOfKickoff`'s own rule re-checked in
 * TypeScript below), and `fetched_at` strictly before the season's first kickoff. `propsAnchorPoints`
 * re-applies the leakage gate itself regardless — a gate that lives only in a query is a gate the next
 * caller does not have.
 *
 * The join to `props_player_map` is done in TypeScript because `ReadonlyDb` exposes no join builder
 * (`db/client.ts`'s own narrowing), the same shape `odds/player-map.ts`'s own readers already use. An
 * unresolved prop name simply has no map row and drops out — never guessed at.
 */
export async function loadArchivedPropLines(db: ReadonlyDb, season: number, firstKickoff: Date): Promise<readonly ArchivedPropLine[]> {
  const spanStart = new Date(Date.UTC(season, 7, 1));
  const spanEnd = new Date(Date.UTC(season + 1, 2, 1));
  const rows = await db
    .select({
      playerName: playerPropObservations.playerName,
      market: playerPropObservations.market,
      point: playerPropObservations.point,
      commenceTime: playerPropObservations.commenceTime,
      fetchedAt: playerPropObservations.fetchedAt,
    })
    .from(playerPropObservations)
    .where(
      and(
        gte(playerPropObservations.commenceTime, spanStart),
        lt(playerPropObservations.commenceTime, spanEnd),
        lt(playerPropObservations.fetchedAt, firstKickoff),
      ),
    );

  const mapRows = await db
    .select({ propName: propsPlayerMap.propName, season: propsPlayerMap.season, playerId: propsPlayerMap.playerId })
    .from(propsPlayerMap);
  const playerIdByName = new Map(mapRows.filter((row) => row.season === season).map((row) => [row.propName, row.playerId] as const));

  const lines: ArchivedPropLine[] = [];
  for (const row of rows) {
    if (seasonOfKickoff(row.commenceTime) !== season) continue;
    if (!isPropMarket(row.market)) continue;
    const playerId = playerIdByName.get(row.playerName);
    if (playerId === undefined) continue;
    lines.push({ playerId, market: row.market, point: row.point, commenceTime: row.commenceTime, fetchedAt: row.fetchedAt });
  }
  return lines;
}
