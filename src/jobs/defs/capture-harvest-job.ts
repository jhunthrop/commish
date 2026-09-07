// THE CAPTURE HARVEST JOB — production has ZERO `capture_snapshots` rows because `captureOnce`
// (`@/projections/capture`) has only ever run from the ingestion worker's own tick (a long-lived
// process nothing in production keeps alive) or from an operator's ad-hoc `scripts/capture-once.ts`.
// Without a row, a player card has never checked an injury feed and a capsule has no news to cite.
// This job is what actually lands injury designations, headlines and depth-chart moves in the
// archive every night, on the schedule the job system owns (`schedules.ts`).
//
// FEED SELECTION — a DELIBERATE SUBSET, not `CAPTURE_FEEDS` whole. `HARVEST_FEED_SOURCES` below
// keeps the cheap, single-request, daily-value feeds a player card or capsule actually reads:
// injuries-by-date, news, depth charts, inactives and betting odds. Left out on purpose: the
// 32-request `tank01_injuries` roster sweep (the worker/operator path's concern, not a nightly
// job's), the ~4.4MB weekly `tank01_player_list`, `tank01_adp` (already owned by
// `adp-snapshot-job.ts`), and `tank01_changelog`/`tank01_projections`/`tank01_dfs_salaries`. There
// is no team-info feed in `CAPTURE_FEEDS` to add — `getNFLTeams` is a path Tank01 exposes
// (`TANK01_CONFIG.paths.teams`) but nothing in the capture module polls it, the same way the team
// list itself is a hardcoded constant (`NFL_TEAM_ABBREVIATIONS`) rather than a daily fetch — so
// this job does not invent one.
//
// THE BUDGET. Every feed in `HARVEST_FEED_SOURCES` is single-request regardless of cadence
// (`CAPTURE_FEEDS`'s own `requests()`), so the worst case — every cadence due the same day, which
// only happens Thursday-through-Monday when the game-day feeds also fire — costs 5 upstream
// requests. `CAPTURE_HARVEST_REQUEST_BUDGET` below is a deliberately small, SELF-CONTAINED ceiling
// (not the ingestion worker's shared `dailyRequestBudget`, `stats-pipeline/config.ts`): this job
// runs pre-dawn, nowhere near live scoring's own draw on that shared ledger, and its own feed list
// is fixed and small enough that a private ceiling is honest rather than a workaround.
//
// FRESHNESS. `captureOnce`'s `isFresh`/`markFresh` exist to stop the ingestion worker's own
// multiple-times-an-hour tick from re-polling a feed inside its cadence window. A job that fires
// once a night on its OWN schedule is already at that cadence, so this job answers `isFresh` with a
// constant `false` rather than standing up a Redis-backed key — the digest check inside
// `captureOnce` (`digestOf`/`latestDigest`) is what actually stops an unchanged feed from writing a
// duplicate row, and that guard is unconditional regardless of freshness.
//
// TERMINAL VS RETRYABLE: a missing `TANK01_API_KEY` cannot resolve itself on a retry — the same
// key is read on every attempt — so it is the one terminal case, checked before `captureOnce` ever
// runs. Everything else `captureOnce` can throw (a DB failure around the insert, `latestDigest`'s
// own select) is ordinary retryable weather, matching every other nightly job in this directory.
// `captureOnce` itself never throws for a single feed's own network failure — that lands as a
// `"failed"` outcome in the summary instead, which is `capture.ts`'s own honest-data design (a
// failed feed is a logged detail line, never a fabricated row) and this job does not fight it.
import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { captureSnapshots, players } from "@/db/schema";
import type { JsonObject } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import { envOrUndefined } from "@/lib/env";
import { harvestDesignationDiff, harvestNewsDiff, type HarvestCapture } from "@/projections/harvest-diff";
import { enqueuePeekDocumentRebuildsQuietly } from "./peek-document-job";
import { captureOnce, type CaptureBudget, type CaptureFeedOutcome, type CaptureResult } from "@/projections/capture";
import { CAPTURE_FEEDS, NFL_TEAM_ABBREVIATIONS, type CaptureFeed } from "@/projections/capture-feeds";
import { currentNflWeek } from "@/stats-pipeline";
import { createTank01Client } from "@/stats/tank01/client";
import { TANK01_CONFIG } from "@/stats/tank01/config";
import { defineJob, TerminalJobError, type AnyJobDefinition, type StepOutcome } from "../contract";

export const CAPTURE_HARVEST_JOB_NAME = "capture-harvest";

/** See the module docblock's FEED SELECTION section for why each of these five, and why not the
 *  rest of `CAPTURE_FEEDS`. */
