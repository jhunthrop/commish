import { describe, expect, it } from "vitest";
import { priorSeasonsFor, volatilityFor, START_WORTHY_POINTS } from "./career";
import { marketMovementFor } from "./market-movement";

describe("volatilityFor", () => {
  it("counts the weeks above the stated bar and names the worst one", () => {
    expect(volatilityFor(2025, [{ week: 1, points: 22 }, { week: 2, points: 4.5 }, { week: 3, points: 16 }])).toEqual({
      season: 2025,
      weeksPlayed: 3,
      weeksAboveThreshold: 2,
      threshold: START_WORTHY_POINTS,
      worstWeek: { week: 2, points: 4.5 },
    });
  });

  it("returns nothing for a season with no played week rather than zero of zero", () => {
    expect(volatilityFor(2025, [])).toBeNull();
  });

  it("names the earlier of two identically bad weeks, every run", () => {
    expect(volatilityFor(2025, [{ week: 9, points: 3 }, { week: 4, points: 3 }])!.worstWeek.week).toBe(4);
  });
});

describe("priorSeasonsFor", () => {
  it("lists the seasons the store holds, newest first, and skips the ones it does not", () => {
    expect(
      priorSeasonsFor([
        { season: 2024, points: 190, gamesPlayed: 14, positionRank: 11, qualifierCount: 60 },
        null,
        { season: 2025, points: 248, gamesPlayed: 15, positionRank: 4, qualifierCount: 62 },
      ]).map((season) => season.season),
    ).toEqual([2025, 2024]);
  });

  it("returns nothing for a player the store holds no season for", () => {
    expect(priorSeasonsFor([null, null])).toEqual([]);
  });
});

describe("marketMovementFor", () => {
  it("states both dated captures and the picks between them", () => {
    expect(
      marketMovementFor([
        { adp: 24, capturedAt: new Date("2026-08-08T00:00:00.000Z") },
        { adp: 13, capturedAt: new Date("2026-09-07T00:00:00.000Z") },
      ]),
    ).toEqual({ latestAdp: 13, latestAt: "2026-09-07", earlierAdp: 24, earlierAt: "2026-08-08", picks: 11 });
  });

  it("refuses a single capture, which is a price rather than a movement", () => {
    expect(marketMovementFor([{ adp: 13, capturedAt: new Date("2026-09-07T00:00:00.000Z") }])).toBeNull();
  });

  it("refuses two captures on one day, which the dated sentence could not tell apart", () => {
    expect(
      marketMovementFor([
        { adp: 14, capturedAt: new Date("2026-09-07T01:00:00.000Z") },
        { adp: 13, capturedAt: new Date("2026-09-07T20:00:00.000Z") },
      ]),
    ).toBeNull();
  });

  it("reads a fall down the board as a negative movement rather than flipping the sign", () => {
    expect(
      marketMovementFor([
        { adp: 13, capturedAt: new Date("2026-08-08T00:00:00.000Z") },
        { adp: 24.5, capturedAt: new Date("2026-09-07T00:00:00.000Z") },
      ])!.picks,
    ).toBe(-11.5);
  });
});
