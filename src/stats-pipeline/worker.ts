import { and, asc, eq, ne } from "drizzle-orm";
import type Redis from "ioredis";
import type { Db } from "@/db/client";
import { matchups, statWeeks } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import type { Clock } from "@/domain/timing";
import type { PublishFn } from "@/lib/realtime/publish";
import type { GameSummary, StatsProvider } from "@/stats/provider";
import { affectedTeams } from "./affected";
import { STATS_INGESTION_CONFIG } from "./config";
import type { ScoreUpdatePayload, TeamScore, WeekStatus } from "./contract";
import { diffStatLines } from "./digest";
import { finalizeWeek, scoreTeamsForWeek } from "./finalize";
import { persistTick } from "./persist";
import type { RequestBudget } from "./budget";

/** `final-only` fetches a final game's box score exactly once, ever; `live` never stops asking. */
export type IngestionMode = "final-only" | "live";

export interface TickOutcome {
  readonly week: number;
  /** Present only for a league-scoped step (a publish or a finalize) within the tick. */
  readonly leagueId?: string;
  readonly applied: boolean;
  readonly reason?: string;
}

export interface IngestionWorker {
  /** One ingestion pass. Tests drive this directly. */
  tick(): Promise<readonly TickOutcome[]>;
  start(): void;
  stop(): void;
}

interface WorkerDeps {
  readonly db: Db;
  readonly provider: StatsProvider;
  readonly redis: Redis;
  readonly publish: PublishFn;
  readonly clock: Clock;
  readonly budget: RequestBudget;
  /** Defaults to `STATS_INGESTION_CONFIG.mode`. Overridable so a test can drive `live` without
   *  mutating shared config, the same reason the draft ticker takes an injected `Clock`. */
  readonly mode?: IngestionMode;
  readonly intervalMs?: number;
  /**
   * Called for every `applied: false` outcome, rate-limited per (week, league) pair — see
   * `STATS_INGESTION_CONFIG.warnIntervalMs` — mirroring `draft-service/ticker.ts`'s
   * `onOutcome`. Defaults to `console.warn`.
   */
  readonly onOutcome?: (outcome: TickOutcome) => void;
}

const defaultOnOutcome = (outcome: TickOutcome): void => {
  console.warn("[stats-pipeline] tick not applied", outcome);
};

/**
 * The earliest week not yet final, and the `maxWeeks - 1` weeks after it. Never the whole
 * season. A week with no `stat_weeks` row at all (never ticked) counts as not-final by absence,
 * which is what makes week 1 the starting point on a completely fresh database.
 */
async function weeksToExamine(db: Db, maxWeeks: number): Promise<readonly number[]> {
  const [row] = await db
    .select({ week: statWeeks.week })
    .from(statWeeks)
    .where(ne(statWeeks.status, "final"))
    .orderBy(asc(statWeeks.week))
    .limit(1);
  const start = row?.week ?? 1;
  return Array.from({ length: maxWeeks }, (_, i) => start + i);
}

async function needsBoxScore(redis: Redis, game: GameSummary, mode: IngestionMode): Promise<boolean> {
  if (game.status === "scheduled") return false;
  if (mode === "live") return true;
  // final-only: only a game that has JUST turned final, and only the first time it's seen so.
  if (game.status !== "final") return false;
  const alreadyFetched = await redis.exists(STATS_INGESTION_CONFIG.keys.finalGame(game.gameId));
  return alreadyFetched === 0;
}

function weekStatusOf(games: readonly GameSummary[]): WeekStatus {
  if (games.every((game) => game.status === "final")) return "final";
  if (games.every((game) => game.status === "scheduled")) return "scheduled";
  return "in_progress";
}

