import { describe, expect, it } from "vitest";
import { tierCompositionFor } from "./composition";

describe("tierCompositionFor", () => {
  it("names an aggregate and never a member", () => {
    expect(tierCompositionFor({ newcomers: 8, veterans: 0 })).toEqual({ newcomers: 8, veterans: 0 });
  });

  it("passes both counts through unchanged, whatever their values", () => {
    expect(tierCompositionFor({ newcomers: 0, veterans: 12 })).toEqual({ newcomers: 0, veterans: 12 });
  });
});
