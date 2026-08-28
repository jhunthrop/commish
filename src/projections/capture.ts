import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { captureSnapshots } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { Tank01Client } from "@/stats/tank01/client";
import {
  cadenceAllows,
  freshnessSeconds,
  requestCostOf,
  CAPTURE_CONFIG,
  CAPTURE_FEEDS,
  type CaptureFeed,
  type CaptureFeedContext,
} from "./capture-feeds";

/**
 * THE CAPTURE JOB — the only part of this engine where waiting costs something that cannot be
 * bought back.
 *
 * Everything nflverse publishes is archived and can be backfilled whenever we get round to it. The
 * feeds in `CAPTURE_FEEDS` are not: an injury designation, a depth chart, a pre-kickoff betting
 * line, this week's DFS salaries, the ADP the market believed in August — each is a CURRENT
 * snapshot that is overwritten in place upstream, with no history endpoint anywhere. Every week
 * this does not run is a week of training data that does not exist.
 *
 * It captures the response VERBATIM and maps nothing. That is deliberate and it is what lets this
 * ship before anyone has seen the real payloads: the irreversible thing is the observation, not the
 * interpretation, and a mapper written against a guessed shape would produce confident garbage on
 * top of bytes that were fine all along. `player_week_observations` is derived from these snapshots
 * and can be rebuilt from them, so the mapping can be written — and rewritten — at leisure.
 *
 * It runs inside the existing ingestion worker's tick rather than on a scheduler of its own,
 * because that worker already owns the poll interval, the cross-instance lease and, above all, the
 * monthly request ledger. A second scheduler would be a second spender against one paid quota with
 * no idea what the first was doing, and the day it mattered would be the Sunday it took live
 * scoring down.
 */

/** Whether one upstream request costs anything, and permission to make it. */
export interface CaptureBudget {
  reserve(count: number): Promise<{ readonly granted: boolean; readonly denial?: string }>;
}

export interface CaptureDeps {
  readonly db: Db;
  readonly client: Tank01Client;
  readonly clock: Clock;
  readonly budget: CaptureBudget;
  readonly season: number;
  readonly week: number;
  readonly teams: readonly string[];
  /** True while this feed's cadence still considers a previous capture recent enough. */
  isFresh(key: string): Promise<boolean>;
  /** Record that this feed was polled, expiring after `ttlSeconds`. */
  markFresh(key: string, ttlSeconds: number): Promise<void>;
  /** Defaults to `CAPTURE_FEEDS`. Injectable so a test can drive one feed in isolation. */
  readonly feeds?: readonly CaptureFeed[];
}

/**
 * What happened to one feed this pass. A status rather than a boolean because the caller — the
 * ingestion worker's tick log — must tell an ORDINARY skip (still fresh, nothing changed, not a
 * game day) from a FAILURE. Logging every skip would drown the log in normality and train an
 * operator to ignore it, which is precisely when a dead endpoint would go unnoticed for a season.
 */
export type CaptureStatus = "captured" | "unchanged" | "fresh" | "off-cadence" | "budget-refused" | "failed";

export interface CaptureFeedOutcome {
  readonly source: string;
  readonly status: CaptureStatus;
  /** How many upstream requests this feed made. Zero when it was skipped. */
  readonly requests: number;
  /** The upstream error, for `failed`. */
  readonly reason?: string;
}

export interface CaptureResult {
  readonly feeds: readonly CaptureFeedOutcome[];
  /** Set when the whole pass was refused before any request was made. */
  readonly reason?: string;
}

/**
 * A stable fingerprint of a payload, so an unchanged feed writes no row.
 *
 * Keys are sorted at every level before hashing. `JSON.stringify` preserves insertion order, and
 * an upstream that returns the same facts with its keys in a different order would otherwise look
 * like a change on every single poll — which would turn a daily capture of an unchanged injury
 * report into 365 identical rows a year and make "when did this actually change" unanswerable.
 */
function digestOf(payload: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  };
  return createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}

async function latestDigest(db: Db, source: string): Promise<string | null> {
  const [row] = await db
    .select({ digest: captureSnapshots.digest })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, source))
    .orderBy(desc(captureSnapshots.capturedAt), desc(captureSnapshots.id))
    .limit(1);
  return row?.digest ?? null;
}

