import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { ViewSwitch, ViewSwitchNav } from "./view-switch";

const STOPS = [
  { value: "board", label: "Board" },
  { value: "sheet", label: "Your sheet" },
  { value: "mocks", label: "Mock drafts" },
];

const DESTINATIONS = [
  { value: "board", label: "Board", href: "/app/draft/board" },
  { value: "sheet", label: "Your sheet", href: "/app/draft/sheet" },
  { value: "mocks", label: "Mock drafts", href: "/app/draft/mock-drafts" },
];

describe("ViewSwitch", () => {
  it("lifts the stop you are on off the track, in both themes, axe-clean", async () => {
    await renderSurface(<ViewSwitch label="Draft view" stops={STOPS} value="sheet" onChange={() => {}} />, async ({ container }) => {
      const track = screen.getByTestId("view-switch");
      expect(track.className).toContain("bg-surface-inset");
      const here = within(track).getByRole("tab", { name: "Your sheet" });
      expect(here).toHaveAttribute("aria-selected", "true");
      expect(here.className).toContain("bg-surface-elevated");
      expect(here.className).toContain("shadow-card");
      // The stops you are not on carry no fill at all: one thumb on the track, always.
      expect(within(track).getByRole("tab", { name: "Board" }).className).not.toContain("bg-surface-elevated");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("hands back the stop that was pressed", async () => {
    const onChange = vi.fn();
    await renderSurface(<ViewSwitch label="Draft view" stops={STOPS} value="board" onChange={onChange} />, () => {
      fireEvent.click(screen.getByRole("tab", { name: "Mock drafts" }));
      expect(onChange).toHaveBeenCalledWith("mocks");
    });
  });
});

describe("ViewSwitchNav", () => {
  it("wears the identical track with each stop as its own address, in both themes, axe-clean", async () => {
    await renderSurface(<ViewSwitchNav label="Draft view" stops={DESTINATIONS} value="board" />, async ({ container }) => {
      const track = screen.getByTestId("view-switch");
      expect(track.className).toContain("bg-surface-inset");
      const here = within(track).getByRole("link", { name: "Board" });
      expect(here).toHaveAttribute("aria-current", "page");
      expect(here).toHaveAttribute("href", "/app/draft/board");
      expect(here.className).toContain("bg-surface-elevated");
      expect(within(track).getByRole("link", { name: "Mock drafts" })).toHaveAttribute("href", "/app/draft/mock-drafts");
      expect(within(track).getByRole("link", { name: "Your sheet" })).not.toHaveAttribute("aria-current");
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
