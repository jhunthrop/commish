import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Celebration } from "./celebration";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

describe("Celebration", () => {
  it("announces itself politely, in both themes, axe-clean", async () => {
    await renderSurface(<Celebration title="You won!" detail="112.50 to 98.25" emphasis="self" />, async ({ container }) => {
      expect(screen.getByRole("status")).toHaveTextContent("You won!");
      expect(screen.getByText("112.50 to 98.25")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("uses a different treatment for your own moment than for somebody else's", () => {
    const mine = render(<Celebration title="You won!" emphasis="self" />);
    expect(mine.container.firstElementChild).toHaveClass("animate-celebrate-self");
    mine.unmount();
    const theirs = render(<Celebration title="Iron Owls won." emphasis="peer" />);
    expect(theirs.container.firstElementChild).toHaveClass("animate-celebrate-peer");
  });

  it("keeps the panel but drops the animation when the user asked for less motion", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const { container } = render(<Celebration title="You won!" emphasis="self" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.firstElementChild?.className).not.toContain("animate-celebrate");
  });
});
