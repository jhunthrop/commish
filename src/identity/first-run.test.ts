import { describe, expect, it } from "vitest";
import { firstRunPlan } from "./first-run";

describe("firstRunPlan", () => {
  it("orders the paths by what this manager most likely needs", () => {
    // A first-timer with no group is looking for a game to join. An experienced manager with no
    // leagues on this product is nearly always the person who came here to RUN one. Same three
    // paths, different order, because ordering is the only honest way to guide without hiding.
    expect(firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!.paths.map((p) => p.key))
      .toEqual(["browse", "join", "create"]);
    expect(firstRunPlan({ experienceTier: "experienced", helpLevel: "standard", leagueCount: 0 })!.paths.map((p) => p.key))
      .toEqual(["create", "join", "browse"]);
  });

  it("always offers all three paths, whichever way it orders them", () => {
    // Guidance is ordering, never removal. A first-timer who came here to run their office league
    // must not have to find the create form behind an experience setting they set wrong.
    for (const tier of ["beginner", "experienced"] as const) {
      const plan = firstRunPlan({ experienceTier: tier, helpLevel: "guided", leagueCount: 0 })!;
      expect(new Set(plan.paths.map((p) => p.key))).toEqual(new Set(["create", "join", "browse"]));
    }
  });

  it("shows the how-it-works explainer only in guided help", () => {
    expect(firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!.showsExplainer).toBe(true);
    expect(firstRunPlan({ experienceTier: "beginner", helpLevel: "standard", leagueCount: 0 })!.showsExplainer).toBe(false);
  });

  it("disappears entirely once you are in a league", () => {
    expect(firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 1 })).toBeNull();
  });

  // The two tests above only ever exercise `leagueCount: 0` or `1` — this closes the gap so the
  // "disappears" rule is proven for every tier and help level, not just the one combination
  // above, and for a league count greater than one (a manager who already has several leagues).
  it("disappears for every tier and help level once any league exists, however many", () => {
    for (const experienceTier of ["beginner", "experienced"] as const) {
      for (const helpLevel of ["guided", "standard"] as const) {
        for (const leagueCount of [1, 2, 10]) {
          expect(firstRunPlan({ experienceTier, helpLevel, leagueCount })).toBeNull();
        }
      }
    }
  });

  it("gives each path plain, active-voice copy with no em-dash", () => {
    const plan = firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!;
    for (const path of plan.paths) {
      expect(path.title.length).toBeGreaterThan(0);
      expect(path.detail.length).toBeGreaterThan(0);
      expect(path.cta.length).toBeGreaterThan(0);
      expect(path.title).not.toMatch(/—/);
      expect(path.detail).not.toMatch(/—/);
      expect(path.cta).not.toMatch(/—/);
    }
  });

  it("returns the exact copy this product ships, keyed the same way every time", () => {
    const beginner = firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!;
    const experienced = firstRunPlan({ experienceTier: "experienced", helpLevel: "guided", leagueCount: 0 })!;
    const byKey = (plan: typeof beginner) => new Map(plan.paths.map((p) => [p.key, p]));

    // Same copy table underneath both orderings — only the ORDER differs, never the content.
    expect(byKey(beginner)).toEqual(byKey(experienced));

    expect(byKey(beginner).get("create")).toEqual({
      key: "create",
      title: "Start a league",
      detail: "You pick the format, the scoring and who's in it.",
      cta: "Start a league",
    });
    expect(byKey(beginner).get("join")).toEqual({
      key: "join",
      title: "Join with an invite",
      detail: "Paste the link or code your commissioner sent you.",
      cta: "Use an invite",
    });
    expect(byKey(beginner).get("browse")).toEqual({
      key: "browse",
      title: "Find an open league",
      detail: "Browse leagues that still have seats and join one today.",
      cta: "Browse open leagues",
    });
  });

  it("has a non-empty headline regardless of tier or help level", () => {
    for (const experienceTier of ["beginner", "experienced"] as const) {
      for (const helpLevel of ["guided", "standard"] as const) {
        expect(firstRunPlan({ experienceTier, helpLevel, leagueCount: 0 })!.headline.length).toBeGreaterThan(0);
      }
    }
  });
});
