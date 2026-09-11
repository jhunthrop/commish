import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { TOKENS } from "./tokens";

vi.mock("./use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "./use-reduced-motion";
import { useEntranceClass, useLeaveTransition } from "./use-motion";

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useEntranceClass", () => {
  it("springs an arrival in by default and slaps a celebration in", () => {
    expect(renderHook(() => useEntranceClass()).result.current).toBe("animate-spring-in");
    expect(renderHook(() => useEntranceClass("celebrate")).result.current).toBe("animate-slap-in");
  });

  it("returns no class at all when the reader asked for less motion", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    expect(renderHook(() => useEntranceClass()).result.current).toBe("");
    expect(renderHook(() => useEntranceClass("celebrate")).result.current).toBe("");
  });
});

describe("useLeaveTransition", () => {
  it("keeps the element mounted for the ease-out after it closes, then lets it go", () => {
    const { result, rerender } = renderHook(({ open }) => useLeaveTransition(open), { initialProps: { open: true } });
    expect(result.current).toEqual({ mounted: true, leaving: false, className: "" });
    rerender({ open: false });
    expect(result.current.mounted).toBe(true);
    expect(result.current.leaving).toBe(true);
    expect(result.current.className).toBe("animate-ease-out");
    act(() => {
      vi.advanceTimersByTime(TOKENS.motion.duration.out - 1);
    });
    expect(result.current.mounted).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual({ mounted: false, leaving: false, className: "" });
  });

  it("starts unmounted when it opens closed, and mounts the moment it opens", () => {
    const { result, rerender } = renderHook(({ open }) => useLeaveTransition(open), { initialProps: { open: false } });
    expect(result.current.mounted).toBe(false);
    rerender({ open: true });
    expect(result.current.mounted).toBe(true);
    expect(result.current.leaving).toBe(false);
  });

  it("cancels a leave when the element opens again before the ease-out ends", () => {
    const { result, rerender } = renderHook(({ open }) => useLeaveTransition(open), { initialProps: { open: true } });
    rerender({ open: false });
    expect(result.current.leaving).toBe(true);
    rerender({ open: true });
    act(() => {
      vi.advanceTimersByTime(TOKENS.motion.duration.out * 2);
    });
    expect(result.current).toEqual({ mounted: true, leaving: false, className: "" });
  });

  it("leaves at once under reduced motion, with no ease-out class and no timer", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const { result, rerender } = renderHook(({ open }) => useLeaveTransition(open), { initialProps: { open: true } });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: false, leaving: false, className: "" });
  });
});
