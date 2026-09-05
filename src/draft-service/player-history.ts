import { eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { nflPlayers, players, scoringSettings } from "@/db/schema";
import type { Position } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import type { PlayerHistoryBody, PlayerSeasonSummary, PlayerWeekPoints } from "@/draft-room/contract";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@/scoring";
import { nflPlayerIdsFor } from "@/projections/crosswalk";
import type { SeasonStatLine } from "@/projections/lines";
import { statLinesAsOfForLiveSurface } from "@/projections/nflverse/derived-stat-lines";
import { PRODUCT_SEASON } from "@/projections/preseason/current";

/** How many finished seasons the peek card looks back over — the mock's own three. */
const HISTORY_SEASONS = 3;

/** The NFL's own regular season. A finish is a regular-season fact; playoff weeks stay out. */
const NFL_REGULAR_SEASON_WEEKS = 18;

/**
 * THE PEEK CARD'S SEASON HISTORY (design ruling, 2026-09-02) — what a player really did, read
 * from the real point-in-time store (`player_week_observations`, the nflverse ingests) and
 * composed through THIS league's own scoring rules, so the card's PPG and finish mean the same
 * thing the league's own scoreboard would have said.
 *
 * HONESTY RULES, restated from the contract: only stored weeks are rendered. A season with no
 * stored week for the player produces no row; a rookie produces an empty body; nothing here
 * fills, extrapolates or placeholders. The positional finish ranks the player among every
 * same-position player WITH A STORED WEEK that season — the population is stated by the data,
 * not assumed.
 *
 * THE GAP SEASONS: nflverse never published `stats_player_week` for a couple of seasons
 * (`STAT_LINE_GAPS`), and the product is allowed to read the pbp-derived fallback for exactly
 * the ones the live-admission seam names (`LIVE_ADMITTED_DERIVED_SEASONS` — see
 * `derived-stat-lines.ts`). Published rows always win; derived rows only fill weeks the
 * published feed does not carry.
 */
export async function playerHistory(db: Db | DbTx, leagueId: string, playerId: string): Promise<PlayerHistoryBody> {
  const EMPTY: PlayerHistoryBody = { seasons: [], latestWeeklySeason: null, latestWeekly: [] };

  const [playerRow] = await db.select({ position: players.position }).from(players).where(eq(players.id, playerId));
  if (playerRow === undefined) return EMPTY;
  const position = playerRow.position;

  const crosswalk = await nflPlayerIdsFor(db, [playerId]);
  const gsisId = crosswalk.get(playerId);
  if (gsisId === undefined) return EMPTY;

  // The league's own rules, the same read (and the same fallback) `rankedPlayers` makes.
  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  const rules: ScoringRules = settings ?? PPR_SCORING;

  // The finish population: every player the historical universe lists at this position. The
  // universe's own spelling is wider than the product's (`FB`, `HB`); a player whose product
  // position has no exact universe twin still ranks against the exact-spelling peers, and his
  // own id is unioned in so he can never rank outside his own population.
  const peers = await db.select({ id: nflPlayers.id }).from(nflPlayers).where(eq(nflPlayers.position, position));
  const peerIds = [...new Set([gsisId, ...peers.map((peer) => peer.id)])];

  const now = new Date();
  const seasons: PlayerSeasonSummary[] = [];
  let latestWeekly: readonly PlayerWeekPoints[] = [];
  let latestWeeklySeason: number | null = null;

  for (let back = 1; back <= HISTORY_SEASONS; back += 1) {
    const season = PRODUCT_SEASON - back;
    const lines = await seasonLines(db, season, peerIds, now);
    const summary = summarize(season, lines, gsisId, position, rules);
    if (summary === null) continue;
    seasons.push(summary.row);
    if (latestWeeklySeason === null) {
      latestWeeklySeason = season;
      latestWeekly = summary.weekly;
    }
  }

  return { seasons, latestWeeklySeason, latestWeekly };
}

/** One season's stat lines for the peer set: the published feed, plus the derived fallback for
 *  an admitted gap season — published weeks always win. See `statLinesAsOfForLiveSurface`'s own
 *  docblock for why this is narrower than the laws harness's `statLinesAsOfForMeasurement`. */
async function seasonLines(db: Db | DbTx, season: number, peerIds: readonly string[], asOf: Date): Promise<readonly SeasonStatLine[]> {
  return statLinesAsOfForLiveSurface(db, { season, week: { from: 1, to: NFL_REGULAR_SEASON_WEEKS }, asOf, playerIds: peerIds });
}

interface SeasonSummaryResult {
  readonly row: PlayerSeasonSummary;
  readonly weekly: readonly PlayerWeekPoints[];
}

function summarize(
  season: number,
  lines: readonly SeasonStatLine[],
  gsisId: string,
  position: Position,
  rules: ScoringRules,
): SeasonSummaryResult | null {
  const mine = lines.filter((row) => row.line.playerId === gsisId).sort((a, b) => a.line.week - b.line.week);
  if (mine.length === 0) return null;

  const weekly = mine.map((row): PlayerWeekPoints => ({ week: row.line.week, points: roundPoints(computeFantasyPoints(row.line, position, rules)) }));
  const totalPoints = weekly.reduce((sum, week) => sum + week.points, 0);
  const totalYards = mine.reduce((sum, row) => sum + row.line.passingYards + row.line.rushingYards + row.line.receivingYards, 0);
  const totalTouchdowns = mine.reduce((sum, row) => sum + row.line.passingTouchdowns + row.line.rushingTouchdowns + row.line.receivingTouchdowns, 0);

  // Season totals for every peer with a stored week, ranked by points. Higher total ranks
  // earlier; the player's own total was computed the same way, so ties resolve honestly (a tie
  // shares the better rank the way a leaderboard does: strictly-greater totals only).
  const totalsByPlayer = new Map<string, number>();
  for (const row of lines) {
    const points = computeFantasyPoints(row.line, position, rules);
    totalsByPlayer.set(row.line.playerId, (totalsByPlayer.get(row.line.playerId) ?? 0) + points);
  }
  const myTotal = totalsByPlayer.get(gsisId) ?? 0;
  let ahead = 0;
  for (const [peerId, total] of totalsByPlayer) {
    if (peerId !== gsisId && total > myTotal) ahead += 1;
  }

  return {
    row: {
      season,
      gamesPlayed: mine.length,
      pointsPerGame: roundPoints(totalPoints / mine.length),
      totalYards: Math.round(totalYards),
      totalTouchdowns: Math.round(totalTouchdowns),
      positionFinish: `${position}${ahead + 1}`,
    },
    weekly,
  };
}
