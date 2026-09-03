import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { renderSurface } from "@/components/ui/test-utils";
import type { LineupBody } from "../contract";
import { LINEUP, fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LineupEditor } from "./lineup-editor";
import { term } from "@/help/glossary";
import { LeagueRoomDepsProvider } from "../hooks/deps";

// `LineupEditor` reads `useRouter()` to refresh after an IR move (`router.refresh()`) — this
// panel is never rendered inside a real Next.js app router in these unit tests, so it needs the
// same stand-in `seat-confirm-panel.test.tsx` already uses for the same reason.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** FIX 4: `LINEUP` carries no FLEX starter, so the caption's own branch needs a fixture that has one. */
const LINEUP_WITH_FLEX: LineupBody = {
  ...LINEUP,
  starters: [...LINEUP.starters, { slot: "FLEX", slotIndex: 0, playerId: "wr1", playerName: "Ja'Marr Chase", position: "WR", nflTeam: "BUF", headshotUrl: null, adp: null }],
};

/** Task 1 (superflex): the same "no branch without a fixture" reasoning as `LINEUP_WITH_FLEX`. */
const LINEUP_WITH_SUPERFLEX: LineupBody = {
  ...LINEUP,
  starters: [...LINEUP.starters, { slot: "SUPERFLEX", slotIndex: 0, playerId: "qb2", playerName: "Backup Quarterback", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null }],
};

/** Every roster slot empty, the shape `lineupView` returns before a draft has run — a team
 *  exists (a seat was taken) but nobody has been picked onto it yet. */
const ROSTERLESS_LINEUP: LineupBody = {
  ...LINEUP,
  starters: LINEUP.starters.map((slot) => ({ ...slot, playerId: null, playerName: null })),
  bench: LINEUP.bench.map((slot) => ({ ...slot, playerId: null, playerName: null })),
};

