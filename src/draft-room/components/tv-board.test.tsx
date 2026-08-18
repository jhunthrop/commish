import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { fixtureDeps, renderInRoom, SNAKE_VIEW } from "../test-fixtures";
import { TvBoard } from "./tv-board";

/** `PickCelebration` calls `usePrefersReducedMotion`, which reads `matchMedia`; happy-dom's is minimal. */
function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TvBoard", () => {
  it("shows the board with no controls at all, axe-clean", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    const { container } = renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getAllByText("Bay Bandits").length).toBeGreaterThan(0));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("spotlights whoever is on the clock", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getByTestId("spotlight")).toHaveTextContent("Bay Bandits"));
  });

  it("updates live from the stream without any control being touched", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(fixture.sources).toHaveLength(1));

    act(() =>
      fixture.sources[0]!.emit("draft.pick", {
        draftId: "d1",
        clock: { phase: "in_progress", sequence: 2, pickNumber: 2, onClockTeamId: "t2", deadlineAt: SNAKE_VIEW.deadlineAt, clockSeconds: 28_800, nextTightening: null },
        pickNumber: 1,
        round: 1,
        teamId: "t1",
        playerId: "qb1",
        slot: "QB",
        slotIndex: 0,
        price: null,
        timestamp: "2026-09-01T00:05:00.000Z",
        auto: false,
      }),
    );

    await waitFor(() => expect(screen.getByTestId("spotlight")).toHaveTextContent("Iron Owls"));
    expect(screen.getByRole("table", { name: /every pick/i })).toHaveTextContent("Jalen Croft");
  });

  it("still offers a way forward if the board cannot load", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    fixture.deps = { ...fixture.deps, fetchJson: async () => ({ json: async () => ({ ok: false, error: "That draft doesn't exist." }) }) as unknown as Response };
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That draft doesn't exist."));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows a loading skeleton while the board is fetching", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { json: async () => ({ ok: true, data: { draft: fixture.view, teamId: fixture.teamId, isCommissioner: false, teams: [] } }) } as unknown as Response;
      },
    };
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  });

  it("shows an empty state when there are no picks yet", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getByText("The board is empty")).toBeInTheDocument());
    expect(screen.getByText("Picks appear here the moment they land.")).toBeInTheDocument();
  });

});