/** The feeds whose cadence permits them today and whose last capture has gone stale. */
async function dueFeeds(
  feeds: readonly CaptureFeed[],
  { isFresh }: Pick<CaptureDeps, "isFresh">,
  at: Date,
): Promise<{ readonly due: readonly CaptureFeed[]; readonly skipped: readonly CaptureFeedOutcome[] }> {
  const due: CaptureFeed[] = [];
  const skipped: CaptureFeedOutcome[] = [];
  for (const feed of feeds) {
    if (!cadenceAllows(feed.cadence, at)) {
      skipped.push({ source: feed.source, status: "off-cadence", requests: 0 });
      continue;
    }
    if (await isFresh(CAPTURE_CONFIG.attemptKey(feed.source))) {
      skipped.push({ source: feed.source, status: "fresh", requests: 0 });
      continue;
    }
    due.push(feed);
  }
  return { due, skipped };
}

/**
 * One capture pass. Safe to call on every tick — it decides for itself what is due.
 *
 * The budget is reserved ONCE, up front, for exactly what the due feeds will spend, following the
 * ingestion worker's own rule: reserve what you are about to spend, never a worst case, because
 * there is no release path and a lost release is a permanently over-counted ledger. A refusal
 * captures nothing rather than capturing some feeds and stranding the reservation.
 */
export async function captureOnce(deps: CaptureDeps): Promise<CaptureResult> {
  const { db, client, clock, budget, season, week, teams, markFresh, feeds = CAPTURE_FEEDS } = deps;
  const capturedAt = new Date(clock.now());
  const context: CaptureFeedContext = { season, week, teams };

  const { due, skipped } = await dueFeeds(feeds, deps, capturedAt);
  if (due.length === 0) return { feeds: skipped };

  const reservation = await budget.reserve(requestCostOf(due, context));
  if (!reservation.granted) {
    // Fails closed and captures NOTHING. A half-captured pass is worse than none: the feeds that
    // did land would mark themselves fresh and the rest would be skipped for a day, so a single
    // exhausted tick would cost a whole cadence period of the feeds that happened to sort last.
    return {
      reason: `The upstream request budget refused the capture pass (${reservation.denial ?? "denied"}).`,
      feeds: [
        ...skipped,
        ...due.map((feed) => ({ source: feed.source, status: "budget-refused" as const, requests: 0 })),
      ],
    };
  }

  const outcomes: CaptureFeedOutcome[] = [...skipped];
  for (const feed of due) {
    const requests = feed.requests(context);
    try {
      // Sequential, not `Promise.all`: the Tank01 client's own docblock records that concurrent
      // calls draw burst 429s from the RapidAPI gateway, and this job has no deadline — it is
      // capturing a snapshot, not serving a page.
      const bodies: unknown[] = [];
      for (const request of requests) bodies.push(await client.get(request.path, request.query));
      // A single-request feed stores its body directly; a fan-out stores the array, in request
      // order, as ONE snapshot — thirty-two teams' injury reports are one state of the world, and
      // splitting them into thirty-two rows would make "what did the league look like on Friday"
      // a join instead of a lookup.
      const payload = bodies.length === 1 ? bodies[0] : bodies;
      const digest = digestOf(payload);

      if (digest === (await latestDigest(db, feed.source))) {
        // Nothing changed, so nothing is written — and no knowledge is lost, because a
        // point-in-time read asks for the newest snapshot at or before a moment and the previous
        // one still answers it correctly.
        await markFresh(CAPTURE_CONFIG.attemptKey(feed.source), freshnessSeconds(feed.cadence));
        outcomes.push({ source: feed.source, status: "unchanged", requests: requests.length });
        continue;
      }

      await db.insert(captureSnapshots).values({ source: feed.source, capturedAt, digest, payload });
      await markFresh(CAPTURE_CONFIG.attemptKey(feed.source), freshnessSeconds(feed.cadence));
      outcomes.push({ source: feed.source, status: "captured", requests: requests.length });
    } catch (error: unknown) {
      // One feed's failure never stops the others, and a failed feed is NOT marked fresh: it
      // retries on the next tick rather than standing down for a whole cadence period. A wrong
      // endpoint path (none of these are verified against a live key yet) therefore shows up as
      // one loud dead feed while the rest keep capturing.
      outcomes.push({
        source: feed.source,
        status: "failed",
        requests: requests.length,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { feeds: outcomes };
}
