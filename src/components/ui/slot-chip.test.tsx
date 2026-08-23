import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { SlotChip } from "./slot-chip";

describe("SlotChip", () => {
  it("renders the slot letter in a bordered chip, both themes, axe-clean", async () => {
    await renderSurface(<SlotChip slot="FLEX" />, async ({ container }) => {
      expect(screen.getByText("FLEX")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("carries a border, unlike a bare string", () => {
    render(<SlotChip slot="BENCH" />);
    expect(screen.getByText("BENCH").className).toContain("border-line");
  });

  // Task 1 (superflex): `RosterSlotType` gaining `SUPERFLEX` needs no change here — the chip
  // already renders whatever slot letter it's given. `PositionBadge` never gets this one,
  // because superflex is not a position.
  it("renders SUPERFLEX, the same as any other slot letter", () => {
    render(<SlotChip slot="SUPERFLEX" />);
    expect(screen.getByText("SUPERFLEX")).toBeInTheDocument();
  });
});
