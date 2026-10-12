import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chipEligibleLaws, DISCOVERED_JSON_PATH } from "./registry";
import { pricingEligibleLawIds, pricingEligibleLaws, SUSPECT_LAWS, SUSPECT_LAW_IDS } from "./pricing";
import type { Law } from "./types";
import { packagePath } from "@research-ts/lib/package-path";

function law(overrides: Partial<Law> = {}): Law {
  return {
    id: "some_law",
    position: "RB",
    claim: "Fixture claim, independent of the real registry.",
    measured: { effect: 1, ci: [0.5, 1.5], sample: 100, seasons: "fixture" },
    trainEffect: 1,
    verdict: "confirmed",
    modelPath: null,
    hasFoldEvidence: true,
    origin: "discovered",
    primaryQuantityId: null,
    primaryQuantityNoun: null,
    primaryQuantityUnit: null,
    ...overrides,
  };
}

describe("SUSPECT_LAWS — the vigilance record, carried as data", () => {
  it("carries the nine ids Task 2's vigilance section marked, each with its reason", () => {
    expect(SUSPECT_LAWS).toHaveLength(9);
    for (const suspect of SUSPECT_LAWS) {
      expect(suspect.reason.length).toBeGreaterThan(20);
    }
    expect([...SUSPECT_LAW_IDS].sort()).toEqual(
      [
        "and:WR:threshold:WR:incomingCoachTenureSeasons:q70+threshold:WR:touchdownPointsShare:q70",
        "delta:RB:pointsPerGame:q30:rose_into",
        "delta:RB:pointsPerGame:q70:fell_out_of",
        "delta:TE:pointsPerGame:q80:fell_out_of",
        "delta:WR:pointsPerGame:q20:fell_out_of",
        "delta:WR:pointsPerGame:q70:rose_into",
        "delta:WR:pointsPerGame:q80:fell_out_of",
        "delta:WR:pointsPerGame:q90:fell_out_of",
        "threshold:RB:snapShare:q20",
      ].sort(),
    );
  });

  /** A suspect id that matches no committed law is a silent no-op: the gate would look armed and
   *  price the law anyway. This is the check that a typo cannot survive. */
  it("names only ids the committed discovery file actually confirms", () => {
    const parsed = JSON.parse(readFileSync(packagePath(DISCOVERED_JSON_PATH), "utf-8")) as {
      readonly laws: Readonly<Record<string, { readonly verdict: string }>>;
    };
    for (const id of SUSPECT_LAW_IDS) {
      expect(parsed.laws[id], `suspect id "${id}" is not in ${DISCOVERED_JSON_PATH}`).toBeDefined();
      expect(parsed.laws[id]!.verdict, `suspect id "${id}" is not confirmed`).toBe("confirmed");
    }
  });
});

describe("pricingEligibleLaws — measurement stays, pricing admission is a policy gate", () => {
  it("drops a suspect law while chipEligibleLaws keeps it", () => {
    const suspect = law({ id: "threshold:RB:snapShare:q20" });
    const ordinary = law({ id: "threshold:RB:age:q70" });
    const laws = [suspect, ordinary];

    expect(chipEligibleLaws(laws).map((entry) => entry.id)).toEqual(["threshold:RB:snapShare:q20", "threshold:RB:age:q70"]);
    expect(pricingEligibleLaws(laws).map((entry) => entry.id)).toEqual(["threshold:RB:age:q70"]);
  });

  it("keeps the suspect law's verdict untouched — the registry entry is not rewritten", () => {
    const suspect = law({ id: "threshold:RB:snapShare:q20" });
    pricingEligibleLaws([suspect]);
    expect(suspect.verdict).toBe("confirmed");
  });

  it("is a SUBSET of chip eligibility: everything it admits, a chip may cite", () => {
    const laws = [
      law({ id: "tribal_one", origin: "tribal", verdict: "debunked" }),
      law({ id: "discovered_weak", verdict: "weak" }),
      law({ id: "discovered_confirmed" }),
      law({ id: "delta:RB:pointsPerGame:q30:rose_into" }),
    ];
    const chip = new Set(chipEligibleLaws(laws).map((entry) => entry.id));
    for (const entry of pricingEligibleLaws(laws)) {
      expect(chip.has(entry.id)).toBe(true);
    }
    expect(pricingEligibleLaws(laws).map((entry) => entry.id)).toEqual(["tribal_one", "discovered_confirmed"]);
  });

  it("pricingEligibleLawIds is the same set, as ids", () => {
    const laws = [law({ id: "a" }), law({ id: "threshold:RB:snapShare:q20" })];
    expect([...pricingEligibleLawIds(laws)]).toEqual(["a"]);
  });
});
