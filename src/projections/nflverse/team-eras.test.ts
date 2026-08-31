import { describe, expect, it } from "vitest";
import { FACT_SEASONS, finalWeekOf, nflTeamsBySeason } from "./team-eras";

describe("FACT_SEASONS", () => {
  it("covers 1999 through 2026 inclusive", () => {
    expect(FACT_SEASONS[0]).toBe(1999);
    expect(FACT_SEASONS[FACT_SEASONS.length - 1]).toBe(2026);
    expect(FACT_SEASONS.length).toBe(28);
  });
});

describe("nflTeamsBySeason", () => {
  it("fields 31 teams before the Texans existed, 1999 through 2001", () => {
    for (const season of [1999, 2000, 2001]) {
      expect(nflTeamsBySeason(season)).toHaveLength(31);
      expect(nflTeamsBySeason(season)).not.toContain("HOU");
    }
  });

  it("fields 32 teams from 2002, the Texans' first season", () => {
    expect(nflTeamsBySeason(2002)).toHaveLength(32);
    expect(nflTeamsBySeason(2002)).toContain("HOU");
  });

  it("spells the Raiders OAK through 2019, LV from 2020", () => {
    expect(nflTeamsBySeason(2019)).toContain("OAK");
    expect(nflTeamsBySeason(2019)).not.toContain("LV");
    expect(nflTeamsBySeason(2020)).toContain("LV");
    expect(nflTeamsBySeason(2020)).not.toContain("OAK");
  });

  it("spells the Chargers SD through 2016, LAC from 2017", () => {
    expect(nflTeamsBySeason(2016)).toContain("SD");
    expect(nflTeamsBySeason(2016)).not.toContain("LAC");
    expect(nflTeamsBySeason(2017)).toContain("LAC");
    expect(nflTeamsBySeason(2017)).not.toContain("SD");
  });

  it("spells the Rams STL through 2015, LA from 2016", () => {
    expect(nflTeamsBySeason(2015)).toContain("STL");
    expect(nflTeamsBySeason(2015)).not.toContain("LA");
    expect(nflTeamsBySeason(2016)).toContain("LA");
    expect(nflTeamsBySeason(2016)).not.toContain("STL");
  });

  it("always fields 32 teams from 2002 onward, whatever the current relocation mix", () => {
    for (const season of [2002, 2010, 2016, 2017, 2020, 2026]) {
      expect(nflTeamsBySeason(season)).toHaveLength(32);
    }
  });
});

describe("finalWeekOf", () => {
  it("is 17 through 2020", () => {
    expect(finalWeekOf(2020)).toBe(17);
    expect(finalWeekOf(1999)).toBe(17);
  });

  it("is 18 from 2021", () => {
    expect(finalWeekOf(2021)).toBe(18);
    expect(finalWeekOf(2026)).toBe(18);
  });
});
