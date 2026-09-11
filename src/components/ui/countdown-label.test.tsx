import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { UI_CONFIG } from "./config";
import { CountdownLabel } from "./countdown";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));

afterEach(() => {
  vi.useRealTimers();
});

describe("CountdownLabel (the clock ticks alone)", () => {
  it("re-renders only itself on a tick: the parent that handed it the deadline renders once", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    let parentRenders = 0;
    function Parent() {
      parentRenders += 1;
      return (
        <div>
          <CountdownLabel deadlineAt="2026-09-01T00:00:12.000Z" data-testid="clock" />
        </div>
      );
    }
    render(<Parent />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId("clock")).toHaveTextContent("0:12");
    act(() => {
      vi.advanceTimersByTime(UI_CONFIG.countdown.tickMs * 3);
    });
    expect(screen.getByTestId("clock")).toHaveTextContent("0:09");
    expect(parentRenders).toBe(1);
  });

  it("shows the placeholder with no deadline and before the clock snaps, never a false 0:00", () => {
    render(<CountdownLabel deadlineAt={null} data-testid="clock" />);
    expect(screen.getByTestId("clock")).toHaveTextContent("…");
    expect(renderToString(<CountdownLabel deadlineAt="2026-09-01T00:00:12.000Z" placeholder="--" />)).toContain("--");
  });
});
