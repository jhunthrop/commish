import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { DraftRoomDepsProvider } from "../hooks/deps";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { fixtureDeps, renderInRoom, SNAKE_VIEW } from "../test-fixtures";
import { spotlightClockTone, TvBoard } from "./tv-board";

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
  it("shows the board with no controls at all, axe-clean, both themes, empty grid", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    await renderSurface(
      <DraftRoomDepsProvider deps={fixture.deps}>
        <TvBoard draftId="d1" />
      </DraftRoomDepsProvider>,
      async ({ container }) => {
        await waitFor(() => expect(screen.getAllByText("Bay Bandits").length).toBeGreaterThan(0));
        expect(screen.queryAllByRole("button")).toHaveLength(0);
        expect(screen.queryAllByRole("textbox")).toHaveLength(0);
        // Stage-only: the rail and the board, with neither of the room's two personal regions.
        expect(screen.getByTestId("room-rail")).toBeInTheDocument();
        expect(screen.queryByTestId("room-dock")).toBeNull();
        expect(screen.queryByRole("list", { name: /available players/i })).toBeNull();
        // …and no personal chrome on the rail either, even though the viewer owns team 1.
        expect(screen.queryByText(/Your team/)).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("renders the board itself with real table markup, axe-clean, both themes", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps({
      ...SNAKE_VIEW,
      picks: [
        { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:05:00.000Z", auto: false },
      ],
      availablePlayerIds: ["rb1", "rb2", "wr1"],
    });
    await renderSurface(
      <DraftRoomDepsProvider deps={fixture.deps}>
        <TvBoard draftId="d1" />
      </DraftRoomDepsProvider>,
      async ({ container }) => {
        await waitFor(() => expect(screen.getByRole("table", { name: /draft board/i })).toBeInTheDocument());
        expect(screen.getAllByText("Jalen Croft").length).toBeGreaterThan(0);
        expect(screen.getAllByRole("columnheader", { name: /Bay Bandits/ }).length).toBeGreaterThan(0);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
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
        clock: { phase: "in_progress", sequence: 2, pickNumber: 2, onClockTeamId: "t2", deadlineAt: SNAKE_VIEW.deadlineAt, clockSeconds: 28_800, nextTightening: null, upcoming: SNAKE_VIEW.upcoming },
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
    expect(screen.getByRole("table", { name: /draft board/i })).toHaveTextContent("Jalen Croft");
  });

  it("still offers a way forward if the board cannot load", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    fixture.deps = { ...fixture.deps, fetchJson: async () => ({ json: async () => ({ ok: false, error: "That draft does not exist." }) }) as unknown as Response };
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That draft does not exist."));
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

  it("shows an empty board — every slot dashed, nobody drafted — before the first pick", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getByRole("table", { name: /draft board/i })).toBeInTheDocument());
    // Not a "no picks yet" placeholder: the real board, every slot dashed, with the spotlight
    // sitting on the cell about to be filled. A draft party wants to see the shape of the night.
    expect(screen.queryByText("Jalen Croft")).toBeNull();
    expect(screen.getAllByText("On the clock").length).toBeGreaterThan(0);
  });

  // Task 2 (review E5/E6): the spotlight band folds in the one clock the party sees — the
  // rail's own countdown is gone on this variant (see room-rail.test.tsx), so this band is now
  // the TV's only ticking clock.
  describe("the spotlight band's own clock (E5/E6)", () => {
    it("shows the shared countdown in the band, calm above the hot threshold", async () => {
      stubMatchMedia();
      const fixture = fixtureDeps({ ...SNAKE_VIEW, deadlineAt: new Date(Date.now() + 45_000).toISOString() });
      renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
      await waitFor(() => expect(screen.getByTestId("spotlight-countdown")).toBeInTheDocument());
      expect(screen.getByTestId("spotlight-countdown").className).not.toContain("text-negative");
      // One clock per screen (E5): the rail beside it prints none of its own.
      expect(screen.queryByTestId("countdown")).toBeNull();
    });

    it("flips at the exact threshold millisecond — <= on the nose (T2 review MEDIUM)", () => {
      // The component tests on either side of the boundary ride the wall clock, which cannot
      // sit still AT the boundary; the extracted rule can. A future <= -> < regression fails here.
      expect(spotlightClockTone(DRAFT_ROOM_CONFIG.tv.hotThresholdMs)).toBe("hot");
      expect(spotlightClockTone(DRAFT_ROOM_CONFIG.tv.hotThresholdMs + 1)).toBe("default");
      expect(spotlightClockTone(0)).toBe("hot");
      expect(spotlightClockTone(null)).toBe("default");
    });

    it("goes hot inside the final 30 seconds, and not a moment before", async () => {
      stubMatchMedia();
      const fixture = fixtureDeps({ ...SNAKE_VIEW, deadlineAt: new Date(Date.now() + 20_000).toISOString() });
      renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
      await waitFor(() => expect(screen.getByTestId("spotlight-countdown")).toBeInTheDocument());
      expect(screen.getByTestId("spotlight-countdown").className).toContain("text-negative");
    });
  });

  // Task 2 (review E6): the last pick landed, restated quietly at glance scale beside the
  // band's own clock — the wire underneath already carries the newest pick's ink; this is a
  // restatement, so the player's name stays muted rather than repeating that emphasis.
  it("restates the last pick landed, quietly, beside the spotlight clock", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(fixture.sources).toHaveLength(1));

    act(() =>
      fixture.sources[0]!.emit("draft.pick", {
        draftId: "d1",
        clock: { phase: "in_progress", sequence: 2, pickNumber: 2, onClockTeamId: "t2", deadlineAt: SNAKE_VIEW.deadlineAt, clockSeconds: 28_800, nextTightening: null, upcoming: SNAKE_VIEW.upcoming },
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

    await waitFor(() => expect(screen.getByTestId("spotlight-last-pick")).toHaveTextContent("#1"));
    const lastPick = screen.getByTestId("spotlight-last-pick");
    expect(lastPick).toHaveTextContent("Jalen Croft");
    expect(lastPick.className).toContain("text-text-muted");
    // The face beside the line (T1 review MEDIUM): qb1's fixture carries a real headshot URL,
    // so the restatement renders the image branch — the pool's own test carries the initials
    // branch with the same fixture set.
    // The Avatar renders BESIDE the testid'd line, inside the same spotlight band — scope the
    // query there, keyed by qb1's own URL so the on-clock owner's avatar can never satisfy it.
    const faces = Array.from(screen.getByTestId("spotlight").querySelectorAll("img"));
    expect(faces.some((img) => (img.getAttribute("src") ?? "").includes("qb1.png"))).toBe(true);
  });

  it("shows no last-pick restatement before anything has been drafted", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getByTestId("spotlight")).toBeInTheDocument());
    expect(screen.queryByTestId("spotlight-last-pick")).toBeNull();
  });
});
