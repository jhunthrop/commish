import { describe, expect, it } from "vitest";
import { HALF_PPR_SCORING, PPR_SCORING, STANDARD_SCORING, TE_PREMIUM_SCORING } from "@research/domain/scoring";
import {
  BOARD_FORMATS,
  BOARD_FORMAT_SPECS,
  boardBasisLine,
  boardFormatForRules,
  boardSourceFor,
  DEFAULT_BOARD_FORMAT,
  isBoardFormat,
} from "./board-formats";

describe("board formats", () => {
  it("names three formats, PPR first and the default", () => {
    expect(BOARD_FORMATS).toEqual(["ppr", "half", "std"]);
    expect(DEFAULT_BOARD_FORMAT).toBe("ppr");
  });

  it("derives the PPR board source as the name every existing row was written under", () => {
    expect(boardSourceFor("ppr")).toBe("commish_board_v9_ppr_12");
    expect(boardSourceFor("half")).toBe("commish_board_v9_half_12");
    expect(boardSourceFor("std")).toBe("commish_board_v9_std_12");
  });

  it("keeps the PPR ADP benchmark source and snapshot format spelled as before", () => {
    expect(BOARD_FORMAT_SPECS.ppr.adpSource).toBe("ffc_adp_ppr_12");
    expect(BOARD_FORMAT_SPECS.ppr.snapshotFormat).toBe("ppr_12");
    expect(BOARD_FORMAT_SPECS.half.adpSource).toBe("ffc_adp_half_12");
    expect(BOARD_FORMAT_SPECS.std.adpSource).toBe("ffc_adp_std_12");
  });

  it("carries the exact preset rules per format", () => {
    expect(BOARD_FORMAT_SPECS.ppr.rules).toBe(PPR_SCORING);
    expect(BOARD_FORMAT_SPECS.half.rules).toBe(HALF_PPR_SCORING);
    expect(BOARD_FORMAT_SPECS.std.rules).toBe(STANDARD_SCORING);
  });

  it("guards a free-text value", () => {
    expect(isBoardFormat("half")).toBe(true);
    expect(isBoardFormat("half_ppr")).toBe(false);
    expect(isBoardFormat("")).toBe(false);
  });
});

describe("boardFormatForRules", () => {
  it("matches each shipped preset exactly, with no note", () => {
    expect(boardFormatForRules(PPR_SCORING)).toEqual({ format: "ppr", exact: true, note: null });
    expect(boardFormatForRules(HALF_PPR_SCORING)).toEqual({ format: "half", exact: true, note: null });
    expect(boardFormatForRules(STANDARD_SCORING)).toEqual({ format: "std", exact: true, note: null });
  });

  it("sends TE premium to the PPR board and says so once", () => {
    const resolved = boardFormatForRules(TE_PREMIUM_SCORING);
    expect(resolved.format).toBe("ppr");
    expect(resolved.exact).toBe(false);
    expect(resolved.note).toMatch(/PPR/);
  });

  it("picks the nearest format by points per reception for a custom sheet", () => {
    expect(boardFormatForRules({ ...STANDARD_SCORING, pointsPerReception: 0.4 }).format).toBe("half");
    expect(boardFormatForRules({ ...STANDARD_SCORING, pointsPerReception: 0.2 }).format).toBe("std");
    expect(boardFormatForRules({ ...STANDARD_SCORING, pointsPerReception: 1.5 }).format).toBe("ppr");
  });

  it("breaks a tie toward PPR, the product default", () => {
    expect(boardFormatForRules({ ...STANDARD_SCORING, pointsPerReception: 0.75 }).format).toBe("ppr");
  });

  it("names the league's own reception weight in the note", () => {
    const resolved = boardFormatForRules({ ...STANDARD_SCORING, pointsPerReception: 0.4, pointsPerPassingTouchdown: 6 });
    expect(resolved.note).toContain("0.4");
    expect(resolved.note).toContain("Half PPR");
  });
});

describe("boardBasisLine", () => {
  it("names the season, the team count and the format, in board order", () => {
    expect(boardBasisLine("half", 2026)).toBe("2026 board, 12-team half PPR, in board order");
    expect(boardBasisLine("ppr", 2026)).toBe("2026 board, 12-team PPR, in board order");
    expect(boardBasisLine("std", 2026)).toBe("2026 board, 12-team standard scoring, in board order");
  });
});
