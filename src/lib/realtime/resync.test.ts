import { describe, expect, it, vi } from "vitest";
import { REALTIME_CONFIG } from "./config";
import { createResyncMarker } from "./resync";

function fakeRedis(failing = false) {
  const held = new Map<string, string>();
  const sets: unknown[][] = [];
  return {
    held,
    sets,
    client: {
      async get(key: string) {
        if (failing) throw new Error("connect ETIMEDOUT");
        return held.get(key) ?? null;
      },
      async set(key: string, value: string, ...args: unknown[]) {
        sets.push([key, value, ...args]);
        if (failing) throw new Error("connect ETIMEDOUT");
        held.set(key, value);
        return "OK";
      },
    },
  };
}

describe("the resync marker (review finding 3)", () => {
  it("marks a draft with the instant, under its key and TTL, and reads it back; an unmarked draft reads null", async () => {
    const redis = fakeRedis();
    const marker = createResyncMarker(redis.client as never, () => "2026-09-19T00:00:00.000Z");
    expect(await marker.check("d1")).toBeNull();
    await marker.mark("d1");
    expect(await marker.check("d1")).toBe("2026-09-19T00:00:00.000Z");
    expect(redis.sets).toEqual([[REALTIME_CONFIG.resyncKey("d1"), "2026-09-19T00:00:00.000Z", "PX", REALTIME_CONFIG.resyncMarkerTtlMs]]);
    expect(REALTIME_CONFIG.resyncMarkerTtlMs).toBeGreaterThanOrEqual(REALTIME_CONFIG.plannedCloseMs);
  });

  it("never throws: a failing Redis is logged once per streak, a read is no mark", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const marker = createResyncMarker(fakeRedis(true).client as never);
    await marker.mark("d1");
    await marker.mark("d1");
    expect(await marker.check("d1")).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
