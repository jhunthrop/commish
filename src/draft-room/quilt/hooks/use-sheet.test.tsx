import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QUILT_CONFIG } from "../state/config";
import { encodeSheet } from "../state/sheet";
import { writeSeedSheet } from "../state/sheet-seed";
import { useSheet } from "./use-sheet";

const BOARD = ["p1", "p2", "p3"];

beforeEach(() => {
  window.localStorage.clear();
});

describe("useSheet — the seed import (the workflow pass)", () => {
  it("starts a fresh draft's sheet from the standing seed, reconciled against this board", async () => {
    // The seed carries a pick this board does not serve (p9): it drops, the survivors hold
    // their order, and a board id the seed never saw (p2) enters at its board position among
    // them — `reconcileSheet`'s own documented rule, applied to the seed unchanged.
    writeSeedSheet(["p3", "p9", "p1"]);
    const { result } = renderHook(() => useSheet("draft_fresh", BOARD));
    await waitFor(() => expect(result.current.sheet.order.length).toBeGreaterThan(0));
    expect(result.current.sheet.order).toEqual(["p3", "p2", "p1"]);
  });

  it("never lets the seed overwrite a sheet the manager already has for this draft", async () => {
    writeSeedSheet(["p3", "p2", "p1"]);
    window.localStorage.setItem(
      `${QUILT_CONFIG.sheetStorageKeyPrefix}draft_kept`,
      encodeSheet({ order: ["p2", "p1", "p3"], notes: { p2: "my guy" } }),
    );
    const { result } = renderHook(() => useSheet("draft_kept", BOARD));
    await waitFor(() => expect(result.current.sheet.order.length).toBeGreaterThan(0));
    expect(result.current.sheet.order).toEqual(["p2", "p1", "p3"]);
    expect(result.current.sheet.notes).toEqual({ p2: "my guy" });
  });

  it("falls back to the board's own order with no seed and no stored sheet", async () => {
    const { result } = renderHook(() => useSheet("draft_bare", BOARD));
    await waitFor(() => expect(result.current.sheet.order.length).toBeGreaterThan(0));
    expect(result.current.sheet.order).toEqual(BOARD);
  });
});
