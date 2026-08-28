import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { renderSurface } from "@/components/ui/test-utils";
import type { TeamStandingsRow } from "../contract";
import { ALL_CLINCHED_STANDINGS, STANDINGS } from "../test-fixtures";
import { StandingsTable } from "./standings-table";

describe("StandingsTable", () => {
  it("shows each team's record and both points columns, in both themes, axe-clean", async () => {
    await renderSurface(<StandingsTable rows={STANDINGS} myTeamId="t1" />, async ({ container }) => {
      const rows = screen.getAllByRole("row").slice(1);
      expect(within(rows[0]!).getByText("9-4")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("1,412.50".replace(",", ""))).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Step 15's audit: a standings row named the team but never showed a face. `Avatar` falls
  // back to initials with no `ownerAvatar` on the row, so the owner's initials sit beside the
  // team name rather than a blank space.
  it("puts the owner's face beside the team name", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByText("AR")).toBeInTheDocument();
  });

  it("carries an InfoTip on the Record column header", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByRole("button", { name: "What is a record?" })).toBeInTheDocument();
  });

  /**
   * Step 2's invariant was "dense numerals — `font-mono` on every number this table renders, the
   * record cell included, so a re-sort never shifts a column's digits sideways." The INVARIANT is
   * unchanged and still asserted; the spelling of it moved for the points columns only.
   *
   * The fun pass (Task 10) made both points columns `Stat`s, which is the product's one renderer
   * of magnitude colour — and `Stat` reaches tabular alignment through `tabular-nums` on the
   * display face rather than through `font-mono`. Pinning `font-mono` there would have banned the
   * heat map from the table it pays off most in, to defend a property the replacement also has.
   * The record cell keeps `font-mono` exactly as before: it is not a `Stat` and never became one.
   */
  it("keeps every number tabular so a re-sort never shifts a column's digits sideways", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByText("9-4").className).toContain("font-mono");
    // `Stat` wraps its value in a bare span inside the run that carries the numeric styling, so
    // the classes live one level up — the same reach `stat.test.tsx` makes.
    expect(screen.getByText("1412.50").parentElement!.className).toContain("tabular-nums");
  });

  it("renders dense, at Gameday's own 7px vertical cell padding", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    const headerCell = screen.getByRole("columnheader", { name: "Team" });
    // Gameday law 4, density is respect (2026-08-28): v3 set this at 11px, which was the
    // Sunday Standard mock's own figure and airier than a fantasy table wants. A manager on a
    // Sunday reads more rows, not calmer ones. Read from `UI_CONFIG.table` rather than pinned as a
    // literal twice over.
    expect(headerCell).toHaveStyle({ paddingTop: "7px", paddingBottom: "7px" });
  });

  // FIX 1 (HIGH): helpLevel must actually reach a wired InfoTip, not just be accepted and
  // dropped — a guided caller sees the short line without clicking; a standard caller (or one
  // this prop is simply omitted for, the default) only gets the click-to-reveal trigger.
  it("threads helpLevel into its InfoTip: guided shows the short line inline, standard doesn't", () => {
    const { rerender } = render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.queryByText(GLOSSARY["standings-record"].short)).not.toBeInTheDocument();
    rerender(<StandingsTable rows={STANDINGS} myTeamId="t1" helpLevel="standard" />);
    expect(screen.queryByText(GLOSSARY["standings-record"].short)).not.toBeInTheDocument();
    rerender(<StandingsTable rows={STANDINGS} myTeamId="t1" helpLevel="guided" />);
    expect(screen.getByText(GLOSSARY["standings-record"].short)).toBeInTheDocument();
  });

  // NEW-3 (gauntlet fix wave, "reported, not fixed"): the Record header's own instance of
  // `open-league-card.tsx`'s guided-`InfoTip` layout break — a guided caller's caption grows
  // that ONE header cell past the other headers' plain single-line height, and `Table`'s
  // `<th>` picked up `align-top` (`@/components/ui/table.tsx`) so the row's other labels stay
  // flush with `Record`'s own top edge rather than floating at the row's new, taller vertical
  // center. None of the other tests in this file render `helpLevel="guided"` through axe, so
  // this is the one that actually exercises the layout the fix targets.
  it("keeps every header flush and stays axe-clean with the Record header's guided caption showing, in both themes", async () => {
    await renderSurface(<StandingsTable rows={STANDINGS} myTeamId="t1" helpLevel="guided" />, async ({ container }) => {
      expect(screen.getByText(GLOSSARY["standings-record"].short)).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Team" }).className).toContain("align-top");
      expect(screen.getByRole("columnheader", { name: /^Record/ }).className).toContain("align-top");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("marks the clinched teams and the caller's own row", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByText("Clinched")).toBeInTheDocument();
    expect(screen.getByText("Bay Bandits").closest("tr")).toHaveAttribute("data-own", "true");
  });

  it("re-orders by a column when its header button is pressed, keeping the server's ranking for ties", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Sort by points against" }));
    const names = screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(names[0]).toContain("Iron Owls");
  });

  it("a GENUINE tie keeps the server's order through a sort round-trip — the client never restates a tiebreak", () => {
    // Two rows identical on every sortable number; the server ranked t_b above t_c
    // (its tiebreak is teamId — a rule this component must never re-derive).
    const tied = [
      { teamId: "t_a", teamName: "Front Runners", wins: 8, losses: 5, ties: 0, pointsFor: 1400, pointsAgainst: 1200, clinched: false, ownerDisplayName: "A", ownerAvatar: null },
      { teamId: "t_b", teamName: "Twin Alpha", wins: 6, losses: 7, ties: 0, pointsFor: 1234.5, pointsAgainst: 1300, clinched: false, ownerDisplayName: "B", ownerAvatar: null },
      { teamId: "t_c", teamName: "Twin Beta", wins: 6, losses: 7, ties: 0, pointsFor: 1234.5, pointsAgainst: 1300, clinched: false, ownerDisplayName: "C", ownerAvatar: null },
    ];
    render(<StandingsTable rows={tied} myTeamId={null} />);
    const namesAfter = (label: string) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
      return screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent ?? "");
    };
    const byPointsFor = namesAfter("Sort by points for");
    expect(byPointsFor.findIndex((n) => n.includes("Twin Alpha"))).toBeLessThan(byPointsFor.findIndex((n) => n.includes("Twin Beta")));
    const byWins = namesAfter("Sort by standing");
    expect(byWins.findIndex((n) => n.includes("Twin Alpha"))).toBeLessThan(byWins.findIndex((n) => n.includes("Twin Beta")));
  });

  it("offers a next action before any week has been scored", async () => {
    await renderSurface(<StandingsTable rows={[]} myTeamId={null} />, async ({ container }) => {
      expect(screen.getByText("No results yet")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Task 5 carry: `clinchedTeamIds` reports every team clinched from week 1 whenever the
  // playoff field is as big as the league itself (`playoffTeams >= teamCount`) — a signal with
  // no information in it. Twelve meaningless badges are worse than none.
  it("suppresses the clinched badge for every row when the whole league is (degenerately) clinched", async () => {
    await renderSurface(<StandingsTable rows={ALL_CLINCHED_STANDINGS} myTeamId="t1" />, async ({ container }) => {
      expect(screen.queryByText("Clinched")).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Step 2: the playoff cut, drawn as a hairline between two rows — never a colored row, which
  // would be a WCAG 1.4.1 color-only-boundary failure. `STANDINGS` has three teams; a
  // `playoffTeams` of 2 draws the cut above the third (`t3`, "Comet Crew").
  it("draws the playoff cut as a border-top hairline above the first team out, when playoffTeams is given", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" playoffTeams={2} />);
    const cutRow = screen.getByText("Comet Crew").closest("tr")!;
    expect(cutRow.className).toContain("border-t-edge");
    const inRow = screen.getByText("Iron Owls").closest("tr")!;
    expect(inRow.className).not.toContain("border-t-edge");
  });

  it("draws no cut at all without a playoffTeams prop, or when the field covers the whole league", () => {
    const { rerender } = render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(document.querySelector("tr.border-t-edge")).toBeNull();
    rerender(<StandingsTable rows={STANDINGS} myTeamId="t1" playoffTeams={STANDINGS.length} />);
    expect(document.querySelector("tr.border-t-edge")).toBeNull();
  });

  // Task 3 (Phase 3.5): the standings surface that says the record itself is a two-games-a-week
  // one. Inverted assertion — a non-median league (the default, `medianGame` omitted) never
  // shows either the caption note or the swapped InfoTip. `formatRecord`/`computeStandings`
  // themselves are unchanged (one column, because the median game IS a game — a second record
  // column would say the opposite of what the format means); this only adds context around it.
  it("adds neither the caption note nor a swapped InfoTip for a non-median league", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.queryByText(/median game/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is a record?" })).toBeInTheDocument();
  });

  it("names the median game in a caption note and swaps the Record header's InfoTip, in both themes, axe-clean", async () => {
    await renderSurface(<StandingsTable rows={STANDINGS} myTeamId="t1" medianGame />, async ({ container }) => {
      expect(screen.getByText(/Records include each week's median game\./)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "What is a median game?" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "What is a record?" })).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("keeps the tiebreak sentence and appends the median note to the SAME line, not a second paragraph", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" medianGame />);
    expect(
      screen.getByText("Ties in the standings break on points for. Clinched means a guaranteed playoff spot. Records include each week's median game."),
    ).toBeInTheDocument();
  });

  /**
   * THE HEAT MAP ON THE STANDINGS (the fun pass, Task 10 — `docs/design/2026-08-27-fun-pass-
   * spec.md`). The table stays a table: rule 4's amended test is "a thing you act on or compare
   * against its neighbours may be a card; a thing you read down a column stays a row", and the
   * standings is the canonical column you read down. What changes is that its two points columns
   * stop being the same colour as every other number in the product.
   *
   * The population is this league's own teams, which is the only genuine one a standings table
   * has — and it is why a three-row fixture (every other test above) still renders plain ink.
   */
  describe("magnitude on the points columns", () => {
    const SIX: readonly TeamStandingsRow[] = [1400, 1300, 1200, 1100, 1000, 900].map((pointsFor, index) => ({
      teamId: `x${index}`,
      teamName: `Team ${index}`,
      wins: 10 - index,
      losses: index,
      ties: 0,
      pointsFor,
      // Deliberately the REVERSE order: the team scoring most also allows most, so a test that
      // passed by reading the wrong column would be caught.
      pointsAgainst: 900 + index * 100,
      clinched: false,
      ownerDisplayName: `Owner ${index}`,
      ownerAvatar: null,
    }));

    it("ranks points for against the league, and says which population it used", () => {
      render(<StandingsTable rows={SIX} myTeamId="x0" />);
      expect(screen.getByText("Top 8% of teams by points for.")).toBeInTheDocument();
      expect(screen.getByText("Bottom 8% of teams by points for.")).toBeInTheDocument();
    });

    it("reads points against in the direction it is actually judged, where the biggest number is the worst", () => {
      render(<StandingsTable rows={SIX} myTeamId="x0" />);
      // `x0` allows the FEWEST (900) and therefore sits at the top of a population named for that
      // direction. A ramp that ranked it by raw size would paint the best defense in the league
      // as its worst number.
      expect(screen.getByText("Top 8% of teams by fewest points allowed.")).toBeInTheDocument();
      expect(screen.getByText("Bottom 8% of teams by fewest points allowed.")).toBeInTheDocument();
    });

    it("leaves the record alone, because the row order already ranks it", () => {
      const { container } = render(<StandingsTable rows={SIX} myTeamId="x0" />);
      // Two heat-coloured cells per row and no more. A record is what the table is SORTED by —
      // tinting it would spend the heat map on a fact the reader gets from position, which is the
      // "louder without making a true thing more legible" failure rule 6 rejects.
      expect(screen.getByText("10-0").className).toContain("font-mono");
      expect(container.querySelectorAll("[data-magnitude]")).toHaveLength(SIX.length * 2);
    });

    it("keeps the ranking readable with the hue switched off", () => {
      const { container } = render(<StandingsTable rows={SIX} myTeamId="x0" />);
      expect(container.textContent).toContain("▲");
      expect(container.textContent).toContain("▼");
      // The first channel, and the least negotiable: whatever the tint is doing, the number is on
      // screen as its own number. (Twice here — 1400 is both the top scorer's points for and the
      // worst defense's points against.)
      expect(screen.getAllByText("1400.00")).toHaveLength(2);
    });

    it("stays plain ink for a league too small to rank inside", () => {
      const { container } = render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
      const steps = Array.from(container.querySelectorAll("[data-magnitude]")).map((el) => el.getAttribute("data-magnitude"));
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.every((step) => step === "neutral")).toBe(true);
    });

    it("is axe-clean with the heat on, in both themes", async () => {
      await renderSurface(<StandingsTable rows={SIX} myTeamId="x0" />, async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      });
    });
  });
});
