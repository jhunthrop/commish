import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { UI_CONFIG } from "@/components/ui/config";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, MATCHUP, MATCHUP_WITH_MEDIAN, renderInLeague } from "../test-fixtures";
import { MatchupPanel } from "./matchup-panel";

/** Same matchup, mid-games: `final` and `weekStatus` both say so, independent of each other. */
const inProgressMatchup = { ...MATCHUP, final: false, weekStatus: "in_progress" as const };

describe("MatchupPanel", () => {
  it("shows both lineups, per-player points and the final score, in both themes, axe-clean", async () => {
    await renderSurface(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />, async ({ container }) => {
      expect(screen.getByRole("heading", { name: "Bay Bandits" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Iron Owls" })).toBeInTheDocument();
      expect(screen.getByText("112.50")).toBeInTheDocument();
      expect(screen.getByText("Final")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // D5 (competition review, MEDIUM a11y): axe's `heading-order` used to fail at both viewports —
  // the document ran `<h1>` straight into `Side`'s own team-name `<h3>`, since this panel gave
  // its matchup an eyebrow `<span>` rather than a heading. A real `<h2>` now anchors the
  // matchup, so `Side`'s `<h3>` nests under something instead of being the first heading at all.
  it("anchors the matchup with a real h2, so the side tables' h3s are never the first heading under the page title (D5)", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    expect(screen.getByRole("heading", { level: 2, name: "Bay Bandits against Iron Owls" })).toBeInTheDocument();
  });

  // D4 (competition review, HIGH): a starter with no stat line for the week used to coalesce to
  // `0.00` — the exact conflation `matchupWeek`'s own `entryFor` docblock (and `initialScores`
  // one layer up) forbids: "has not played" and "played and scored nothing" are different facts.
  it("renders a starter with no stat line as a dash, never a silent zero (D4)", () => {
    const notYetPlayed = {
      ...MATCHUP,
      home: { ...MATCHUP.home, starters: [{ ...MATCHUP.home.starters[0]!, points: null }] },
    };
    render(<MatchupPanel matchup={notYetPlayed} myTeamId="t1" weekStatus="final" />);
    expect(screen.getByRole("cell", { name: "—" })).toBeInTheDocument();
    expect(screen.queryByText("0.00")).not.toBeInTheDocument();
  });

  // E1(a) (D2/E3, competition review), as Gameday re-sites it: the margin is the hero's own
  // middle-column line. The games-final clause it used to carry moved up to the week band
  // (`LiveMatchupWeek`), which states it ONCE — it is a week-wide fact, and six panels printing
  // "13 of 13 games final" on one screen was six copies of one truth.
  it("prints the margin from the reader's own seat", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    expect(screen.getByText("You are up 14.25.")).toBeInTheDocument();
  });

  // Phase 2 Plan B: live scoring EXISTS. This case used to assert the opposite, and it was
  // correct while the stat set was a fixed file a commissioner scored by hand. Inverting it is
  // the point of the change, not a casualty of it: the panel must now say which of the three
  // states a week is in, and must never show a moving number with no state beside it.
  it("says which state the week is in, and never shows a score with no state", async () => {
    const { deps } = fixtureLeagueDeps();
    renderInLeague(<MatchupPanel matchup={inProgressMatchup} myTeamId="t1" weekStatus="in_progress" />, deps);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByText("Final")).not.toBeInTheDocument();
  });

  it("says a week is not scored yet rather than showing a zero", async () => {
    const pending = { ...MATCHUP, final: false, home: { ...MATCHUP.home, score: null }, away: { ...MATCHUP.away, score: null } };
    await renderSurface(<MatchupPanel matchup={pending} myTeamId="t1" weekStatus="scheduled" />, async ({ container }) => {
      expect(screen.getByText("Not started")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Non-median league: `matchup.median` is `null`, the same "nothing to say" state a week with
  // no scores reads as — no median residue anywhere on the page.
  it("shows no median line at all for a non-median league", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    expect(screen.queryByText(/league median/)).not.toBeInTheDocument();
  });

  it("shows each team's own median result, second person for the viewer's own team, third person for the other, in both themes, axe-clean", async () => {
    await renderSurface(
      <MatchupPanel matchup={MATCHUP_WITH_MEDIAN} myTeamId="t1" weekStatus="final" />,
      async ({ container }) => {
        // `t1` (home, myTeamId) beat the median; `t2` (away) missed it.
        expect(
          screen.getByText("You scored 112.50. The league median was 104.20, so you won that one too."),
        ).toBeInTheDocument();
        expect(
          screen.getByText("Iron Owls scored 98.25. The league median was 104.20, so they lost that one too."),
        ).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // The exact same matchup, viewed by nobody in it (a bye-week spectator, or a commissioner
  // browsing another pairing) — both sides read in the third person, and neither says "You".
  it("reads both sides in the third person for a viewer with no team in this matchup", () => {
    render(<MatchupPanel matchup={MATCHUP_WITH_MEDIAN} myTeamId={null} weekStatus="final" />);
    expect(
      screen.getByText("Bay Bandits scored 112.50. The league median was 104.20, so they won that one too."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Iron Owls scored 98.25. The league median was 104.20, so they lost that one too."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^You /)).not.toBeInTheDocument();
  });

  // The same "no median yet" state a week with no scores reads as (the brief's own equivalence):
  // a median exists for the week, but this particular side has no score to compare it to.
  it("shows no median line for a side with no score yet, even when the week's median is known", () => {
    const halfScored = { ...MATCHUP_WITH_MEDIAN, home: { ...MATCHUP_WITH_MEDIAN.home, score: null } };
    render(<MatchupPanel matchup={halfScored} myTeamId="t1" weekStatus="in_progress" />);
    expect(screen.queryByText(/Bay Bandits scored|You scored/)).not.toBeInTheDocument();
    expect(screen.getByText(/Iron Owls scored 98.25/)).toBeInTheDocument();
  });

  // A15: the "matchup" glossary term's InfoTip caller.
  it("carries an InfoTip on its own Matchup eyebrow", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    expect(screen.getByRole("button", { name: "What is a matchup?" })).toBeInTheDocument();
  });

  // Step 3c: the last two `Table` consumers to converge dense (the other is `budget-table.tsx`,
  // Task 12) — see `table.tsx`'s own docblock for the density-default decision this leaves.
  it("renders its starters table dense, at whatever vertical cell padding the density token carries", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    const headerCell = screen.getAllByRole("columnheader", { name: "Player" })[0]!;
    // Gameday law 4, density is respect (2026-08-28): v3 set this at 11px, which was the
    // Sunday Standard mock's own figure and airier than a fantasy table wants. A manager on a
    // Sunday reads more rows, not calmer ones. Read from `UI_CONFIG.table` rather than pinned as a
    // literal twice over.
    const dense = `${UI_CONFIG.table.denseRowPaddingPx}px`;
    expect(headerCell).toHaveStyle({ paddingTop: dense, paddingBottom: dense });
  });

  // Gauntlet fix wave, NEW-10: `Pos` (a `PositionBadge` sticker) used to be its own column here,
  // identical to `Slot` for every row but FLEX — two columns for one fact. `Slot` is the one
  // that survives (the same precedent `LineupEditor`'s own roster table already sets); this
  // table no longer renders a `PositionBadge` at all.
  it("renders every starter's roster slot as a SlotChip, with no separate position column", () => {
    render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
    expect(screen.queryByRole("columnheader", { name: "Pos" })).not.toBeInTheDocument();
    const slot = MATCHUP.home.starters[0]!.slot;
    expect(screen.getAllByText(slot).length).toBeGreaterThan(0);
  });

  /**
   * THE HEAT MAP, on the surface it pays off most (the fun pass, Task 9 — `docs/design/
   * 2026-08-27-fun-pass-spec.md`). Every one of these asserts the same bargain from a different
   * side: a points cell is tinted ONLY against a population the page can actually name, and the
   * tint is never the channel a manager depends on.
   */
  describe("magnitude on the player lines", () => {
    /** A week wide enough to rank inside: five started quarterbacks, this matchup's own two
     *  among them. `LiveMatchupWeek` builds this from every matchup in the week; the panel takes
     *  it as a prop because one matchup can never see the league. */
    const QB_WEEK = new Map([["QB" as const, [4, 8, 12, 19.25, 24.5]]]);

    it("compares a starter against the players who share their job, and says so out loud", () => {
      render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" positionPoints={QB_WEEK} />);
      // 24.5 is the best of the five, which is 0.9 on a tie-split percentile rank — "Top 10%",
      // never "Top 0%" and never a claim of perfection. 19.25 sits fourth of five, at 0.7.
      expect(screen.getByText("Top 10% of starting quarterbacks this week.")).toBeInTheDocument();
      expect(screen.getByText("Top 30% of starting quarterbacks this week.")).toBeInTheDocument();
    });

    it("leaves a position the week has no population for as plain ink, beside a tinted one", () => {
      // The running back has no pool here at all: a fixture week with one started RB is not
      // "running backs this week". A heat map that filled that gap with a guess would be the
      // decoration rule 6 rejects, so the cell simply stays a number.
      const { container } = render(
        <MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" positionPoints={QB_WEEK} />,
      );
      const steps = Array.from(container.querySelectorAll("[data-magnitude]")).map((el) => el.getAttribute("data-magnitude"));
      expect(steps).toContain("strong");
      expect(steps).toContain("good");
      expect(steps).toContain("neutral");
    });

    it("keeps the number readable as a number, and keeps the caret that survives with no colour", () => {
      const { container } = render(
        <MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" positionPoints={QB_WEEK} />,
      );
      expect(screen.getByText("24.50")).toBeInTheDocument();
      expect(screen.getByText("19.25")).toBeInTheDocument();
      // The caret is the channel that survives with the hue switched off. Without it this whole
      // feature misinforms one man in twelve rather than merely underserving him.
      expect(container.textContent).toContain("▲");
    });

    it("tints nothing at all when the page named no population, which is every other caller", () => {
      const { container } = render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" />);
      const steps = Array.from(container.querySelectorAll("[data-magnitude]")).map((el) => el.getAttribute("data-magnitude"));
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.every((step) => step === "neutral")).toBe(true);
    });

    it("leaves a player who has not played as a dash, never a heat-coloured zero", () => {
      const notPlayed = {
        ...MATCHUP,
        home: { ...MATCHUP.home, starters: [{ ...MATCHUP.home.starters[0]!, points: null }] },
      };
      const { container } = render(
        <MatchupPanel matchup={notPlayed} myTeamId="t1" weekStatus="in_progress" positionPoints={QB_WEEK} />,
      );
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
      // Scoped to the tables. The hero's own bench chip may legitimately print "0.00 on your
      // bench" for a bench that PLAYED and produced nothing, which is a different fact from a
      // starter who has not kicked off and the one this assertion is about.
      const tables = Array.from(container.querySelectorAll("table")).map((table) => table.textContent).join("");
      expect(tables).not.toContain("0.00");
    });

    it("prints the column name once per table on screen, never visibly under every number", () => {
      render(<MatchupPanel matchup={MATCHUP} myTeamId="t1" weekStatus="final" positionPoints={QB_WEEK} />);
      // The `<th>` is the label a reader sees, for both side tables. Every other "Points" in the
      // document belongs to a cell's `Stat` and is `sr-only` — the number still has a name in the
      // accessibility tree, and the page still reads as a table rather than eighteen captioned
      // tiles (the document grammar the fun pass exists to undo).
      const spelled = screen.getAllByText("Points");
      const headers = screen.getAllByRole("columnheader", { name: "Points" });
      expect(headers).toHaveLength(2);
      const inCells = spelled.filter((el) => el.closest("th") === null);
      expect(inCells.length).toBeGreaterThan(0);
      expect(inCells.every((el) => el.className.includes("sr-only"))).toBe(true);
    });
  });
});
