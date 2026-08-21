import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type Redis from "ioredis";
import type { Db } from "@/db/client";
import { matchups, statWeeks } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import type { Clock } from "@/domain/timing";
import { weekStatusFromGames } from "@/league";
import { autoSetLineupsForWeek } from "@/league-service/auto-lineup";
import type { PublishFn } from "@/lib/realtime/publish";
import type { GameSummary, StatsProvider } from "@/stats/provider";
import { affectedTeams } from "./affected";
import { STATS_INGESTION_CONFIG, type IngestionMode } from "./config";
import type { ScoreUpdatePayload, TeamScore, WeekStatus } from "./contract";
import { diffStatLines } from "./digest";
import { finalizeWeek, requireScore, scoreTeamsForWeek } from "./finalize";
import { persistTick } from "./persist";
import type { RequestBudget, ReservationDenial } from "./budget";
import type { ScoreCache } from "./score-cache";

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

/** No Redis round trip needed: a caller that has no cache to fill keeps working untouched, the
 *  same idiom `setLineup`'s `cache` and `crossLeagueHome`'s `scoreCache` parameters use. */
const NOOP_SCORE_CACHE: Pick<ScoreCache, "write" | "invalidate"> = {
  write: async () => {},
  invalidate: async () => {},
};

interface WorkerDeps {
  readonly db: Db;
  readonly provider: StatsProvider;
  readonly redis: Redis;
  readonly publish: PublishFn;
  readonly clock: Clock;
  readonly budget: RequestBudget;
  /**
   * Where a computed live score is cached for the cross-league home's batched read
   * (`crossLeagueHome`, `@/league-service/home.ts`). The worker is the ONLY writer: it is the one
   * place a week's team totals are computed while the week is still in progress, so without this
   * the cache had no producer at all and every live read missed.
   */
  readonly scoreCache?: Pick<ScoreCache, "write" | "invalidate">;
  /** Defaults to `STATS_INGESTION_CONFIG.mode`. Overridable so a test can drive `live` without
   *  mutating shared config, the same reason the draft ticker takes an injected `Clock`. */
  readonly mode?: IngestionMode;
  readonly intervalMs?: number;
  /** Defaults to `STATS_INGESTION_CONFIG.wedgedWeekTicks`. Overridable so a test can reach the
   *  wedge without driving 384 real ticks. */
  readonly wedgedWeekTicks?: number;
  /**
   * Called for every `applied: false` outcome, rate-limited per (week, league, reason) triple —
   * see `STATS_INGESTION_CONFIG.warnIntervalMs` — mirroring `draft-service/ticker.ts`'s
   * `onOutcome`. Defaults to `console.warn`.
   */
  readonly onOutcome?: (outcome: TickOutcome) => void;
  /**
   * Task 4's own trigger: the missed-deadline lineup, fired on the tick that moves a week's
   * `stat_weeks.status` OUT of `scheduled` and never again for that week — see `tickWeek`'s own
   * call site for why AFTER `persistTick` commits is the only place this can run. Defaults to the
   * real `autoSetLineupsForWeek` (`@/league-service/auto-lineup`); injectable so a test can spy on
   * it or force its failure without a real transaction underneath.
   */
  readonly autoSet?: typeof autoSetLineupsForWeek;
}

const defaultOnOutcome = (outcome: TickOutcome): void => {
  console.warn("[stats-pipeline] tick not applied", outcome);
};

/** What an operator does about a denial differs by cause, so the tick log says which. */
const DENIAL_REASONS: Readonly<Record<ReservationDenial, string>> = {
  "budget-exhausted": "This month's upstream request budget is spent, so the tick was skipped.",
  "ledger-unavailable": "The request ledger could not be reached, so the tick was skipped rather than spend uncounted.",
};

/** One `stat_weeks` row, as this tick reads it — one query serves the window planner, the
 *  correction sweep and the late-settlement catch-up. */
interface WeekRow {
  readonly week: number;
  readonly status: WeekStatus;
  readonly updatedAt: Date;
  readonly version: number;
  readonly gamesTotal: number;
  readonly gamesFinal: number;
}

interface ExaminationWindow {
  /** The weeks to examine this tick, in the order their box scores claim the tick's game budget. */
  readonly weeks: readonly number[];
  /** The earliest non-final week (or the week the pointer resumes at), for wedge tracking. */
  readonly start: number;
  /** True when `start` has no `stat_weeks` row yet — a cold start, or the first tick of a new week. */
  readonly startIsNew: boolean;
}

