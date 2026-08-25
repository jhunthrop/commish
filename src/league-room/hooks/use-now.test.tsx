import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useNow } from "./use-now";

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  // The hydration contract (founder-reported live defect, 2026-08-24): neither the server
  // render nor the client's first render may read the wall clock — the two run on different
  // clocks and their HTML must agree byte-for-byte. The snap happens in an effect instead.
  it("is null on the server render — the clock only snaps in an effect, after hydration", () => {
    function Probe() {
      return <span>{String(useNow(1_000))}</span>;
    }
    expect(renderToString(<Probe />)).toContain("null");
  });

  it("snaps to the wall clock once mounted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const { result } = renderHook(() => useNow(1_000));
    expect(result.current).toBe(Date.now());
  });

  it("advances on the given interval", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNow(1_000));
    const first = result.current;
    expect(first).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current).toBeGreaterThan(first!);
  });

  it("clears its interval on unmount", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useNow(1_000));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
