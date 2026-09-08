import { describe, expect, it } from "vitest";
import { pedigreeFor, type PedigreeInput } from "./pedigree";

function input(overrides: Partial<PedigreeInput> = {}): PedigreeInput {
  return {
    birthDate: null,
    openingDay: null,
    rookieSeason: null,
    productSeason: 2026,
    draftYear: null,
    draftRound: null,
    draftPick: null,
    draftClub: null,
    college: null,
    ...overrides,
  };
}

describe("pedigreeFor", () => {
  it("computes age from the stored birth date against the stored kickoff, never a clock", () => {
    const facts = pedigreeFor(input({ birthDate: "2001-07-15", openingDay: new Date("2026-09-10T00:20:00.000Z"), rookieSeason: 2023 }));
    expect(facts).toMatchObject({ ageOnOpeningDay: 25.2, seasonsPlayed: 3 });
  });

  it("leaves the age absent when the schedule has no kickoff yet rather than measuring against today", () => {
    expect(pedigreeFor(input({ birthDate: "2001-07-15", rookieSeason: 2023 }))!.ageOnOpeningDay).toBeNull();
  });

  it("reports an absent round as absent while still naming the pick the roster row carries", () => {
    expect(pedigreeFor(input({ draftYear: 2023, draftPick: 22, draftClub: "NYG" }))).toMatchObject({
      draftYear: 2023,
      draftRound: null,
      draftPick: 22,
      draftClub: "NYG",
      undrafted: false,
    });
  });

  it("calls him undrafted only when the roster row names an entry year and carries no pick", () => {
    expect(pedigreeFor(input({ draftYear: 2023 }))!.undrafted).toBe(true);
    expect(pedigreeFor(input({ rookieSeason: 2023 }))!.undrafted).toBeNull();
  });

  it("returns nothing at all when not one field has a row behind it", () => {
    expect(pedigreeFor(input())).toBeNull();
  });
});
