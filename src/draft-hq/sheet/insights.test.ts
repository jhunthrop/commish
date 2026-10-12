import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research/db/client";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { nflGames } from "@research/db/schema";
import { LEAGUE_CONFIG } from "@/league/config";
import { byeStackWarning } from "./insights";

describe("byeStackWarning", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  afterEach(async () => {
    await truncateAll(db);
  });

  /** SF, DAL and MIA sit out `byeWeek`; NYG and OTH1 play every week — a real, honestly-derived
   *  bye per `byeWeeksByTeam`'s own "exactly one missing week" rule. */
  async function seedSchedule(byeWeek: number): Promise<void> {
    for (let week = 1; week <= LEAGUE_CONFIG.regularSeasonWeeks; week += 1) {
      if (week === byeWeek) {
        await db.insert(nflGames).values({ gameId: `g-${week}-a`, week, homeNflTeam: "NYG", awayNflTeam: "OTH1", status: "final" });
        continue;
      }
      await db.insert(nflGames).values([
        { gameId: `g-${week}-a`, week, homeNflTeam: "SF", awayNflTeam: "DAL", status: "final" },
        { gameId: `g-${week}-b`, week, homeNflTeam: "MIA", awayNflTeam: "NYG", status: "final" },
      ]);
    }
  }

  it("flags three or more of the sheet's own top entries sharing a bye week", async () => {
    await seedSchedule(9);
    const entries = [
      { playerId: "p1", team: "SF" },
      { playerId: "p2", team: "DAL" },
      { playerId: "p3", team: "MIA" },
      { playerId: "p4", team: "NYG" },
    ];
    const warning = await byeStackWarning(db, entries);
    expect(warning).toEqual({ week: 9, count: 3, playerIds: ["p1", "p2", "p3"] });
  });

  it("stays quiet under the three-player threshold", async () => {
    await seedSchedule(9);
    const entries = [
      { playerId: "p1", team: "SF" },
      { playerId: "p2", team: "DAL" },
    ];
    expect(await byeStackWarning(db, entries)).toBeNull();
  });

  it("only looks at the top N entries, never the whole sheet", async () => {
    await seedSchedule(9);
    const entries = [
      { playerId: "p1", team: "NYG" },
      { playerId: "p2", team: "NYG" },
      { playerId: "p3", team: "SF" },
      { playerId: "p4", team: "DAL" },
      { playerId: "p5", team: "MIA" },
    ];
    expect(await byeStackWarning(db, entries, 2)).toBeNull();
  });
});
