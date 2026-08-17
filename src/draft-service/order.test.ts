import { describe, it, expect } from "vitest";
import { draftOrderFor } from "./order";

const TEAMS = Array.from({ length: 12 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);

describe("draftOrderFor", () => {
  it("is deterministic for a given draft id", () => {
    expect(draftOrderFor("draft_abc", TEAMS)).toEqual(draftOrderFor("draft_abc", TEAMS));
  });

  it("is a permutation of the teams — every team drafts exactly once per round", () => {
    expect([...draftOrderFor("draft_abc", TEAMS)].sort()).toEqual([...TEAMS].sort());
  });

  it("does not simply preserve input order", () => {
    expect(draftOrderFor("draft_abc", TEAMS)).not.toEqual(TEAMS);
  });

  it("gives different drafts different orders", () => {
    // With 12 teams a collision has probability 1/12!, but if these two ids do collide,
    // pick a different pair — do not delete the test.
    expect(draftOrderFor("draft_abc", TEAMS)).not.toEqual(draftOrderFor("draft_xyz", TEAMS));
  });

  it("ignores the order the team ids arrive in", () => {
    expect(draftOrderFor("draft_abc", [...TEAMS].reverse())).toEqual(draftOrderFor("draft_abc", TEAMS));
  });
});
