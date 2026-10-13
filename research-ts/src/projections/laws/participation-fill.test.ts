import { describe, expect, it } from "vitest";
import { PBP_PLAYER_METRICS, PBP_PLAYER_SOURCE } from "../nflverse/pbp-players";
import type { PlayerWeekObservation } from "../store";
import { fillFromPlayByPlay, targetShareOf } from "./populations";

/**
 * THE GAP-SEASON TARGET-SHARE DENOMINATOR (dossier-voice round, §3.1) — a pure fixture over
 * `fillFromPlayByPlay`, deliberately not a database round trip: the property under test is
 * arithmetic ("three receivers on one team, shares that sum to one"), and a seeded store would
 * only put six inserts between the reader and it.
 */

const SEASON = 2025;
const AS_OF = new Date("2026-01-01T00:00:00.000Z");

function row(playerId: string, week: number, metric: string, value: number): PlayerWeekObservation {
  return { season: SEASON, week, playerId, source: PBP_PLAYER_SOURCE, metric, value, asOf: AS_OF };
}

function targets(playerId: string, week: number, value: number): PlayerWeekObservation {
  return row(playerId, week, PBP_PLAYER_METRICS.targets, value);
}

function teams(entries: readonly (readonly [string, number, string])[]): ReadonlyMap<string, string> {
  return new Map(entries.map(([playerId, week, team]) => [`${playerId}|${week}`, team] as const));
}

describe("fillFromPlayByPlay", () => {
  it("gives three receivers on one team their own share, and the three sum to one", () => {
    const rows = [
      targets("wr1", 1, 10),
      targets("wr2", 1, 6),
      targets("wr3", 1, 4),
      targets("wr1", 2, 8),
      targets("wr2", 2, 8),
      targets("wr3", 2, 4),
    ];
    const teamEdges = teams([
      ["wr1", 1, "SF"], ["wr2", 1, "SF"], ["wr3", 1, "SF"],
      ["wr1", 2, "SF"], ["wr2", 2, "SF"], ["wr3", 2, "SF"],
    ]);

    const filled = fillFromPlayByPlay(new Map(), rows, teamEdges);

    expect(targetShareOf(filled.get("wr1"))).toBeCloseTo(18 / 40, 10);
    expect(targetShareOf(filled.get("wr2"))).toBeCloseTo(14 / 40, 10);
    expect(targetShareOf(filled.get("wr3"))).toBeCloseTo(8 / 40, 10);
    const total = ["wr1", "wr2", "wr3"].reduce((sum, id) => sum + (targetShareOf(filled.get(id)) ?? 0), 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("counts a traded player against each week's own team", () => {
    const rows = [targets("mover", 1, 5), targets("holdover", 1, 5), targets("mover", 2, 3), targets("newmate", 2, 9)];
    const teamEdges = teams([
      ["mover", 1, "SF"], ["holdover", 1, "SF"],
      ["mover", 2, "NYG"], ["newmate", 2, "NYG"],
    ]);

    const filled = fillFromPlayByPlay(new Map(), rows, teamEdges);

    // 8 of his own targets over 10 (SF, week 1) plus 12 (NYG, week 2).
    expect(targetShareOf(filled.get("mover"))).toBeCloseTo(8 / 22, 10);
  });

  it("leaves a week with no team edge out of both the numerator and the denominator", () => {
    const rows = [targets("wr1", 1, 4), targets("wr2", 1, 6), targets("wr1", 2, 100)];
    const teamEdges = teams([["wr1", 1, "SF"], ["wr2", 1, "SF"]]);

    const filled = fillFromPlayByPlay(new Map(), rows, teamEdges);

    expect(filled.get("wr1")).toEqual({ targets: 4, teamTargets: 10, carries: 0 });
    expect(targetShareOf(filled.get("wr1"))).toBeCloseTo(0.4, 10);
  });

  it("returns no share, and never a divide, when a team-week recorded no targets", () => {
    const rows = [targets("wr1", 1, 0), row("rb1", 1, PBP_PLAYER_METRICS.carries, 12)];
    const teamEdges = teams([["wr1", 1, "SF"], ["rb1", 1, "SF"]]);

    const filled = fillFromPlayByPlay(new Map(), rows, teamEdges);

    expect(targetShareOf(filled.get("wr1"))).toBeNull();
    expect(filled.get("rb1")).toEqual({ targets: 0, teamTargets: 0, carries: 12 });
  });

  it("never substitutes for a player the published feed already placed", () => {
    const published = new Map([["wr1", { targets: 90, teamTargets: 500, carries: 2 }]]);
    const rows = [targets("wr1", 1, 7), targets("wr2", 1, 3)];
    const teamEdges = teams([["wr1", 1, "SF"], ["wr2", 1, "SF"]]);

    const filled = fillFromPlayByPlay(published, rows, teamEdges);

    expect(filled.get("wr1")).toEqual({ targets: 90, teamTargets: 500, carries: 2 });
    // wr1's own targets still count toward his team's denominator: the team total is a fact about
    // the team, not about which players the published feed happened to place.
    expect(filled.get("wr2")).toEqual({ targets: 3, teamTargets: 10, carries: 0 });
  });
});
