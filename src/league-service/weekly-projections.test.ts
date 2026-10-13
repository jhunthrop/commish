import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { captureSnapshots } from "@research-ts/db/schema";
import { createTestDb, recordStatements } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { weeklyProjectionsByPlayerId } from "./weekly-projections";

const db = createTestDb();

async function seedCapture(week: number, capturedAt: string, ppr: number): Promise<void> {
  await db.insert(captureSnapshots).values({
    source: "tank01_projections",
    capturedAt: new Date(capturedAt),
    digest: `digest-${week}-${capturedAt}`,
    payload: {
      week,
      playerProjections: { p1: { fantasyPointsDefault: { PPR: ppr } }, p2: { fantasyPointsDefault: { PPR: "not a number" } } },
      teamDefenseProjections: { KC: { teamAbv: "KC", fantasyPointsDefault: 7.5 } },
    },
  });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("weeklyProjectionsByPlayerId", () => {
  it("reads the newest capture for the week, players and defenses, dropping non-numbers", async () => {
    await seedCapture(3, "2026-09-08T10:00:00.000Z", 11.1);
    await seedCapture(3, "2026-09-08T11:00:00.000Z", 12.2);
    const projections = await weeklyProjectionsByPlayerId(db, 3);
    expect([...projections.entries()]).toEqual([
      ["p1", 12.2],
      ["DST-KC", 7.5],
    ]);
  });

  it("answers an empty map for a capture taken for another week, and for no capture at all", async () => {
    expect((await weeklyProjectionsByPlayerId(db, 3)).size).toBe(0);
    await seedCapture(4, "2026-09-08T10:00:00.000Z", 9);
    expect((await weeklyProjectionsByPlayerId(db, 3)).size).toBe(0);
  });

  it("memoizes per week on the instance: the second read of a week issues no statement (finding 7)", async () => {
    await seedCapture(3, "2026-09-08T10:00:00.000Z", 11.1);
    await weeklyProjectionsByPlayerId(db, 3);
    const statements = await recordStatements(db, async (logged) => {
      expect((await weeklyProjectionsByPlayerId(logged, 3)).get("p1")).toBe(11.1);
      await weeklyProjectionsByPlayerId(logged, 4);
    });
    // Week 3 came from memory; week 4 is a different key and reads once.
    expect(statements).toHaveLength(1);
  });
});
