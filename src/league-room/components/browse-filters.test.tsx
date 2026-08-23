import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { BrowseFilters } from "./browse-filters";

describe("BrowseFilters", () => {
  it("offers every filter as a labelled control, in both themes, axe-clean", async () => {
    await renderSurface(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />, async ({ container }) => {
      expect(screen.getByLabelText("Draft format")).toBeInTheDocument();
      expect(screen.getByLabelText("Experience")).toBeInTheDocument();
      expect(screen.getByLabelText("Stake tier")).toBeInTheDocument();
      expect(screen.getByLabelText("Who's playing")).toBeInTheDocument();
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
    render(
      <BrowseFilters filter={{ format: "auction", experienceTier: "experienced", stakeTier: 3, participationTier: "veteran" }} />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Draft format").value).toBe("auction");
    expect(screen.getByLabelText<HTMLSelectElement>("Experience").value).toBe("experienced");
    expect(screen.getByLabelText<HTMLSelectElement>("Stake tier").value).toBe("3");
    expect(screen.getByLabelText<HTMLSelectElement>("Who's playing").value).toBe("veteran");
  });

  it("offers only the formats the draft engine can actually run", () => {
    render(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />);
    const options = [...screen.getByLabelText<HTMLSelectElement>("Draft format").options].map((o) => o.value);
    expect(options).toEqual(["any", "snake", "auction"]);
  });

  it("offers exactly the two participation tiers the platform computes, plus 'any', defaulting to any", () => {
    render(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />);
    const select = screen.getByLabelText<HTMLSelectElement>("Who's playing");
    expect([...select.options].map((o) => o.value)).toEqual(["any", "newcomer", "veteran"]);
    expect(select.value).toBe("any");
  });

  it("is reachable by keyboard, in the natural tab order, and choosable without a mouse", async () => {
    const user = userEvent.setup();
    render(<BrowseFilters filter={EMPTY_BROWSE_FILTER} />);
    await user.tab();
    expect(screen.getByLabelText("Draft format")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Experience")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Stake tier")).toHaveFocus();
    await user.tab();
    const participationSelect = screen.getByLabelText<HTMLSelectElement>("Who's playing");
    expect(participationSelect).toHaveFocus();
    await user.selectOptions(participationSelect, "newcomer");
    expect(participationSelect.value).toBe("newcomer");
    await user.tab();
    expect(screen.getByRole("button", { name: "Show leagues" })).toHaveFocus();
  });
});
