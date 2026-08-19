import { and, asc, eq } from "drizzle-orm";
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
import { finalizeWeek, requireScore, scoreTeamsForWeek } from "./finalize";
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
 * season.
 *
 * Three cases, not two:
 *
 * 1. A non-final row exists — resume there, same as always. This is the steady-state case:
 *    continuous operation always has a `scheduled` lookahead row for the week after the one
 *    currently in flight (planted by THIS tick's own window before that week ever finalizes),
 *    so the pointer walks forward one week at a time, indefinitely, and never needs case 3.
 * 2. The table is completely empty (never ticked at all) — start at week 1. Absence counts as
 *    not-final here, and only here: there is no history yet to have settled.
 * 3. Every EXISTING row is final, but the table isn't empty — resume at `MAX(week) + 1`, never
 *    back at week 1. Without this, a cold start partway through a season (or a restart after an
 *    outage spanning more than `maxWeeks - 1` weeks) marks its first window's weeks final in a
 *    single tick, finds no non-final row anywhere on the NEXT tick, and falls through to case 2's
 *    week-1 fallback forever — a permanent stall that never reaches the live week and burns the
 *    monthly request budget on the same two already-settled weeks tick after tick. See
 *    `worker.test.ts`'s "cold start mid-season" case.
 *
 * Clamped to `STATS_INGESTION_CONFIG.lastWeekOfSeason` either way, so a fully-settled season's
 * pointer stops advancing past the season rather than examining weeks that will never exist.
 */
async function weeksToExamine(db: Db, maxWeeks: number): Promise<readonly number[]> {
  // The whole table, not a single-row query: it holds at most one row per week of a season
  // (~18 at the outside), so reading it in full is cheap, and only reading it in full lets this
  // tell "empty" (case 2) apart from "every row is final" (case 3) — a `WHERE status != 'final'
  // LIMIT 1` query can't distinguish the two, because both return no row.
  const rows = await db.select({ week: statWeeks.week, status: statWeeks.status }).from(statWeeks).orderBy(asc(statWeeks.week));
  const firstNonFinal = rows.find((row) => row.status !== "final");
  const start = firstNonFinal !== undefined ? firstNonFinal.week : rows.length === 0 ? 1 : rows[rows.length - 1]!.week + 1;
  const lastWeek = STATS_INGESTION_CONFIG.lastWeekOfSeason;
  return Array.from({ length: maxWeeks }, (_, i) => start + i).filter((week) => week <= lastWeek);
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
          // requireScore, not `?? 0`: teamIds came from this same leagueId via affectedTeams, so
          // a missing entry means scoreTeamsForWeek and that lookup have drifted apart — the
          // surrounding try/catch is what turns that into a skipped, retried-next-tick publish
          // rather than a fabricated zero shown live to a manager watching the game.
          scores: teamIds.map((teamId) => ({ teamId, points: requireScore(scores, teamId) })),
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
        // Non-null by construction: finalizeWeek (which just returned ok: true) writes both
        // scores via requireScore inside its own transaction, and nothing else in this codebase
        // ever nulls a matchup's score back out once finalizeWeek has set it.
        const scores: TeamScore[] = settled.flatMap((row) => [
          { teamId: row.homeTeamId, points: row.homeScore! },
          { teamId: row.awayTeamId, points: row.awayScore! },
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
    // Games actually fetched THIS tick whose box score is now final — the finalGame marker for
    // each is set only after `persistTick` below commits, never here at fetch time.
    const finalGamesFetched: GameSummary[] = [];
    const finalGamesFetchedIds = new Set<string>();
    for (const game of games) {
      if (gamesFetched >= gamesBudgetRemaining) break;
      if (!(await needsBoxScore(redis, game, mode))) continue;
      fetchedLines.push(...(await provider.getGameStatLines(game)));
      gamesFetched += 1;
      if (game.status === "final") {
        finalGamesFetched.push(game);
        finalGamesFetchedIds.add(game.gameId);
      }
    }

    const gamesTotal = games.length;
    const finalGames = games.filter((game) => game.status === "final");
    const gamesFinal = finalGames.length;

    // A week may only be reported `final` once EVERY final game's box score has actually been
    // ingested — not merely once the provider's schedule says every game ended. `maxGamesPerTick`
    // can leave a final game's box score unfetched (a real Sunday runs more games than the
    // budget allows in one tick), and marking the week `final` anyway would mean that game's
    // points are NEVER fetched again: a `final` week is never re-examined (`weeksToExamine`
    // above only resumes at a non-final row, or the week immediately after the settled history).
    //
    // Checked against the `finalGame` Redis marker directly (set below, after `persistTick`
    // commits) rather than `needsBoxScore`: `needsBoxScore` also folds in `live` mode's "always
    // refetch a final game" rule, which answers a different question ("should THIS tick fetch
    // it") than the one asked here ("has it EVER been ingested"). A game fetched THIS tick counts
    // too, even though its marker isn't written until after `persistTick` below — it's about to
    // be, by the same transaction this status is persisted alongside.
    let everyFinalGameIngested = true;
    for (const game of finalGames) {
      if (finalGamesFetchedIds.has(game.gameId)) continue;
      const alreadyIngested = await redis.exists(STATS_INGESTION_CONFIG.keys.finalGame(game.gameId));
      if (alreadyIngested === 0) {
        everyFinalGameIngested = false;
        break;
      }
    }

    const providerStatus = weekStatusOf(games);
    const status: WeekStatus = providerStatus === "final" && !everyFinalGameIngested ? "in_progress" : providerStatus;

    const snapshotKey = STATS_INGESTION_CONFIG.keys.snapshot(week);
    const previousRaw = await redis.hgetall(snapshotKey);
    const previous = new Map(Object.entries(previousRaw));
    const { changed, digests } = diffStatLines(previous, fetchedLines);

    // The write. If this throws, NOTHING below runs — no finalGame marker, no snapshot update —
    // so a transient persist failure leaves Redis exactly as it was before this tick touched it,
    // and the next tick refetches and re-diffs from scratch. Same principle as publish-after-
    // commit: a Redis claim of "already ingested" may only be made once Postgres actually agrees.
    const persisted = await persistTick(db, {
      week,
      changed,
      status,
      games: { total: gamesTotal, final: gamesFinal },
      now: clock.now(),
    });

    for (const game of finalGamesFetched) {
      await redis.set(STATS_INGESTION_CONFIG.keys.finalGame(game.gameId), "1", "EX", STATS_INGESTION_CONFIG.ttlSeconds.finalGame);
    }
    if (digests.size > 0) {
      await redis.hset(snapshotKey, Object.fromEntries(digests));
      await redis.expire(snapshotKey, STATS_INGESTION_CONFIG.ttlSeconds.snapshot);
    }

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

    // An empty window means every week through `STATS_INGESTION_CONFIG.lastWeekOfSeason` is
    // already final — the season is over, and there is nothing left to examine, ever, until
    // next season resets the ledger. Checked BEFORE the reservation below, not after: reserving
    // the worst-case budget on an empty window anyway would drain the monthly ledger for zero
    // work every poll interval for as long as the season stays settled (~960 requests a day at
    // the default 30-minute interval) — the one case `weeks.length + maxGamesPerTick` was never
    // meant to cover, since there is no upstream call this tick could possibly make.
    if (weeks.length === 0) {
      const outcome: TickOutcome = { week: 0, applied: false, reason: "Nothing to examine — every week through the season's end is already final." };
      reportIfDue(outcome, nowMs);
      return [outcome];
    }

    // Reserved BEFORE any upstream call: one request per week examined (`listGames`) plus the
    // ceiling on box scores a tick may fetch — a worst-case upper bound, not a tally of what
    // this tick turns out to need, because that number isn't known until `listGames` (itself
    // an upstream call) has already run.
    const reserved = await budget.reserve(weeks.length + STATS_INGESTION_CONFIG.maxGamesPerTick);
    if (!reserved) {
      // `weeks[0]` is never undefined here: the `weeks.length === 0` case already returned above.
      const outcome: TickOutcome = { week: weeks[0]!, applied: false, reason: "This tick's request budget reservation was denied." };
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
