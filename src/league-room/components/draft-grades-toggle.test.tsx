import { describe, it, expect } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { DraftGradesToggle } from "./draft-grades-toggle";

describe("DraftGradesToggle", () => {
  it("shows the on state and its honest description, in both themes, axe-clean", async () => {
    await renderSurface(<DraftGradesToggle leagueId="l1" visible={true} />, async ({ container }) => {
      expect(screen.getByText("Draft grades on league home")).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "On" });
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("Every manager sees the letter grades on league home once the draft ends.")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("shows the off state with its own honest description", () => {
    renderInLeague(<DraftGradesToggle leagueId="l1" visible={false} />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Grades stay off league home. Nobody in this league sees them.")).toBeInTheDocument();
  });

  it("flips on click and writes the change through PUT /api/leagues/[leagueId]/settings", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { draftGradesVisible: false } });
    renderInLeague(<DraftGradesToggle leagueId="l1" visible={true} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "On" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Off" })).toBeInTheDocument());
    expect(fixture.calls).toEqual([`PUT /api/leagues/l1/settings`]);
  });

  it("rolls the button back to its prior state when the server refuses the write", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "Only the commissioner can do that." });
    renderInLeague(<DraftGradesToggle leagueId="l1" visible={true} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "On" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Only the commissioner can do that."));
    expect(screen.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
  });
});
