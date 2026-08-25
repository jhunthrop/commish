import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { BrowseFilters } from "./browse-filters";

describe("BrowseFilters", () => {
  it("ships exactly four controls: All, Drafting soonest, Drafts when full, Newer players", async () => {
    await renderSurface(<BrowseFilters active="all" />, async ({ container }) => {
      const nav = screen.getByRole("navigation", { name: "Filter open leagues" });
      const links = nav.querySelectorAll("a");
      expect(links).toHaveLength(4);
      expect(screen.getByRole("link", { name: "All" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Drafting soonest" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Drafts when full" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Newer players" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("never offers Superflex or Median game as filters — they are card facts, not filter axes", async () => {
    await renderSurface(<BrowseFilters active="all" />, ({ container }) => {
      expect(container.textContent).not.toMatch(/Superflex/);
      expect(container.textContent).not.toMatch(/Median game/);
    });
  });

  it("points 'Drafting soonest' at the sort param, not a narrowing filter", async () => {
    await renderSurface(<BrowseFilters active="all" />, () => {
      expect(screen.getByRole("link", { name: "Drafting soonest" })).toHaveAttribute("href", "/browse?sort=soonest");
    });
  });

  it("points 'Drafts when full' and 'Newer players' at their own params", async () => {
    await renderSurface(<BrowseFilters active="all" />, () => {
      expect(screen.getByRole("link", { name: "Drafts when full" })).toHaveAttribute("href", "/browse?whenFull=1");
      expect(screen.getByRole("link", { name: "Newer players" })).toHaveAttribute("href", "/browse?experienceTier=beginner");
    });
  });

  it("marks exactly one control current, matching the caller's own active option", async () => {
    await renderSurface(<BrowseFilters active="soonest" />, () => {
      expect(screen.getByRole("link", { name: "Drafting soonest" })).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
      expect(screen.getByRole("link", { name: "Drafts when full" })).not.toHaveAttribute("aria-current");
      expect(screen.getByRole("link", { name: "Newer players" })).not.toHaveAttribute("aria-current");
    });
  });

  it("dresses the active control as an ink-bordered quiet pill — never a filled one (Task 6 restyle)", async () => {
    await renderSurface(<BrowseFilters active="soonest" />, () => {
      const active = screen.getByRole("link", { name: "Drafting soonest" });
      expect(active.className).toContain("border-text-primary");
      expect(active.className).not.toContain("bg-surface-elevated");
      const quiet = screen.getByRole("link", { name: "All" });
      expect(quiet.className).toContain("border-line");
      expect(quiet.className).not.toContain("bg-surface-elevated");
    });
  });

  it("'All' clears back to the unfiltered browse", async () => {
    await renderSurface(<BrowseFilters active="when_full" />, () => {
      expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/browse");
    });
  });
});
