import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { WeekStatusBadge } from "./week-status-badge";

describe("WeekStatusBadge", () => {
  it("says a scheduled week hasn't started, in both themes, axe-clean", async () => {
    await renderSurface(<WeekStatusBadge status="scheduled" />, async ({ container }) => {
      expect(screen.getByText("Not started")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says an in-progress week is in progress, with the live pill's tinted ring, in both themes, axe-clean", async () => {
    await renderSurface(<WeekStatusBadge status="in_progress" />, async ({ container }) => {
      expect(screen.getByText("In progress")).toBeInTheDocument();
      expect(screen.getByText("In progress").className).toMatch(/ring-accent-glow/);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("gives no glow to a scheduled or final week", () => {
    const { rerender } = render(<WeekStatusBadge status="scheduled" />);
    expect(screen.getByText("Not started").className).not.toMatch(/ring-/);
    rerender(<WeekStatusBadge status="final" />);
    expect(screen.getByText("Final").className).not.toMatch(/ring-/);
  });

  it("says a final week is final, in both themes, axe-clean", async () => {
    await renderSurface(<WeekStatusBadge status="final" />, async ({ container }) => {
      expect(screen.getByText("Final")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
