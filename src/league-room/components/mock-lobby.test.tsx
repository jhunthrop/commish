import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { MyMockRoomSummary } from "@/mock-draft-service/lobby";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { MockLobby, historyGroupFor, historyWhenSentence, soloQuickStartLabel } from "./mock-lobby";

const calls: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => calls.push(`push:${href}`) }),
}));

const OPEN_ROOM = { leagueId: "l1", shareCode: "OPEN01", teamCount: 10, seatsOpen: 3, pickSeconds: 60, startsInMs: 90_000 };
const MINE_ROOM: MyMockRoomSummary = {
  leagueId: "l2",
  draftId: "d2",
  shareCode: "MINE01",
  teamCount: 8,
  seatsOpen: 0,
  pickSeconds: 30,
  startsInMs: -5_000,
  mode: "solo",
  status: "in_progress",
  teamName: "Mock Squad",
};

function baseProps() {
  return {
    initialOpen: [],
    initialMine: [],
    initialWireItems: [],
    modes: ["solo", "lobby", "link"] as const,
    teamCountOptions: [8, 10, 12],
    pickSecondsOptions: [30, 60, 90],
    defaultTeamCount: 12,
    defaultPickSeconds: 60,
    emptyMessage: "No mock drafts are open right now.",
    historyEmptyMessage: "You have no mock drafts yet.",
  };
}

function mineRoom(overrides: Partial<MyMockRoomSummary> & { readonly draftId: string; readonly leagueId: string; readonly shareCode: string }): MyMockRoomSummary {
  return { ...MINE_ROOM, ...overrides };
}

describe("soloQuickStartLabel", () => {
  it("states the actual defaults it will create, never a bare generic label", () => {
    expect(soloQuickStartLabel(12, 60)).toBe("Start a solo mock now, 12 teams, 60s clock");
    expect(soloQuickStartLabel(8, 30)).toBe("Start a solo mock now, 8 teams, 30s clock");
  });

});

describe("historyWhenSentence", () => {
  it("reads forward for a room still waiting to fill", () => {
    expect(historyWhenSentence("scheduled", 90_000)).toBe("Starts in 2 minutes");
    expect(historyWhenSentence("scheduled", -1)).toBe("Starting any moment");
  });

  it("reads backward, as X ago, for a room that already started, finished, or was abandoned", () => {
    expect(historyWhenSentence("complete", -3_600_000)).toBe("1 hour ago");
    expect(historyWhenSentence("in_progress", -5_000)).toBe("under a minute ago");
  });
});

describe("historyGroupFor", () => {
  const now = Date.parse("2026-08-26T12:00:00.000Z");

  it("buckets the same calendar day as Today", () => {
    expect(historyGroupFor(now - 1_000, now)).toBe("Today");
  });

  it("buckets the prior calendar day as Yesterday, regardless of hour", () => {
    expect(historyGroupFor(Date.parse("2026-08-25T23:00:00.000Z"), now)).toBe("Yesterday");
  });

  it("buckets anything before that as Earlier", () => {
    expect(historyGroupFor(Date.parse("2026-08-23T12:00:00.000Z"), now)).toBe("Earlier");
  });
});

