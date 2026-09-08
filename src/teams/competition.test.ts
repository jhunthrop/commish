import { describe, expect, it } from "vitest";
import { competitionFor, type LeaderIdentity } from "./competition";

const identity: LeaderIdentity = {
  names: new Map([
    ["asb", "Amon-Ra St. Brown"],
    ["lap", "Sam LaPorta"],
    ["gib", "Jahmyr Gibbs"],
    ["mont", "David Montgomery"],
  ]),
  // Montgomery is deliberately NOT crosswalked: his name must render as plain text.
  productIds: new Map([
    ["asb", "4374302"],
    ["lap", "4430027"],
    ["gib", "4429795"],
  ]),
};

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
  it("shares each leader's count against the club's own attributed total, most first, carrying both ids", () => {
    const competition = competitionFor(2025, rows, identity)!;
    expect(competition.season).toBe(2025);
    expect(competition.targets).toEqual([
      { nflPlayerId: "asb", playerId: "4374302", name: "Amon-Ra St. Brown", count: 150, share: 0.5 },
      { nflPlayerId: "lap", playerId: "4430027", name: "Sam LaPorta", count: 100, share: 0.3333 },
      { nflPlayerId: "gib", playerId: "4429795", name: "Jahmyr Gibbs", count: 50, share: 0.1667 },
    ]);
    expect(competition.carries).toEqual([
      { nflPlayerId: "gib", playerId: "4429795", name: "Jahmyr Gibbs", count: 250, share: 0.625 },
      { nflPlayerId: "mont", playerId: null, name: "David Montgomery", count: 150, share: 0.375 },
    ]);
  });

  it("counts red-zone touches as carries plus targets, and ignores the inside-ten metrics", () => {
    const competition = competitionFor(2025, rows, identity)!;
    expect(competition.redZoneTouches.map((row) => [row.name, row.count, row.playerId])).toEqual([
      ["Jahmyr Gibbs", 41, "4429795"],
      ["David Montgomery", 33, null],
      ["Amon-Ra St. Brown", 19, "4374302"],
    ]);
  });

  it("caps each column at the configured number of leaders", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ playerId: `p${index}`, metric: "pbp_targets", value: 10 + index }));
    expect(competitionFor(2025, many, { names: new Map(), productIds: new Map() })!.targets).toHaveLength(5);
  });

  it("falls back to the id for a name the universe does not hold, and is null for no touches", () => {
    const empty: LeaderIdentity = { names: new Map(), productIds: new Map() };
    expect(competitionFor(2025, [{ playerId: "ghost", metric: "pbp_carries", value: 3 }], empty)!.carries[0]).toMatchObject({ name: "ghost", playerId: null });
    expect(competitionFor(2025, [], identity)).toBeNull();
    expect(competitionFor(2025, [{ playerId: "asb", metric: "air_yards", value: 900 }], identity)).toBeNull();
  });
});
