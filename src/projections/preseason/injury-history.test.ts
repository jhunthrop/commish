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
  return { season: 2023, gamesPlayed: 17, teamGames: 17, gamesUnavailable: 0, gamesSuspended: 0, ...overrides };
}

describe("gamesMissedInSeason", () => {
  it("is the games the store says he was unavailable for, never his team's games minus his own", () => {
    // Eleven played, six healthy did-not-play weeks, none unavailable: a backup, not an absence.
    expect(gamesMissedInSeason([season({ season: 2023, gamesPlayed: 11, teamGames: 17, gamesUnavailable: 0 })], 2023)).toBe(0);
    expect(gamesMissedInSeason([season({ season: 2023, gamesPlayed: 12, teamGames: 17, gamesUnavailable: 5 })], 2023)).toBe(5);
  });

  it("caps at his team's games rather than reporting more absences than there were weeks", () => {
    expect(gamesMissedInSeason([season({ season: 2023, gamesPlayed: 0, teamGames: 17, gamesUnavailable: 18 })], 2023)).toBe(17);
  });

  it("is null where the history carries no record for that season at all", () => {
    expect(gamesMissedInSeason([season({ season: 2022 })], 2023)).toBeNull();
    expect(gamesMissedInSeason([], 2023)).toBeNull();
  });

  it("is null where the designation stores do not cover the season: silence, never a clean season", () => {
    expect(gamesMissedInSeason([season({ season: 2023, gamesPlayed: 11, gamesUnavailable: null })], 2023)).toBeNull();
  });
});

describe("recentGamesMissed", () => {
  it("sums the two most recent prior seasons", () => {
    const history = [
      season({ season: 2022, gamesPlayed: 14, teamGames: 17, gamesUnavailable: 3 }),
      season({ season: 2023, gamesPlayed: 10, teamGames: 17, gamesUnavailable: 7 }),
    ];
    // For a 2024 season, prior seasons are 2023 (missed 7) and 2022 (missed 3): 10 combined.
    expect(recentGamesMissed(history, 2024)).toBe(10);
  });

  it("treats a missing or uncovered season as zero missed rather than a full season lost", () => {
    // A second-year player: 2023 exists, 2022 does not (he was not in the league).
    const history = [season({ season: 2023, gamesPlayed: 15, teamGames: 17, gamesUnavailable: 2 })];
    expect(recentGamesMissed(history, 2024)).toBe(2);
    expect(recentGamesMissed([...history, season({ season: 2022, gamesPlayed: 9, gamesUnavailable: null })], 2024)).toBe(2);
  });

  it("is zero for a rookie with no history at all", () => {
    expect(recentGamesMissed([], 2024)).toBe(0);
  });
});

describe("careerAvailabilityRate", () => {
  it("is null with no history, or with no season the designation stores cover", () => {
    expect(careerAvailabilityRate([])).toBeNull();
    expect(careerAvailabilityRate([season({ gamesUnavailable: null })])).toBeNull();
  });

  it("is games available over games his teams played, summed across every covered season", () => {
    const history = [
      season({ season: 2020, gamesPlayed: 16, teamGames: 16, gamesUnavailable: 0 }),
      season({ season: 2021, gamesPlayed: 10, teamGames: 17, gamesUnavailable: 7 }),
      season({ season: 2022, gamesPlayed: 17, teamGames: 17, gamesUnavailable: 0 }),
    ];
    expect(careerAvailabilityRate(history)).toBeCloseTo(43 / 50, 5);
  });

  it("counts a healthy did-not-play week as available: a backup's career is not a fragile one", () => {
    expect(careerAvailabilityRate([season({ gamesPlayed: 3, teamGames: 17, gamesUnavailable: 0 })])).toBe(1);
  });

  it("skips an uncovered season rather than reading it either way", () => {
    const history = [
      season({ season: 2021, gamesPlayed: 9, gamesUnavailable: null }),
      season({ season: 2022, gamesPlayed: 12, teamGames: 17, gamesUnavailable: 5 }),
    ];
    expect(careerAvailabilityRate(history)).toBeCloseTo(12 / 17, 5);
  });

  it("looks past a three-season window when the history carries more than that, the whole point of a CAREER rate", () => {
    const longCareer = Array.from({ length: 8 }, (_, index) => season({ season: 2015 + index, gamesPlayed: 17, teamGames: 17, gamesUnavailable: 0 }));
    const oneBadRecentYear = [...longCareer, season({ season: 2023, gamesPlayed: 3, teamGames: 17, gamesUnavailable: 14 })];
    // A single recent lost season barely dents an eight-year clean record.
    expect(careerAvailabilityRate(oneBadRecentYear)).toBeGreaterThan(0.9);
  });

  it("clamps an unavailable count above team games rather than going negative", () => {
    expect(careerAvailabilityRate([season({ gamesPlayed: 0, teamGames: 17, gamesUnavailable: 20 })])).toBe(0);
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
