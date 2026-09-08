// THE WAKE SET — what the minute tick reads INSTEAD of Postgres to learn whether there is anything
// to do (Neon cost audit 2026-09-07, finding 1). Vercel Cron fires `/api/jobs/tick` every minute,
// and a tick that touches Postgres keeps Neon's compute from ever suspending; the fix is a tick
// whose idle path costs zero statements. One Redis sorted set holds every instant the tick must
// wake for, member by member: a queued job's `run_at`, the moment a claimed attempt would turn
// stale, the next instant an unwatched draft owes a clock expiry, the earliest scheduled kickoff,
// and a safety marker that runs the sweep at least every `JOBS_CONFIG.sweepMaxQuietMs`.
//
// FAIL OPEN, EVERYWHERE. A wake set that cannot be read reports everything due, so a Redis outage
// degrades to today's every-minute Postgres tick and never to a frozen queue. A process nothing
// has installed a set into (a script, a test) is the same: ungated. And a MISSING sweep sentinel
// counts as a due sweep, so a fresh or flushed Redis cannot leave the draft backstop asleep.
import type Redis from "ioredis";
import { JOBS_CONFIG } from "./config";

/** The fixed members. Per-row members come from `wakeMember` below. */
export const WAKE_MEMBERS = {
  /** A claimed attempt exists that could turn stale; refreshed by every heartbeat. */
  reclaim: "reclaim",
  /** The earliest kickoff (or mock start) among scheduled drafts, written by the sweep. */
  scheduledDrafts: "drafts:scheduled",
  /** The sweep's own "run me at least this often" marker. Absent means: run now. */
  sweepSafety: "sweep:safety",
} as const;

const JOB_PREFIX = "job:";
const DRAFT_PREFIX = "draft:";

export const wakeMember = {
  job: (jobId: number): string => `${JOB_PREFIX}${jobId}`,
  draft: (draftId: string): string => `${DRAFT_PREFIX}${draftId}`,
} as const;

export interface WakeDue {
  /** The members whose instant had passed when this was read, in Redis order. */
  readonly members: readonly string[];
  /** A queued job may be eligible: run the claim loop. */
  readonly claim: boolean;
  /** A claimed attempt may have gone stale: run the reclaim scan. */
  readonly reclaim: boolean;
  /** A draft may owe work, or the safety marker is due or missing: let the sweep fire. */
  readonly sweep: boolean;
}

export interface WakeSet {
  /** Everything due at `nowMs`. Never throws. */
  due(nowMs: number): Promise<WakeDue>;
  /** Registers (or moves) one member's wake instant. Never throws. */
  add(member: string, atMs: number): Promise<void>;
  /** Forgets members. Never throws. */
  remove(members: readonly string[]): Promise<void>;
}

/** What an unreadable or uninstalled set reports: today's behavior, a tick that checks everything. */
export const EVERYTHING_DUE: WakeDue = { members: [], claim: true, reclaim: true, sweep: true };

const isSweepMember = (member: string): boolean =>
  member.startsWith(DRAFT_PREFIX) || member === WAKE_MEMBERS.scheduledDrafts || member === WAKE_MEMBERS.sweepSafety;

/** Pure: the tick's steering from a due list plus whether the sweep sentinel exists at all. */
export function classifyWakeDue(members: readonly string[], sweepSentinelPresent: boolean): WakeDue {
  return {
    members,
    claim: members.some((member) => member.startsWith(JOB_PREFIX)),
    reclaim: members.includes(WAKE_MEMBERS.reclaim),
    sweep: !sweepSentinelPresent || members.some(isSweepMember),
  };
}

/** No gate at all: the local always-on runner and every test that does not care. */
export const UNGATED_WAKE_SET: WakeSet = {
  due: async () => EVERYTHING_DUE,
  add: async () => undefined,
  remove: async () => undefined,
};

/** In-memory, single-process — the test double, with the identical semantics. */
export function createMemoryWakeSet(): WakeSet {
  const instants = new Map<string, number>();
  return {
    due: async (nowMs) => {
      const members = [...instants.entries()]
        .filter(([, atMs]) => atMs <= nowMs)
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([member]) => member);
      return classifyWakeDue(members, instants.has(WAKE_MEMBERS.sweepSafety));
    },
    add: async (member, atMs) => {
      instants.set(member, atMs);
    },
    remove: async (members) => {
      for (const member of members) instants.delete(member);
    },
  };
}

/**
 * The production set: one Redis sorted set, score = wake instant in ms. Every command is wrapped so
 * a Redis failure logs once per streak and reports everything due (reads) or drops the write —
 * the queue and the sweep keep working off Postgres, exactly as they did before this gate existed.
 */
export function createRedisWakeSet(redis: Redis, key: string = JOBS_CONFIG.wakeSetKey): WakeSet {
  let erroring = false;
  const report = (operation: string, error: unknown): void => {
    if (!erroring) console.error(`[jobs] wake set ${operation} failed; running ungated until Redis answers again`, error);
    erroring = true;
  };
  return {
    due: async (nowMs) => {
      try {
        const [members, sentinel] = await Promise.all([redis.zrangebyscore(key, "-inf", nowMs), redis.zscore(key, WAKE_MEMBERS.sweepSafety)]);
        erroring = false;
        return classifyWakeDue(members, sentinel !== null);
      } catch (error: unknown) {
        report("read", error);
        return EVERYTHING_DUE;
      }
    },
    add: async (member, atMs) => {
      try {
        await redis.zadd(key, atMs, member);
        erroring = false;
      } catch (error: unknown) {
        report("write", error);
      }
    },
    remove: async (members) => {
      if (members.length === 0) return;
      try {
        await redis.zrem(key, ...members);
        erroring = false;
      } catch (error: unknown) {
        report("remove", error);
      }
    },
  };
}

/**
 * The process-wide set, on `globalThis` for the reason `getDb` is: `next dev` re-instantiates
 * modules on recompile, and the install (`src/instrumentation.ts`) must survive that. Every
 * writer that has no injected set — `enqueueJob` from an API route, the draft store's attention
 * note — reads through here, and an uninstalled process is ungated rather than silently gated.
 */
const globalWake = globalThis as { __commishWakeSet?: WakeSet };

export function installWakeSet(set: WakeSet | undefined): void {
  globalWake.__commishWakeSet = set;
}

export function wakeSet(): WakeSet {
  return globalWake.__commishWakeSet ?? UNGATED_WAKE_SET;
}