export function createIngestionWorker({
  db,
  provider,
  redis,
  publish,
  clock,
  budget,
  mode = STATS_INGESTION_CONFIG.mode,
  intervalMs = STATS_INGESTION_CONFIG.pollIntervalMs,
  onOutcome = defaultOnOutcome,
}: WorkerDeps): IngestionWorker {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const lastWarnedAtMs = new Map<string, number>();

  function outcomeKey(outcome: TickOutcome): string {
    return `${outcome.week}:${outcome.leagueId ?? ""}`;
  }

  function reportIfDue(outcome: TickOutcome, nowMs: number): void {
    if (outcome.applied) return;
    const key = outcomeKey(outcome);
    const lastWarnedAt = lastWarnedAtMs.get(key);
    if (lastWarnedAt !== undefined && nowMs - lastWarnedAt < STATS_INGESTION_CONFIG.warnIntervalMs) return;
    lastWarnedAtMs.set(key, nowMs);
    onOutcome(outcome);
  }

  /** Every league fielding this week, from `matchups` — the source of truth for "which leagues
   *  are in season", not a league-wide scan. */
  async function leaguesInWeek(week: number): Promise<readonly string[]> {
    const rows = await db.selectDistinct({ leagueId: matchups.leagueId }).from(matchups).where(eq(matchups.weekNumber, week));
    return rows.map((row) => row.leagueId);
  }

  async function publishAffected(
    week: number,
    status: WeekStatus,
    gamesFinal: number,
    gamesTotal: number,
    version: number,
    changed: readonly StatLine[],
    nowMs: number,
  ): Promise<void> {
    const affected = await affectedTeams(db, { week, playerIds: changed.map((line) => line.playerId) });
    const teamIdsByLeague = new Map<string, string[]>();
    for (const { leagueId, teamId } of affected) {
      const list = teamIdsByLeague.get(leagueId) ?? [];
      list.push(teamId);
      teamIdsByLeague.set(leagueId, list);
    }

    for (const [leagueId, teamIds] of teamIdsByLeague) {
      try {
        const scores = await scoreTeamsForWeek(db, leagueId, week, teamIds);
        const payload: ScoreUpdatePayload = {
          week,
          status,
          version,
          gamesFinal,
          gamesTotal,
          scores: teamIds.map((teamId) => ({ teamId, points: scores.get(teamId) ?? 0 })),
        };
        // Best-effort by contract (`createPublisher`): a Redis failure here returns null and
        // never throws, so the write above is never at risk from a publish failure.
        await publish({ leagueId, type: "score.update", payload });
      } catch (error: unknown) {
        // One league's scoring/publish failure must not stop every other affected league from
        // hearing about ITS changed players this tick.
        console.error("[stats-pipeline] publish failed for league", leagueId, error);
        reportIfDue({ week, leagueId, applied: false, reason: "Couldn't publish this league's live score update." }, nowMs);
      }
    }
  }

  async function finalizeDrafted(
    week: number,
    gamesFinal: number,
    gamesTotal: number,
    version: number,
    nowMs: number,
  ): Promise<void> {
    for (const leagueId of await leaguesInWeek(week)) {
      try {
        const result = await finalizeWeek(db, leagueId, week);
        // An undrafted league is refused by finalizeWeek's own guard — not a failure of THIS
        // tick, just a league that has not started its season. Nothing to publish for it.
        if (!result.ok) continue;

        const settled = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, week)));
        const scores: TeamScore[] = settled.flatMap((row) => [
          { teamId: row.homeTeamId, points: row.homeScore ?? 0 },
          { teamId: row.awayTeamId, points: row.awayScore ?? 0 },
        ]);
        const payload: ScoreUpdatePayload = { week, status: "final", version, gamesFinal, gamesTotal, scores };
        await publish({ leagueId, type: "score.update", payload });
      } catch (error: unknown) {
        // Mirrors the draft ticker's per-draft isolation: one league's finalize failure must
        // not stop every other league in the same week from being settled.
        console.error("[stats-pipeline] finalize failed for league", leagueId, error);
        reportIfDue({ week, leagueId, applied: false, reason: "Couldn't finalize this league's week." }, nowMs);
      }
    }
  }

  async function tickWeek(week: number, gamesBudgetRemaining: number, nowMs: number): Promise<{ outcome: TickOutcome | null; gamesFetched: number }> {
    const games = await provider.listGames(week);
    // No games at all means this week is outside the provider's season (or hasn't been
    // scheduled yet) — nothing to record, nothing to score.
    if (games.length === 0) return { outcome: null, gamesFetched: 0 };

    let gamesFetched = 0;
    const fetchedLines: StatLine[] = [];
    for (const game of games) {
      if (gamesFetched >= gamesBudgetRemaining) break;
      if (!(await needsBoxScore(redis, game, mode))) continue;
      fetchedLines.push(...(await provider.getGameStatLines(game)));
      gamesFetched += 1;
      if (game.status === "final") {
        await redis.set(STATS_INGESTION_CONFIG.keys.finalGame(game.gameId), "1", "EX", STATS_INGESTION_CONFIG.ttlSeconds.finalGame);
      }
    }

    const gamesTotal = games.length;
    const gamesFinal = games.filter((game) => game.status === "final").length;
    const status = weekStatusOf(games);

    const snapshotKey = STATS_INGESTION_CONFIG.keys.snapshot(week);
    const previousRaw = await redis.hgetall(snapshotKey);
    const previous = new Map(Object.entries(previousRaw));
    const { changed, digests } = diffStatLines(previous, fetchedLines);
    if (digests.size > 0) {
      await redis.hset(snapshotKey, Object.fromEntries(digests));
      await redis.expire(snapshotKey, STATS_INGESTION_CONFIG.ttlSeconds.snapshot);
    }

    const persisted = await persistTick(db, {
      week,
      changed,
      status,
      games: { total: gamesTotal, final: gamesFinal },
      now: clock.now(),
    });

    if (changed.length > 0) {
      await publishAffected(week, status, gamesFinal, gamesTotal, persisted.version, changed, nowMs);
    }
    if (status === "final") {
      await finalizeDrafted(week, gamesFinal, gamesTotal, persisted.version, nowMs);
    }

    return { outcome: { week, applied: true }, gamesFetched };
  }

  async function tick(): Promise<readonly TickOutcome[]> {
    const weeks = await weeksToExamine(db, STATS_INGESTION_CONFIG.maxWeeksPerTick);
    const nowMs = Date.parse(clock.now());

    // Reserved BEFORE any upstream call: one request per week examined (`listGames`) plus the
    // ceiling on box scores a tick may fetch — a worst-case upper bound, not a tally of what
    // this tick turns out to need, because that number isn't known until `listGames` (itself
    // an upstream call) has already run.
    const reserved = await budget.reserve(weeks.length + STATS_INGESTION_CONFIG.maxGamesPerTick);
    if (!reserved) {
      const outcome: TickOutcome = { week: weeks[0] ?? 0, applied: false, reason: "This tick's request budget reservation was denied." };
      reportIfDue(outcome, nowMs);
      return [outcome];
    }

    const outcomes: TickOutcome[] = [];
    let gamesFetchedThisTick = 0;
    for (const week of weeks) {
      try {
        const remaining = STATS_INGESTION_CONFIG.maxGamesPerTick - gamesFetchedThisTick;
        const { outcome, gamesFetched } = await tickWeek(week, remaining, nowMs);
        gamesFetchedThisTick += gamesFetched;
        if (outcome !== null) {
          outcomes.push(outcome);
          reportIfDue(outcome, nowMs);
        }
      } catch (error: unknown) {
        // One week's failure (a dropped connection, an upstream 500) must not stop the other
        // week examined this tick from being checked.
        console.error("[stats-pipeline] tick failed for week", week, error);
        const outcome: TickOutcome = { week, applied: false, reason: "Something went wrong ingesting this week." };
        outcomes.push(outcome);
        reportIfDue(outcome, nowMs);
      }
    }
    return outcomes;
  }

  return {
    tick,
    start() {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        // Never overlap ticks: a slow tick (a stalled upstream request) must not stack another
        // on top of it.
        if (running) return;
        running = true;
        void tick()
          .catch((error: unknown) => {
            console.error("[stats-pipeline] ticker failed", error);
          })
          .finally(() => {
            running = false;
          });
      }, intervalMs);
    },
    stop() {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
