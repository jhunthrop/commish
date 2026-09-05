import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players } from "@/db/schema";
import { playerDirectoryFor } from "./present";
import type { SimSummary } from "./types";

const SUMMARY: SimSummary = {
  runs: 10,
  teamCount: 12,
  slot: 1,
  rounds: 2,
  baselineTop3Rate: 0.25,
  builds: [],
  availability: [
    { pickNumber: 1, round: 1, expectedBestAvailable: { playerId: "p1", position: "RB" }, survivalRate: 1, fallbacks: [{ playerId: "p2", position: "WR", runs: 1 }] },
  ],
  exposure: [{ playerId: "p3", position: "QB", rosterShare: 0.5 }],
  meanFinishRank: 5,
  elapsedMs: 10,
};

describe("playerDirectoryFor", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(players).values([
      { id: "p1", name: "Player One", position: "RB", nflTeam: "SF" },
      { id: "p2", name: "Player Two", position: "WR", nflTeam: "DAL" },
      { id: "p3", name: "Player Three", position: "QB", nflTeam: "MIA" },
      { id: "p4", name: "Unreferenced", position: "TE", nflTeam: "NYJ" },
    ]);
  });

  it("resolves every player id referenced by the summary, and nothing else", async () => {
    const directory = await playerDirectoryFor(db, SUMMARY);
    expect(Object.keys(directory).sort()).toEqual(["p1", "p2", "p3"]);
    expect(directory.p1).toEqual({ name: "Player One", team: "SF" });
  });

  it("returns an empty directory for a null summary", async () => {
    expect(await playerDirectoryFor(db, null)).toEqual({});
  });

  it("resolves every seat's own players for a bySlot (find-my-best-slot) summary", async () => {
    const directory = await playerDirectoryFor(db, { bySlot: [SUMMARY, { ...SUMMARY, slot: 2, exposure: [{ playerId: "p4", position: "TE", rosterShare: 1 }] }] });
    expect(Object.keys(directory).sort()).toEqual(["p1", "p2", "p3", "p4"]);
  });
});
