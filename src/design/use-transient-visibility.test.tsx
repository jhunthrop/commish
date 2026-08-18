import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTransientVisibility } from "./use-transient-visibility";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useTransientVisibility", () => {
  it("is hidden with no key", () => {
    const { result } = renderHook(() => useTransientVisibility(null, 1000));
    expect(result.current).toBe(false);
  });

  it("shows for the given window and then hides", () => {
    const { result } = renderHook(() => useTransientVisibility(1, 1000));
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(false);
  });

  it("re-shows on a new key, and does not re-show on the same one", () => {
    const { result, rerender } = renderHook(({ key }) => useTransientVisibility(key, 1000), { initialProps: { key: 1 } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(false);
    rerender({ key: 1 });
    expect(result.current).toBe(false);
    rerender({ key: 2 });
    expect(result.current).toBe(true);
  });
});
