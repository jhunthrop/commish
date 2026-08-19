import { describe, it, expect, afterEach, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import type { HomeBody } from "../contract";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { HomeBoard } from "./home-board";

const SCHEDULED_CARD: HomeBody["leagues"][number] = {
  id: "l1",
  name: "Sunday Money",
  format: "snake",
  teamCount: 10,
  filledTeams: 10,
  isCommissioner: false,
  myTeamId: "t1",
  draftId: "d1",
  draftStatus: "complete",
  record: { wins: 5, losses: 2, ties: 0 },
  weekNumber: 4,
  weekStatus: "scheduled",
  matchup: null,
  nextAction: { kind: "set-lineup", label: "Set your lineup" },
};

const LIVE_CARD: HomeBody["leagues"][number] = {
  ...SCHEDULED_CARD,
  id: "l2",
  name: "Auction Night",
  weekStatus: "in_progress",
  nextAction: { kind: "watch-scores", label: "Watch the scores" },
};

const EMPTY: HomeBody = { leagues: [] };
const ONE_SCHEDULED: HomeBody = { leagues: [SCHEDULED_CARD] };
const ONE_LIVE: HomeBody = { leagues: [LIVE_CARD] };

afterEach(() => {
  if (vi.isFakeTimers()) vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

describe("HomeBoard", () => {
  it("renders the server's payload immediately, in both themes", async () => {
    await inBothThemes(<HomeBoard initial={ONE_SCHEDULED} />, async ({ container }) => {
      expect(screen.getByRole("link", { name: /Sunday Money/ })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("shows the plain empty state, with an action, when the caller has no leagues", async () => {
    await inBothThemes(<HomeBoard initial={EMPTY} />, async ({ container }) => {
      expect(screen.getByText("No leagues yet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Jump to the form/ })).toHaveAttribute("href", "#create-league");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("never polls when no league's week is in progress, even once visible and past the interval", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const fixture = fixtureLeagueDeps({ ok: true, data: ONE_SCHEDULED });
    renderInLeague(<HomeBoard initial={ONE_SCHEDULED} />, fixture.deps);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs * 3);
    });
    expect(fixture.calls).toEqual([]);
  });

  it("never polls while the document is hidden, even with a live week", async () => {
    vi.useFakeTimers();
    setVisibility("hidden");
    const fixture = fixtureLeagueDeps({ ok: true, data: ONE_LIVE });
    renderInLeague(<HomeBoard initial={ONE_LIVE} />, fixture.deps);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs * 3);
    });
    expect(fixture.calls).toEqual([]);
  });

  it("polls on the interval once visible and some week is in progress, and folds the response in", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const refreshed: HomeBody = { leagues: [{ ...LIVE_CARD, name: "Auction Night Refreshed" }] };
    const fixture = fixtureLeagueDeps({ ok: true, data: refreshed });
    renderInLeague(<HomeBoard initial={ONE_LIVE} />, fixture.deps);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs);
    });
    expect(fixture.calls).toEqual(["GET /api/home"]);
    expect(screen.getByRole("link", { name: /Auction Night Refreshed/ })).toBeInTheDocument();
  });

  it("stops polling on its own once a refreshed payload says every week is done", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const final: HomeBody = { leagues: [{ ...LIVE_CARD, weekStatus: "final", nextAction: { kind: "review-week", label: "See how the week went" } }] };
    const fixture = fixtureLeagueDeps({ ok: true, data: final });
    renderInLeague(<HomeBoard initial={ONE_LIVE} />, fixture.deps);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs);
    });
    expect(fixture.calls).toEqual(["GET /api/home"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs * 3);
    });
    // No second call: the just-folded-in state has no in-progress week left.
    expect(fixture.calls).toEqual(["GET /api/home"]);
  });

  it("leaves the last-known board on screen when a background refresh fails", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const fixture = fixtureLeagueDeps({ ok: true, data: ONE_LIVE });
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => {
        throw new Error("offline");
      },
    };
    renderInLeague(<HomeBoard initial={ONE_LIVE} />, fixture.deps);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs);
    });
    expect(screen.getByRole("link", { name: /Auction Night/ })).toBeInTheDocument();
  });
});
