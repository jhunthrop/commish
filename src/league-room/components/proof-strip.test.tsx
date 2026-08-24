import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { ProofStats } from "@/matchmaking/contract";
import { ProofStrip } from "./proof-strip";

const FULL_STATS: ProofStats = { leaguesFilled: 247, draftsNext48h: 12, rating: { average: 4.8, count: 63 }, any: true };
const EMPTY_STATS: ProofStats = { leaguesFilled: null, draftsNext48h: null, rating: null, any: false };

describe("ProofStrip", () => {
  it("renders no proof strip at all when the numbers have not earned it", () => {
    const { container } = render(<ProofStrip stats={EMPTY_STATS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links the rating to the reviews it came from, with its count beside it", () => {
    const { getByRole } = render(<ProofStrip stats={FULL_STATS} />);
    expect(getByRole("link", { name: "Read all 63 member reviews" })).toHaveAttribute("href", "/reviews");
  });

  it("shows each earned number above its floor, with no row for a null one", () => {
    const partial: ProofStats = { leaguesFilled: 247, draftsNext48h: null, rating: null, any: true };
    const { getByText, queryByText } = render(<ProofStrip stats={partial} />);
    expect(getByText("247")).toBeInTheDocument();
    expect(getByText(/leagues filled this season/)).toBeInTheDocument();
    expect(queryByText(/drafts in the next 48 hours/)).not.toBeInTheDocument();
    expect(queryByText(/member rating/)).not.toBeInTheDocument();
  });

  it("is axe-clean in both themes with a full strip", async () => {
    await renderSurface(<ProofStrip stats={FULL_STATS} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
