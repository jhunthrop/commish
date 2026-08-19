import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { WeekStatusBadge } from "./week-status-badge";

describe("WeekStatusBadge", () => {
  it("says a scheduled week hasn't started, in both themes, axe-clean", async () => {
    await inBothThemes(<WeekStatusBadge status="scheduled" />, async ({ container }) => {
      expect(screen.getByText("Not started")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says an in-progress week is in progress, in both themes, axe-clean", async () => {
    await inBothThemes(<WeekStatusBadge status="in_progress" />, async ({ container }) => {
      expect(screen.getByText("In progress")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says a final week is final, in both themes, axe-clean", async () => {
    await inBothThemes(<WeekStatusBadge status="final" />, async ({ container }) => {
      expect(screen.getByText("Final")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
