import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { ProofStats } from "@/matchmaking/contract";
import { ProofStrip } from "./proof-strip";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

const FULL_STATS: ProofStats = {
  leaguesFilled: 247,
  roomsFillingNow: 12,
  rating: { average: 4.8, count: 63 },
  tightestRoomSeatsRemaining: 5,
  any: true,
};
const EMPTY_STATS: ProofStats = { leaguesFilled: null, roomsFillingNow: null, rating: null, tightestRoomSeatsRemaining: null, any: false };

describe("ProofStrip (repointed by storefront review R1)", () => {
  it("renders no proof strip at all when the numbers have not earned it", () => {
    const { container } = render(<ProofStrip stats={EMPTY_STATS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links the rating to the reviews it came from, with its count beside it", () => {
    const { getByRole } = render(<ProofStrip stats={FULL_STATS} />);
    expect(getByRole("link", { name: "Read all 63 member reviews" })).toHaveAttribute("href", "/reviews");
  });

  it("shows each earned number above its floor, with no row for a null one", () => {
    const partial: ProofStats = { leaguesFilled: 247, roomsFillingNow: null, rating: null, tightestRoomSeatsRemaining: null, any: true };
    const { getByText, queryByText } = render(<ProofStrip stats={partial} />);
    expect(getByText("247")).toBeInTheDocument();
    expect(getByText(/leagues filled this season/)).toBeInTheDocument();
    expect(queryByText(/rooms filling right now/)).not.toBeInTheDocument();
    expect(queryByText(/member rating/)).not.toBeInTheDocument();
  });

  // Task 7 (Spec): the strip re-renders as the mock's score chips — hairline-bordered
  // rounded-lg, mono tabular numbers, quiet labels.
  it("renders each stat as a hairline-bordered score chip with a mono tabular number", () => {
    const { getByText } = render(<ProofStrip stats={FULL_STATS} />);
    const number = getByText("247");
    expect(number.className).toContain("font-mono");
    expect(number.className).toContain("tabular-nums");
    const chip = number.closest("p");
    expect(chip?.className).toContain("rounded-lg");
    expect(chip?.className).toContain("border-line");
  });

  it("prints leaguesFilled in ink and the live roomsFillingNow count in text-negative", () => {
    const { getByText } = render(<ProofStrip stats={FULL_STATS} />);
    expect(getByText("247").className).toContain("text-text-primary");
    expect(getByText("12").className).toContain("text-negative");
    expect(getByText(/rooms filling right now/)).toBeInTheDocument();
  });

  // Storefront review R1: the third chip — how few seats are left in the tightest room, worded
  // as a plain count rather than a countdown to a kickoff a sit-and-go shelf no longer has.
  it("renders the tightest room's seats remaining, pluralized honestly", () => {
    const { getByText } = render(<ProofStrip stats={FULL_STATS} />);
    expect(getByText("5")).toBeInTheDocument();
    expect(getByText("seats left in the tightest room")).toBeInTheDocument();
  });

  it("keeps the label singular for exactly one seat left", () => {
    const oneLeft: ProofStats = { ...FULL_STATS, tightestRoomSeatsRemaining: 1 };
    const { getByText } = render(<ProofStrip stats={oneLeft} />);
    expect(getByText("1")).toBeInTheDocument();
    expect(getByText("seat left in the tightest room")).toBeInTheDocument();
  });

  // Real or absent, never dressed up: nothing filling renders no chip at all.
  it("omits the tightest-room chip when nothing is filling", () => {
    const absent: ProofStats = { ...FULL_STATS, tightestRoomSeatsRemaining: null };
    expect(render(<ProofStrip stats={absent} />).queryByText(/left in the tightest room/)).not.toBeInTheDocument();
  });

  // Task 7 (hero band): the strip is the hero's fourth riser, and reduced motion is a real
  // branch — the chips stay, the animation classes go.
  it("rises fourth, and drops the animation when the user asked for less motion", () => {
    const animated = render(<ProofStrip stats={FULL_STATS} />);
    expect(animated.container.firstElementChild?.className).toContain("animate-rise");
    expect(animated.container.firstElementChild?.className).toContain("rise-4");
    animated.unmount();

    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const still = render(<ProofStrip stats={FULL_STATS} />);
    expect(still.getByText("247")).toBeInTheDocument();
    expect(still.container.firstElementChild?.className).not.toContain("animate-rise");
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  it("is axe-clean in both themes with a full strip", async () => {
    await renderSurface(<ProofStrip stats={FULL_STATS} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
