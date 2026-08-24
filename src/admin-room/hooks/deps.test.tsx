import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { onSessionLost } from "@/components/app-shell/session-watch";
import { useAdminRoomDeps } from "./deps";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Task 19 fix round 1, F2 (the A16 carry, closed): `AdminRoomDeps`'s real `BROWSER_DEPS.fetchJson`
 * is now a one-line delegate to `fetchWithSessionWatch`, the same wiring `AccountRoomDeps`/
 * `ChatRoomDeps`/`DraftRoomDeps`/`LeagueRoomDeps` have carried since Task 16 — proven here the
 * same way `session-watch.test.ts` proves the function itself: spy on `globalThis.fetch`, listen
 * on `onSessionLost`, and assert the escalation. `renderHook(() => useAdminRoomDeps())` with no
 * `AdminRoomDepsProvider` wrapper reaches the real `BROWSER_DEPS` — the same "no provider
 * degrades to the real dependencies" fallback `use-notices.test.tsx`'s own docblock names for
 * `useAccountRoomDeps()`.
 *
 * Every existing `ResolutionForm`/`HeldTradeDetail` test renders through
 * `AdminRoomDepsProvider`/`fixtureAdminDeps` instead (a fake `fetchJson`, no real network) — by
 * design, since those tests are about the FORM'S contract, not about the wiring this file covers.
 * This is the one place the real delegate itself is exercised, so a future regression (someone
 * reverting `fetchJson` back to a bare `fetch`) fails here rather than nowhere.
 */
describe("useAdminRoomDeps — the real BROWSER_DEPS delegate", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("delegates to fetchWithSessionWatch: a write's 401 in our own envelope shape reaches the shared session-lost recovery, marked as a write", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(401, { ok: false, error: "Not authenticated." }));

    const heard: unknown[] = [];
    const off = onSessionLost((detail) => heard.push(detail));

    const { result } = renderHook(() => useAdminRoomDeps());
    await result.current.fetchJson("/api/admin/flags/flag_1/resolve", { method: "POST", body: "{}" });

    expect(heard).toEqual([{ write: true }]);
    off();
  });

  it("hands a successful response back completely unchanged, and emits nothing", async () => {
    const original = jsonResponse(200, { ok: true, data: { flagId: "flag_1", decision: "no_action" } });
    fetchSpy.mockResolvedValue(original);

    const heard: unknown[] = [];
    const off = onSessionLost((detail) => heard.push(detail));

    const { result } = renderHook(() => useAdminRoomDeps());
    const response = await result.current.fetchJson("/api/admin/flags/flag_1/resolve");

    expect(response).toBe(original);
    expect(await response.json()).toEqual({ ok: true, data: { flagId: "flag_1", decision: "no_action" } });
    expect(heard).toEqual([]);
    off();
  });

  it("says nothing on a non-401 failure — a 500 is not a session problem", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(500, { ok: false, error: "Something went wrong." }));

    const heard: unknown[] = [];
    const off = onSessionLost((detail) => heard.push(detail));

    const { result } = renderHook(() => useAdminRoomDeps());
    await result.current.fetchJson("/api/admin/flags/flag_1/resolve", { method: "POST", body: "{}" });

    expect(heard).toEqual([]);
    off();
  });
});
