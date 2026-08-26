import { describe, expect, it } from "vitest";
import { copyViolations } from "@/integrity/copy-rules";
import { prizeTableInvariant } from "@/money/prize-table";
import { LEAGUE_CONFIG } from "@/league/config";
import {
  HOUSE_CATALOG,
  HOUSE_RUNG_LABEL,
  MINUTES_PER_DAY,
  houseKickoffFor,
  houseLeagueName,
  plusMinutesIso,
  type HouseRung,
  type HouseRungName,
} from "./house-catalog";
import { MATCHMAKING_CONFIG } from "./config";

const NOW = "2026-08-23T00:00:00.000Z";

function plusMinutes(iso: string, minutes: number): string {
  return plusMinutesIso(iso, minutes);
}

describe("HOUSE_CATALOG", () => {
  // Founder directive 2026-08-26: the whole shelf is sit-and-go now — every rung drafts the
  // moment its last seat fills, never at a chosen clock time.
  it("makes every rung when_full — there is no scheduled-trigger house rung left", () => {
    for (const rung of Object.values(HOUSE_CATALOG.rungs)) {
      expect(rung.startTrigger).toBe("when_full");
    }
  });

  it("drops the shelf's total width to exactly two, one open_12 and one beginner_12 apiece", () => {
    const total = Object.values(HOUSE_CATALOG.rungs).reduce((sum, rung) => sum + rung.openAtOnce, 0);
    expect(total).toBe(2);
    expect(HOUSE_CATALOG.rungs.open_12.openAtOnce).toBe(1);
    expect(HOUSE_CATALOG.rungs.beginner_12.openAtOnce).toBe(1);
  });

  it("retires sitandgo_12 to zero width, without dropping the key or its label", () => {
    expect(HOUSE_CATALOG.rungs.sitandgo_12.openAtOnce).toBe(0);
    expect(HOUSE_CATALOG.rungs.sitandgo_12.startTrigger).toBe("when_full");
    expect(HOUSE_RUNG_LABEL.sitandgo_12.length).toBeGreaterThan(0);
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
});

describe("HOUSE_RUNG_LABEL copy sweep", () => {
  it("breaks none of the product's copy rules — no em/en dash, nothing accusatory or passive", () => {
    for (const label of Object.values(HOUSE_RUNG_LABEL)) {
      expect(copyViolations(label)).toEqual([]);
    }
  });
});

/**
 * `houseKickoffFor` is dormant (no catalog rung is `"scheduled"` any more — see `HOUSE_CATALOG`'s
 * own docblock), but it stays pure, exported and tested against a synthetic scheduled-shaped
 * rung, so the stagger arithmetic is not lost the day a rung turns `"scheduled"` again.
 */
describe("houseKickoffFor (dormant, kept for a future scheduled rung)", () => {
  const scheduledLikeRung: HouseRung = { ...HOUSE_CATALOG.rungs.open_12, startTrigger: "scheduled", firstKickoffMinutes: 180, staggerMinutes: 180 };

  it("staggers each open league of a rung by the rung's own spacing", () => {
    expect(houseKickoffFor(NOW, scheduledLikeRung, 0)).toBe(plusMinutes(NOW, scheduledLikeRung.firstKickoffMinutes));
    expect(houseKickoffFor(NOW, scheduledLikeRung, 2)).toBe(plusMinutes(NOW, scheduledLikeRung.firstKickoffMinutes + 2 * scheduledLikeRung.staggerMinutes));
  });

  it("keeps a widely-staggered kickoff inside the window setDraftKickoff would accept", () => {
    const openAtOnce = 3;
    const widest = scheduledLikeRung.firstKickoffMinutes + (openAtOnce - 1) * scheduledLikeRung.staggerMinutes;
    expect(widest).toBeLessThan(LEAGUE_CONFIG.defaults.maxDraftDaysAhead * MINUTES_PER_DAY);
  });

  it("is a no-op at zero minutes — every live rung's own shape today", () => {
    expect(houseKickoffFor(NOW, HOUSE_CATALOG.rungs.open_12, 0)).toBe(NOW);
    expect(houseKickoffFor(NOW, HOUSE_CATALOG.rungs.open_12, 3)).toBe(NOW);
  });
});

describe("houseLeagueName", () => {
  it("draws the first cycle straight from the rung's pool, un-suffixed", () => {
    expect(houseLeagueName("open_12", 1)).toBe("The Blitz Room");
    expect(houseLeagueName("open_12", 2)).toBe("Fourth and Long");
    expect(houseLeagueName("open_12", 12)).toBe("Play Action Party");
    expect(houseLeagueName("beginner_12", 1)).toBe("The Rookie Room");
    expect(houseLeagueName("beginner_12", 8)).toBe("Kickoff Classic");
  });

  it("wraps to the pool's first entry again, suffixed with the lap count, once a rung's editions exceed its pool", () => {
    expect(houseLeagueName("open_12", 13)).toBe("The Blitz Room 2");
    expect(houseLeagueName("open_12", 24)).toBe("Play Action Party 2");
    expect(houseLeagueName("open_12", 25)).toBe("The Blitz Room 3");
    expect(houseLeagueName("beginner_12", 9)).toBe("The Rookie Room 2");
  });

  it("never reproduces the retired 'Open 12-team League N' shape for any rung or edition", () => {
    for (const rung of Object.keys(HOUSE_CATALOG.rungs) as HouseRungName[]) {
      for (const edition of [1, 2, 13, 9999]) {
        expect(houseLeagueName(rung, edition)).not.toBe(`${HOUSE_RUNG_LABEL[rung]} League ${edition}`);
      }
    }
  });

  it("is unique across 30 consecutive editions of every rung", () => {
    for (const rung of Object.keys(HOUSE_CATALOG.rungs) as HouseRungName[]) {
      const names = Array.from({ length: 30 }, (_, i) => houseLeagueName(rung, i + 1));
      expect(new Set(names).size).toBe(30);
    }
  });

  it("never shouts — no run of two or more consecutive uppercase letters in any name", () => {
    for (const rung of Object.keys(HOUSE_CATALOG.rungs) as HouseRungName[]) {
      for (const edition of [1, 2, 13, 9999]) {
        expect(houseLeagueName(rung, edition)).not.toMatch(/[A-Z]{2,}/);
      }
    }
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

// Phase 4, Task 8: the catalog is config — a rung's fee terms are declared here, so this is
// where founder decision 10's arithmetic law holds them before any spawn ever runs.
describe("rung entry fees", () => {
  it("keeps every rung free until the founder flips one, and holds any flipped rung to the prize-table invariant", () => {
    for (const rung of Object.values(HOUSE_CATALOG.rungs)) {
      if (rung.entryFeeCents === 0) {
        expect(rung.platformFeeCents).toBe(0);
        expect(rung.payoutTable).toBeNull();
      } else {
        expect(prizeTableInvariant(rung.entryFeeCents, rung.platformFeeCents, rung.teamCount, rung.payoutTable ?? [])).toEqual({ ok: true });
      }
    }
  });

  it("is free on every rung today — the founder's free season, as catalog fact", () => {
    for (const rung of Object.values(HOUSE_CATALOG.rungs)) {
      expect(rung.entryFeeCents).toBe(0);
    }
  });
});