describe("MockLobby", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("shows the quiet one-line empty state when nothing is open, with the honest one-tap in the lower third", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} />, fixture.deps);
    // The two bordered announcing-an-absence panels died (founder, 2026-08-28, the stadium
    // pass): one faint line says the one true thing, and the strip at the foot carries the act.
    expect(screen.getByText("Nothing is drafting right now. Start one and a room opens in seconds.")).toBeInTheDocument();
    const quickStart = screen.getByTestId("quick-start-primary");
    expect(quickStart).toHaveTextContent("Start a solo mock now, 12 teams, 60s clock");
    expect(quickStart).toHaveAttribute("href", "/app/mock-drafts?create=solo");
  });

  it("swaps the strip's verb for the open room closest to firing, never a second solo one-tap beside it", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} initialOpen={[OPEN_ROOM]} />, fixture.deps);
    // Law 6: only one of the strip's three acts ever renders. With a joinable room open, the
    // verb is Take a seat, and the solo quick-start does not render anywhere.
    expect(screen.getByRole("button", { name: "Take a seat" })).toBeInTheDocument();
    expect(screen.queryByTestId("quick-start-primary")).not.toBeInTheDocument();
    expect(screen.queryByText("Start a solo mock now, 12 teams, 60s clock")).not.toBeInTheDocument();
  });

  /**
   * SUNDAY v5 undid the fun pass's card here: a ranked list of near-identical rooms is a thing
   * you read DOWN (the founder's own storefront ruling), so an open room is a timing-tower row
   * again — hairline-topped, position numeral, hover response on the row surface.
   */
  it("draws an open room as a hairline timing-tower row that still answers the pointer", () => {
    const fixture = fixtureLeagueDeps();
    const { container } = renderInLeague(<MockLobby {...baseProps()} initialOpen={[OPEN_ROOM]} />, fixture.deps);

    const row = container.querySelector("li");
    expect(row).not.toBeNull();
    // A hairline row, not a bordered card.
    expect(row!.className).toContain("border-t");
    expect(row!.className).toContain("border-line");
    // The pointer response lives on the row's own surface.
    expect(row!.firstElementChild?.className).toMatch(/hover:bg-surface-elevated/);
    // The row never becomes the control — Join is still its own button (rule 5 holds here; the
    // lobby is audited by e2e/page-audit.spec.ts and is not the draft room's named exception).
    expect(row!.getAttribute("role")).toBeNull();
    expect(row!.getAttribute("tabindex")).toBeNull();
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("renders nothing for the practice wire when initialWireItems is empty (R3, real-or-nothing)", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} />, fixture.deps);
    expect(screen.queryByRole("list", { name: "Recent practice activity" })).not.toBeInTheDocument();
  });

  it("renders the practice wire's own server-read items on first paint (R3)", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} initialWireItems={[{ kind: "mocks_running", count: 4 }]} />, fixture.deps);
    expect(screen.getByText("4 mocks drafting right now")).toBeInTheDocument();
  });

  it("never renders a manual refresh control (R5 — this lobby polls instead)", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} />, fixture.deps);
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  it("shows exactly one one-tap when both lists are empty — the lower third's, never a second copy (law 6)", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} />, fixture.deps);
    // The per-panel one-taps (quick-start-open-empty / quick-start-history-empty) died with the
    // empty panels themselves; the strip at the foot carries the page's single loud action.
    expect(screen.getByTestId("quick-start-primary")).toBeInTheDocument();
    expect(screen.getAllByText("Start a solo mock now, 12 teams, 60s clock")).toHaveLength(1);
    expect(screen.queryByTestId("quick-start-open-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("quick-start-history-empty")).not.toBeInTheDocument();
  });

  it("renders an open room's own live facts — a seat meter and a ticking countdown, not frozen prose", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} initialOpen={[OPEN_ROOM]} />, fixture.deps);
    expect(screen.getByText("10 teams · 60s clock")).toBeInTheDocument();
    expect(screen.getByText("7 of 10 seated")).toBeInTheDocument();
    expect(screen.getByText("You have no mock drafts yet.")).toBeInTheDocument();
  });

  it("renders one of the caller's own rooms with its identity line and status-appropriate link label", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} initialMine={[MINE_ROOM]} />, fixture.deps);
    // Gameday split the row's one sentence in two: the team NAME on its own baseline, and the
    // data clauses under it in mono. The name and "Drafting now" each appear TWICE — once in
    // the history row, once in the lower third's drafting-now cell, which points back into the
    // same room with its own verb.
    expect(screen.getAllByText("Mock Squad")).toHaveLength(2);
    expect(screen.getByText("Solo · 8 teams · 30s · under a minute ago")).toBeInTheDocument();
    expect(screen.getAllByText("Drafting now").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/app/drafts/d2");
    expect(screen.getByRole("link", { name: "Back to your draft" })).toHaveAttribute("href", "/app/drafts/d2");
    expect(screen.getByText("1 mock draft")).toBeInTheDocument();
  });

  it("polls the live read on an interval and refreshes both lists, with no user action (R5)", async () => {
    vi.useFakeTimers();
    try {
      const fixture = fixtureLeagueDeps({ ok: true, data: { open: [OPEN_ROOM], mine: [MINE_ROOM], wire: [{ kind: "mocks_running", count: 2 }] } });
      renderInLeague(<MockLobby {...baseProps()} />, fixture.deps);
      expect(fixture.calls).toEqual([]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.mockLobbyPollIntervalMs);
      });

      expect(fixture.calls).toEqual(["GET /api/mock-drafts"]);
      expect(screen.getByText("10 teams · 60s clock")).toBeInTheDocument();
      expect(screen.getByText("2 mocks drafting right now")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling once unmounted", async () => {
    vi.useFakeTimers();
    try {
      const fixture = fixtureLeagueDeps({ ok: true, data: { open: [], mine: [], wire: [] } });
      const { unmount } = renderInLeague(<MockLobby {...baseProps()} />, fixture.deps);
      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.mockLobbyPollIntervalMs * 3);
      });

      expect(fixture.calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("groups history rows by day — Today, Yesterday, Earlier", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
      const today = mineRoom({ leagueId: "g1", draftId: "g1", shareCode: "G1", startsInMs: -1_000, status: "complete" });
      const yesterday = mineRoom({ leagueId: "g2", draftId: "g2", shareCode: "G2", startsInMs: -13 * 60 * 60 * 1000, status: "complete" });
      const earlier = mineRoom({ leagueId: "g3", draftId: "g3", shareCode: "G3", startsInMs: -3 * 24 * 60 * 60 * 1000, status: "complete" });
      const fixture = fixtureLeagueDeps();
      renderInLeague(<MockLobby {...baseProps()} initialMine={[today, yesterday, earlier]} />, fixture.deps);

      expect(screen.getByText("Today")).toBeInTheDocument();
      expect(screen.getByText("Yesterday")).toBeInTheDocument();
      expect(screen.getByText("Earlier")).toBeInTheDocument();
      expect(screen.getByText("3 mock drafts")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses history beyond the newest 8 rows behind a quiet disclosure, and reveals the rest on request", () => {
    const rooms = Array.from({ length: 9 }, (_, i) =>
      mineRoom({ leagueId: `h${i}`, draftId: `h${i}`, shareCode: `H${i}`, startsInMs: -(i + 1) * 60_000, status: "complete" }),
    );
    const fixture = fixtureLeagueDeps();
    renderInLeague(<MockLobby {...baseProps()} initialMine={rooms} />, fixture.deps);

    expect(screen.getByText("9 mock drafts")).toBeInTheDocument();
    expect(screen.getAllByText(/^Mock Squad/)).toHaveLength(LEAGUE_ROOM_CONFIG.mockHistoryVisibleCount);
    const disclosure = screen.getByRole("button", { name: "Show all 9" });

    fireEvent.click(disclosure);

    expect(screen.getAllByText(/^Mock Squad/)).toHaveLength(9);
    expect(screen.queryByRole("button", { name: "Show all 9" })).not.toBeInTheDocument();
  });

  it("joins an open room and navigates straight into it", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", draftId: "d1", teamId: "t1", alreadySeated: false } });
    renderInLeague(<MockLobby {...baseProps()} initialOpen={[OPEN_ROOM]} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(calls).toEqual(["push:/app/drafts/d1"]));
    expect(fixture.calls).toEqual(["POST /api/mock-drafts/OPEN01"]);
  });

  it("shows the server's own refusal when a join fails, and never navigates", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "This mock draft is already full. Start a new one whenever you like." });
    renderInLeague(<MockLobby {...baseProps()} initialOpen={[OPEN_ROOM]} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already full");
    expect(calls).toEqual([]);
  });

  it("navigates straight into a newly created room from its own setup form", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l9", teamId: "t1", draftId: "d9", shareCode: "NEW001", startsAt: "2026-08-25T12:00:00.000Z" } });
    renderInLeague(<MockLobby {...baseProps()} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Start mock draft" }));
    await waitFor(() => expect(calls).toEqual(["push:/app/drafts/d9"]));
  });

  it("is axe-clean in both themes, populated", async () => {
    await renderSurface(<MockLobby {...baseProps()} initialOpen={[OPEN_ROOM]} initialMine={[MINE_ROOM]} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });

});
