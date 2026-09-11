import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { fixtureLeagueDeps } from "../test-fixtures";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "./deps";
import { usePresence } from "./use-presence";

function wrapper(deps: LeagueRoomDeps) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <LeagueRoomDepsProvider deps={deps}>{children}</LeagueRoomDepsProvider>;
  };
}

describe("usePresence", () => {
  it("starts from the server's read and folds the room off the frame without a single read (H2)", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { userIds: ["never-read"] } });
    const { result } = renderHook(() => usePresence("l1", ["u1"]), { wrapper: wrapper(fixture.deps) });
    expect([...result.current]).toEqual(["u1"]);

    act(() => fixture.emit("presence.changed", { userIds: ["u1", "u2"] }));
    expect([...result.current].sort()).toEqual(["u1", "u2"]);
    act(() => fixture.emit("presence.changed", { userIds: ["u2"] }));
    expect([...result.current]).toEqual(["u2"]);
    expect(fixture.calls).toEqual([]);
  });

  it("ignores a frame that does not carry the whole room, rather than trusting half of it", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { userIds: [] } });
    const { result } = renderHook(() => usePresence("l1", ["u1"]), { wrapper: wrapper(fixture.deps) });
    act(() => fixture.emit("presence.changed", { userId: "u9", present: true }));
    act(() => fixture.emit("presence.changed", { userIds: ["u2", 7] }));
    expect([...result.current]).toEqual(["u1"]);
    expect(fixture.calls).toEqual([]);
  });

  it("re-reads once on every stream open, the mount-gap resync", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { userIds: ["u3"] } });
    const { result } = renderHook(() => usePresence("l1", []), { wrapper: wrapper(fixture.deps) });
    act(() => fixture.fire("open"));
    await waitFor(() => expect([...result.current]).toEqual(["u3"]));
    expect(fixture.calls).toEqual(["GET /api/leagues/l1/presence"]);
  });

  it("keeps the last honest answer when the open read fails", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "nope" });
    const { result } = renderHook(() => usePresence("l1", ["u1"]), { wrapper: wrapper(fixture.deps) });
    act(() => fixture.fire("open"));
    await waitFor(() => expect(fixture.calls).toHaveLength(1));
    expect([...result.current]).toEqual(["u1"]);
  });

  it("closes its stream subscription on unmount", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { userIds: [] } });
    const { result, unmount } = renderHook(() => usePresence("l1", ["u1"]), { wrapper: wrapper(fixture.deps) });
    unmount();
    act(() => fixture.emit("presence.changed", { userIds: ["u9"] }));
    expect([...result.current]).toEqual(["u1"]);
  });
});
