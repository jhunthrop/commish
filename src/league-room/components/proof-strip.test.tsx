import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { ProofStats } from "@/matchmaking/contract";
import { ProofStrip } from "./proof-strip";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

/** Fixed instants, five hours apart — every relative claim in this file derives from these two. */
const NOW = "2026-09-10T12:00:00.000Z";
const IN_FIVE_HOURS = "2026-09-10T17:00:00.000Z";
const IN_THIRTY_MINUTES = "2026-09-10T12:30:00.000Z";

const FULL_STATS: ProofStats = {
  leaguesFilled: 247,
  draftsNext48h: 12,
  rating: { average: 4.8, count: 63 },
  nextDraftAt: IN_FIVE_HOURS,
  any: true,
};
const EMPTY_STATS: ProofStats = { leaguesFilled: null, draftsNext48h: null, rating: null, nextDraftAt: null, any: false };

describe("ProofStrip", () => {
  it("renders no proof strip at all when the numbers have not earned it", () => {
    const { container } = render(<ProofStrip stats={EMPTY_STATS} nowIso={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links the rating to the reviews it came from, with its count beside it", () => {
    const { getByRole } = render(<ProofStrip stats={FULL_STATS} nowIso={NOW} />);
    expect(getByRole("link", { name: "Read all 63 member reviews" })).toHaveAttribute("href", "/reviews");
  });

  it("shows each earned number above its floor, with no row for a null one", () => {
    const partial: ProofStats = { leaguesFilled: 247, draftsNext48h: null, rating: null, nextDraftAt: null, any: true };
    const { getByText, queryByText } = render(<ProofStrip stats={partial} nowIso={NOW} />);
    expect(getByText("247")).toBeInTheDocument();
    expect(getByText(/leagues filled this season/)).toBeInTheDocument();
    expect(queryByText(/drafts in the next 48 hours/)).not.toBeInTheDocument();
    expect(queryByText(/member rating/)).not.toBeInTheDocument();
  });

  // Task 7 (Spec): the strip re-renders as the mock's score chips — hairline-bordered
  // rounded-lg, mono tabular numbers, quiet labels.
  it("renders each stat as a hairline-bordered score chip with a mono tabular number", () => {
    const { getByText } = render(<ProofStrip stats={FULL_STATS} nowIso={NOW} />);
    const number = getByText("247");
    expect(number.className).toContain("font-mono");
    expect(number.className).toContain("tabular-nums");
    const chip = number.closest("p");
    expect(chip?.className).toContain("rounded-lg");
    expect(chip?.className).toContain("border-line");
  });

  it("prints leaguesFilled in ink and the live draftsNext48h count in text-negative", () => {
    const { getByText } = render(<ProofStrip stats={FULL_STATS} nowIso={NOW} />);
    expect(getByText("247").className).toContain("text-text-primary");
    expect(getByText("12").className).toContain("text-negative");
  });

  // Task 7 (Spec): the third chip — a real next draft inside the window, worded coarsely.
  it("renders the next draft as a coarse hour count when one is scheduled inside the window", () => {
    const { getByText } = render(<ProofStrip stats={FULL_STATS} nowIso={NOW} />);
    expect(getByText("5")).toBeInTheDocument();
    expect(getByText("hours until the next draft")).toBeInTheDocument();
  });

  it("switches to minutes under an hour, singular when it must", () => {
    const soon: ProofStats = { ...FULL_STATS, nextDraftAt: IN_THIRTY_MINUTES };
    const { getByText } = render(<ProofStrip stats={soon} nowIso={NOW} />);
    expect(getByText("30")).toBeInTheDocument();
    expect(getByText("minutes until the next draft")).toBeInTheDocument();

    const oneMinute: ProofStats = { ...FULL_STATS, nextDraftAt: "2026-09-10T12:00:45.000Z" };
    const single = render(<ProofStrip stats={oneMinute} nowIso={NOW} />);
    expect(single.getByText("1")).toBeInTheDocument();
    expect(single.getByText("minute until the next draft")).toBeInTheDocument();
  });

  // Real or absent, never dressed up: a null instant renders no chip, and so does one the 60s
  // cache let slip into the past — "1 minute until" a draft that already kicked off is dressing.
  it("omits the next-draft chip when the instant is absent or already behind now", () => {
    const absent: ProofStats = { ...FULL_STATS, nextDraftAt: null };
    expect(render(<ProofStrip stats={absent} nowIso={NOW} />).queryByText(/until the next draft/)).not.toBeInTheDocument();

    const past: ProofStats = { ...FULL_STATS, nextDraftAt: "2026-09-10T11:59:00.000Z" };
    expect(render(<ProofStrip stats={past} nowIso={NOW} />).queryByText(/until the next draft/)).not.toBeInTheDocument();
  });

  // Task 7 (hero band): the strip is the hero's fourth riser, and reduced motion is a real
  // branch — the chips stay, the animation classes go.
  it("rises fourth, and drops the animation when the user asked for less motion", () => {
    const animated = render(<ProofStrip stats={FULL_STATS} nowIso={NOW} />);
    expect(animated.container.firstElementChild?.className).toContain("animate-rise");
    expect(animated.container.firstElementChild?.className).toContain("rise-4");
    animated.unmount();

    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const still = render(<ProofStrip stats={FULL_STATS} nowIso={NOW} />);
    expect(still.getByText("247")).toBeInTheDocument();
    expect(still.container.firstElementChild?.className).not.toContain("animate-rise");
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  it("is axe-clean in both themes with a full strip", async () => {
    await renderSurface(<ProofStrip stats={FULL_STATS} nowIso={NOW} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