/** The two feeds a peek document actually reads. Named because the player-level diff below compares
 *  exactly these two captures and nothing else: a depth chart or a betting line moving is real news
 *  for other surfaces, but it is not a field on this document. */
const INJURY_SOURCE = "tank01_injuries_by_date";
const NEWS_SOURCE = "tank01_news";

const HARVEST_FEED_SOURCES: ReadonlySet<string> = new Set([
  INJURY_SOURCE,
  NEWS_SOURCE,
  "tank01_depth_charts",
  "tank01_inactives",
  "tank01_betting_odds",
]);

function harvestFeeds(feeds: readonly CaptureFeed[]): readonly CaptureFeed[] {
  return feeds.filter((feed) => HARVEST_FEED_SOURCES.has(feed.source));
}

/** See the module docblock's THE BUDGET section. */
export const CAPTURE_HARVEST_REQUEST_BUDGET = 10;

/** A per-run reservation that never persists — this job's own feed list is small and fixed, so a
 *  fixed in-memory ceiling is honest rather than sharing (or reinventing) the ingestion worker's
 *  Redis-backed ledger. */
function fixedBudget(limit: number): CaptureBudget {
  return {
    async reserve(count) {
      if (count > limit) {
        return { granted: false, denial: `requested ${count} request(s) exceeds this run's budget of ${limit}` };
      }
      return { granted: true };
    },
  };
}

export interface CaptureHarvestPayload {
  /** The schedule's own fire instant (`schedule.ts`'s `tickOne`, which merges `firedAt` onto every
   *  schedule-born job's payload) — read here so the captured day (`YYYYMMDD`, for the two
   *  date-keyed feeds) is stable across retries of the same fire rather than drifting with
   *  wall-clock `Date.now()` at attempt time, the same discipline `adp-snapshot-job.ts` and
   *  `props-preseason-snapshot-job.ts` already keep. Optional because a hand-enqueued run (an
   *  operator re-run) carries no schedule fire; that case falls back to the injected clock. */
  readonly firedAt?: string;
}

export function parseCaptureHarvestPayload(raw: JsonObject): CaptureHarvestPayload {
  const firedAt = raw.firedAt;
  if (firedAt === undefined) return {};
  if (typeof firedAt !== "string" || Number.isNaN(Date.parse(firedAt))) {
    throw new Error(`capture-harvest payload: firedAt must be an ISO instant string, got ${JSON.stringify(firedAt)}.`);
  }
  return { firedAt };
}

export interface CaptureHarvestDeps {
  /** Defaults to reading `TANK01_CONFIG.envVars.apiKey` from the environment — injectable so a
   *  test can pin it without `vi.stubEnv`, matching every other capture-adjacent test's shape. */
  readonly apiKey?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Injectable so a test can pin the derived week without seeding `stat_weeks`. Defaults to the
   *  same earliest-non-final lookup `stats-pipeline/index.ts`'s own `getCapture()` uses — it falls
   *  back to week 1 when the table is empty, which IS the preseason case this job must handle:
   *  every harvested feed but `tank01_inactives` is date-keyed rather than week-keyed, so a
   *  placeholder week never corrupts what they capture. */
  readonly currentWeek?: (db: Db) => Promise<number>;
  /** Injectable for a test to drive one feed in isolation, exactly like `CaptureDeps.feeds`
   *  (`capture.ts`) it forwards to. Defaults to `CAPTURE_FEEDS` filtered to `HARVEST_FEED_SOURCES`. */
  readonly feeds?: readonly CaptureFeed[];
}

function describeFeed(feed: CaptureFeedOutcome): string {
  return `${feed.source}: ${feed.status}${feed.reason === undefined ? "" : ` — ${feed.reason}`}`;
}

function summarize(result: CaptureResult): StepOutcome {
  if (result.reason !== undefined) {
    return { summary: `capture-harvest: refused — ${result.reason}`, detail: result.feeds.map(describeFeed) };
  }
  const captured = result.feeds.filter((feed) => feed.status === "captured").length;
  const unchanged = result.feeds.filter((feed) => feed.status === "unchanged").length;
  const failed = result.feeds.filter((feed) => feed.status === "failed").length;
  const other = result.feeds.length - captured - unchanged - failed;
  const summary =
    `capture-harvest: ${result.feeds.length} feed(s) considered, ${captured} captured, ${unchanged} unchanged, ` +
    `${failed} failed` +
    (other > 0 ? `, ${other} skipped (off-cadence or already fresh)` : "");
  return { summary, detail: result.feeds.map(describeFeed) };
}