/**
 * The earliest week not yet final, and — only when it is worth a request — the week after it.
 *
 * Three cases for where to start, not two:
 *
 * 1. A non-final row exists — resume there. The steady-state case.
 * 2. The table is completely empty (never ticked at all) — start at week 1. Absence counts as
 *    not-final here, and only here: there is no history yet to have settled.
 * 3. Every EXISTING row is final, but the table isn't empty — resume at `MAX(week) + 1`, never
 *    back at week 1. Without this, a cold start partway through a season (or a restart after an
 *    outage spanning more than one week) marks its first window's weeks final in a single tick,
 *    finds no non-final row anywhere on the NEXT tick, and falls through to case 2's week-1
 *    fallback forever — a permanent stall that never reaches the live week and burns the monthly
 *    request budget on the same already-settled weeks tick after tick.
 *
 * The WIDTH is the part that costs money. A `listGames` call is one upstream request per examined
 * week per tick, and at the default cadence that is 1,488 ticks a month — so the window is ONE
 * week wide in steady state, and widens only when the extra request can buy something:
 *
 * - **The start week has no row yet** (cases 2 and 3): the tick is walking forward, and a second
 *   week keeps a cold start converging in a bounded number of ticks. This costs one extra request
 *   on the tick that resumes at a fresh week and nothing afterwards, because that same tick plants
 *   the row that makes the next tick narrow again. It is not a tail.
 * - **The start week has WEDGED** (`wedgedWeekTicks`): see below. An incident, never steady state
 *   — `wedgedWeekTicks` is deliberately longer than any week can legitimately stay unsettled.
 *
 * Otherwise the week after the current one is all `scheduled` games that cannot have moved, and
 * re-listing it every thirty minutes for a week straight is the single largest line in the
 * request budget for no information at all. Nothing depends on the lookahead planting a row:
 * case 3 is what advances the pointer once a week settles.
 *
 * **The wedged shape is not simply "two weeks".** A week that can never reach `final` — a
 * postponed game whose upstream status never flips, a box score that permanently 404s — pins
 * `start` forever, and a window of `[start, start+1]` would buy the season exactly one week and
 * then stall again at `start+1`. So while a wedge holds the window is the wedged week PLUS a full
 * normal window opening at the first non-final week AFTER it: the wedge stays visible and still
 * ingestible (its games may yet be played), and the rest of the season genuinely advances past it,
 * one settled week at a time, for as long as the wedge lasts.
 *
 * Clamped to the PROVIDER's own last week either way — never a constant of this module's — so a
 * fully-settled season's pointer stops advancing past the season rather than listing a week the
 * configured provider will always answer empty. A constant 18 against the mock's 17-week dataset
 * is exactly how the pointer used to stall at a week that could never get a row.
 */
export function examinationWindow(
  rows: readonly { readonly week: number; readonly status: WeekStatus }[],
  options: { readonly lastWeek: number; readonly maxWeeks: number; readonly widen: boolean },
): ExaminationWindow {
  const firstNonFinal = rows.find((row) => row.status !== "final");
  const start = firstNonFinal !== undefined ? firstNonFinal.week : rows.length === 0 ? 1 : rows[rows.length - 1]!.week + 1;
  const startIsNew = firstNonFinal === undefined;
  const forward = (from: number, count: number): readonly number[] => Array.from({ length: count }, (_, i) => from + i);

  const weeks = options.widen
    ? [start, ...forward(resumeAfterWedge(rows, start), options.maxWeeks)]
    : forward(start, startIsNew ? options.maxWeeks : 1);

  return { weeks: weeks.filter((week) => week <= options.lastWeek), start, startIsNew };
}

/**
 * Where the season resumes while `wedged` is stuck: the earliest non-final week after it, or — if
 * every later week has settled, or none has been examined yet — the week after the newest row.
 * The same three-case reasoning `examinationWindow` uses for `start`, applied to the remainder of
 * the season rather than to the whole of it.
 */
function resumeAfterWedge(rows: readonly { readonly week: number; readonly status: WeekStatus }[], wedged: number): number {
  const firstNonFinal = rows.find((row) => row.week > wedged && row.status !== "final");
  if (firstNonFinal !== undefined) return firstNonFinal.week;
  // `reduce` seeded with the wedged week rather than an index into `rows`: it needs no special
  // case for a row set that holds nothing later than the wedge, and none for an empty one.
  return rows.reduce((newest, row) => Math.max(newest, row.week), wedged) + 1;
}

/**
 * The most recent settled week that is still inside its correction window, or `null`.
 *
 * NFL official scoring revisions run into the following week, and `final-only` records whatever
 * the box score said the first moment the provider called the game final — by construction the
 * earliest and least settled version of it. Without this, no post-final revision could ever land:
 * `examinationWindow` walks forward from the first NON-final row, so a week whose row says `final`
 * would never be returned again, and the season record would be frozen at a number the league
 * itself no longer agrees with.
 *
 * Measured from `stat_weeks.updated_at`, which is the moment the week's stored facts last moved.
 * A sweep that finds nothing writes nothing (see `tickWeek`), so an uneventful sweep does not
 * push the deadline out; a sweep that DOES land a correction does, which is the right direction —
 * a week that was revised once is the likeliest week to be revised again.
 */
