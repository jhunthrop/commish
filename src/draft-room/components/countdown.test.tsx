import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, screen, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { useCountdown, Countdown } from "./countdown";

afterEach(() => {
  vi.useRealTimers();
});

describe("useCountdown", () => {
  it("is null when there is no deadline", () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current).toBeNull();
  });

  it("returns the ms remaining until the deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const { result } = renderHook(() => useCountdown("2026-09-01T00:00:12.000Z"));
    expect(result.current).toBe(12_000);
  });

  it("clamps at zero once the deadline has passed, never negative", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:20.000Z"));
    const { result } = renderHook(() => useCountdown("2026-09-01T00:00:12.000Z"));
    expect(result.current).toBe(0);
  });

  it("ticks as time advances", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    const { result } = renderHook(() => useCountdown("2026-09-01T00:00:12.000Z"));
    expect(result.current).toBe(12_000);
    vi.setSystemTime(new Date("2026-09-01T00:00:05.000Z"));
    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(6_000);
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
});
