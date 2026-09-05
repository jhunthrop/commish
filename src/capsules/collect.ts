import { and, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { playerStatLines, statWeeks } from "@/db/schema";
import type { Position, StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { boardRows, type BoardOptions, type BoardRow } from "@/draft-hq/board/service";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { injurySnapshot } from "@/league-service/injuries";
import { newsForPlayers, type NewsStory } from "@/league-service/news";
import { chipEligibleLaws, registry } from "@/projections/laws/registry";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { computeFantasyPoints, roundPoints } from "@/scoring";
import { buildPlayerFacts, type PlayerFacts, type PlayerFactsInput, type PlayerFactsSeasonSummary } from "./facts";

/**
 * THE FACTS COLLECTOR — every database read `buildPlayerFacts` needs, gathered ONCE for every
 * board-relevant player at a time (the sweep job's own unit of work), never one query per player.
 * `facts.ts` stays pure; this module is the only place that touches the database.
 *
 * THE GENERIC BOARD SHAPE. A capsule is a product-surface artifact, not a per-league one — the
 * same reasoning `draft-hq/hq/service.ts`/`draft-hq/sheet/seed.ts` already use for their own
 * board reads outside a specific league's own roster settings: `{teamCount: 12, rosterSlots:
 * STANDARD_ROSTER_SLOTS}`, the product's own generic default. The board's own `projectedPoints`/
 * `floorPoints`/`medianPoints`/`ceilingPoints`/`reasons` are shape-INDEPENDENT (composed once,
 * offline — `board/service.ts`'s own docblock); this module reads no shape-dependent field off
 * `BoardRow` (`valueOverReplacement`, `valueRank`, `positionRankInValue`, its own `tier` triad),
 * favouring the reasons-derived `scarcity`/`tier_cliff` facts instead, which are the same
 * shape-independent numbers `verdict.ts`/`groups.ts` already build the Outlook from.
 *
 * SEASON SUMMARY, CURRENT SEASON ONLY. `playerSeason` (the per-league player page) falls back to
 * a prior season's own point-in-time store when the current one has not kicked off yet; this
 * collector does not — a capsule fact sheet correctly has NO season summary in that common
 * preseason state (`facts.season` is `null`, and the writer/template both already handle that
 * honestly), rather than reaching for a borrowed prior year the way the full player page's own
 * UI widening does. Documented here as a deliberate scope line, not an oversight: adding the
 * prior-season fallback would mean porting `playerSeason`'s own crosswalk-and-observation-store
 * machinery into a league-free context, real additional engineering this task did not need to
 * duplicate to ship an honest preseason capsule.
 */

const GENERIC_BOARD_SHAPE: BoardOptions["shape"] = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };

/** Every played-week total for `playerIds`, under this product's standard PPR scoring (the same
 *  fixed format the shipped board itself is composed under). A player with no played week yet
 *  this season is simply absent from the returned map — never a fabricated zero. */
async function currentSeasonSummaries(db: Db, playerIds: readonly string[], positionOf: ReadonlyMap<string, Position>): Promise<ReadonlyMap<string, PlayerFactsSeasonSummary>> {
  const summaries = new Map<string, PlayerFactsSeasonSummary>();
  if (playerIds.length === 0) return summaries;

  const weekRows = await db.select({ week: statWeeks.week }).from(statWeeks).where(ne(statWeeks.status, "scheduled"));
  const played = weekRows.map((row) => row.week);
  if (played.length === 0) return summaries;

  const lines: readonly StatLine[] = await db
    .select()
    .from(playerStatLines)
    .where(and(inArray(playerStatLines.playerId, playerIds), inArray(playerStatLines.week, played)));

  const byPlayer = new Map<string, StatLine[]>();
  for (const line of lines) {
    const bucket = byPlayer.get(line.playerId);
    if (bucket === undefined) byPlayer.set(line.playerId, [line]);
    else bucket.push(line);
  }

  for (const [playerId, myLines] of byPlayer) {
    const position = positionOf.get(playerId);
    if (position === undefined) continue;
    let carries = 0;
    let rushingYards = 0;
    let targets = 0;
    let receptions = 0;
    let receivingYards = 0;
    let passingYards = 0;
    let touchdowns = 0;
    let fantasyPoints = 0;
    for (const line of myLines) {
      // The current season's own rows always default these to `0` in the database (see
      // `player_stat_lines`' own docblock) — the `?? 0` here satisfies `StatLine`'s wider,
      // optional-for-a-prior-season type, never standing in for a genuinely missing reading.
      carries += line.carries ?? 0;
      rushingYards += line.rushingYards;
      targets += line.targets ?? 0;
      receptions += line.receptions;
      receivingYards += line.receivingYards;
      passingYards += line.passingYards;
      touchdowns += line.rushingTouchdowns + line.receivingTouchdowns + line.passingTouchdowns;
      fantasyPoints += computeFantasyPoints(line, position, PPR_SCORING);
    }
    const gamesPlayed = myLines.length;
    summaries.set(playerId, {
      season: PRODUCT_SEASON,
      gamesPlayed,
      pointsPerGame: roundPoints(fantasyPoints / gamesPlayed),
      totals: { carries, rushingYards, targets, receptions, receivingYards, passingYards, touchdowns, fantasyPoints: roundPoints(fantasyPoints) },
    });
  }
  return summaries;
}

function factsInputFor(
  row: BoardRow,
  season: PlayerFactsSeasonSummary | undefined,
  injuries: { readonly capturedAt: Date | null; readonly designations: ReadonlyMap<string, string> },
  news: ReadonlyMap<string, readonly NewsStory[]>,
  laws: PlayerFactsInput["laws"],
): PlayerFactsInput {
  const injuryDesignation = injuries.designations.get(row.playerId) ?? null;
  return {
    identity: { id: row.playerId, name: row.name, position: row.position, team: row.team },
    productSeason: PRODUCT_SEASON,
    reasons: row.reasons,
    laws,
    market: { adp: row.marketAdp, positionAdp: row.marketPositionAdp, boardRank: row.rank },
    projection: { projectedPoints: row.projectedPoints, floorPoints: row.floorPoints, medianPoints: row.medianPoints, ceilingPoints: row.ceilingPoints },
    byeWeek: row.byeWeek,
    season: season ?? null,
    injuryDesignation,
    injuryAsOf: injuryDesignation === null ? null : injuries.capturedAt?.toISOString() ?? null,
    news: news.get(row.name) ?? [],
  };
}

/** Every board-ranked player's facts, in one bounded pass: one `boardRows` read, one injury
 *  snapshot read, one news-snapshot read (serving every name at once,
 *  `newsForPlayers`), one season-stat-lines read, and the law registry read once, off disk. The
 *  sweep job calls this once per run and diffs each player's own `factsHash` against the stored
 *  row (`store.ts`) to decide who actually needs a fresh generation. */
export async function collectAllPlayerFacts(db: Db, asOf: Date = new Date()): Promise<readonly PlayerFacts[]> {
  const rows = await boardRows(db, { shape: GENERIC_BOARD_SHAPE, asOf });
  if (rows.length === 0) return [];

  const laws = chipEligibleLaws(registry());
  const positionOf = new Map(rows.map((row) => [row.playerId, row.position] as const));
  const [injuries, news, seasons] = await Promise.all([
    injurySnapshot(db),
    newsForPlayers(db, rows.map((row) => row.name)),
    currentSeasonSummaries(db, rows.map((row) => row.playerId), positionOf),
  ]);

  return rows.map((row) => buildPlayerFacts(factsInputFor(row, seasons.get(row.playerId), injuries, news, laws)));
}
