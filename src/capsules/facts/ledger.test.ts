import { describe, expect, it } from "vitest";
import { depthNames, depthNumbers, depthTeamCodes } from "./ledger";
import { EMPTY_DEPTH } from "./types";

describe("the depth ledger", () => {
  it("contributes nothing at all for a player the depth stores held nothing for", () => {
    expect(depthNumbers(EMPTY_DEPTH)).toEqual([]);
    expect(depthNames(EMPTY_DEPTH)).toEqual([]);
    expect(depthTeamCodes(EMPTY_DEPTH)).toEqual([]);
  });
});
