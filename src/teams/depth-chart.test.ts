import { describe, expect, it } from "vitest";
import { depthChartFor, harvestListingsFor } from "./depth-chart";

const AS_OF = new Date("2026-09-01T12:00:00.000Z");

describe("depthChartFor", () => {
  it("groups listings by offensive position in room order, slots ascending, capped at the configured depth", () => {
    const chart = depthChartFor(AS_OF, [
      { position: "WR", slot: 2, name: "Jameson Williams", playerId: "jw" },
      { position: "RB", slot: 1, name: "Jahmyr Gibbs", playerId: "jg" },
      { position: "WR", slot: 1, name: "Amon-Ra St. Brown", playerId: "asb" },
      { position: "QB", slot: 1, name: "Jared Goff", playerId: "goff" },
      { position: "WR", slot: 3, name: "Isaac TeSlaa", playerId: null },
      { position: "WR", slot: 4, name: "Kalif Raymond", playerId: null },
      { position: "WR", slot: 5, name: "Dominic Lovett", playerId: null },
      { position: "DEF", slot: 1, name: "Aidan Hutchinson", playerId: null },
    ]);
    expect(chart?.asOf).toBe("2026-09-01");
    expect(chart?.groups.map((group) => group.position)).toEqual(["QB", "RB", "WR"]);
    expect(chart?.groups[2]?.slots.map((slot) => slot.name)).toEqual(["Amon-Ra St. Brown", "Jameson Williams", "Isaac TeSlaa", "Kalif Raymond"]);
  });

  it("is null with no offensive listing at all", () => {
    expect(depthChartFor(AS_OF, [])).toBeNull();
    expect(depthChartFor(AS_OF, [{ position: "DEF", slot: 1, name: "x", playerId: null }])).toBeNull();
  });
});

describe("harvestListingsFor", () => {
  const payload = [
    { teamAbv: "ARI", depthChart: { RB: [{ longName: "James Conner", playerID: "1", depthPosition: "RB1" }] } },
    {
      teamAbv: "DET",
      depthChart: {
        RB: [
          { longName: "Jahmyr Gibbs", playerID: "4429795", depthPosition: "RB1" },
          { longName: "Isiah Pacheco", playerID: "4361529", depthPosition: "RB2" },
        ],
        PK: [{ longName: "Jake Bates", playerID: "4689936", depthPosition: "PK1" }],
        DB: [{ longName: "Kerby Joseph", playerID: "9", depthPosition: "DB1" }],
        WR: [{ longName: "", playerID: "0", depthPosition: "WR1" }, { longName: "No Slot", playerID: "0", depthPosition: "WR" }],
      },
    },
  ];

  it("reads one club's offensive groups, folding the feed's PK onto K and skipping unreadable entries", () => {
    expect(harvestListingsFor(payload, "DET")).toEqual([
      { position: "RB", slot: 1, name: "Jahmyr Gibbs", playerId: "4429795" },
      { position: "RB", slot: 2, name: "Isiah Pacheco", playerId: "4361529" },
      { position: "K", slot: 1, name: "Jake Bates", playerId: "4689936" },
    ]);
  });

  it("yields nothing for a club the payload does not carry or a payload of another shape", () => {
    expect(harvestListingsFor(payload, "ZZZ")).toEqual([]);
    expect(harvestListingsFor({ not: "an array" }, "DET")).toEqual([]);
    expect(harvestListingsFor(null, "DET")).toEqual([]);
  });
});
