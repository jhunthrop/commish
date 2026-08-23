import { describe, expect, it } from "vitest";
import { copyViolations } from "@/integrity/copy-rules";
import { LEAGUE_CONFIG } from "@/league";
import {
  HOUSE_CATALOG,
  HOUSE_RUNG_LABEL,
  MINUTES_PER_DAY,
  houseKickoffFor,
  houseLeagueName,
  plusMinutesIso,
  type HouseRungName,
} from "./house-catalog";
import { MATCHMAKING_CONFIG } from "./config";

const NOW = "2026-08-23T00:00:00.000Z";

function plusMinutes(iso: string, minutes: number): string {
  return plusMinutesIso(iso, minutes);
}

describe("HOUSE_CATALOG", () => {
  it("staggers each open league of a rung by the rung's own spacing", () => {
    const rung = HOUSE_CATALOG.rungs.open_12;
    expect(houseKickoffFor(NOW, rung, 0)).toBe(plusMinutes(NOW, rung.firstKickoffMinutes));
    expect(houseKickoffFor(NOW, rung, 2)).toBe(plusMinutes(NOW, rung.firstKickoffMinutes + 2 * rung.staggerMinutes));
  });

  it("keeps every staggered kickoff inside the window setDraftKickoff would accept", () => {
    const widest = Math.max(
      ...Object.values(HOUSE_CATALOG.rungs).map((rung) => rung.firstKickoffMinutes + (rung.openAtOnce - 1) * rung.staggerMinutes),
    );
    expect(widest).toBeLessThan(LEAGUE_CONFIG.defaults.maxDraftDaysAhead * MINUTES_PER_DAY);
  });

  it("gives a sit-and-go rung no scheduled time at all, because filling is its schedule", () => {
    expect(HOUSE_CATALOG.rungs.sitandgo_12.startTrigger).toBe("when_full");
  });

  it("declares every rung against a tier the enforcement gate actually recognizes", () => {
    for (const rung of Object.values(HOUSE_CATALOG.rungs)) {
      expect(MATCHMAKING_CONFIG.experienceTiers).toContain(rung.experienceTier);
    }
  });

  it("keeps every rung on one canonical format, which is the whole liquidity argument", () => {
    const shapes = Object.values(HOUSE_CATALOG.rungs).map((rung) => `${rung.format}:${rung.teamCount}:${rung.scoringPreset}:${rung.rosterShape}`);
    expect(new Set(shapes).size).toBe(1);
  });

  it("names every rung with a real, non-empty label", () => {
    for (const rung of Object.keys(HOUSE_CATALOG.rungs) as HouseRungName[]) {
      expect(HOUSE_RUNG_LABEL[rung].length).toBeGreaterThan(0);
    }
  });

  it("gives every rung a positive shelf width", () => {
    for (const rung of Object.values(HOUSE_CATALOG.rungs)) {
      expect(rung.openAtOnce).toBeGreaterThan(0);
    }
  });
});

describe("HOUSE_RUNG_LABEL copy sweep", () => {
  it("breaks none of the product's copy rules — no em/en dash, nothing accusatory or passive", () => {
    for (const label of Object.values(HOUSE_RUNG_LABEL)) {
      expect(copyViolations(label)).toEqual([]);
    }
  });
});

describe("houseLeagueName", () => {
  it("names a spawn from its rung's label and edition, so two editions never share a name", () => {
    expect(houseLeagueName("open_12", 1)).toBe("Open 12-team League 1");
    expect(houseLeagueName("open_12", 2)).toBe("Open 12-team League 2");
    expect(houseLeagueName("open_12", 1)).not.toBe(houseLeagueName("open_12", 2));
  });

  it("breaks none of the product's copy rules for any rung or a large edition number", () => {
    for (const rung of Object.keys(HOUSE_CATALOG.rungs) as HouseRungName[]) {
      expect(copyViolations(houseLeagueName(rung, 9999))).toEqual([]);
    }
  });
});

describe("plusMinutesIso", () => {
  it("moves an ISO instant forward by whole minutes", () => {
    expect(plusMinutesIso("2026-08-23T00:00:00.000Z", 90)).toBe("2026-08-23T01:30:00.000Z");
  });

  it("is a no-op at zero minutes", () => {
    expect(plusMinutesIso(NOW, 0)).toBe(NOW);
  });
});
