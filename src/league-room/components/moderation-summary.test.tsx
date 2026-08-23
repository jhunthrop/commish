import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { ModerationSummaryView } from "../contract";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { ModerationSummary } from "./moderation-summary";

const POPULATED: ModerationSummaryView = { removedMessages: 2, removedReviews: 1, mostRecentAt: "2026-08-19T14:02:00.000Z", openQuestions: 1 };
const HEALTHY: ModerationSummaryView = { removedMessages: 0, removedReviews: 0, mostRecentAt: null, openQuestions: 0 };

describe("ModerationSummary", () => {
  it("says what the window is and what it deliberately is not, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: POPULATED });
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <ModerationSummary leagueId="l1" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        await screen.findByText("2");
        expect(
          screen.getByText("Commish reviews reports in every league. We keep the details between the people involved and our operators."),
        ).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows the loading skeleton before the fetch resolves", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: POPULATED }, { deferred: true });
    renderInLeague(<ModerationSummary leagueId="l1" />, fixture.deps);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows four counts and a date once loaded, and links every count to its own label", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: POPULATED });
    renderInLeague(<ModerationSummary leagueId="l1" />, fixture.deps);

    await screen.findByText("Messages removed");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Reviews removed")).toBeInTheDocument();
    expect(screen.getByText("Open questions")).toBeInTheDocument();
    expect(screen.getAllByText("1", { selector: "dd" })).toHaveLength(2); // reviews removed, and open questions
    expect(screen.getByText("Most recent")).toBeInTheDocument();
    const time = document.querySelector("time");
    expect(time).toHaveAttribute("dateTime", POPULATED.mostRecentAt);
    expect(time?.textContent).toBe(new Date(POPULATED.mostRecentAt!).toLocaleDateString());
  });

  it("shows the healthy empty state — a real state, and the only one anybody sees on a healthy league", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: HEALTHY });
    renderInLeague(<ModerationSummary leagueId="l1" />, fixture.deps);
    expect(await screen.findByText("Nothing has needed attention.")).toBeInTheDocument();
    expect(screen.queryByText("Messages removed")).not.toBeInTheDocument();
  });

  it("never names who was moderated, what they said, or why", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: POPULATED });
    renderInLeague(<ModerationSummary leagueId="l1" />, fixture.deps);
    await screen.findByText("Messages removed");
    expect(document.body.textContent ?? "").not.toMatch(/u_bob|u_[a-z]+_\d/);
  });

  it("shows the server's reason and a retry on failure, and recovers once retried", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "Something went wrong on our side. Please try again." });
    renderInLeague(<ModerationSummary leagueId="l1" />, fixture.deps);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on our side."));
    fixture.response = { ok: true, data: HEALTHY };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing has needed attention.")).toBeInTheDocument();
  });

  it("shows a connection error when the fetch itself throws", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: HEALTHY });
    fixture.deps = { ...fixture.deps, fetchJson: async () => { throw new Error("network down"); } };
    renderInLeague(<ModerationSummary leagueId="l1" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("We couldn't reach the server."));
  });

  it("renders no dead cell for a healthy count with no date — mostRecentAt is genuinely optional", async () => {
    const noDate: ModerationSummaryView = { removedMessages: 1, removedReviews: 0, mostRecentAt: null, openQuestions: 0 };
    const fixture = fixtureLeagueDeps({ ok: true, data: noDate });
    renderInLeague(<ModerationSummary leagueId="l1" />, fixture.deps);
    await screen.findByText("Messages removed");
    expect(screen.queryByText("Most recent")).not.toBeInTheDocument();
  });
});
