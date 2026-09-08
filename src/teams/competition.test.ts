import { describe, expect, it } from "vitest";
import { competitionFor } from "./competition";

const names = new Map([
  ["asb", "Amon-Ra St. Brown"],
  ["lap", "Sam LaPorta"],
  ["gib", "Jahmyr Gibbs"],
  ["mont", "David Montgomery"],
]);

const rows = [
  { playerId: "asb", metric: "pbp_targets", value: 90 },
  { playerId: "asb", metric: "pbp_targets", value: 60 },
  { playerId: "lap", metric: "pbp_targets", value: 100 },
  { playerId: "gib", metric: "pbp_targets", value: 50 },
  { playerId: "gib", metric: "pbp_carries", value: 250 },
  { playerId: "mont", metric: "pbp_carries", value: 150 },
  { playerId: "gib", metric: "red_zone_carries", value: 30 },
  { playerId: "gib", metric: "red_zone_targets", value: 11 },
  { playerId: "mont", metric: "red_zone_carries", value: 33 },
  { playerId: "asb", metric: "red_zone_targets", value: 19 },
  { playerId: "lap", metric: "inside_ten_targets", value: 4 },
];

describe("competitionFor", () => {
  it("shares each leader's count against the club's own attributed total, most first", () => {
    const competition = competitionFor(2025, rows, names)!;
    expect(competition.season).toBe(2025);
    expect(competition.targets).toEqual([
      { playerId: "asb", name: "Amon-Ra St. Brown", count: 150, share: 0.5 },
      { playerId: "lap", name: "Sam LaPorta", count: 100, share: 0.3333 },
      { playerId: "gib", name: "Jahmyr Gibbs", count: 50, share: 0.1667 },
    ]);
    expect(competition.carries).toEqual([
      { playerId: "gib", name: "Jahmyr Gibbs", count: 250, share: 0.625 },
      { playerId: "mont", name: "David Montgomery", count: 150, share: 0.375 },
    ]);
  });

  it("counts red-zone touches as carries plus targets, and ignores the inside-ten metrics", () => {
    const competition = competitionFor(2025, rows, names)!;
    expect(competition.redZoneTouches).toEqual([
      { playerId: "gib", name: "Jahmyr Gibbs", count: 41 },
      { playerId: "mont", name: "David Montgomery", count: 33 },
      { playerId: "asb", name: "Amon-Ra St. Brown", count: 19 },
    ]);
  });

  it("caps each column at the configured number of leaders", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ playerId: `p${index}`, metric: "pbp_targets", value: 10 + index }));
    expect(competitionFor(2025, many, new Map())!.targets).toHaveLength(5);
  });

  it("falls back to the id for a name the universe does not hold, and is null for no touches", () => {
    expect(competitionFor(2025, [{ playerId: "ghost", metric: "pbp_carries", value: 3 }], new Map())!.carries[0]!.name).toBe("ghost");
    expect(competitionFor(2025, [], names)).toBeNull();
    expect(competitionFor(2025, [{ playerId: "asb", metric: "air_yards", value: 900 }], names)).toBeNull();
  });
});
