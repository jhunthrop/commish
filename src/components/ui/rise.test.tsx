import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { Rise } from "./rise";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

describe("Rise", () => {
  it("wraps its children in the entrance animation at the named stagger step", () => {
    const { container, getByText } = render(
      <Rise step={2}>
        <p>the sub</p>
      </Rise>,
    );
    expect(getByText("the sub")).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain("animate-rise");
    expect(container.firstElementChild?.className).toContain("rise-2");
  });

  it("carries layout classes through unchanged", () => {
    const { container } = render(
      <Rise step={1} className="flex flex-col">
        <p>content</p>
      </Rise>,
    );
    expect(container.firstElementChild?.className).toContain("flex flex-col");
  });

  // Reduced motion is a real BRANCH, not a shorter animation: the content still renders, it
  // simply never carries an animation class — the same contract Celebration states.
  it("keeps the content but drops every animation class under reduced motion", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const { container, getByText } = render(
      <Rise step={4} className="flex">
        <p>still here</p>
      </Rise>,
    );
    expect(getByText("still here")).toBeInTheDocument();
    expect(container.firstElementChild?.className).not.toContain("animate-rise");
    expect(container.firstElementChild?.className).not.toContain("rise-4");
    expect(container.firstElementChild?.className).toContain("flex");
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });
});
