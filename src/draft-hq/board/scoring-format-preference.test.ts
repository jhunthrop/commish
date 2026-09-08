import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_FORMAT_STORAGE_KEY, readStoredBoardFormat, storeBoardFormat } from "./scoring-format-preference";

describe("the remembered board format", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads PPR, the default, when nothing has been remembered", () => {
    expect(readStoredBoardFormat()).toBe("ppr");
  });

  it("remembers a chosen format across reads", () => {
    storeBoardFormat("half");
    expect(window.localStorage.getItem(BOARD_FORMAT_STORAGE_KEY)).toBe("half");
    expect(readStoredBoardFormat()).toBe("half");
    storeBoardFormat("std");
    expect(readStoredBoardFormat()).toBe("std");
  });

  it("treats a value that is not one of the three formats as the default, never as a fourth board", () => {
    window.localStorage.setItem(BOARD_FORMAT_STORAGE_KEY, "te_premium");
    expect(readStoredBoardFormat()).toBe("ppr");
  });

  it("survives a browser whose storage throws, on read and on write", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    // A private window or a preview where the accessor itself refuses: the whole `localStorage`
    // object is replaced, not one method, because that is the shape the real failure takes.
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    try {
      expect(() => storeBoardFormat("half")).not.toThrow();
      expect(readStoredBoardFormat()).toBe("ppr");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
