import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { ADVISOR_CONFIG } from "@/domain/advisor";
import { assembleAdvisorContext, valuePlayers } from "./context";
import { advisorFixture } from "@/league-service/test-support";

const db: Db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

describe("assembleAdvisorContext", () => {
  it("carries the league's own name, week, scoring settings and both rosters", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 4 });

    expect(context).not.toBeNull();
    if (context === null) return;
    expect(context.leagueName).toBe("Sunday Money");
    expect(context.weekNumber).toBe(4);
    expect(context.scoring.pointsPerReception).toBe(1);
    expect(context.me.teamName).toBe("Bay Bandits");
    expect(context.me.players.map((p) => p.playerId).sort()).toEqual(["rb_bell", "rb_change", "wr_deep", "wr_volume"]);
    expect(context.opponent?.teamName).toBe("Iron Owls");
  });

  it("bounds recent form to ADVISOR_CONFIG.trendWeeks — no unbounded stat read", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 4 });
    for (const player of context!.me.players) {
      expect(player.recentPoints.length).toBeLessThanOrEqual(ADVISOR_CONFIG.trendWeeks);
    }
  });

  it("values the SAME roster differently under PPR and standard scoring", async () => {
    const ppr = await advisorFixture(db, "ppr", "_ppr");
    const pprContext = await assembleAdvisorContext(db, { ...ppr, weekNumber: 4 });
    const standard = await advisorFixture(db, "standard", "_std");
    const standardContext = await assembleAdvisorContext(db, { ...standard, weekNumber: 4 });

    const volumeInPpr = pprContext!.me.players.find((p) => p.playerId === "wr_volume")!;
    const volumeInStandard = standardContext!.me.players.find((p) => p.playerId === "wr_volume")!;
    // 10 catches a week is ten points a week of difference, and nothing else changed.
    expect(volumeInPpr.averagePoints - volumeInStandard.averagePoints).toBe(10);

    // And the ORDER flips: the volume receiver outscores the deep threat only under PPR.
    const deepInPpr = pprContext!.me.players.find((p) => p.playerId === "wr_deep")!;
    const deepInStandard = standardContext!.me.players.find((p) => p.playerId === "wr_deep")!;
    expect(volumeInPpr.averagePoints).toBeGreaterThan(deepInPpr.averagePoints);
    expect(volumeInStandard.averagePoints).toBeLessThan(deepInStandard.averagePoints);
  });

  it("marks who is currently starting, straight off the stored lineup", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 4 });
    const starting = context!.me.players.filter((p) => p.starting).map((p) => p.playerId).sort();
    expect(starting).toEqual(["rb_bell", "wr_deep"]);
  });

  it("returns a context with no opponent for a week with no matchup", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 99 });
    expect(context?.opponent).toBeNull();
  });

  it("returns null for a league that doesn't exist", async () => {
    expect(await assembleAdvisorContext(db, { leagueId: "nope", teamId: "nope", weekNumber: 1 })).toBeNull();
  });
});

describe("valuePlayers", () => {
  it("picks out named players with their per-week value, ignoring ids the team doesn't have", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 4 });
    const valued = valuePlayers(context!.me, ["rb_bell", "not_on_this_team"]);
    expect(valued.map((p) => p.playerId)).toEqual(["rb_bell"]);
    expect(valued[0]?.averagePoints).toBeGreaterThan(0);
  });
});