export function correctionCandidate(
  rows: readonly { readonly week: number; readonly status: WeekStatus; readonly updatedAt: Date }[],
  nowMs: number,
  windowDays: number,
): number | null {
  const settled = rows.filter((row) => row.status === "final");
  const latest = settled[settled.length - 1];
  if (latest === undefined) return null;
  return nowMs - latest.updatedAt.getTime() < windowDays * 24 * 60 * 60 * 1_000 ? latest.week : null;
}

/** A week's schedule as this tick found it, plus exactly which box scores the tick will fetch. */
interface WeekPlan {
  readonly week: number;
  readonly games: readonly GameSummary[];
  readonly toFetch: readonly GameSummary[];
  /** A correction sweep re-reads a settled week; a normal pass walks the live one. */
  readonly correction: boolean;
  /**
   * False when the tick's game budget cut the fetch list short, or a denied box-score reservation
   * emptied it. It is what stops a correction sweep from claiming a calendar day it barely
   * examined: `correctionWindowDays` gives a settled week three chances, and one busy Sunday
   * spending `maxGamesPerTick` on the live week would otherwise burn a third of them.
   */
  readonly complete: boolean;
  /**
   * This week's `stat_weeks.status` as `runTick`'s own opening read found it, BEFORE this tick's
   * `persistTick` can move it — `"scheduled"` for a week with no row at all, matching
   * `weekStatusFor`'s own convention. Task 4's trigger fires exactly when this was `"scheduled"`
   * and the tick's own freshly-computed status is not: the transition is only ever observable by
   * comparing a snapshot taken before the write to the write's own result, never by re-reading
   * `stat_weeks` afterwards (a second tick would see the same "not scheduled" value and refire).
   */
  readonly priorStatus: WeekStatus;
}

/**
 * Compare-and-delete: only the holder releases the lease. A plain DEL would let a tick that ran
 * past the lease's TTL delete the NEXT instance's freshly-acquired lease on its way out, which
 * turns a best-effort mutex into a mutex that is silently off exactly when ticks are slow.
 */
const RELEASE_LEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

type Lease = { readonly kind: "acquired"; readonly token: string } | { readonly kind: "unleased" } | { readonly kind: "held" };

