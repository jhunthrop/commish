// THE SEASON'S STAT TOTALS, SUMMED IN SQL (Neon cost audit 2026-09-07, finding 6). `rankedPlayers`
// used to read every `player_stat_lines` row for weeks 1 to 18 — 12,000 rows, 1.9 MB — and sum
// fantasy points in JavaScript. The scoring engine is linear in every stat but one: the defense
// tier tables score points-allowed and yards-allowed PER GAME in fixed brackets. So Postgres sums
// the linear columns per player (a sum of weighted stats is the weighted sum) and, for a DEF line,
// scores each game's two brackets with a CASE rendered FROM the engine's own tables — never a
// second copy of the boundaries — and sums those too. The engine is then run ONCE per player over
// the sums, with the tier points added back. One aggregate query, about 1,700 short rows.
//
// EXACTNESS. Every preset weight is a multiple of 0.01 and every scored stat is an integer (sacks
// are halves), so each game's linear total is nominally a two-decimal number and the engine's
// per-line rounding was the identity; summing before rounding lands on the same two-decimal total.
import { eq, lte, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db, DbTx } from "@research/db/client";
import { players, playerStatLines } from "@research/db/schema";
import type { StatLine } from "@research/domain/player";
import { SCORING_TIER_TABLES } from "@research/scoring";

/** One player's season, as the engine wants to score it: every linear stat summed, the defense
 *  brackets already scored per game and summed separately. */
export interface SeasonStatTotals {
  readonly line: StatLine;
  readonly defenseTierPoints: number;
}

const DEFENSE_POSITION = "DEF";

/** The columns the engine weights linearly, in the engine's own field names. */
const LINEAR_COLUMNS = {
  passingYards: playerStatLines.passingYards,
  passingTouchdowns: playerStatLines.passingTouchdowns,
  interceptions: playerStatLines.interceptions,
  rushingYards: playerStatLines.rushingYards,
  rushingTouchdowns: playerStatLines.rushingTouchdowns,
  receivingYards: playerStatLines.receivingYards,
  receivingTouchdowns: playerStatLines.receivingTouchdowns,
  receptions: playerStatLines.receptions,
  fumblesLost: playerStatLines.fumblesLost,
  fieldGoalsMade: playerStatLines.fieldGoalsMade,
  extraPointsMade: playerStatLines.extraPointsMade,
  sacks: playerStatLines.sacks,
  defensiveInterceptions: playerStatLines.defensiveInterceptions,
  defensiveTouchdowns: playerStatLines.defensiveTouchdowns,
  twoPointConversions: playerStatLines.twoPointConversions,
  fieldGoalsMissed: playerStatLines.fieldGoalsMissed,
  extraPointsMissed: playerStatLines.extraPointsMissed,
  kickReturnTouchdowns: playerStatLines.kickReturnTouchdowns,
  puntReturnTouchdowns: playerStatLines.puntReturnTouchdowns,
  defensiveFumblesRecovered: playerStatLines.defensiveFumblesRecovered,
  safeties: playerStatLines.safeties,
} as const;

type LinearField = keyof typeof LINEAR_COLUMNS;

/** A bracket's points as a typed parameter: bound bare it would reach Postgres as text. */
const points = (value: number): SQL => sql`${value}::int`;

/** `CASE` over one bracket table, rendered from the engine's constant so the boundaries have one
 *  spelling. The table's last row is its unbounded bracket (`Infinity`), the CASE's `else`. */
function tierCase(column: AnyPgColumn, tiers: readonly (readonly [number, number])[]): SQL {
  const bounded = tiers.filter(([ceiling]) => Number.isFinite(ceiling));
  const branches = bounded.map(([ceiling, value]) => sql`when ${column} <= ${points(ceiling)} then ${points(value)}`);
  const [, fallback] = tiers[tiers.length - 1]!;
  return sql`(case ${sql.join(branches, sql` `)} else ${points(fallback)} end)`;
}

function sumOf(column: (typeof LINEAR_COLUMNS)[LinearField]): SQL<number> {
  return sql<number>`coalesce(sum(${column}), 0)::float8`;
}

export async function seasonStatTotalsByPlayer(db: Db | DbTx, maxWeek: number): Promise<ReadonlyMap<string, SeasonStatTotals>> {
  const defenseTier = sql<number>`coalesce(sum(case when ${players.position} = ${DEFENSE_POSITION} then ${tierCase(playerStatLines.pointsAllowed, SCORING_TIER_TABLES.pointsAllowed!)} + ${tierCase(playerStatLines.yardsAllowed, SCORING_TIER_TABLES.yardsAllowed!)} else 0 end), 0)::float8`;
  const sums = Object.fromEntries((Object.keys(LINEAR_COLUMNS) as LinearField[]).map((field) => [field, sumOf(LINEAR_COLUMNS[field])])) as Record<LinearField, SQL<number>>;
  const rows = await db
    .select({ playerId: playerStatLines.playerId, defenseTierPoints: defenseTier, ...sums })
    .from(playerStatLines)
    .innerJoin(players, eq(players.id, playerStatLines.playerId))
    .where(lte(playerStatLines.week, maxWeek))
    .groupBy(playerStatLines.playerId);

  return new Map(
    rows.map((row) => {
      const { playerId, defenseTierPoints, ...linear } = row;
      return [playerId, { line: { playerId, week: 0, ...linear }, defenseTierPoints }];
    }),
  );
}
