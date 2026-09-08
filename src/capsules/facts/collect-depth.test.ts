import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { nflGames, nflPlayers, nflverseInjuries, nflverseRosterWeeks, preseasonRosters } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { collectDepthFacts, depthPriorSeasons } from "./collect-depth";
import { EMPTY_DEPTH } from "./types";

const PRIOR_SEASON = PRODUCT_SEASON - 1;
const ASOF = new Date("2026-09-07T00:00:00.000Z");

function options(teamByPlayerId: ReadonlyMap<string, string>) {
  return {
    productSeason: PRODUCT_SEASON,
    priorSeasons: depthPriorSeasons(PRODUCT_SEASON),
    positions: new Map([["00-0000001", "RB" as const]]),
    teamByPlayerId,
    asOf: ASOF,
  };
}

describe("collectDepthFacts", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(nflPlayers).values({ id: "00-0000001", name: "Rashad Long", position: "RB", rookieSeason: 2023 });
  });

  it("returns nothing at all for a caller with no subjects", async () => {
    expect((await collectDepthFacts(db, options(new Map()))).byPlayerId.size).toBe(0);
  });

  it("leaves every group absent for a player the depth stores hold no row for, except the curated coaching table", async () => {
    const pass = await collectDepthFacts(db, options(new Map([["00-0000001", "SF"]])));
    const depth = pass.byPlayerId.get("00-0000001")!;
    expect({ ...depth, coaching: null, pedigree: null }).toEqual(EMPTY_DEPTH);
    // The play-caller table ships in the repo, so it answers for every team without a database row.
    expect(depth.coaching).toMatchObject({ season: PRODUCT_SEASON, headCoach: "Kyle Shanahan" });
    // `nfl_players.rookie_season` alone is a real pedigree row, and the rest stays absent.
    expect(depth.pedigree).toMatchObject({ seasonsPlayed: PRODUCT_SEASON - 2023, ageOnOpeningDay: null, draftPick: null });
  });

  it("derives a season-ending absence and a games-missed count from the archived weeks", async () => {
    await db.insert(nflverseInjuries).values([{ season: PRIOR_SEASON, week: 5, playerId: "00-0000001", reportStatus: "Out", primaryInjury: "Knee", practiceStatus: "" }]);
    await db.insert(nflverseRosterWeeks).values(
      [1, 2, 3, 4, 5, 6].map((week) => ({ season: PRIOR_SEASON, week, playerId: "00-0000001", team: "SF", status: "RES", position: "RB" })),
    );

    const depth = (await collectDepthFacts(db, options(new Map([["00-0000001", "SF"]])))).byPlayerId.get("00-0000001")!;
    // The stat store holds no played week for him, so his last played week is zero and week 1 is
    // the first he missed. The injury report's own row sits at week 5 and cannot anchor week 1, so
    // the roster status answers instead and brings no body part with it.
    expect(depth.seasonEndings).toEqual([
      { season: PRIOR_SEASON, lastPlayedWeek: 0, firstMissedWeek: 1, source: "status", reportStatus: null, rosterStatus: "RES", primaryInjury: null },
    ]);
    expect(depth.gamesMissed).toEqual([{ season: PRIOR_SEASON, missed: 6, teamGames: 17 }]);
  });

  it("reads the published schedule and the roster archive's own pedigree", async () => {
    await db.insert(nflGames).values([
      { gameId: "g1", week: 1, homeNflTeam: "SF", awayNflTeam: "SEA", status: "scheduled" },
      { gameId: "g2", week: 15, homeNflTeam: "LA", awayNflTeam: "SF", status: "scheduled" },
    ]);
    await db.insert(preseasonRosters).values({
      season: PRODUCT_SEASON,
      team: "SF",
      playerId: "00-0000001",
      position: "RB",
      status: "active",
      birthDate: "2001-07-15",
      draftYear: 2023,
      draftPick: 22,
      draftClub: "NYG",
      asOf: new Date("2026-08-26T00:00:00.000Z"),
    });

    const depth = (await collectDepthFacts(db, options(new Map([["00-0000001", "SF"]])))).byPlayerId.get("00-0000001")!;
    expect(depth.schedule).toEqual({
      weekOneOpponent: { week: 1, opponent: "SEA", home: true },
      homeGames: 1,
      roadGames: 1,
      indoorGames: null,
      playoffWeeks: [{ week: 15, opponent: "LA", home: false }],
    });
    expect(depth.pedigree).toMatchObject({ draftYear: 2023, draftPick: 22, draftClub: "NYG", undrafted: false, ageOnOpeningDay: null });
  });
});
