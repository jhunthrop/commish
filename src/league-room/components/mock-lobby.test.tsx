import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { MockLobby } from "./mock-lobby";

const calls: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => calls.push(`push:${href}`) }),
}));

const OPEN_ROOM = { leagueId: "l1", shareCode: "OPEN01", teamCount: 10, seatsOpen: 3, pickSeconds: 60, startsInMs: 90_000 };
const MINE_ROOM = { leagueId: "l2", draftId: "d2", shareCode: "MINE01", teamCount: 8, seatsOpen: 0, pickSeconds: 30, startsInMs: -5_000, mode: "solo" as const, status: "in_progress" as const };

function baseProps() {
  return {
    initialOpen: [],
    initialMine: [],
    modes: ["solo", "lobby", "link"] as const,
    teamCountOptions: [8, 10, 12],
    pickSecondsOptions: [30, 60, 90],
    defaultTeamCount: 12,
    defaultPickSeconds: 60,
    emptyMessage: "No practice drafts are open right now.",
    emptyActionLabel: "Start a mock draft",
  };
}

describe("MockLobby", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("shows the empty-lobby invitation when nothing is open, pointing at an immediate solo start", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} />, fixture.deps);
    expect(screen.getByText("No practice drafts are open right now.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a mock draft" })).toHaveAttribute("href", "/app/mock-drafts?create=solo");
  });

  it("renders an open room's own facts, and a plain no-rooms sentence for mine when both start empty", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} initialOpen={[OPEN_ROOM]} />, fixture.deps);
    expect(screen.getByText("10 teams · 3 open · 60s clock")).toBeInTheDocument();
    expect(screen.getByText("You have no practice rooms yet.")).toBeInTheDocument();
  });

  it("renders one of the caller's own rooms with the status-appropriate link label", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} initialMine={[MINE_ROOM]} />, fixture.deps);
    expect(screen.getByText("Drafting now")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/app/drafts/d2");
  });

  it("refreshes the open and mine lists from the live read on request", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { open: [OPEN_ROOM], mine: [MINE_ROOM] } });
    renderInLeague(<MockLobby {...baseProps()} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText("10 teams · 3 open · 60s clock")).toBeInTheDocument());
    expect(fixture.calls).toEqual(["GET /api/mock-drafts"]);
  });

  it("joins an open room and navigates straight into it", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", draftId: "d1", teamId: "t1", alreadySeated: false } });
    renderInLeague(<MockLobby {...baseProps()} initialOpen={[OPEN_ROOM]} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(calls).toEqual(["push:/app/drafts/d1"]));
    expect(fixture.calls).toEqual(["POST /api/mock-drafts/OPEN01"]);
  });

  it("shows the server's own refusal when a join fails, and never navigates", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "This practice draft is already full. Start a new one whenever you like." });
    renderInLeague(<MockLobby {...baseProps()} initialOpen={[OPEN_ROOM]} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already full");
    expect(calls).toEqual([]);
  });

  it("navigates straight into a newly created room from its own setup form", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l9", teamId: "t1", draftId: "d9", shareCode: "NEW001", startsAt: "2026-08-25T12:00:00.000Z" } });
    renderInLeague(<MockLobby {...baseProps()} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Start practice draft" }));
    await waitFor(() => expect(calls).toEqual(["push:/app/drafts/d9"]));
  });

  it("is axe-clean in both themes, populated", async () => {
    await renderSurface(<MockLobby {...baseProps()} initialOpen={[OPEN_ROOM]} initialMine={[MINE_ROOM]} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
