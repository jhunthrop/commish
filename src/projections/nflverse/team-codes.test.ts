import { describe, expect, it } from "vitest";
import { NFL_TEAM_ABBREVIATIONS } from "@/projections/capture-feeds";
import { nflTeamsBySeason } from "./team-eras";
import {
  TEAM_DEFENSE_UNIVERSE_PREFIX,
  productTeamCode,
  sourceTeamCode,
  teamDefenseUniverseId,
  teamDefenseUniverseIdForProviderId,
  teamDefenseUniverseIds,
} from "./team-codes";

describe("team codes", () => {
  it("translates the only two clubs the two feeds spell differently", () => {
    expect(sourceTeamCode("LAR")).toBe("LA");
    expect(sourceTeamCode("WSH")).toBe("WAS");
    expect(productTeamCode("LA")).toBe("LAR");
    expect(productTeamCode("WAS")).toBe("WSH");
  });

  it("is the identity for the other thirty", () => {
    for (const code of NFL_TEAM_ABBREVIATIONS) {
      if (code === "LAR" || code === "WSH") continue;
      expect(sourceTeamCode(code)).toBe(code);
      expect(productTeamCode(code)).toBe(code);
    }
  });

  it("round trips every product code through the source spelling", () => {
    for (const code of NFL_TEAM_ABBREVIATIONS) {
      expect(productTeamCode(sourceTeamCode(code))).toBe(code);
    }
  });

  it("maps the three historical spellings onto the franchise's current product code", () => {
    expect(productTeamCode("STL")).toBe("LAR");
    expect(productTeamCode("SD")).toBe("LAC");
    expect(productTeamCode("OAK")).toBe("LV");
  });

  it("covers every code the source itself used in the ingested span", () => {
    for (let season = 2013; season <= 2025; season += 1) {
      for (const code of nflTeamsBySeason(season)) {
        expect(() => productTeamCode(code)).not.toThrow();
      }
    }
  });

  it("refuses an unknown code on both sides rather than passing it through", () => {
    expect(() => sourceTeamCode("XXX")).toThrow(/XXX/);
    expect(() => productTeamCode("XXX")).toThrow(/XXX/);
  });

  it("mints one synthetic universe id per source code and parses the provider id back", () => {
    expect(teamDefenseUniverseId("LA")).toBe(`${TEAM_DEFENSE_UNIVERSE_PREFIX}LA`);
    expect(teamDefenseUniverseIdForProviderId("DST-LAR")).toBe(`${TEAM_DEFENSE_UNIVERSE_PREFIX}LA`);
    expect(teamDefenseUniverseIdForProviderId("DST-WSH")).toBe(`${TEAM_DEFENSE_UNIVERSE_PREFIX}WAS`);
    expect(teamDefenseUniverseIdForProviderId("DST-XXX")).toBeNull();
    expect(teamDefenseUniverseIdForProviderId("4362628")).toBeNull();
  });

  it("holds exactly thirty two synthetic universe ids, all distinct", () => {
    const ids = teamDefenseUniverseIds();
    expect(ids).toHaveLength(32);
    expect(new Set(ids).size).toBe(32);
  });
});
