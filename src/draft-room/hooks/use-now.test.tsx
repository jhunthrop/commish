import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "./use-now";

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("advances on the given interval", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNow(1_000));
    const first = result.current;
    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current).toBeGreaterThan(first);
  });

  it("clears its interval on unmount so a closed room stops ticking", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useNow(1_000));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