export function createIngestionWorker({
  db,
  provider,
  redis,
  publish,
  clock,
  budget,
  scoreCache = NOOP_SCORE_CACHE,
  mode = STATS_INGESTION_CONFIG.mode,
  intervalMs = STATS_INGESTION_CONFIG.pollIntervalMs,
  wedgedWeekTicks = STATS_INGESTION_CONFIG.wedgedWeekTicks,
  onOutcome = defaultOnOutcome,
  autoSet = autoSetLineupsForWeek,
}: WorkerDeps): IngestionWorker {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const lastWarnedAtMs = new Map<string, number>();
  /** How many consecutive ticks the window has opened on the same un-advanceable week. */
  let wedgeWeek: number | null = null;
  let wedgeTicks = 0;

  /**
   * Rate-limited per (week, league, reason) by default: two different problems with the same week
   * are two different things to know about, and only a repeat of the SAME one is noise.
   *
   * A caller whose `reason` carries a VARYING detail must pass its own stable key. A key derived
   * from a message containing a counter is a fresh key every tick, which does not rate-limit
   * anything and grows this map forever — the wedge warning did exactly that, warning every thirty
   * minutes for days and retaining an entry for each.
   */
  function outcomeKey(outcome: TickOutcome): string {
    return [outcome.week, outcome.leagueId, outcome.reason].join(":");
  }

  /**
   * Bounds the map to keys that are still suppressing something. An entry older than
   * `warnIntervalMs` no longer changes any decision, so deleting it is semantically free — and
   * without it the map grows one entry per (week, league) pair that ever failed, in a process
   * designed to run for months.
   */
  function forgetExpiredWarnings(nowMs: number): void {
    for (const [key, warnedAt] of lastWarnedAtMs) {
      if (nowMs - warnedAt >= STATS_INGESTION_CONFIG.warnIntervalMs) lastWarnedAtMs.delete(key);
    }
  }

  function reportIfDue(outcome: TickOutcome, nowMs: number, rateLimitKey: string = outcomeKey(outcome)): void {
    if (outcome.applied) return;
    const lastWarnedAt = lastWarnedAtMs.get(rateLimitKey);
    if (lastWarnedAt !== undefined && nowMs - lastWarnedAt < STATS_INGESTION_CONFIG.warnIntervalMs) return;
    forgetExpiredWarnings(nowMs);
    lastWarnedAtMs.set(rateLimitKey, nowMs);
    onOutcome(outcome);
  }

  /**
   * THE CROSS-INSTANCE SERIALIZER, and deliberately a best-effort one.
   *
   * `instrumentation.ts` starts this worker in every Node process, so without a lease every
   * instance fetches every unmarked box score independently: N times the upstream spend, N times
   * the ledger debit, and two publishes stamped with the same `stat_weeks.version` where the
   * second one — often the fresher one — is dropped by `useLiveScores`'s version gate.
   *
   * `SET NX PX` on one Redis key, held for the poll interval, released on completion. Best-effort
   * BY DESIGN, and the failure mode is stated rather than guarded: if Redis is unreachable the
   * tick runs UNLEASED, which means duplicate work, which is safe — persistence is idempotent by
   * storage model (absolute values upserted on `(player_id, week)`, `stat_weeks.version` advanced
   * only by what Postgres itself says actually changed) and serialized by the `stat_weeks` primary
   * key, so concurrent copies cost requests and never correctness. A blocking lock would be the
   * wrong trade twice over: it would need to span the HTTP fetch phase, and a Redis outage would
   * take live scoring down entirely rather than make it more expensive.
   */
  async function acquireLease(): Promise<Lease> {
    const token = randomUUID();
    try {
      const acquired = await redis.set(STATS_INGESTION_CONFIG.keys.tickLease, token, "PX", intervalMs, "NX");
      return acquired === null ? { kind: "held" } : { kind: "acquired", token };
    } catch {
      return { kind: "unleased" };
    }
  }

  async function releaseLease(lease: Lease): Promise<void> {
    if (lease.kind !== "acquired") return;
    try {
      await redis.eval(RELEASE_LEASE_SCRIPT, 1, STATS_INGESTION_CONFIG.keys.tickLease, lease.token);
    } catch {
      // The lease expires on its own within one poll interval. A failed release costs at most one
      // skipped tick on this instance, which is the cheap half of a best-effort lease.
    }
  }

  /** Whether this tick should fetch a game's box score at all. */
  async function needsBoxScore(game: GameSummary, correction: boolean): Promise<boolean> {
    if (game.status === "scheduled") return false;
    // A correction sweep exists precisely to re-read a game whose box score is already stored, so
    // it ignores both the `finalGame` marker and `final-only`'s fetch-once rule.
    if (correction || mode === "live") return true;
    // final-only: only a game that has JUST turned final, and only the first time it's seen so.
    if (game.status !== "final") return false;
    const alreadyFetched = await redis.exists(STATS_INGESTION_CONFIG.keys.finalGame(game.gameId));
    return alreadyFetched === 0;
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
          // surrounding try/catch is what turns that into a skipped publish for this ONE league
          // rather than a fabricated zero shown live to a manager watching the game. It is not
          // retried: the digest snapshot below has already committed, so the next tick sees
          // nothing changed. The affected league's managers wait one poll interval, until the
          // stats move again.
          scores: teamIds.map((teamId) => ({ teamId, points: requireScore(scores, teamId) })),
        };
        // The cache write is what makes the cross-league home's live branch real: `crossLeagueHome`
        // batch-reads exactly this key at exactly this version. Written BEFORE the publish and
        // AFTER the persist, so a browser that reacts to the frame by re-reading finds the value
        // already there. Degrades open on its own (see `ScoreCache`), so it can never fail a tick.
        await scoreCache.write(leagueId, week, version, payload.scores);
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

  /** Settles one league's week and publishes the result. Shared by the transition path and the
   *  late-draft catch-up below, so a week settled either way is settled and published identically. */
  async function settleLeagueWeek(leagueId: string, week: number, gamesFinal: number, gamesTotal: number, version: number): Promise<boolean> {
    const result = await finalizeWeek(db, leagueId, week, scoreCache);
    // An undrafted league is refused by finalizeWeek's own guard — not a failure of THIS tick,
    // just a league that has not started its season. Nothing to publish for it.
    if (!result.ok) return false;

    const settled = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, week)));
    // Non-null by construction: finalizeWeek (which just returned ok: true) writes both scores
    // via requireScore inside its own transaction, and nothing else in this codebase ever nulls
    // a matchup's score back out once finalizeWeek has set it.
    const scores: TeamScore[] = settled.flatMap((row) => [
      { teamId: row.homeTeamId, points: row.homeScore! },
      { teamId: row.awayTeamId, points: row.awayScore! },
    ]);
    const payload: ScoreUpdatePayload = { week, status: "final", version, gamesFinal, gamesTotal, scores };
    await publish({ leagueId, type: "score.update", payload });
    return true;
  }

  async function finalizeDrafted(week: number, gamesFinal: number, gamesTotal: number, version: number, nowMs: number): Promise<void> {
    for (const leagueId of await leaguesInWeek(week)) {
      try {
        await settleLeagueWeek(leagueId, week, gamesFinal, gamesTotal, version);
      } catch (error: unknown) {
        // Mirrors the draft ticker's per-draft isolation: one league's finalize failure must
        // not stop every other league in the same week from being settled.
        console.error("[stats-pipeline] finalize failed for league", leagueId, error);
        reportIfDue({ week, leagueId, applied: false, reason: "Couldn't finalize this league's week." }, nowMs);
      }
    }
  }

  /**
   * The catch-up for a league that drafted AFTER one of its weeks had already settled.
   *
   * `finalizeWeek` refuses an undrafted league (its rosters do not exist yet, so every team would
   * score zero and the standings would show a season of phantom losses), and the tick that settled
   * the week moved on. Nothing brought that league back: a final week is only re-examined by the
   * correction sweep, which settles nothing for a league that was skipped. So a league drafting on
   * a Sunday afternoon silently forfeited that week from its season record.
   *
   * Driven off the data rather than off a Redis flag written by the draft: a `matchups` row in a
   * FINAL week with no score is exactly the state that needs settling, whatever produced it, and
   * it needs no coupling between the draft's commit transaction and this worker. Bounded per tick
   * so a league that completes a mid-season draft catches up over a few ticks rather than doing a
   * season of settlement writes inside one.
   */
  async function settleMissedWeeks(rows: readonly WeekRow[], nowMs: number): Promise<readonly TickOutcome[]> {
    const finalWeeks = rows.filter((row) => row.status === "final");
    if (finalWeeks.length === 0) return [];
    const rowByWeek = new Map(finalWeeks.map((row) => [row.week, row]));

    const unsettled = await db
      .selectDistinct({ leagueId: matchups.leagueId, week: matchups.weekNumber })
      .from(matchups)
      .where(and(inArray(matchups.weekNumber, finalWeeks.map((row) => row.week)), isNull(matchups.homeScore)))
      .orderBy(asc(matchups.weekNumber), asc(matchups.leagueId))
      .limit(STATS_INGESTION_CONFIG.maxSettlementsPerTick);

    const outcomes: TickOutcome[] = [];
    for (const row of unsettled) {
      // Non-null by construction: `week` came out of a query filtered to `finalWeeks`' own weeks.
      const statWeek = rowByWeek.get(row.week)!;
      try {
        const settled = await settleLeagueWeek(row.leagueId, row.week, statWeek.gamesFinal, statWeek.gamesTotal, statWeek.version);
        // A league that still has not drafted is not a failure and not news — it is a league that
        // has not started its season, and it will be picked up the tick after its draft commits.
        if (settled) outcomes.push({ week: row.week, leagueId: row.leagueId, applied: true });
      } catch (error: unknown) {
        console.error("[stats-pipeline] late settlement failed for league", row.leagueId, error);
        const outcome: TickOutcome = { week: row.week, leagueId: row.leagueId, applied: false, reason: "Couldn't settle this league's already-finished week." };
        outcomes.push(outcome);
        reportIfDue(outcome, nowMs);
      }
    }
    return outcomes;
  }

  async function tickWeek(plan: WeekPlan, nowMs: number, nowIso: string): Promise<TickOutcome> {
    const { week, games, correction } = plan;
    const fetchedLines: StatLine[] = [];
    // Games actually fetched THIS tick whose box score is now final — the finalGame marker for
    // each is set only after `persistTick` below commits, never here at fetch time.
    const finalGamesFetched: GameSummary[] = [];
    const finalGamesFetchedIds = new Set<string>();
    for (const game of plan.toFetch) {
      fetchedLines.push(...(await provider.getGameStatLines(game)));
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
    // (or a denied box-score reservation) can leave a final game's box score unfetched, and
    // marking the week `final` anyway would mean that game's points are only ever picked up by
    // the correction sweep, and lost entirely once its window closes.
    //
    // Checked against the `finalGame` Redis marker directly (set below, after `persistTick`
    // commits) rather than `needsBoxScore`: `needsBoxScore` also folds in `live` mode's and the
    // correction sweep's "always refetch" rules, which answer a different question ("should THIS
    // tick fetch it") than the one asked here ("has it EVER been ingested"). A game fetched THIS
    // tick counts too, even though its marker isn't written until after `persistTick` below — it's
    // about to be, by the same transaction this status is persisted alongside.
    let everyFinalGameIngested = true;
    for (const game of finalGames) {
      if (finalGamesFetchedIds.has(game.gameId)) continue;
      const alreadyIngested = await redis.exists(STATS_INGESTION_CONFIG.keys.finalGame(game.gameId));
      if (alreadyIngested === 0) {
        everyFinalGameIngested = false;
        break;
      }
    }

    const providerStatus = weekStatusFromGames(games);
    const status: WeekStatus = providerStatus === "final" && !everyFinalGameIngested ? "in_progress" : providerStatus;

    const snapshotKey = STATS_INGESTION_CONFIG.keys.snapshot(week);
    const previousRaw = await redis.hgetall(snapshotKey);
    const previous = new Map(Object.entries(previousRaw));
    const { changed, digests } = diffStatLines(previous, fetchedLines);

    // A sweep that found nothing writes NOTHING — not even `stat_weeks.updated_at`. The week is
    // already final and its game counts already stored, so there is no fact to record; and since
    // the correction window is measured from `updated_at`, a no-op write would push the deadline
    // out by another day on every sweep and the window would never close.
    if (correction && changed.length === 0) {
      if (plan.complete) await markSwept(week, nowIso);
      return { week, applied: true };
    }

    // The write. If this throws, NOTHING below runs — no finalGame marker, no snapshot update —
    // so a transient persist failure leaves Redis exactly as it was before this tick touched it,
    // and the next tick refetches and re-diffs from scratch. Same principle as publish-after-
    // commit: a Redis claim of "already ingested" may only be made once Postgres actually agrees.
    const persisted = await persistTick(db, {
      week,
      changed,
      status,
      games: { total: gamesTotal, final: gamesFinal },
      now: nowIso,
    });

    for (const game of finalGamesFetched) {
      await redis.set(STATS_INGESTION_CONFIG.keys.finalGame(game.gameId), "1", "EX", STATS_INGESTION_CONFIG.ttlSeconds.finalGame);
    }
    if (digests.size > 0) {
      await redis.hset(snapshotKey, Object.fromEntries(digests));
      await redis.expire(snapshotKey, STATS_INGESTION_CONFIG.ttlSeconds.snapshot);
    }
    // A sweep counts for the day only if it actually read the whole week, and so does the tick
    // that SETTLED the week (which by definition ingested every final game, or it would not have
    // settled): the box scores were read today either way, so the first correction sweep is
    // tomorrow's. That is also what keeps the sweep from re-reading a week within minutes of it
    // settling, which would spend requests to re-confirm numbers the same tick just wrote.
    if ((correction && plan.complete) || status === "final") await markSwept(week, nowIso);

    // Task 4's own trigger: the missed-deadline lineup runs on the tick that moves THIS week out
    // of `scheduled`, and only that tick — `plan.priorStatus` is the status `runTick`'s opening
    // read found BEFORE this tick's write, so a week that was already `in_progress` or `final`
    // never refires it. AFTER `persistTick` commits, never inside it: `stat_weeks` is keyed on
    // week alone and is not league-scoped, the same reason `correctSettledWeek` runs its own
    // global `persistTick` before and outside every per-league transaction. A failure here is
    // logged and swallowed — never rethrown — so a broken auto-set can never fail the tick that
    // just settled real scores; it is safe to repeat on the next tick because its own idempotency
    // comes from the per-team guard inside `autoSetLineupsForWeek`, not from firing exactly once.
    if (plan.priorStatus === "scheduled" && status !== "scheduled") {
      try {
        await autoSet(db, { weekNumber: week, occurredAt: nowIso });
      } catch (error: unknown) {
        console.error("[stats-pipeline] auto-set lineup failed for week", week, error);
        reportIfDue({ week, applied: false, reason: "Couldn't auto-set lineups for managers who missed this week's deadline." }, nowMs);
      }
    }

    if (changed.length > 0) {
      await publishAffected(week, status, gamesFinal, gamesTotal, persisted.version, changed, nowMs);
    }
    // `persistTick` never regresses a settled week (see its own docblock), so a correction sweep's
    // week is still `final` here and re-settles through the same path the transition used —
    // `finalizeWeek` recomputes from stored lineups and stored lines and overwrites, which is what
    // carries a landed correction all the way into `matchups` and the standings.
    if (status === "final") {
      await finalizeDrafted(week, gamesFinal, gamesTotal, persisted.version, nowMs);
    }

    return { week, applied: true };
  }

  /** One sweep per week per calendar day, marked only once the sweep has actually completed. */
  async function markSwept(week: number, nowIso: string): Promise<void> {
    try {
      await redis.set(
        STATS_INGESTION_CONFIG.keys.correctionSweep(week, nowIso.slice(0, 10)),
        "1",
        "EX",
        STATS_INGESTION_CONFIG.ttlSeconds.correctionSweep,
      );
    } catch {
      // Worst case the sweep runs twice in a day, which costs requests and changes no number.
    }
  }

  /** `null` when no sweep is due: outside the window, already swept today, or Redis is unreachable
   *  (in which case skipping is the conservative direction — it spends nothing). */
  async function correctionWeekDue(rows: readonly WeekRow[], nowMs: number, nowIso: string): Promise<number | null> {
    const candidate = correctionCandidate(rows, nowMs, STATS_INGESTION_CONFIG.correctionWindowDays);
    if (candidate === null) return null;
    try {
      const swept = await redis.exists(STATS_INGESTION_CONFIG.keys.correctionSweep(candidate, nowIso.slice(0, 10)));
      return swept === 0 ? candidate : null;
    } catch {
      return null;
    }
  }

  /** Tracks how long the window has opened on the same un-advanceable week, and says when to widen. */
  function trackWedge(window: ExaminationWindow, nowMs: number): boolean {
    if (window.startIsNew) {
      wedgeWeek = null;
      wedgeTicks = 0;
      return false;
    }
    if (wedgeWeek === window.start) wedgeTicks += 1;
    else {
      wedgeWeek = window.start;
      wedgeTicks = 1;
    }
    if (wedgeTicks <= wedgedWeekTicks) return false;
    // The count is in the MESSAGE (an operator wants to know how long) and deliberately not in the
    // rate-limit key, which is stable per wedged week — see `reportIfDue`.
    reportIfDue(
      {
        week: window.start,
        applied: false,
        reason: `Week ${window.start} has not finished after ${wedgeTicks} ingestion passes. The rest of the season is being examined alongside it so it keeps moving.`,
      },
      nowMs,
      `wedged:${window.start}`,
    );
    return true;
  }

  async function tick(): Promise<readonly TickOutcome[]> {
    const lease = await acquireLease();
    if (lease.kind === "held") {
      const outcome: TickOutcome = { week: 0, applied: false, reason: "Another instance is already running this tick." };
      reportIfDue(outcome, Date.parse(clock.now()));
      return [outcome];
    }
    try {
      return await runTick();
    } finally {
      await releaseLease(lease);
    }
  }

  async function runTick(): Promise<readonly TickOutcome[]> {
    const nowIso = clock.now();
    const nowMs = Date.parse(nowIso);
    // The whole table, not a single-row query: it holds at most one row per week of a season
    // (~18 at the outside), so reading it in full is cheap, and only reading it in full lets this
    // tell "empty" apart from "every row is final" — a `WHERE status != 'final' LIMIT 1` query
    // can't distinguish the two, because both return no row. It is also what the correction sweep
    // and the late-settlement catch-up below read, so one query serves all three.
    const rows: readonly WeekRow[] = await db
      .select({
        week: statWeeks.week,
        status: statWeeks.status,
        updatedAt: statWeeks.updatedAt,
        version: statWeeks.version,
        gamesTotal: statWeeks.gamesTotal,
        gamesFinal: statWeeks.gamesFinal,
      })
      .from(statWeeks)
      .orderBy(asc(statWeeks.week));

    const provisional = examinationWindow(rows, {
      lastWeek: provider.lastWeekOfSeason,
      maxWeeks: STATS_INGESTION_CONFIG.maxWeeksPerTick,
      widen: false,
    });
    const widen = trackWedge(provisional, nowMs);
    const window = widen
      ? examinationWindow(rows, { lastWeek: provider.lastWeekOfSeason, maxWeeks: STATS_INGESTION_CONFIG.maxWeeksPerTick, widen: true })
      : provisional;

    const correctionWeek = await correctionWeekDue(rows, nowMs, nowIso);
    const sweepWeek = correctionWeek !== null && !window.weeks.includes(correctionWeek) ? correctionWeek : null;

    // An empty window means every week through the provider's last is already final and no
    // correction is due — the season is over, and there is nothing to examine until next season
    // resets the ledger. Checked BEFORE any reservation, not after: reserving on an empty window
    // would drain the monthly ledger for zero work every poll interval for as long as the season
    // stays settled. Reported (rate-limited) rather than returned silently, so a season that has
    // genuinely stopped advancing is visible in the log instead of being indistinguishable from a
    // worker that is not running at all.
    if (window.weeks.length === 0 && sweepWeek === null) {
      const outcome: TickOutcome = { week: 0, applied: false, reason: "Nothing to examine — every week through the season's end is already final." };
      reportIfDue(outcome, nowMs);
      return [outcome, ...(await settleMissedWeeks(rows, nowMs))];
    }

    const outcomes: TickOutcome[] = [];
    const plans: WeekPlan[] = [];
    let gamesBudgetRemaining = STATS_INGESTION_CONFIG.maxGamesPerTick;

    /** Lists one week and decides, exactly, which of its box scores this tick will fetch. */
    async function planWeek(week: number, correction: boolean): Promise<void> {
      try {
        const games = await provider.listGames(week);
        // No games at all means this week is outside the provider's season (or hasn't been
        // scheduled yet) — nothing to record, nothing to score.
        if (games.length === 0) return;
        const toFetch: GameSummary[] = [];
        let truncated = false;
        for (const game of games) {
          if (toFetch.length >= gamesBudgetRemaining) {
            truncated = true;
            break;
          }
          if (await needsBoxScore(game, correction)) toFetch.push(game);
        }
        gamesBudgetRemaining -= toFetch.length;
        // `rows` is `runTick`'s own opening read, taken before this tick's `persistTick` can move
        // anything — an absent row reads as `"scheduled"`, the same convention `weekStatusFor`
        // uses, so a week the worker has never reached is a legitimate transition source too.
        const priorStatus: WeekStatus = rows.find((row) => row.week === week)?.status ?? "scheduled";
        plans.push({ week, games, toFetch, correction, complete: !truncated, priorStatus });
      } catch (error: unknown) {
        // One week's failure (a dropped connection, an upstream 500) must not stop the other
        // week examined this tick from being checked.
        console.error("[stats-pipeline] listing games failed for week", week, error);
        const outcome: TickOutcome = { week, applied: false, reason: "Something went wrong listing this week's games." };
        outcomes.push(outcome);
        reportIfDue(outcome, nowMs);
      }
    }

    // PHASE ONE of the reservation: exactly one `listGames` per LIVE week about to be examined.
    // This is the number of requests the next few lines actually make, not an upper bound on the
    // whole tick — the tick cannot know what its box-score fetches will cost until these calls
    // return, and reserving that unknown as a worst case with no release path is what turned an
    // 850-request ingestion budget into 38 grants a month.
    if (window.weeks.length > 0) {
      const scheduleReservation = await budget.reserve(window.weeks.length);
      if (!scheduleReservation.granted) {
        const outcome: TickOutcome = { week: window.weeks[0]!, applied: false, reason: DENIAL_REASONS[scheduleReservation.denial] };
        reportIfDue(outcome, nowMs);
        return [outcome];
      }
      for (const week of window.weeks) await planWeek(week, false);
    }

    // PHASE ONE-B: the correction sweep's own schedule call, reserved separately and made only if
    // there is game budget left to do anything with it. The live weeks come first and take what
    // they need; a sweep with nothing left to fetch would spend a request to learn a schedule it
    // cannot act on, and would then have to leave the day unclaimed anyway.
    if (sweepWeek !== null && gamesBudgetRemaining > 0) {
      const sweepReservation = await budget.reserve(1);
      if (sweepReservation.granted) await planWeek(sweepWeek, true);
      else reportIfDue({ week: sweepWeek, applied: false, reason: DENIAL_REASONS[sweepReservation.denial] }, nowMs);
    }

    // PHASE TWO: the exact box scores this tick has decided to fetch, now that it knows. A denial
    // here skips the fetches and keeps the schedules — they are already paid for, and the week's
    // honest game counts and status are worth persisting even on a tick that can afford no box
    // scores. `everyFinalGameIngested` above is what stops that from marking a week final early.
    const boxScoreCount = plans.reduce((total, plan) => total + plan.toFetch.length, 0);
    const boxScoreReservation = boxScoreCount === 0 ? { granted: true as const } : await budget.reserve(boxScoreCount);
    const fetchPlans = boxScoreReservation.granted ? plans : plans.map((plan) => ({ ...plan, toFetch: [], complete: false }));
    if (!boxScoreReservation.granted) {
      // `plans` is never empty here: a denial only happens when `boxScoreCount` is positive, and
      // that count comes from the plans themselves.
      reportIfDue({ week: plans[0]!.week, applied: false, reason: DENIAL_REASONS[boxScoreReservation.denial] }, nowMs);
    }

    for (const plan of fetchPlans) {
      try {
        const outcome = await tickWeek(plan, nowMs, nowIso);
        outcomes.push(outcome);
        reportIfDue(outcome, nowMs);
      } catch (error: unknown) {
        console.error("[stats-pipeline] tick failed for week", plan.week, error);
        const outcome: TickOutcome = { week: plan.week, applied: false, reason: "Something went wrong ingesting this week." };
        outcomes.push(outcome);
        reportIfDue(outcome, nowMs);
      }
    }

    outcomes.push(...(await settleMissedWeeks(rows, nowMs)));
    return outcomes;
  }

  return {
    tick,
    start() {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        // Never overlap ticks: a slow tick (a stalled upstream request) must not stack another
        // on top of it. This is the in-process half; `acquireLease` is the cross-instance half.
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