/** The two most recent captures of one feed, newest first — what the player-level diff compares.
 *  Fewer than two means there is nothing to compare against, and the diff says so by naming nobody. */
async function lastTwoCaptures(db: Db, source: string): Promise<{ readonly next: HarvestCapture | null; readonly previous: HarvestCapture | null }> {
  const rows = await db
    .select({ payload: captureSnapshots.payload })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, source))
    .orderBy(desc(captureSnapshots.capturedAt))
    .limit(2);
  return { next: rows[0] ?? null, previous: rows[1] ?? null };
}

/**
 * WHICH PLAYERS THIS HARVEST MOVED, as product player ids.
 *
 * The injuries feed carries the product's own player id already. The news feed carries only the name
 * in front of its title's colon, the same join `news.ts` makes, so those names are resolved through
 * one read of `players`. A name the product does not carry resolves to nothing and is dropped rather
 * than guessed at.
 */
async function movedPlayerIds(db: Db): Promise<readonly string[]> {
  const [injuries, news] = await Promise.all([lastTwoCaptures(db, INJURY_SOURCE), lastTwoCaptures(db, NEWS_SOURCE)]);
  const moved = new Set<string>(injuries.next === null ? [] : harvestDesignationDiff(injuries.previous, injuries.next));

  const names = news.next === null ? [] : harvestNewsDiff(news.previous, news.next);
  if (names.length > 0) {
    const rows = await db.select({ id: players.id }).from(players).where(inArray(players.name, [...names]));
    for (const row of rows) moved.add(row.id);
  }
  return [...moved].sort();
}

export async function runCaptureHarvestStep(db: Db, clock: Clock, payload: CaptureHarvestPayload, deps: CaptureHarvestDeps = {}): Promise<StepOutcome> {
  const apiKey = deps.apiKey ?? envOrUndefined(TANK01_CONFIG.envVars.apiKey);
  if (apiKey === undefined) {
    // TERMINAL, not retryable: the same env var is read on every attempt, so nothing about
    // retrying changes the outcome until an operator sets the key.
    throw new TerminalJobError(`capture-harvest: ${TANK01_CONFIG.envVars.apiKey} is not set; there is no Tank01 client to build.`);
  }

  const capturedNow = payload.firedAt ?? clock.now();
  const seasonSetting = envOrUndefined(TANK01_CONFIG.envVars.season);
  const season = seasonSetting === undefined ? TANK01_CONFIG.defaultSeason : Number(seasonSetting);
  const week = await (deps.currentWeek ?? currentNflWeek)(db);
  const client = createTank01Client({ apiKey, fetch: deps.fetch });

  const result = await captureOnce({
    db,
    client,
    clock: { now: () => capturedNow },
    budget: fixedBudget(CAPTURE_HARVEST_REQUEST_BUDGET),
    season,
    week,
    teams: NFL_TEAM_ABBREVIATIONS,
    isFresh: async () => false,
    markFresh: async () => {},
    feeds: deps.feeds ?? harvestFeeds(CAPTURE_FEEDS),
  });

  // THE EVENT (peek document design §3.4, row four). The harvest already knew whether a FEED
  // changed; this is the part that knows WHO changed inside it, which is what keeps the rebuild
  // targeted at a handful of players rather than the whole board. The capture instant is the reason
  // stamp, so a retried attempt that captured nothing new coalesces onto the same job.
  const moved = await movedPlayerIds(db);
  const enqueued =
    moved.length === 0
      ? 0
      : await enqueuePeekDocumentRebuildsQuietly(db, clock, { playerIds: moved, reason: `harvest:${capturedNow}` });

  const outcome = summarize(result);
  return {
    summary: `${outcome.summary}. Peek documents: ${moved.length} player${moved.length === 1 ? "" : "s"} moved, ${enqueued} rebuild${enqueued === 1 ? "" : "s"} enqueued`,
    detail: outcome.detail,
  };
}

export const captureHarvestJob: AnyJobDefinition = defineJob<CaptureHarvestPayload>({
  name: CAPTURE_HARVEST_JOB_NAME,
  maxAttempts: 3,
  // Up to 5 sequential upstream requests (see THE BUDGET above) plus a handful of DB reads/writes
  // — generous headroom against a slow upstream night, matching the ADP snapshot job's own
  // single-fetch-class budget with margin for the extra feeds.
  timeoutMs: 90_000,
  backoff: { baseMs: 60_000, maxMs: 10 * 60_000 },
  parsePayload: parseCaptureHarvestPayload,
  steps: [{ name: "harvest", run: (ctx, payload) => runCaptureHarvestStep(ctx.db, ctx.clock, payload) }],
});
