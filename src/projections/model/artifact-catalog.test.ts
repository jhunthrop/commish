import { describe, expect, it } from "vitest";
import { catalogSpecFor, MODEL_ARTIFACT_CATALOG } from "./artifact-catalog";

describe("the model artifact catalog", () => {
  it("names every artifact once", () => {
    const names = MODEL_ARTIFACT_CATALOG.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["preseason/game-variance-skill", "preseason/game-variance-kdef", "market/props-anchor-weight"]));
  });

  it("pins a positive version and a parser for each", () => {
    for (const spec of MODEL_ARTIFACT_CATALOG) {
      expect(spec.version).toBeGreaterThanOrEqual(1);
      expect(() => spec.parse(null)).toThrow();
    }
  });

  it("answers null for a name the code has never heard of, never a guess", () => {
    expect(catalogSpecFor("preseason/game-variance-skill")?.version).toBe(1);
    expect(catalogSpecFor("nobody/knows")).toBeNull();
  });
});
