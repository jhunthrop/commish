import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import type { SnapshotSummary } from "@/projections/odds/snapshot";
import {
  parsePropsPreseasonSnapshotPayload,
  runPropsPreseasonSnapshotStep,
  type PropsPreseasonSnapshotDeps,
} from "./props-preseason-snapshot-job";

const db = createTestDb();
const CLOCK = { now: () => "2026-09-01T00:00:00.000Z" };
const KICKOFF = new Date("2026-09-10T00:20:00.000Z");

const SUMMARY: SnapshotSummary = {
  totalEvents: 16,
  upcomingEvents: 16,
  selectedEvents: 16,
  totalWritten: 240,
  totalSkipped: 3,
  credits: { remaining: "9500", used: "500" },
};

function depsWithKickoff(kickoff: Date | null, snapshot = vi.fn<PropsPreseasonSnapshotDeps["snapshot"]>()): PropsPreseasonSnapshotDeps {
  return { firstKickoff: vi.fn().mockResolvedValue(kickoff), snapshot };
}

describe("props-preseason-snapshot job step", () => {
  it("before kickoff: calls the real snapshot and reports credits", async () => {
    const snapshot = vi.fn().mockResolvedValue(SUMMARY);
    const deps = depsWithKickoff(KICKOFF, snapshot);

    const outcome = await runPropsPreseasonSnapshotStep(db, CLOCK, { firedAt: "2026-09-05T07:30:00.000Z" }, deps);

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(outcome.summary).toContain("fetched 16 event(s)");
    expect(outcome.summary).toContain("wrote 240 observation(s)");
    expect(outcome.summary).toContain("credits remaining=9500 used=500");
  });

  it("AT kickoff: self-disables, never calls the network (strictly before, never at)", async () => {
    const snapshot = vi.fn();
    const deps = depsWithKickoff(KICKOFF, snapshot);

    const outcome = await runPropsPreseasonSnapshotStep(db, CLOCK, { firedAt: KICKOFF.toISOString() }, deps);

    expect(snapshot).not.toHaveBeenCalled();
    expect(outcome.summary).toContain("the pre-kickoff window is closed");
    expect(outcome.summary).toContain("no network call made");
  });

  it("after kickoff: self-disables permanently, never calls the network", async () => {
    const snapshot = vi.fn();
    const deps = depsWithKickoff(KICKOFF, snapshot);

    const outcome = await runPropsPreseasonSnapshotStep(db, CLOCK, { firedAt: "2026-09-15T12:00:00.000Z" }, deps);

    expect(snapshot).not.toHaveBeenCalled();
    expect(outcome.summary).toContain("the pre-kickoff window is closed");
  });

  it("no ingested schedule yet: skips without a network call rather than throwing", async () => {
    const snapshot = vi.fn();
    const deps = depsWithKickoff(null, snapshot);

    const outcome = await runPropsPreseasonSnapshotStep(db, CLOCK, {}, deps);

    expect(snapshot).not.toHaveBeenCalled();
    expect(outcome.summary).toContain("no kickoff to gate against");
    expect(outcome.summary).toContain("no network call made");
  });

  it("derives the gate check from the schedule's own firedAt, never the wall clock, when present", async () => {
    const snapshot = vi.fn().mockResolvedValue(SUMMARY);
    const deps = depsWithKickoff(KICKOFF, snapshot);
    // Wall clock reads well past kickoff; firedAt (the schedule's own fire instant) is still before it.
    const lateClock = { now: () => "2026-12-01T00:00:00.000Z" };

    const outcome = await runPropsPreseasonSnapshotStep(db, lateClock, { firedAt: "2026-09-05T07:30:00.000Z" }, deps);

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(outcome.summary).toContain("fetched 16 event(s)");
  });

  it("falls back to the injected clock when no firedAt is present (a hand-enqueued run)", async () => {
    const snapshot = vi.fn().mockResolvedValue(SUMMARY);
    const deps = depsWithKickoff(KICKOFF, snapshot);

    await runPropsPreseasonSnapshotStep(db, CLOCK, {}, deps);

    expect(snapshot).toHaveBeenCalledTimes(1);
  });
});

describe("parsePropsPreseasonSnapshotPayload", () => {
  it("accepts an empty payload", () => {
    expect(parsePropsPreseasonSnapshotPayload({})).toEqual({});
  });

  it("accepts a well-formed firedAt", () => {
    expect(parsePropsPreseasonSnapshotPayload({ firedAt: "2026-09-05T07:30:00.000Z" })).toEqual({
      firedAt: "2026-09-05T07:30:00.000Z",
    });
  });

  it("rejects a malformed firedAt", () => {
    expect(() => parsePropsPreseasonSnapshotPayload({ firedAt: "not-a-date" })).toThrow();
    expect(() => parsePropsPreseasonSnapshotPayload({ firedAt: 5 })).toThrow();
  });
});
