import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, screen, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { UI_CONFIG } from "./config";
import { useCountdown, Countdown, formatCountdown, formatCoarseRemaining, formatCoarseDuration } from "./countdown";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
});

describe("useCountdown", () => {
  it("is null when there is no deadline", () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current.remainingMs).toBeNull();
  });

  it("returns the ms remaining until the deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const { result } = renderHook(() => useCountdown("2026-09-01T00:00:12.000Z"));
    expect(result.current.remainingMs).toBe(12_000);
  });

  it("clamps at zero once the deadline has passed, never negative", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:20.000Z"));
    const { result } = renderHook(() => useCountdown("2026-09-01T00:00:12.000Z"));
    expect(result.current.remainingMs).toBe(0);
  });

  it("ticks as time advances", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const { result } = renderHook(() => useCountdown("2026-09-01T00:00:12.000Z"));
    expect(result.current.remainingMs).toBe(12_000);
    vi.setSystemTime(new Date("2026-09-01T00:00:05.000Z"));
    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current.remainingMs).toBe(6_000);
  });

  it("also returns the wall-clock reading it computed remainingMs from, so a caller needing both never runs a second interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const { result } = renderHook(() => useCountdown("2026-09-01T00:00:12.000Z"));
    expect(result.current.now).toBe(Date.now());
  });

  // Phase 3.5, Task 8: the reduced-motion branch — a real one, not a cosmetic no-op. The
  // countdown stays correct at any tick rate; it simply refreshes less often.
  it("ticks less often once the caller prefers reduced motion, and still agrees on the answer", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const { result } = renderHook(() => useCountdown("2026-09-01T00:10:00.000Z"));
    expect(result.current.remainingMs).toBe(10 * 60_000);

    // A tick well under the reduced-motion interval leaves `now` — and so `remainingMs` — unmoved.
    act(() => void vi.advanceTimersByTime(UI_CONFIG.countdown.tickMs * 2));
    expect(result.current.remainingMs).toBe(10 * 60_000);

    // The interval itself only fires once the FULL reduced-motion interval has elapsed since mount.
    act(() => void vi.advanceTimersByTime(UI_CONFIG.countdown.reducedMotionTickMs - UI_CONFIG.countdown.tickMs * 2));
    expect(result.current.remainingMs).toBe(10 * 60_000 - UI_CONFIG.countdown.reducedMotionTickMs);
  });
});

describe("Countdown", () => {
  it("renders the formatted digits, hidden from assistive tech — both themes, axe-clean", async () => {
    await renderSurface(<Countdown remainingMs={125_000} data-testid="countdown" />, async ({ container }) => {
      const el = screen.getByTestId("countdown");
      expect(el).toHaveTextContent("2:05");
      expect(el).toHaveAttribute("aria-hidden", "true");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("pairs the hidden digits with a coarse, polite announcement outside the aria-hidden span", () => {
    render(<Countdown remainingMs={2 * 60 * 60 * 1_000 + 15_000} data-testid="countdown" />);
    const live = screen.getByText("About 2 hours left");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("sizes sm for a ledger-row clock at body size", () => {
    render(<Countdown remainingMs={125_000} size="sm" data-testid="countdown" />);
    expect(screen.getByTestId("countdown").className).toMatch(/text-sm/);
  });

  it("sizes xl for the waiting room's hero clock", () => {
    render(<Countdown remainingMs={125_000} size="xl" data-testid="countdown" />);
    expect(screen.getByTestId("countdown").className).toMatch(/text-display-xl/);
  });

  it("announces rarely — the coarse text is unchanged by a sub-boundary tick, and updates on a boundary crossing", () => {
    const { rerender } = render(<Countdown remainingMs={2 * 60 * 60 * 1_000 + 15_000} />);
    expect(screen.getByText("About 2 hours left")).toBeInTheDocument();

    rerender(<Countdown remainingMs={2 * 60 * 60 * 1_000 + 14_000} />);
    expect(screen.getByText("About 2 hours left")).toBeInTheDocument();

    rerender(<Countdown remainingMs={90_000} />);
    expect(screen.getByText("About 2 minutes left")).toBeInTheDocument();

    rerender(<Countdown remainingMs={5_000} />);
    expect(screen.getByText("Under a minute left")).toBeInTheDocument();
  });
});

describe("formatCountdown", () => {
  it.each([
    [0, "0:00"],
    [-5_000, "0:00"],
    [9_400, "0:10"],
    [125_000, "2:05"],
    [3_849_000, "1:04:09"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});

describe("formatCoarseDuration", () => {
  it.each([
    [0, "under a minute"],
    [-5_000, "under a minute"],
    [59_000, "under a minute"],
    [60_000, "1 minute"],
    [125_000, "2 minutes"],
    [3_599_999, "60 minutes"],
    [3_600_000, "1 hour"],
    [8 * 3_600_000, "8 hours"],
    [23 * 3_600_000, "23 hours"],
    [24 * 3_600_000, "1 day"],
    [7 * 24 * 3_600_000, "7 days"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatCoarseDuration(ms)).toBe(expected);
  });
});

describe("formatCoarseRemaining", () => {
  it.each([
    [0, "Under a minute left"],
    [-5_000, "Under a minute left"],
    [59_000, "Under a minute left"],
    [60_000, "About 1 minute left"],
    [125_000, "About 2 minutes left"],
    [3_599_999, "About 60 minutes left"],
    [3_600_000, "About 1 hour left"],
    [8 * 3_600_000, "About 8 hours left"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatCoarseRemaining(ms)).toBe(expected);
  });

  it("rounds rather than truncates, so it agrees with what a human would say", () => {
    // 89 999 ms is 1.4999... minutes — rounds down to "1 minute", not up to "2".
    expect(formatCoarseRemaining(89_999)).toBe("About 1 minute left");
  });
});
