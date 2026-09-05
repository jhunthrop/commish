import { describe, expect, it } from "vitest";
import {
  careerAvailabilityRate,
  careerSeasonsOfRecord,
  gamesMissedInSeason,
  priorSeasonWorkloadShare,
  recentGamesMissed,
  type SeasonWorkload,
} from "./injury-history";
import type { SeasonAvailability } from "./availability";

function season(overrides: Partial<SeasonAvailability> = {}): SeasonAvailability {
  return { season: 2023, gamesPlayed: 17, teamGames: 17, ...overrides };
}

describe("gamesMissedInSeason", () => {
  it("is his team's games minus his own", () => {
    expect(gamesMissedInSeason([season({ season: 2023, gamesPlayed: 12, teamGames: 17 })], 2023)).toBe(5);
  });

  it("floors at zero rather than going negative on a data glitch", () => {
    expect(gamesMissedInSeason([season({ season: 2023, gamesPlayed: 18, teamGames: 17 })], 2023)).toBe(0);
  });

  it("is null where the history carries no record for that season at all", () => {
    expect(gamesMissedInSeason([season({ season: 2022 })], 2023)).toBeNull();
    expect(gamesMissedInSeason([], 2023)).toBeNull();
  });
});

describe("recentGamesMissed", () => {
  it("sums the two most recent prior seasons", () => {
    const history = [season({ season: 2022, gamesPlayed: 14, teamGames: 17 }), season({ season: 2023, gamesPlayed: 10, teamGames: 17 })];
    // For a 2024 season, prior seasons are 2023 (missed 7) and 2022 (missed 3): 10 combined.
    expect(recentGamesMissed(history, 2024)).toBe(10);
  });

  it("treats a missing season as zero missed rather than a full season lost", () => {
    // A second-year player: 2023 exists, 2022 does not (he was not in the league).
    const history = [season({ season: 2023, gamesPlayed: 15, teamGames: 17 })];
    expect(recentGamesMissed(history, 2024)).toBe(2);
  });

  it("is zero for a rookie with no history at all", () => {
    expect(recentGamesMissed([], 2024)).toBe(0);
  });
});

describe("careerAvailabilityRate", () => {
  it("is null with no history — a rookie has no career to be durable or fragile in", () => {
    expect(careerAvailabilityRate([])).toBeNull();
  });

  it("is games played over games his teams played, summed across every season carried", () => {
    const history = [
      season({ season: 2020, gamesPlayed: 16, teamGames: 16 }),
      season({ season: 2021, gamesPlayed: 10, teamGames: 17 }),
      season({ season: 2022, gamesPlayed: 17, teamGames: 17 }),
    ];
    expect(careerAvailabilityRate(history)).toBeCloseTo(43 / 50, 5);
  });

  it("looks past a three-season window when the history carries more than that — the whole point of a CAREER rate", () => {
    const longCareer = Array.from({ length: 8 }, (_, index) => season({ season: 2015 + index, gamesPlayed: 17, teamGames: 17 }));
    const oneBadRecentYear = [...longCareer, season({ season: 2023, gamesPlayed: 3, teamGames: 17 })];
    // A single recent lost season barely dents an eight-year clean record.
    expect(careerAvailabilityRate(oneBadRecentYear)).toBeGreaterThan(0.9);
  });

  it("clamps a games-played value above team games rather than exceeding one", () => {
    expect(careerAvailabilityRate([season({ gamesPlayed: 20, teamGames: 17 })])).toBe(1);
  });
});

describe("careerSeasonsOfRecord", () => {
  it("counts the seasons the history carries", () => {
    expect(careerSeasonsOfRecord([])).toBe(0);
    expect(careerSeasonsOfRecord([season(), season({ season: 2022 })])).toBe(2);
  });
});

describe("priorSeasonWorkloadShare", () => {
  function workload(overrides: Partial<SeasonWorkload> = {}): SeasonWorkload {
    return { season: 2023, snapShare: 0.7, ...overrides };
  }

  it("reads the immediately prior season's snap share", () => {
    expect(priorSeasonWorkloadShare([workload({ season: 2023, snapShare: 0.62 })], 2024)).toBeCloseTo(0.62, 5);
  });

  it("is null where the prior season carries no recorded share", () => {
    expect(priorSeasonWorkloadShare([workload({ season: 2021 })], 2024)).toBeNull();
    expect(priorSeasonWorkloadShare([], 2024)).toBeNull();
  });
});
