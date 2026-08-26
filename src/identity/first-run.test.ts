import { describe, expect, it } from "vitest";
import { firstRunPathOrder, firstRunPlan } from "./first-run";

describe("firstRunPathOrder", () => {
  // `StartOrJoinDisclosure` (@/league-room/components/start-or-join-disclosure.tsx) reuses this
  // exact function to order the returning-manager disclosure — these two cases are the contract
  // that second consumer depends on, tested directly rather than only through `firstRunPlan`.
  it("puts browse and join ahead of create for a beginner", () => {
    expect(firstRunPathOrder("beginner")).toEqual(["browse", "join", "create"]);
  });

  it("puts create first for an experienced manager", () => {
    expect(firstRunPathOrder("experienced")).toEqual(["create", "join", "browse"]);
  });

  it("always returns the same three keys, whichever order", () => {
    for (const tier of ["beginner", "experienced"] as const) {
      expect(new Set(firstRunPathOrder(tier))).toEqual(new Set(["create", "join", "browse"]));
    }
  });
});

describe("firstRunPlan", () => {
  it("orders the paths by what this manager most likely needs, with practice leading both", () => {
    // A first-timer with no group is looking for a game to join. An experienced manager with no
    // leagues on this product is nearly always the person who came here to RUN one. Same three
    // paths, different order, because ordering is the only honest way to guide without hiding.
    // Practice leads unconditionally (Task 9) — it is not one of the tier-ordered three.
    expect(firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!.paths.map((p) => p.key))
      .toEqual(["practice", "browse", "join", "create"]);
    expect(firstRunPlan({ experienceTier: "experienced", helpLevel: "standard", leagueCount: 0 })!.paths.map((p) => p.key))
      .toEqual(["practice", "create", "join", "browse"]);
  });

  it("always offers all four paths, whichever way it orders the tier-dependent three", () => {
    // Guidance is ordering, never removal. A first-timer who came here to run their office league
    // must not have to find the create form behind an experience setting they set wrong.
    for (const tier of ["beginner", "experienced"] as const) {
      const plan = firstRunPlan({ experienceTier: tier, helpLevel: "guided", leagueCount: 0 })!;
      expect(new Set(plan.paths.map((p) => p.key))).toEqual(new Set(["practice", "create", "join", "browse"]));
    }
  });

  it("puts practice first regardless of tier", () => {
    for (const tier of ["beginner", "experienced"] as const) {
      expect(firstRunPlan({ experienceTier: tier, helpLevel: "guided", leagueCount: 0 })!.paths[0]!.key).toBe("practice");
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

  // The name used to promise "plain, active-voice copy" and assert `.length > 0` — true of any
  // non-empty string, including a paragraph of passive jargon. These are the shape rules the
  // copy actually follows, so a rewrite that abandons one goes red.
  it("keeps each path's copy short, sentence-shaped and free of em-dashes", () => {
    const plan = firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!;
    for (const path of plan.paths) {
      // A title and a call to action are labels, not sentences: a few words, no full stop.
      expect(path.title.split(" ").length).toBeLessThanOrEqual(5);
      expect(path.title.endsWith(".")).toBe(false);
      expect(path.cta.split(" ").length).toBeLessThanOrEqual(4);
      expect(path.cta.endsWith(".")).toBe(false);
      // The detail is the one line that explains, so it is a real sentence and says something.
      expect(path.detail.length).toBeGreaterThanOrEqual(20);
      expect(path.detail.endsWith(".")).toBe(true);

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
      detail: "You pick the format, the scoring and who is in it.",
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
    expect(byKey(beginner).get("practice")).toEqual({
      key: "practice",
      title: "Try a mock draft",
      detail: "Draft against practice bots anytime, before your real league starts.",
      cta: "Try a mock draft",
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
