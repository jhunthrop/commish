import { describe, expect, it } from "vitest";
import { PARTICIPATION_TIERS, participationTierFor, type ParticipationTier } from "./tier";

describe("PARTICIPATION_TIERS", () => {
  it("shares no vocabulary at all with the two experience_tier columns", () => {
    // The whole point of this file. `users.experience_tier` and `leagues.experience_tier` are
    // both `beginner | experienced`; this is a THIRD fact about a person and reusing either word
    // would guarantee that somebody one day reads a self-reported sign-up answer as a computed
    // participation record and blocks a join on it.
    expect(PARTICIPATION_TIERS).toEqual(["newcomer", "veteran"]);
    expect(PARTICIPATION_TIERS as readonly string[]).not.toContain("beginner");
    expect(PARTICIPATION_TIERS as readonly string[]).not.toContain("experienced");
  });
});

describe("participationTierFor", () => {
  it("is newcomer below the cutoff, veteran at it and above it", () => {
    // The spec's boundary trio, and `>=` on purpose: `crossesFairnessThreshold`'s own reasoning
    // applies unchanged. A cutoff whose exact value can never be reached is a cutoff nobody can
    // configure precisely.
    expect(participationTierFor(2, 3)).toBe("newcomer");
    expect(participationTierFor(3, 3)).toBe("veteran");
    expect(participationTierFor(4, 3)).toBe("veteran");
  });

  it("treats an account that has never finished anything as a newcomer, not as unknown", () => {
    expect(participationTierFor(0, 3)).toBe("newcomer");
  });

  it("refuses a negative count rather than classifying it", () => {
    // A count can only come from a `count(*)`, so a negative one means the caller is confused and
    // the honest answer is a throw, not a tier. Fail fast at the boundary.
    expect(() => participationTierFor(-1, 3)).toThrow(/completedSeasons/);
  });
});

describe("the tier union itself", () => {
  it("compiles distinctly from the two experience_tier columns' vocabulary", () => {
    // A `ParticipationTier` can never be assigned an `experienceTier`-shaped literal, and this is
    // proven at compile time by the assignment itself, not merely asserted at runtime above.
    const tier: ParticipationTier = "veteran";
    // @ts-expect-error "experienced" is not a ParticipationTier, which is the whole point.
    const bad: ParticipationTier = "experienced";
    expect([tier, bad]).toContain("veteran");
  });
});
