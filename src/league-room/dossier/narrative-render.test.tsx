import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { PlayerFactsBooksNumbers, PlayerFactsLastSeasonStory, PlayerFactsTrend, PlayerFactsUsage } from "@/capsules/facts";
import { BooksModule } from "./books-module";
import { CallCard } from "./call-card";
import { RoleModule } from "./role-module";
import { SeasonStrip } from "./season-strip";
import { WhyGroups } from "./why-groups";

/**
 * THE RENDER CHOICE, EVERY MODULE, BOTH WAYS (dossier-voice round §3.5) — a validated slot renders
 * in place of the module's own template sentence, and NEVER beside it; no slot renders exactly what
 * the module rendered before the narrative existed. The numbers each module displays are untouched
 * either way, which is the founder's own line: the writer accompanies a stat, it never replaces one.
 */

const USAGE: PlayerFactsUsage = {
  season: 2025,
  snapShare: 0.62,
  snapShareRank: { value: 0.62, positionRank: 4, qualifierCount: 32, namedNeighbor: null },
  targetShare: 0.24,
  targetShareRank: null,
  redZoneShare: 0.4,
  redZoneShareRank: null,
};

const TREND: PlayerFactsTrend = {
  pointsPerGame: { priorSeason: 2024, priorValue: 18.1, recentSeason: 2025, recentValue: 14.3, delta: -3.8, material: true },
  yardsPerOpportunity: null,
  targetShare: null,
};

const BOOKS: PlayerFactsBooksNumbers = {
  propsLines: [{ market: "player_rush_yds", medianLine: 70.5 }],
  teamVegasWinTotal: 9.5,
};

const STORY: PlayerFactsLastSeasonStory = {
  season: 2025,
  gamesPlayed: 16,
  pointsPerGame: 18.1,
  pointsRank: { value: 289.6, positionRank: 3, qualifierCount: 48, namedNeighbor: null },
  bestWeek: { week: 9, points: 34.2 },
  weeksAboveMedian: 11,
  receivingYardsRank: { value: 1102, positionRank: 6, qualifierCount: 48, namedNeighbor: null },
  touchesRank: null,
};

describe("the narrative's render choice", () => {
  it("RoleModule: the written trend replaces the templated one, and the shares stay exactly as they were", () => {
    const templated = render(<RoleModule position="RB" usage={USAGE} trend={TREND} />);
    expect(templated.container.textContent).toContain("18.1 a game in 2024 fell to 14.3 in 2025,");

    const written = render(<RoleModule position="RB" usage={USAGE} trend={TREND} writtenTrend="He gave back nearly four points a game and the tape says the line is the reason." />);
    const text = written.container.textContent ?? "";
    expect(text).toContain("He gave back nearly four points a game");
    expect(text).not.toContain("A real move, not noise.");
    // The stat rows are the engine's, and they are untouched.
    expect(text).toContain("24%");
    expect(text).toContain("62%");
  });

  it("RoleModule: an absence note is said in a voice, with the rows still showing the shape of what is missing", () => {
    const written = render(<RoleModule position="RB" usage={null} trend={null} absenceSentence="Nobody charted his snaps last year, so watch the August work." />);
    const text = written.container.textContent ?? "";
    expect(text).toContain("Nobody charted his snaps last year");
    expect(text).toContain("not tracked for him");

    const templated = render(<RoleModule position="RB" usage={null} trend={null} />);
    expect(templated.container.querySelector('[data-role="usage-absence"]')).toBeNull();
  });

  it("BooksModule: the written line sits with the books' own numbers, never in place of them", () => {
    const written = render(<BooksModule books={BOOKS} sentence="The books hang 70.5 rushing yards a game on him and nine and a half wins on his team." />);
    const text = written.container.textContent ?? "";
    expect(text).toContain("The books hang 70.5 rushing yards a game on him");
    expect(text).toContain("70.5 rush yards a game");
    expect(text).toContain("Team win total: 9.5 wins.");
  });

  it("BooksModule: the absence note replaces the templated one when the books posted nothing", () => {
    const empty: PlayerFactsBooksNumbers = { propsLines: [], teamVegasWinTotal: null };
    const templated = render(<BooksModule books={empty} />);
    expect(templated.container.textContent).toContain("No props line posted for him yet.");

    const written = render(<BooksModule books={empty} sentence="No book has posted a number on him, which says nothing about him at all." />);
    const text = written.container.textContent ?? "";
    expect(text).toContain("No book has posted a number on him");
    expect(text).not.toContain("No props line posted for him yet.");
  });

  it("CallCard: the written per-game sentence replaces the templated talent-versus-games line", () => {
    const props = {
      verdict: "The market is overpricing him.",
      market: { adp: 12.5, expertRank: 14 },
      ourBoard: { position: "RB" as const, positionRank: 4, boardRank: 14, points: 248, scoringLabel: "PPR", perGameRank: 3, expectedGames: 15 },
      gap: -9.5,
    };
    const templated = render(<CallCard {...props} />);
    expect(templated.container.textContent).toContain("Per game he projects like a RB3.");

    const written = render(<CallCard {...props} perGameSentence="Per game he is a top three back. The only question is how many Sundays he is upright for." />);
    const text = written.container.textContent ?? "";
    expect(text).toContain("The only question is how many Sundays");
    expect(text).not.toContain("The question is games:");
  });

  it("SeasonStrip: the written story sits under the stated facts, which never move", () => {
    const written = render(<SeasonStrip story={STORY} weeks={[]} scoringLabel="PPR" sentence="Sixteen games and a top three finish, and the week nine game was the season in one afternoon." />);
    const text = written.container.textContent ?? "";
    expect(text).toContain("the week nine game was the season in one afternoon");
    expect(text).toContain("18.1 a game");
    expect(text).toContain("34.2");

    const templated = render(<SeasonStrip story={STORY} weeks={[]} scoringLabel="PPR" />);
    expect(templated.container.querySelector('[data-season="written"]')).toBeNull();
  });

  it("WhyGroups: one written sentence per group, keyed by the group the module is drawing", () => {
    const reasons = [{ code: "changed_team", from: "SF", to: "MIA" } as const];
    const templated = render(<WhyGroups reasons={reasons} laws={[]} position="RB" />);
    expect(templated.container.textContent).toContain("SF to MIA.");

    const written = render(
      <WhyGroups
        reasons={reasons}
        laws={[]}
        position="RB"
        capsule={{ narrative: { "whyGroup:changed_team": "He is in a new building with a new play sheet, and that is the whole question." } }}
      />,
    );
    const text = written.container.textContent ?? "";
    expect(text).toContain("He is in a new building with a new play sheet");
    expect(text).not.toContain("SF to MIA.");
    // The bold lead is the group's own stated headline and stays the engine's.
    expect(text).toContain("Changed team.");
  });
});
