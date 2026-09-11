import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { REDUCED_MOTION_QUERY } from "./use-reduced-motion";
import { useValueChangeHighlight } from "./use-value-change-highlight";
import { TOKENS } from "./tokens";

/**
 * The same stub `use-reduced-motion.test.tsx` uses — one shape for the one media query the
 * product asks about, so this hook's branch is tested against the real `matchMedia` API rather
 * than against a mock of `usePrefersReducedMotion` itself. Mocking the wrapper would prove only
 * that the two functions agree; stubbing the platform proves the branch a real browser takes.
 *
 * The listener pair is inert here (no test changes the preference mid-mount — that is
 * `use-reduced-motion.test.tsx`'s own case), but both must EXIST: the hook subscribes on mount
 * and unsubscribes on cleanup, and a stub missing either throws inside an effect.
 */
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? matches : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useValueChangeHighlight", () => {
  it("is false on mount, because nothing changed on mount", () => {
    // LAW 6: "Nothing animates on mount, scroll or hover." The number was not there and then
    // there — it arrived, and washing the whole table on first paint is the "performs" half of
    // the law exactly.
    stubMatchMedia(false);
    const { result } = renderHook(({ value }) => useValueChangeHighlight(value), { initialProps: { value: "118.4" } });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(TOKENS.motion.duration.highlight * 4);
    });
    expect(result.current).toBe(false);
  });

  it("is true for the law's ceiling after a real change, then false again", () => {
    stubMatchMedia(false);
    const { result, rerender } = renderHook(({ value }) => useValueChangeHighlight(value), { initialProps: { value: "118.4" } });
    act(() => rerender({ value: "124.4" }));
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(TOKENS.motion.duration.highlight);
    });
    expect(result.current).toBe(false);
  });

  it("ignores a re-render carrying the value already on screen", () => {
    // A parent re-rendering for its own reasons, or a re-delivered socket message repeating a
    // figure nobody's eye needs redirecting to. Motion reports; a repeat is not a report.
    stubMatchMedia(false);
    const { result, rerender } = renderHook(({ value }) => useValueChangeHighlight(value), { initialProps: { value: "118.4" } });
    act(() => rerender({ value: "118.4" }));
    expect(result.current).toBe(false);
  });

  it("re-fires on each subsequent change, so a second jump is reported too", () => {
    stubMatchMedia(false);
    const { result, rerender } = renderHook(({ value }) => useValueChangeHighlight(value), { initialProps: { value: "118.4" } });
    act(() => rerender({ value: "124.4" }));
    act(() => {
      vi.advanceTimersByTime(TOKENS.motion.duration.highlight);
    });
    expect(result.current).toBe(false);
    act(() => rerender({ value: "130.4" }));
    expect(result.current).toBe(true);
  });

  /**
   * THE REDUCED-MOTION BRANCH IS REAL, NOT DECORATIVE — the assertion this whole test file exists
   * for.
   *
   * The globals.css `prefers-reduced-motion` net only shortens durations to 0.01ms, and a
   * one-frame flash of a changed cell is still a flash. A hook that merely animated FASTER for
   * someone who asked for less motion would satisfy the stylesheet and fail the user. So this
   * asserts the behaviour is ABSENT: the value changes, repeatedly, timers run out, and the hook
   * never once returns true — no consumer can render a wash, because there is no moment at which
   * one is being reported.
   *
   * Nothing is lost by removing it. The information was never in the wash: the new number IS the
   * information, and that is the test of whether an animation was reporting or performing.
   */
  it("never returns true under reduced motion, however many times the value changes", () => {
    stubMatchMedia(true);
    const { result, rerender } = renderHook(({ value }) => useValueChangeHighlight(value), { initialProps: { value: "118.4" } });
    expect(result.current).toBe(false);
    for (const value of ["124.4", "130.4", "131.0"]) {
      act(() => rerender({ value }));
      expect(result.current).toBe(false);
      act(() => {
        vi.advanceTimersByTime(TOKENS.motion.duration.highlight / 2);
      });
      expect(result.current).toBe(false);
    }
  });

  it("arms no timer at all under reduced motion, rather than arming one nobody watches", () => {
    // The branch hands `useTransientVisibility` a null key, which schedules nothing — an absence
    // of behaviour rather than a suppressed one.
    stubMatchMedia(true);
    const { rerender } = renderHook(({ value }) => useValueChangeHighlight(value), { initialProps: { value: "118.4" } });
    act(() => rerender({ value: "124.4" }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("takes a number as readily as a string, since a score is both on its way to the screen", () => {
    stubMatchMedia(false);
    const { result, rerender } = renderHook(({ value }) => useValueChangeHighlight(value), { initialProps: { value: 118.4 } });
    act(() => rerender({ value: 124.4 }));
    expect(result.current).toBe(true);
  });
});