describe("LineupEditor", () => {
  // Wave-1 review Q10, SETTLED: branches on the threaded `draftStatus` fact alone, never on the
  // lineup's own empty slots.
  it("says the lineup appears after the draft when draftStatus is pre-draft ('scheduled'), even with a real roster", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="scheduled" />, fixtureLeagueDeps().deps);
    expect(screen.getByText("Your lineup appears here after the draft.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save lineup" })).not.toBeInTheDocument();
  });

  it("shows the real editor once draftStatus is in_progress or complete, even with an all-empty roster (belt only, never the inference)", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={ROSTERLESS_LINEUP} totalWeeks={14} draftStatus="in_progress" />, fixtureLeagueDeps().deps);
    expect(screen.queryByText("Your lineup appears here after the draft.")).not.toBeInTheDocument();
    expect(screen.getByText("QB")).toBeInTheDocument();
    expect(screen.getAllByText("Empty").length).toBeGreaterThan(0);
  });

  it("defaults to pre-draft when draftStatus is absent — the defensive direction only", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} />, fixtureLeagueDeps().deps);
    expect(screen.getByText("Your lineup appears here after the draft.")).toBeInTheDocument();
  });

  it("shows starters and bench with each player named, in both themes", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: LINEUP });
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText("Josh Allen")).toBeInTheDocument();
        expect(screen.getByText("Derrick Henry")).toBeInTheDocument();
        expect(screen.getByText("Bench")).toBeInTheDocument();
        expect(screen.getByText("Backup Quarterback")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // F16: the real anchor `actionHref` (`/app/leagues/${id}#lineup`) lands on — both branches,
  // since a locked week is still where the fragment has to land.
  it("carries id=\"lineup\" while editable", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(document.getElementById("lineup")).toBeInTheDocument();
  });

  it("carries id=\"lineup\" while locked", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={{ ...LINEUP, locked: true }} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(document.getElementById("lineup")).toBeInTheDocument();
  });

  // Sunday v5 (founder ruling 2026-08-28, "the UX should explain itself — we shouldn't need
  // tips"): the Bench heading's `InfoTip` is gone outright, not merely re-gated by `helpLevel`.
  it("heads the bench with a plain label, no tip", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(screen.getByText("Bench")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "What is the bench?" })).not.toBeInTheDocument();
  });

  /**
   * THE SLOT CAPTIONS ARE GONE (2026-08-28), and this is the test that used to demand them, kept
   * and INVERTED rather than deleted, so the sentences cannot drift back in unnoticed.
   *
   * Why they went: the "assert, do not explain" charter's third tell (`docs/design-system.md`) is
   * *"a rule, then a worked example of the same rule, above a control that teaches it faster than
   * either"*, and this was the clearest instance of it in the product — two captions explaining
   * what a slot accepts, directly above a `Select` that only offers players that slot accepts,
   * under a `SlotChip` that names it. Nothing true left the product with them: `/league-rules`
   * carries both definitions in full with a `TermLink`, and both glossary entries are untouched.
   *
   * Both branches are checked, because both used to print them.
   */
  it("explains neither FLEX nor SUPERFLEX in prose, in either branch", () => {
    const { rerender } = renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP_WITH_FLEX} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(screen.queryByText(term("flex").short)).not.toBeInTheDocument();
    rerender(
      <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>
        <LineupEditor leagueId="l1" lineup={LINEUP_WITH_SUPERFLEX} totalWeeks={14} draftStatus="complete" />
      </LeagueRoomDepsProvider>,
    );
    expect(screen.queryByText(GLOSSARY.superflex.short)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "What is a superflex spot?" })).not.toBeInTheDocument();
    rerender(
      <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>
        <LineupEditor leagueId="l1" lineup={{ ...LINEUP_WITH_SUPERFLEX, locked: true }} totalWeeks={14} draftStatus="complete" />
      </LeagueRoomDepsProvider>,
    );
    expect(screen.queryByText(GLOSSARY.superflex.short)).not.toBeInTheDocument();
  });

  /**
   * The name is pressable everywhere it appears (founder, 2026-08-30: "we should be able to
   * click the players name... it should bring up a pop up from the bottom") — a bottom-sheet
   * peek (`openPlayerPeek`, `./player-peek.tsx`) rather than a navigation away from this panel.
   * No `PlayerPeekHost` is mounted in this unit test, so the press is a no-op here; the sheet's
   * own reach to the player's full screen is `player-peek.test.tsx`'s to prove.
   */
  it("makes every named player's name pressable", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={{ ...LINEUP_WITH_FLEX, locked: true }} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("button", { name: "Ja'Marr Chase" })).toBeInTheDocument();
  });

  // Sunday v5 (founder ruling 2026-08-28, "the UX should explain itself"): the kickoff-lock
  // InfoTip is gone — the sentence beneath the heading is the whole of it, and it names whether
  // any player is currently held past a kickoff.
  it("says each player locks at his own kickoff, with no tip, while unlocked", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(screen.getByText("Each player locks at his own kickoff.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "What is a lineup lock?" })).not.toBeInTheDocument();
  });

  /**
   * ESPN'S TWO-TAP MODEL (founder, 2026-08-28): "Save lineup" and its own change event are gone
   * — every swap auto-saves itself. Tapping "Swap" on the bench occupant selects him; the one
   * starter slot he is eligible for lights a "Here" button, and tapping it both swaps the board
   * and fires the same PUT the old single-select change used to.
   */
  it("auto-saves a swap and reports success", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: LINEUP });
    const bodies: unknown[] = [];
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { json: async () => fixture.response } as unknown as Response;
      },
    };
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Swap Backup Quarterback" }));
    fireEvent.click(screen.getByRole("button", { name: "Put Backup Quarterback at QB" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      weekNumber: LINEUP.weekNumber,
      slots: [{ slot: "QB", slotIndex: 0, playerId: "qb2" }, { slot: "RB", slotIndex: 0, playerId: "rb1" }],
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All changes saved."));
  });

  it("shows the server's reason verbatim when a swap is rejected", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "RB is not eligible for the QB slot." });
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Swap Backup Quarterback" }));
    fireEvent.click(screen.getByRole("button", { name: "Put Backup Quarterback at QB" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("RB is not eligible for the QB slot."));
  });

  it("goes read-only once the week has ended, and names when it reopens", async () => {
    const fixture = fixtureLeagueDeps();
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <LineupEditor leagueId="l1" lineup={{ ...LINEUP, locked: true }} totalWeeks={14} draftStatus="complete" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.queryAllByRole("button", { name: /^Swap/ })).toHaveLength(0);
        expect(
          screen.getByText("Week 5 has ended, so its lineup cannot change. You can set next week's lineup now."),
        ).toBeInTheDocument();
        // The unlocked-only kickoff sentence has no place here — the week already ended.
        expect(screen.queryByText(/locks at his own kickoff/)).not.toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // Persona review (first-timer, FIX 4): naming the reopening condition is only honest if there
  // IS one. The season's last week has no next week — promising "next week's lineup" there
  // would be a lie the product would have to walk back seven days later.
  it("drops the reopening sentence on the season's final week — there is no next week", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<LineupEditor leagueId="l1" lineup={{ ...LINEUP, locked: true, weekNumber: 14 }} totalWeeks={14} draftStatus="complete" />, fixture.deps);
    expect(screen.getByText("Week 14 has ended, so its lineup cannot change.")).toBeInTheDocument();
    expect(screen.queryByText(/next week/)).not.toBeInTheDocument();
  });
});
