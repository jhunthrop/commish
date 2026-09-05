import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DraftRoomDepsProvider, type DraftRoomDeps } from "@/draft-room/hooks/deps";
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

  it("consumes the seed on import: a second sheet-less draft starts from its own board, not the mock", async () => {
    writeSeedSheet(["p3", "p1"]);
    const first = renderHook(() => useSheet("draft_first", BOARD));
    await waitFor(() => expect(first.result.current.sheet.order).toEqual(["p3", "p2", "p1"]));
    const second = renderHook(() => useSheet("draft_second", BOARD));
    await waitFor(() => expect(second.result.current.sheet.order.length).toBeGreaterThan(0));
    // The seed served exactly one room; this one gets the board's own order.
    expect(second.result.current.sheet.order).toEqual(["p1", "p2", "p3"]);
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

/** A fake `fetchJson` that never leaves the process, matching `use-draft-room.test.tsx`'s own
 *  idiom for injecting `DraftRoomDeps`. */
function jsonOf(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

function wrapper(deps: DraftRoomDeps) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <DraftRoomDepsProvider deps={deps}>{children}</DraftRoomDepsProvider>;
  };
}

const NO_OPEN_EVENT_SOURCE: DraftRoomDeps["openEventSource"] = () => {
  throw new Error("not used by useSheet");
};

describe("useSheet — Draft HQ's server sync (Task 5, spec §4)", () => {
  it("omitting leagueId never attempts a fetch — every existing caller is unaffected", async () => {
    const fetchJson = vi.fn();
    const { result } = renderHook(() => useSheet("draft_no_league", BOARD), { wrapper: wrapper({ fetchJson, openEventSource: NO_OPEN_EVENT_SOURCE }) });
    await waitFor(() => expect(result.current.sheet.order.length).toBeGreaterThan(0));
    expect(fetchJson).not.toHaveBeenCalled();
    expect(result.current.hasServerSheet).toBe(false);
  });

  it("adopts a server sheet's own order as the room's sheet when one exists for this league", async () => {
    const fetchJson = vi.fn(async () => jsonOf({ ok: true, data: { id: "sheet-1", entries: [{ playerId: "p3", rank: 1, note: null }, { playerId: "p1", rank: 2, note: "sleeper" }] } }));
    const { result } = renderHook(() => useSheet("draft_league", BOARD, "league-1"), { wrapper: wrapper({ fetchJson, openEventSource: NO_OPEN_EVENT_SOURCE }) });
    await waitFor(() => expect(result.current.hasServerSheet).toBe(true));
    // Reconciled against the board (`reconcileSheet`'s own rule): p3, p1 survive from the
    // server in their own order, and p2 — a board id the server sheet never saw — inserts at
    // its own (clamped) board index among them, landing between the two.
    expect(result.current.sheet.order).toEqual(["p3", "p2", "p1"]);
    expect(result.current.sheet.notes).toEqual({ p1: "sleeper" });
    expect(fetchJson).toHaveBeenCalledWith("/api/draft/sheets/default?leagueId=league-1");
  });

  it("stays on local-only behavior when the league has no server sheet yet", async () => {
    const fetchJson = vi.fn(async () => jsonOf({ ok: true, data: null }));
    const { result } = renderHook(() => useSheet("draft_league_none", BOARD, "league-1"), { wrapper: wrapper({ fetchJson, openEventSource: NO_OPEN_EVENT_SOURCE }) });
    await waitFor(() => expect(result.current.sheet.order.length).toBeGreaterThan(0));
    expect(result.current.hasServerSheet).toBe(false);
    expect(result.current.sheet.order).toEqual(BOARD);
  });

  it("writes a reorder through to the server sheet once one is adopted", async () => {
    const calls: { readonly url: string; readonly init?: RequestInit }[] = [];
    const fetchJson = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("/api/draft/sheets/default")) return jsonOf({ ok: true, data: { id: "sheet-1", entries: [{ playerId: "p1", rank: 1, note: null }, { playerId: "p2", rank: 2, note: null }, { playerId: "p3", rank: 3, note: null }] } });
      return jsonOf({ ok: true, data: {} });
    });
    const { result } = renderHook(() => useSheet("draft_league_move", BOARD, "league-1"), { wrapper: wrapper({ fetchJson, openEventSource: NO_OPEN_EVENT_SOURCE }) });
    await waitFor(() => expect(result.current.hasServerSheet).toBe(true));

    result.current.move("p3", -2);

    await waitFor(() => expect(calls.some((call) => call.url === "/api/draft/sheets/sheet-1/entries")).toBe(true));
    const reorderCall = calls.find((call) => call.url === "/api/draft/sheets/sheet-1/entries")!;
    expect(reorderCall.init?.method).toBe("PUT");
    expect(JSON.parse(String(reorderCall.init?.body))).toEqual({ order: ["p3", "p1", "p2"] });
  });

  it("startServerSheet creates a sheet from the room's current local order and switches onto it", async () => {
    const calls: { readonly url: string; readonly init?: RequestInit }[] = [];
    const fetchJson = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("/api/draft/sheets/default")) return jsonOf({ ok: true, data: null });
      if (url === "/api/draft/sheets") return jsonOf({ ok: true, data: { id: "sheet-new" } });
      return jsonOf({ ok: true, data: {} });
    });
    const { result } = renderHook(() => useSheet("draft_start", BOARD, "league-1"), { wrapper: wrapper({ fetchJson, openEventSource: NO_OPEN_EVENT_SOURCE }) });
    await waitFor(() => expect(result.current.sheet.order.length).toBeGreaterThan(0));
    expect(result.current.hasServerSheet).toBe(false);

    result.current.startServerSheet();

    await waitFor(() => expect(result.current.hasServerSheet).toBe(true));
    const replaceCall = calls.find((call) => call.url === "/api/draft/sheets/sheet-new/replace");
    expect(replaceCall?.init?.method).toBe("PUT");
    expect(JSON.parse(String(replaceCall?.init?.body))).toEqual({ entries: BOARD.map((playerId) => ({ playerId, note: null })) });
  });
});
