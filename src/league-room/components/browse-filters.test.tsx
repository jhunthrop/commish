import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { BrowseFilters } from "./browse-filters";

describe("BrowseFilters", () => {
  it("offers every filter as a labelled control, in both themes, axe-clean", async () => {
    await inBothThemes(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />, async ({ container }) => {
      expect(screen.getByLabelText("Draft format")).toBeInTheDocument();
      expect(screen.getByLabelText("Experience")).toBeInTheDocument();
      expect(screen.getByLabelText("Stake tier")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show leagues" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("carries the no-money disclosure right under the stake tier control, not only in the footer", () => {
    render(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />);
    expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
  });

  it("submits as a plain GET to /browse, so the URL is the filter and it works with no JavaScript", () => {
    const { container } = render(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />);
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/browse");
  });

  it("reflects the filter already applied, so a shared link renders its own state", () => {
    render(<BrowseFilters filter={{ format: "auction", experienceTier: "experienced", stakeTier: 3 }} />);
    expect(screen.getByLabelText<HTMLSelectElement>("Draft format").value).toBe("auction");
    expect(screen.getByLabelText<HTMLSelectElement>("Experience").value).toBe("experienced");
    expect(screen.getByLabelText<HTMLSelectElement>("Stake tier").value).toBe("3");
  });

  it("offers only the formats the draft engine can actually run", () => {
    render(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />);
    const options = [...screen.getByLabelText<HTMLSelectElement>("Draft format").options].map((o) => o.value);
    expect(options).toEqual(["any", "snake", "auction"]);
  });
});
