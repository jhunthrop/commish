import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ADVISOR_CONFIG } from "@/domain/advisor";
import { renderSurface } from "@/components/ui/test-utils";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { AdvisorPanel } from "./advisor-panel";

const ADVICE = {
  ok: true,
  data: { headline: "Start Volume Slot.", reasoning: "Ten catches a week is ten points a week in this league.", degraded: false },
};

const DEGRADED = { ok: true, data: { ...ADVICE.data, degraded: true } };

describe("AdvisorPanel", () => {
  it("says what it is and offers one action, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps(ADVICE);
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <AdvisorPanel leagueId="l1" weekNumber={4} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        // The aside ("Advice only. You make the move.") died in the 2026-08-30 scan pass; the
        // eyebrow heading and the single quiet button carry the whole identity now.
        expect(screen.getByRole("heading", { name: "Lineup advisor" })).toBeInTheDocument();
        expect(screen.getByLabelText("Ask about your lineup")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Get advice" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("asks the advisor for this league and week, and shows the answer", async () => {
    const fixture = fixtureLeagueDeps(ADVICE);
    renderInLeague(<AdvisorPanel leagueId="l1" weekNumber={4} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("Ask about your lineup"), { target: { value: "Who do I start at WR?" } });
    fireEvent.click(screen.getByRole("button", { name: "Get advice" }));

    await waitFor(() => expect(screen.getByText("Start Volume Slot.")).toBeInTheDocument());
    expect(screen.getByText("Ten catches a week is ten points a week in this league.")).toBeInTheDocument();
    expect(fixture.calls).toEqual(["POST /api/leagues/l1/advisor/start-sit"]);
  });

  it("labels a degraded answer without treating it as a failure", async () => {
    const fixture = fixtureLeagueDeps(DEGRADED);
    renderInLeague(<AdvisorPanel leagueId="l1" weekNumber={4} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("Ask about your lineup"), { target: { value: "Who do I start?" } });
    fireEvent.click(screen.getByRole("button", { name: "Get advice" }));

    await waitFor(() => expect(screen.getByText("Offline advice")).toBeInTheDocument());
    expect(screen.getByText("Start Volume Slot.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the server's reason when the advisor can't answer, and keeps the question", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "You do not have a team in this league." });
    renderInLeague(<AdvisorPanel leagueId="l1" weekNumber={4} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("Ask about your lineup"), { target: { value: "Who do I start?" } });
    fireEvent.click(screen.getByRole("button", { name: "Get advice" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("You do not have a team in this league."));
    expect(screen.getByLabelText("Ask about your lineup")).toHaveValue("Who do I start?");
  });

  it("caps the question at the server's own limit, imported not restated", () => {
    const fixture = fixtureLeagueDeps(ADVICE);
    renderInLeague(<AdvisorPanel leagueId="l1" weekNumber={4} />, fixture.deps);
    expect(screen.getByLabelText("Ask about your lineup")).toHaveAttribute("maxLength", String(ADVISOR_CONFIG.maxQuestionLength));
  });

  it("does not call the advisor for an empty question", () => {
    const fixture = fixtureLeagueDeps(ADVICE);
    renderInLeague(<AdvisorPanel leagueId="l1" weekNumber={4} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Get advice" }));
    expect(fixture.calls).toEqual([]);
  });

  it("offers no way to apply the advice — advisory-only is visible in the markup, not just the server", async () => {
    const fixture = fixtureLeagueDeps(ADVICE);
    renderInLeague(<AdvisorPanel leagueId="l1" weekNumber={4} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("Ask about your lineup"), { target: { value: "Who do I start?" } });
    fireEvent.click(screen.getByRole("button", { name: "Get advice" }));
    await waitFor(() => expect(screen.getByText("Start Volume Slot.")).toBeInTheDocument());

    for (const label of ["Apply", "Set lineup", "Accept", "Do it"]) {
      expect(screen.queryByRole("button", { name: new RegExp(label, "i") })).not.toBeInTheDocument();
    }
  });
});
