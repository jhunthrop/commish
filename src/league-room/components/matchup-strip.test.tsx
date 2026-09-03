import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { MATCHUP } from "../test-fixtures";
import { MatchupStrip } from "./matchup-strip";

/** A second fixture so the strip is tested with more than one row — the whole component exists to
 *  turn a LIST of matchups into one scannable band. */
const OTHER = {
  ...MATCHUP,
  home: { ...MATCHUP.home, teamId: "t3", teamName: "Comet Crew", score: 44 },
  away: { ...MATCHUP.away, teamId: "t4", teamName: "Dust Devils", score: 51 },
};

describe("MatchupStrip", () => {
  it("renders one row per matchup, both scores on it, in both themes, axe-clean", async () => {
    await renderSurface(
      <MatchupStrip matchups={[MATCHUP, OTHER]}>{(matchup) => <p>{`lineups for ${matchup.home.teamName}`}</p>}</MatchupStrip>,
      async ({ container }) => {
        expect(screen.getByText("Bay Bandits")).toBeInTheDocument();
        expect(screen.getByText("Comet Crew")).toBeInTheDocument();
        expect(screen.getByText("112.50")).toBeInTheDocument();
        expect(screen.getByText("51.00")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  /**
   * THE WHOLE ARGUMENT FOR COLLAPSING THE REST OF THE LEAGUE. Density is only respect while
   * nothing has been deleted: the lineups that used to sit on this page in full are still on it,
   * behind the browser's own disclosure. If this ever stops being true the strip is not a density
   * win, it is the same page with less on it.
   */
  it("keeps every matchup's lineups on the page, behind its own row's disclosure", () => {
    return renderSurface(
      <MatchupStrip matchups={[MATCHUP, OTHER]}>{(matchup) => <p>{`lineups for ${matchup.home.teamName}`}</p>}</MatchupStrip>,
      async () => {
        expect(screen.getByText("lineups for Bay Bandits")).toBeInTheDocument();
        expect(screen.getByText("lineups for Comet Crew")).toBeInTheDocument();
      },
    );
  });

  // The one fact that decides whether a manager cares about somebody else's game at all — a five
  // point lead with three still to play is a different afternoon from the same lead with none.
  it("prints the number of starters still to play across both sides of a row", () => {
    // Mid-week, not final: `remainingToPlay` reports 0 for a final week on purpose (nobody is
    // still to play once the week is over), so the marker only exists while games remain.
    const pending = {
      ...MATCHUP,
      final: false,
      weekStatus: "in_progress" as const,
      home: { ...MATCHUP.home, starters: MATCHUP.home.starters.map((row) => ({ ...row, points: null })) },
    };
    return renderSurface(<MatchupStrip matchups={[pending]}>{() => null}</MatchupStrip>, async () => {
      expect(screen.getByText(`${pending.home.starters.length} to play`)).toBeInTheDocument();
    });
  });

  it("renders nothing at all when there is no other matchup to show", () => {
    return renderSurface(<MatchupStrip matchups={[]}>{() => null}</MatchupStrip>, async ({ container }) => {
      expect(container.querySelector("ul")).toBeNull();
    });
  });
});
