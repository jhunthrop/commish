import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, screen, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { useCountdown, Countdown } from "./countdown";

afterEach(() => {
  vi.useRealTimers();
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
});

describe("Countdown", () => {
  it("renders the formatted digits, hidden from assistive tech — both themes, axe-clean", async () => {
    await inBothThemes(<Countdown remainingMs={125_000} data-testid="countdown" />, async ({ container }) => {
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
