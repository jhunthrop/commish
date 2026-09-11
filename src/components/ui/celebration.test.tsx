import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Celebration } from "./celebration";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

beforeEach(() => {
  vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
});

describe("Celebration", () => {
  it("announces itself politely, in both themes, axe-clean", async () => {
    await renderSurface(<Celebration title="You won!" detail="112.50 to 98.25" emphasis="self" />, async ({ container }) => {
      expect(screen.getByRole("status")).toHaveTextContent("You won!");
      expect(screen.getByText("112.50 to 98.25")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("slaps your own moment in on the amber wash, and springs somebody else's in on paper", () => {
    const mine = render(<Celebration title="You won!" emphasis="self" />);
    expect(mine.container.firstElementChild).toHaveClass("animate-slap-in");
    expect(mine.container.firstElementChild).toHaveClass("self-wash");
    expect(mine.container.firstElementChild!.className).not.toContain("bg-accent");
    mine.unmount();
    const theirs = render(<Celebration title="Iron Owls won." emphasis="peer" />);
    expect(theirs.container.firstElementChild).toHaveClass("animate-spring-in");
    expect(theirs.container.firstElementChild!.className).not.toContain("self-wash");
  });

  it("is a frame worth sending: the league, the people, the number with its basis, the date (P8)", async () => {
    await renderSurface(
      <Celebration
        title="You won week 3"
        emphasis="self"
        leagueName="Sunday Money"
        people={[{ name: "Dana Whitfield" }, { name: "Rey Okafor" }]}
        figure={{ value: "112.5 to 98.2", basis: "week 3, final" }}
        date="Sep 22"
      />,
      async ({ container }) => {
        expect(screen.getByText("Sunday Money")).toBeInTheDocument();
        expect(screen.getByText("Sep 22")).toBeInTheDocument();
        expect(screen.getByText("Dana Whitfield and Rey Okafor")).toBeInTheDocument();
        expect(screen.getByText("DW")).toBeInTheDocument();
        expect(screen.getByText("112.5 to 98.2")).toBeInTheDocument();
        expect(screen.getByText("week 3, final")).toBeInTheDocument();
        expect(container.firstElementChild!.className).toContain("rounded-xl");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("keeps the frame but drops the animation when the user asked for less motion", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const { container } = render(<Celebration title="You won!" emphasis="self" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.firstElementChild?.className).not.toContain("animate-");
  });
});
