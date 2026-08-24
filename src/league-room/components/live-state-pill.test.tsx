import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { LiveStatePill } from "./live-state-pill";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

describe("LiveStatePill", () => {
  it("carries the real weekday and game count as an sr-only sentence, in both themes, axe-clean", async () => {
    await renderSurface(<LiveStatePill liveState={{ weekday: "Sunday", gamesLive: 7 }} />, async ({ container }) => {
      expect(screen.getByText("Sunday · 7 games live")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Task 13, Step 1c: icon-only at every width — the glyph is decorative, the visible count is
  // `aria-hidden`, and the full sentence lives only in the `sr-only` sibling asserted above, so
  // a sighted visitor never sees it printed.
  it("shows a glyph and the bare count, never the sentence, as VISIBLE text", () => {
    render(<LiveStatePill liveState={{ weekday: "Sunday", gamesLive: 7 }} />);
    const count = screen.getByText("7");
    expect(count).toHaveAttribute("aria-hidden", "true");
    const sentence = screen.getByText("Sunday · 7 games live");
    expect(sentence).toHaveClass("sr-only");
  });

  it("pluralizes a single live game correctly", () => {
    render(<LiveStatePill liveState={{ weekday: "Monday", gamesLive: 1 }} />);
    expect(screen.getByText("Monday · 1 game live")).toBeInTheDocument();
  });

  // Ruling 12: nothing live means no pill — off-season, mid-week and pre-kickoff all reach this
  // component as `null`, never as a state it renders text for.
  it("renders nothing at all when nothing is live", () => {
    const { container } = render(<LiveStatePill liveState={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Task 13, Step 5: the pulse is a real reduced-motion branch — the pill stays and still
  // announces, it simply stops animating. Both sides asserted, the same idiom `Celebration` and
  // `useCountdown` already keep. It lives on the GLYPH only (the axe pass's own finding: an
  // `animate-pulse` dip to 50% opacity on the readable digit fails color-contrast for roughly
  // half of every cycle), so these assertions target the icon's `<svg>`, not the outer span —
  // the digit stays a stable, always-compliant `aria-hidden` sibling either way (asserted above).
  it("pulses the glyph by default", () => {
    const { container } = render(<LiveStatePill liveState={{ weekday: "Sunday", gamesLive: 7 }} />);
    expect(container.querySelector("svg")).toHaveClass("animate-pulse");
  });

  it("drops the pulse under reduced motion, without losing the pill or its sentence", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const { container } = render(<LiveStatePill liveState={{ weekday: "Sunday", gamesLive: 7 }} />);
    expect(container.querySelector("svg")?.getAttribute("class") ?? "").not.toContain("animate-pulse");
    expect(screen.getByText("Sunday · 7 games live")).toBeInTheDocument();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });
});
