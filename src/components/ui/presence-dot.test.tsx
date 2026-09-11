import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { PresenceDot } from "./presence-dot";

describe("PresenceDot", () => {
  it("is live green, breathes, and stays decorative unless labelled, in both themes", async () => {
    await renderSurface(<PresenceDot />, async ({ container }) => {
      const dot = screen.getByTestId("presence-dot");
      expect(dot.className).toContain("bg-live");
      expect(dot.className).toContain("animate-breathe");
      expect(dot).toHaveAttribute("aria-hidden", "true");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("announces itself when given a label", async () => {
    const { container } = render(<PresenceDot label="Dana is here" />);
    expect(screen.getByRole("img", { name: "Dana is here" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("holds still when the reader asked for less motion, and stays green", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    render(<PresenceDot />);
    const dot = screen.getByTestId("presence-dot");
    expect(dot.className).not.toContain("animate-breathe");
    expect(dot.className).toContain("bg-live");
  });
});
