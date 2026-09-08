import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRedisConnection } from "@/lib/realtime/redis";
import { JOBS_CONFIG } from "./config";
import {
  classifyWakeDue,
  createMemoryWakeSet,
  createRedisWakeSet,
  EVERYTHING_DUE,
  installWakeSet,
  UNGATED_WAKE_SET,
  WAKE_MEMBERS,
  wakeMember,
  wakeSet,
  type WakeSet,
} from "./wake";

const T0 = Date.parse("2026-09-08T12:00:00.000Z");

describe("classifyWakeDue — the vocabulary the tick steers by", () => {
  it("maps job members to the claim, the reclaim member to the scan, and draft members to the sweep", () => {
    const due = classifyWakeDue([wakeMember.job(7), WAKE_MEMBERS.reclaim, wakeMember.draft("d1")], true);
    expect(due).toEqual({ members: [wakeMember.job(7), WAKE_MEMBERS.reclaim, wakeMember.draft("d1")], claim: true, reclaim: true, sweep: true });
  });

  it("reads an empty due list as nothing to do when the sweep sentinel is present", () => {
    expect(classifyWakeDue([], true)).toEqual({ members: [], claim: false, reclaim: false, sweep: false });
  });

  it("treats a MISSING sweep sentinel as a due sweep — a fresh Redis must never freeze the backstop", () => {
    expect(classifyWakeDue([], false).sweep).toBe(true);
  });

  it("counts the scheduled-drafts marker and the safety marker as sweep reasons", () => {
    expect(classifyWakeDue([WAKE_MEMBERS.scheduledDrafts], true).sweep).toBe(true);
    expect(classifyWakeDue([WAKE_MEMBERS.sweepSafety], true).sweep).toBe(true);
  });
});

function wakeSetContract(name: string, make: () => WakeSet): void {
  describe(`${name} — the WakeSet contract`, () => {
    it("reports only members whose instant has passed, and forgets removed ones", async () => {
      const set = make();
      await set.add(WAKE_MEMBERS.sweepSafety, T0 + 60_000);
      await set.add(wakeMember.job(1), T0 - 1);
      await set.add(wakeMember.job(2), T0 + 1);
      const due = await set.due(T0);
      expect(due.members).toEqual([wakeMember.job(1)]);
      expect(due).toMatchObject({ claim: true, reclaim: false, sweep: false });

      await set.remove([wakeMember.job(1)]);
      expect((await set.due(T0)).members).toEqual([]);
      expect((await set.due(T0 + 1)).members).toEqual([wakeMember.job(2)]);
    });

    it("a later add for the same member replaces its instant", async () => {
      const set = make();
      await set.add(WAKE_MEMBERS.sweepSafety, T0 + 60_000);
      await set.add(WAKE_MEMBERS.reclaim, T0 + 10);
      await set.add(WAKE_MEMBERS.reclaim, T0 + 50);
      expect((await set.due(T0 + 20)).reclaim).toBe(false);
      expect((await set.due(T0 + 50)).reclaim).toBe(true);
    });

    it("removing nothing is a no-op", async () => {
      const set = make();
      await expect(set.remove([])).resolves.toBeUndefined();
    });
  });
}

wakeSetContract("createMemoryWakeSet", createMemoryWakeSet);

describe("createRedisWakeSet — against the local Redis", () => {
  let redis: ReturnType<typeof createRedisConnection>;
  let key: string;

  beforeEach(() => {
    vi.stubEnv("REDIS_URL", process.env.REDIS_URL ?? "redis://localhost:6379");
    redis = createRedisConnection();
    key = `test:jobs:wake:${crypto.randomUUID()}`;
  });

  afterEach(async () => {
    await redis.del(key);
    redis.disconnect();
    vi.unstubAllEnvs();
  });

  wakeSetContract("redis", () => createRedisWakeSet(redis, key));

  it("fails OPEN when Redis is unreachable: everything is due, nothing throws", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const dead = createRedisConnection();
      dead.disconnect();
      const set = createRedisWakeSet(dead, key);
      expect(await set.due(T0)).toEqual(EVERYTHING_DUE);
      await expect(set.add(wakeMember.job(1), T0)).resolves.toBeUndefined();
      await expect(set.remove([wakeMember.job(1)])).resolves.toBeUndefined();
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe("the process-wide wake set", () => {
  it("is ungated until something installs one, and the ungated set says everything is due", async () => {
    installWakeSet(undefined);
    expect(wakeSet()).toBe(UNGATED_WAKE_SET);
    expect(await UNGATED_WAKE_SET.due(T0)).toEqual(EVERYTHING_DUE);
  });

  it("hands back the installed set", () => {
    const set = createMemoryWakeSet();
    installWakeSet(set);
    expect(wakeSet()).toBe(set);
    installWakeSet(undefined);
  });
});

describe("the reclaim marker's margin", () => {
  it("is one heartbeat past the stale threshold, so a scan never runs a hair before a dead attempt turns stale", () => {
    expect(JOBS_CONFIG.reclaimWakeDelayMs).toBe(JOBS_CONFIG.staleAfterMs + JOBS_CONFIG.heartbeatIntervalMs);
  });
});
