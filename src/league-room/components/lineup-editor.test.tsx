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
    expect(screen.getAllByText("QB").length).toBeGreaterThan(0);
    // ABSENCE RENDERS AS ABSENCE: the slot says who is missing from it, in the room's own words,
    // rather than the bare word "Empty" beside a grey tile.
    expect(screen.getAllByText(/^Nobody in your /).length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getByRole("button", { name: "Confirm Backup Quarterback at QB" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Confirm Backup Quarterback at QB" }));
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

/**
 * THE HEADLINE'S BASIS, AND THE WINDOW THE OLD ONE WAS FALSE IN (whole-branch review, C1).
 *
 * The first pass summed only the starters whose points were non-null and then captioned the sum
 * "PPR, your starters in week 5". Between Thursday night and Sunday afternoon, the window managers
 * actually look, that printed one Thursday starter's score under a caption claiming the whole
 * lineup, beside a foot label reading "Your 2". The number named a basis it did not have.
 *
 * The ruling: the headline is the PROJECTED total until every starter has played, then the
 * measured total. A partial week states what was actually summed on a second line, and the foot
 * never puts a count beside a partial sum.
 */
describe("LineupEditor, the headline number", () => {
  const PROJECTIONS = new Map([["qb1", 20], ["rb1", 14], ["qb2", 5]]);

  it("holds the projection while the week is partly played, and says how much is in so far", () => {
    renderInLeague(
      <LineupEditor
        leagueId="l1"
        lineup={LINEUP}
        totalWeeks={14}
        draftStatus="complete"
        projectionsByPlayerId={PROJECTIONS}
        pointsByPlayerId={new Map([["qb1", 12.4], ["rb1", null]])}
      />,
      fixtureLeagueDeps().deps,
    );
    // 20 + 14 projected, NOT the 12.40 one man has actually scored.
    expect(screen.getAllByText("34.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PPR projected, week 5").length).toBeGreaterThan(0);
    expect(screen.getByText("1 of 2 played, 12.40 so far")).toBeInTheDocument();
    // The false caption and the false count are both gone.
    expect(screen.queryByText("PPR, your starters in week 5")).toBeNull();
    expect(screen.queryByText("Your 2")).toBeNull();
  });

  it("becomes the measured total, called final, once every starter has played", () => {
    renderInLeague(
      <LineupEditor
        leagueId="l1"
        lineup={LINEUP}
        totalWeeks={14}
        draftStatus="complete"
        projectionsByPlayerId={PROJECTIONS}
        pointsByPlayerId={new Map([["qb1", 12.4], ["rb1", 18.6]])}
      />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getAllByText("31.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PPR, final").length).toBeGreaterThan(0);
    // Nothing is partial any more, so there is no "so far" line to print.
    expect(screen.queryByText(/so far$/)).toBeNull();
  });

  it("says nothing about points before a single starter has played", () => {
    renderInLeague(
      <LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" projectionsByPlayerId={PROJECTIONS} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getAllByText("PPR projected, week 5").length).toBeGreaterThan(0);
    expect(screen.queryByText(/so far$/)).toBeNull();
  });

  // A projection snapshot that names only some of the starters cannot be captioned as though it
  // covered them all: the same refusal, one level down.
  it("names how many starters a partial projection actually covers", () => {
    renderInLeague(
      <LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" projectionsByPlayerId={new Map([["qb1", 20]])} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getAllByText("PPR projected, 1 of 2 starters").length).toBeGreaterThan(0);
  });
});

/**
 * THE ROW'S CAPTION (whole-branch review, M1). The first pass printed "PPR" under all nine rows
 * while the header already said it, and suppressed the genuinely per-row fact, the opponent and
 * kickoff, at 360px. The caption slot now carries the fixture at every width, and the only thing
 * marked is the EXCEPTION: a number that is a forecast rather than a measurement.
 */
describe("LineupEditor, the row caption", () => {
  const FIXTURES = new Map([["BUF", { opp: "vs MIA", when: "Sun 1:00p", status: "scheduled" as const }]]);

  it("spends the caption on the fixture, and marks only the rows whose number is a forecast", () => {
    renderInLeague(
      <LineupEditor
        leagueId="l1"
        lineup={LINEUP}
        totalWeeks={14}
        draftStatus="complete"
        fixturesByNflTeam={FIXTURES}
        projectionsByPlayerId={new Map([["rb1", 14]])}
        pointsByPlayerId={new Map([["qb1", 12.4]])}
      />,
      fixtureLeagueDeps().deps,
    );
    // Josh Allen has played: his caption is the fixture alone, with no basis restating the header.
    expect(screen.getAllByText("vs MIA, Sun 1:00p").length).toBeGreaterThan(0);
    // Derrick Henry has not: his caption marks the forecast.
    expect(screen.getByText("projected, vs MIA, Sun 1:00p")).toBeInTheDocument();
    // The constant the header already carries is not repeated down the column.
    expect(screen.queryByText("PPR proj")).toBeNull();
  });

  it("keeps the fixture visible rather than hiding it behind a breakpoint", () => {
    renderInLeague(
      <LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" fixturesByNflTeam={FIXTURES} pointsByPlayerId={new Map([["qb1", 12.4]])} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getAllByText("vs MIA, Sun 1:00p")[0]!.className).not.toMatch(/hidden/);
  });

  it("still shouts a bye in the loss channel, because that is the mistake the line exists to prevent", () => {
    renderInLeague(
      <LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" fixturesByNflTeam={new Map()} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getAllByText("Bye")[0]!.className).toMatch(/text-negative/);
  });
});

/**
 * THE EMPTY SLOT SAYS ONE THING (whole-branch review, M2 and the "for Sunday" LOW). The first pass
 * printed "Tap a bench player to move him in" twice on one screen, and hardcoded "for Sunday" for a
 * slot whose game may be on a Thursday.
 */
describe("LineupEditor, the empty slot", () => {
  const EMPTY_QB: LineupBody = {
    ...LINEUP,
    starters: LINEUP.starters.map((slot) => (slot.slot === "QB" ? { ...slot, playerId: null, playerName: null } : slot)),
  };

  it("says it once, in the banner, and names no day it cannot know", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={EMPTY_QB} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(screen.getByText("Your qb is empty.")).toBeInTheDocument();
    expect(screen.queryByText(/for Sunday/)).toBeNull();
    expect(screen.queryByText(/Tap a bench player/)).toBeNull();
  });
});

/**
 * THE SLOT'S DISABLED SKIN COMES FROM THE PRIMITIVE (whole-branch review, H1). It hand-rolled
 * `border border-line` on a bare span, which is the raw-surface guard's own failure and shipped a
 * red design suite.
 */
describe("LineupEditor, the locked slot control", () => {
  it("draws a locked week's slots as disabled buttons rather than hand-rolled spans", () => {
    renderInLeague(
      <LineupEditor leagueId="l1" lineup={{ ...LINEUP, locked: true }} totalWeeks={14} draftStatus="complete" />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByRole("button", { name: "Josh Allen plays QB" })).toBeDisabled();
  });
});

/**
 * THE EDITOR RESYNCS WHEN THE SERVER'S STORY CHANGES (whole-branch review, M5). The state
 * initialiser ran once, so an IR move (which refreshes the server props) left the slot map telling
 * the old story.
 */
describe("LineupEditor, resync", () => {
  it("takes a new server lineup over its own optimistic map", () => {
    const deps = fixtureLeagueDeps().deps;
    const { rerender } = renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, deps);
    expect(screen.getByText("Derrick Henry")).toBeInTheDocument();
    const moved: LineupBody = {
      ...LINEUP,
      starters: LINEUP.starters.map((slot) => (slot.slot === "RB" ? { ...slot, playerId: null, playerName: null } : slot)),
      bench: [],
    };
    rerender(
      <LeagueRoomDepsProvider deps={deps}>
        <LineupEditor leagueId="l1" lineup={moved} totalWeeks={14} draftStatus="complete" />
      </LeagueRoomDepsProvider>,
    );
    expect(screen.queryByText("Derrick Henry")).toBeNull();
    expect(screen.getByText("Nobody in your rb")).toBeInTheDocument();
  });
});
