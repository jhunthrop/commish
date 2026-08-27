import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { renderSurface } from "@/components/ui/test-utils";
import type { LineupBody } from "../contract";
import { LINEUP, fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LineupEditor } from "./lineup-editor";
import { term } from "@/help/glossary";
import { LeagueRoomDepsProvider } from "../hooks/deps";

/** FIX 4: `LINEUP` carries no FLEX starter, so the caption's own branch needs a fixture that has one. */
const LINEUP_WITH_FLEX: LineupBody = {
  ...LINEUP,
  starters: [...LINEUP.starters, { slot: "FLEX", slotIndex: 0, playerId: "wr1", playerName: "Ja'Marr Chase", position: "WR" }],
};

/** Task 1 (superflex): the same "no branch without a fixture" reasoning as `LINEUP_WITH_FLEX`. */
const LINEUP_WITH_SUPERFLEX: LineupBody = {
  ...LINEUP,
  starters: [...LINEUP.starters, { slot: "SUPERFLEX", slotIndex: 0, playerId: "qb2", playerName: "Backup Quarterback", position: "QB" }],
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
    expect(screen.getByLabelText("QB")).toBeInTheDocument();
  });

  it("defaults to pre-draft when draftStatus is absent — the defensive direction only", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} />, fixtureLeagueDeps().deps);
    expect(screen.getByText("Your lineup appears here after the draft.")).toBeInTheDocument();
  });

  it("shows starters and bench with a labelled control per starting slot, in both themes", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: LINEUP });
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByLabelText("QB")).toBeInTheDocument();
        expect(screen.getByLabelText("RB")).toBeInTheDocument();
        expect(screen.getByText("Bench")).toBeInTheDocument();
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

  it("carries an InfoTip on the Bench heading", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("button", { name: "What is the bench?" })).toBeInTheDocument();
  });

  // FIX 1 (HIGH): helpLevel must actually reach a wired InfoTip, not just be accepted and
  // dropped — a guided caller sees the short line without clicking.
  it("threads helpLevel into its InfoTip: guided shows the lineup-lock short line inline", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: LINEUP });
    const { rerender } = renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixture.deps);
    expect(screen.queryByText(GLOSSARY["lineup-lock"].short)).not.toBeInTheDocument();
    rerender(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" helpLevel="guided" />
      </LeagueRoomDepsProvider>,
    );
    expect(screen.getByText(GLOSSARY["lineup-lock"].short)).toBeInTheDocument();
  });

  // Persona review (FIX 4): a caption near the slot list, not a tip on every FLEX chip — one
  // sentence, since there is only ever one FLEX slot to explain.
  it("captions FLEX near the slot list when the roster has one, and says nothing when it doesn't", () => {
    const { rerender } = renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(screen.queryByText(term("flex").short)).not.toBeInTheDocument();
    rerender(
      <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>
        <LineupEditor leagueId="l1" lineup={LINEUP_WITH_FLEX} totalWeeks={14} draftStatus="complete" />
      </LeagueRoomDepsProvider>,
    );
    expect(screen.getByText(term("flex").short)).toBeInTheDocument();
  });

  it("also captions FLEX on the locked, read-only slot list", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={{ ...LINEUP_WITH_FLEX, locked: true }} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(screen.getByText(term("flex").short)).toBeInTheDocument();
  });

  // Task 1 (superflex): the same shared-caption treatment FLEX gets, plus an InfoTip — a newer
  // word than FLEX and worth the click-to-learn-more.
  it("captions SUPERFLEX near the slot list when the roster has one, with an InfoTip, and says nothing when it doesn't", () => {
    const { rerender } = renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(screen.queryByText(term("superflex").short)).not.toBeInTheDocument();
    rerender(
      <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>
        <LineupEditor leagueId="l1" lineup={LINEUP_WITH_SUPERFLEX} totalWeeks={14} draftStatus="complete" />
      </LeagueRoomDepsProvider>,
    );
    expect(screen.getByText(term("superflex").short)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is a superflex spot?" })).toBeInTheDocument();
  });

  it("also captions SUPERFLEX on the locked, read-only slot list", () => {
    renderInLeague(<LineupEditor leagueId="l1" lineup={{ ...LINEUP_WITH_SUPERFLEX, locked: true }} totalWeeks={14} draftStatus="complete" />, fixtureLeagueDeps().deps);
    expect(screen.getByText(term("superflex").short)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is a superflex spot?" })).toBeInTheDocument();
  });

  // The SUPERFLEX caption's short line is already unconditional, unlike bench/lineup-lock's
  // InfoTip-only short line — so `helpLevel="guided"` must not print it a second time.
  it("does not duplicate the SUPERFLEX short line when helpLevel is guided", () => {
    const fixture = fixtureLeagueDeps();
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP_WITH_SUPERFLEX} totalWeeks={14} draftStatus="complete" helpLevel="guided" />, fixture.deps);
    expect(screen.getAllByText(GLOSSARY.superflex.short)).toHaveLength(1);
  });

  // Persona review (veteran, FIX 5): the whole-week lock is coarse and nothing said so before
  // this. Only meaningful while the editor is actually usable — a locked week has nothing left
  // to warn about, it has already happened.
  it("warns that the whole week locks at the first kickoff, only while unlocked", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: LINEUP });
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixture.deps);
    expect(screen.getByText("Lineups lock for the whole week when its first game kicks off.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is a lineup lock?" })).toBeInTheDocument();
  });

  it("saves the starting slots it was given and reports success", async () => {
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
    fireEvent.change(screen.getByLabelText("QB"), { target: { value: "qb2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save lineup" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      weekNumber: LINEUP.weekNumber,
      slots: [{ slot: "QB", slotIndex: 0, playerId: "qb2" }, { slot: "RB", slotIndex: 0, playerId: "rb1" }],
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Lineup saved."));
  });

  it("shows the server's reason verbatim when the lineup is rejected", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "RB is not eligible for the QB slot." });
    renderInLeague(<LineupEditor leagueId="l1" lineup={LINEUP} totalWeeks={14} draftStatus="complete" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Save lineup" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("RB is not eligible for the QB slot."));
  });

  it("goes read-only once the week has started, and names when it reopens", async () => {
    const fixture = fixtureLeagueDeps();
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <LineupEditor leagueId="l1" lineup={{ ...LINEUP, locked: true }} totalWeeks={14} draftStatus="complete" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.queryByRole("button", { name: "Save lineup" })).not.toBeInTheDocument();
        expect(
          screen.getByText("Week 5 has started, so its lineup cannot change. You can set next week's lineup as soon as this week ends."),
        ).toBeInTheDocument();
        // The unlocked-only kickoff warning has no place here — the week already started.
        expect(screen.queryByText(/Lineups lock for the whole week/)).not.toBeInTheDocument();
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
    expect(screen.getByText("Week 14 has started, so its lineup cannot change.")).toBeInTheDocument();
    expect(screen.queryByText(/next week/)).not.toBeInTheDocument();
  });
});
