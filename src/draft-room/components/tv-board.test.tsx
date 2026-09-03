import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, act, within } from "@testing-library/react";
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
  //
  // SUNDAY v5 REWIRED THE BAND ONTO `LowerThird` (law 6): the old bordered "spotlight card" with
  // its own `spotlight-countdown`/`spotlight-last-pick` testids became a lower-third strip of
  // cells, `data-testid="spotlight"` now naming the whole strip rather than a card. It also
  // changed what urgency SPENDS (this file's own docblock on `spotlightClockTone`): the clock is
  // drawn in the live channel unconditionally, since a running draft clock already IS "happening
  // right now" — there is no redder color left for "hot" to step to, so hot renames the cell's
  // micro-label ("Final seconds") instead of recoloring the digits.
  describe("the spotlight band's own clock (E5/E6)", () => {
    it("shows the shared countdown in the band, always in the live channel, never recolored by urgency", async () => {
      stubMatchMedia();
      const fixture = fixtureDeps({ ...SNAKE_VIEW, deadlineAt: new Date(Date.now() + 45_000).toISOString() });
      renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
      await waitFor(() => expect(screen.getByText("Pick clock")).toBeInTheDocument());
      const clockCell = screen.getByText("Pick clock").nextElementSibling as HTMLElement;
      expect(clockCell.className).toContain("text-live");
      expect(clockCell.className).not.toContain("text-negative");
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

    it("goes hot inside the final 30 seconds by renaming the clock's own label, not by recoloring it", async () => {
      stubMatchMedia();
      const fixture = fixtureDeps({ ...SNAKE_VIEW, deadlineAt: new Date(Date.now() + 20_000).toISOString() });
      renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
      await waitFor(() => expect(screen.getByText("Final seconds")).toBeInTheDocument());
      expect(screen.queryByText("Pick clock")).toBeNull();
      const clockCell = screen.getByText("Final seconds").nextElementSibling as HTMLElement;
      expect(clockCell.className).toContain("text-live");
    });

    /**
     * LAW 2, ON THE ONE SURFACE BUILT FOR READING DISTANCE. The party clock shipped at `lg`
     * (44px) — the size the ROOM's own rail uses, on a screen designed to be read from a sofa —
     * while the display scale carries 84 and 116 above it. Pinned by the SIZE CLASS rather than
     * a pixel, so a scale retune moves it and a call-site regression does not.
     */
    it("gives the party clock the TV's own step, never the room rail's", async () => {
      stubMatchMedia();
      const fixture = fixtureDeps({ ...SNAKE_VIEW, deadlineAt: new Date(Date.now() + 45_000).toISOString() });
      renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
      await waitFor(() => expect(screen.getByText("Pick clock")).toBeInTheDocument());
      const digits = screen.getByText("Pick clock").nextElementSibling!.querySelector("span")!;
      expect(digits.className).toContain("text-display-2xl");
    });
  });

  /**
   * GAMEDAY, LAW 2: the draft's own progress, as a number, on the one surface whose viewer cannot
   * scroll or click to find it out. Arithmetic on the payload — picks made, over seats times
   * roster spots — never a projection.
   */
  it("states how far into the draft the room is, as a figure", async () => {
    stubMatchMedia();
    const fixture = fixtureDeps();
    renderInRoom(<TvBoard draftId="d1" />, fixture.deps);
    await waitFor(() => expect(screen.getByText("Picks in")).toBeInTheDocument());
    const total = SNAKE_VIEW.draftOrder.length * SNAKE_VIEW.slotConfig.reduce((sum, slot) => sum + slot.count, 0);
    expect(screen.getByText("Picks in").nextElementSibling).toHaveTextContent(`${SNAKE_VIEW.picks.length} of ${total}`);
  });

  // Task 2 (review E6) put the newest pick's own restatement here, at glance scale beside the
  // spotlight clock. Sunday v5 cut the cell outright rather than reconciling it — this file's
  // own `TvBoard` docblock: "this line already names the newest pick, in ink, one row up" — so
  // `PickWire`, directly above the board, is now the room's one telling of "what just happened"
  // (its own suite owns the formatting; `spotlight-last-pick` no longer exists to test).  This
  // keeps only the integration fact that belongs to `TvBoard`: the live event still reaches the
  // wire, and the strip genuinely carries no per-player fact of its own any more.
  it("routes a live pick to the wire rather than restating it in the spotlight, now that the strip states none", async () => {
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

    await waitFor(() => expect(screen.getByTestId("pick-wire")).toHaveTextContent("Jalen Croft"));
    expect(within(screen.getByTestId("spotlight")).queryByText("Jalen Croft")).toBeNull();
  });
});
