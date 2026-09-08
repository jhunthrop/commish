import { describe, expect, it } from "vitest";
import { resolveTeamRoute, teamPagePath } from "./route";

describe("resolveTeamRoute", () => {
  it("accepts the product's own spelling as canonical", () => {
    expect(resolveTeamRoute("DET")).toEqual({ kind: "canonical", code: "DET" });
    expect(resolveTeamRoute("LAR")).toEqual({ kind: "canonical", code: "LAR" });
    expect(resolveTeamRoute("WSH")).toEqual({ kind: "canonical", code: "WSH" });
  });

  it("redirects the other feed's spelling and the historical cities onto the canonical code", () => {
    expect(resolveTeamRoute("LA")).toEqual({ kind: "redirect", code: "LAR" });
    expect(resolveTeamRoute("WAS")).toEqual({ kind: "redirect", code: "WSH" });
    expect(resolveTeamRoute("STL")).toEqual({ kind: "redirect", code: "LAR" });
    expect(resolveTeamRoute("SD")).toEqual({ kind: "redirect", code: "LAC" });
    expect(resolveTeamRoute("OAK")).toEqual({ kind: "redirect", code: "LV" });
  });

  it("redirects a lowercase spelling of a real code onto its canonical form", () => {
    expect(resolveTeamRoute("det")).toEqual({ kind: "redirect", code: "DET" });
  });

  it("is unknown for a code neither feed has ever used", () => {
    expect(resolveTeamRoute("ZZZ")).toEqual({ kind: "unknown" });
    expect(resolveTeamRoute("")).toEqual({ kind: "unknown" });
  });
});

describe("teamPagePath", () => {
  it("builds the route from the configured base", () => {
    expect(teamPagePath("DET")).toBe("/app/teams/DET");
  });
});
