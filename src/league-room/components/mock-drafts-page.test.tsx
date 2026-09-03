import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { MockLobbyRoomSummary, MyMockRoomSummary } from "@/mock-draft-service/lobby";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { defaultMockTable, encodeMockTable, type MockTableOptions } from "../lib/mock-table";
import { MockDraftsPage, type MockDraftsPageProps } from "./mock-drafts-page";

const pushed: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));

const OPTIONS: MockTableOptions = {
  teamCounts: [8, 10, 12],
  pickSeconds: [30, 60, 90],
  scoringPresets: ["half_ppr", "ppr", "standard", "te_premium"],
  rosterShapes: ["standard", "superflex"],
  defaultTeamCount: 12,
  defaultPickSeconds: 60,
  defaultScoringPreset: "half_ppr",
  defaultRosterShape: "standard",
  maxTeamNameLength: 30,
};

const COPY = {
  soloDetail: "In the room in five seconds.",
  tableHint: "Tap any chip to change it.",
  openLobbyDetail: "Anyone can take a seat.",
  crewDetail: "A private link seats your league mates.",
  sheetTieIn: "Your mock picks can seed your cheat sheet.",
};

const OPEN_ROOM: MockLobbyRoomSummary = { leagueId: "l1", shareCode: "OPEN01", teamCount: 12, seatsOpen: 5, pickSeconds: 60, startsInMs: 90_000 };
const MINE_LIVE: MyMockRoomSummary = {
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

function baseProps(overrides: Partial<MockDraftsPageProps> = {}): MockDraftsPageProps {
  return { initialOpen: [], initialMine: [], options: OPTIONS, copy: COPY, ...overrides };
}

beforeEach(() => {
  pushed.length = 0;
  window.localStorage.clear();
});

describe("MockDraftsPage — law 1, one verb", () => {
  it("DRAFT NOW posts the current chips as a solo create and walks into the room", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { draftId: "d9" } });
    renderInLeague(<MockDraftsPage {...baseProps()} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Draft now" }));
    await waitFor(() => expect(pushed).toEqual(["/app/drafts/d9"]));
    expect(fixture.calls).toContain("POST /api/mock-drafts");
  });

  it("edits a chip in place and remembers the table for the next visit", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { draftId: "d9" } });
    renderInLeague(<MockDraftsPage {...baseProps()} />, fixture.deps);
    // Borrow-and-return: tapping the chip opens one editor row, choosing closes it.
    fireEvent.click(screen.getByTestId("table-chip-teams"));
    fireEvent.click(within(screen.getByRole("group", { name: "Teams" })).getByRole("button", { name: "8" }));
    expect(screen.queryByRole("group", { name: "Teams" })).not.toBeInTheDocument();
    expect(screen.getByTestId("table-chip-teams")).toHaveTextContent("8 teams");
    // The change is persisted under the remembered-table key.
    const stored = JSON.parse(window.localStorage.getItem(LEAGUE_ROOM_CONFIG.mockTableStorageKey)!) as { teamCount: number };
    expect(stored.teamCount).toBe(8);
  });

  it("reads the remembered table back on mount", async () => {
    window.localStorage.setItem(
      LEAGUE_ROOM_CONFIG.mockTableStorageKey,
      encodeMockTable({ ...defaultMockTable(OPTIONS), teamCount: 10, pickSeconds: 30, draftSlot: 7 }),
    );
    renderInLeague(<MockDraftsPage {...baseProps()} />, fixtureLeagueDeps().deps);
    await waitFor(() => expect(screen.getByTestId("table-chip-teams")).toHaveTextContent("10 teams"));
    expect(screen.getByTestId("table-chip-clock")).toHaveTextContent("30s clock");
    expect(screen.getByTestId("table-chip-seat")).toHaveTextContent("Seat: 7");
  });
});

describe("MockDraftsPage — law 2, people are a door", () => {
  it("renders NOTHING for an empty lobby — no list, no box, no sentence about absence", () => {
    renderInLeague(<MockDraftsPage {...baseProps()} />, fixtureLeagueDeps().deps);
    expect(screen.queryByRole("list", { name: "Open lobby rooms" })).not.toBeInTheDocument();
    expect(screen.queryByText(/no mock drafts/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing.*open/i)).not.toBeInTheDocument();
  });

  it("lists open rooms with seat counts and TAKE A SEAT, and joins through the claim door", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { draftId: "d7" } });
    renderInLeague(<MockDraftsPage {...baseProps({ initialOpen: [OPEN_ROOM] })} />, fixture.deps);
    const rooms = screen.getByRole("list", { name: "Open lobby rooms" });
    expect(within(rooms).getByText("7 of 12 seated · fires when full")).toBeInTheDocument();
    fireEvent.click(within(rooms).getByRole("button", { name: "Take a seat" }));
    await waitFor(() => expect(pushed).toEqual(["/app/drafts/d7"]));
    expect(fixture.calls).toContain("POST /api/mock-drafts/OPEN01");
  });

  it("mints the lobby and link rooms with outline verbs, never a second solid", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { draftId: "d8" } });
    renderInLeague(<MockDraftsPage {...baseProps()} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Open lobby" }));
    await waitFor(() => expect(pushed).toEqual(["/app/drafts/d8"]));
    // The amber budget: DRAFT NOW is the page's only solid verb.
    const solids = screen.getAllByRole("button").filter((button) => button.className.includes("bg-accent"));
    expect(solids).toHaveLength(1);
    expect(solids[0]).toHaveTextContent("Draft now");
  });

  it("shows a re-entry row for a room of the caller's own that is still going", () => {
    renderInLeague(<MockDraftsPage {...baseProps({ initialMine: [MINE_LIVE] })} />, fixtureLeagueDeps().deps);
    expect(screen.getByText("Mock Squad")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your draft" })).toHaveAttribute("href", "/app/drafts/d2");
  });

  it("never shows a re-entry row for a completed room — the learning column owns finished mocks", () => {
    renderInLeague(
      <MockDraftsPage {...baseProps({ initialMine: [{ ...MINE_LIVE, status: "complete" }] })} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.queryByText("Mock Squad")).not.toBeInTheDocument();
  });

  it("is axe-clean in both themes with rooms on the page", async () => {
    await renderSurface(
      <MockDraftsPage {...baseProps({ initialOpen: [OPEN_ROOM], initialMine: [MINE_LIVE] })} />,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
