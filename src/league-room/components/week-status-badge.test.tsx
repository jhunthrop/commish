import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { WeekStatusBadge } from "./week-status-badge";

/**
 * FUN PASS, TASK 4: the in-progress week reads "Live", not "In progress". "In progress" is the
 * canonical administrative phrase for a thing that is happening, and it is the exact register
 * the founder named. The tone was already `negative` — live is one of the two things red is
 * allowed to mean (rule 1) — so only the word was ever wrong. Changed here and at every
 * renderer of this badge in the same commit, plus the two e2e specs that read it.
 */
describe("WeekStatusBadge", () => {
  it("says a scheduled week hasn't started, in both themes, axe-clean", async () => {
    await renderSurface(<WeekStatusBadge status="scheduled" />, async ({ container }) => {
      expect(screen.getByText("Not started")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says an in-progress week is live, in the live channel's own ink, in both themes, axe-clean", async () => {
    await renderSurface(<WeekStatusBadge status="in_progress" />, async ({ container }) => {
      expect(screen.getByText("Live")).toBeInTheDocument();
      // Sunday v5's channel split: `live` is its own ink now, never the negative red, and the
      // live state is a LiveMarker (dot beside the word) rather than a ringed pill.
      expect(screen.getByText("Live").className).toMatch(/text-live/);
      expect(screen.getByText("Live").className).not.toMatch(/ring-/);
      expect(screen.getByText("Live").className).not.toMatch(/negative/);
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
