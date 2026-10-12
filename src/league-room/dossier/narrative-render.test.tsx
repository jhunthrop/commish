import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { PlayerFactsBooksNumbers, PlayerFactsLastSeasonStory, PlayerFactsTrend, PlayerFactsUsage } from "@research/capsules/facts";
import type { PlayerSeasonBody } from "@/league-service/player";
import { BooksModule } from "./books-module";
import { CallCard } from "./call-card";
import { RoleModule } from "./role-module";
import { SeasonChartFallback } from "./season-chart-fallback";
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
    // THE FIGURES SURVIVE (review I3): the writer accompanies a stat, it never replaces one, so
    // the two seasons, the delta and its tinted Stat are all still on the page beneath it.
    expect(text).toContain("18.1 a game in 2024 fell to 14.3 in 2025,");
    expect(written.container.querySelector('[data-trend="delta"]')).not.toBeNull();
    expect(written.container.querySelector('[data-role="trend-written"]')?.textContent).toContain("He gave back nearly four points");
    // The stat rows are the engine's, and they are untouched.
    expect(text).toContain("24%");
    expect(text).toContain("62%");
  });

  it("RoleModule: no written trend line where there is no measured trend to accompany", () => {
    const immaterial: PlayerFactsTrend = {
      pointsPerGame: { priorSeason: 2024, priorValue: 12, recentSeason: 2025, recentValue: 12.4, delta: 0.4, material: false },
      yardsPerOpportunity: null,
      targetShare: null,
    };
    for (const trend of [null, immaterial]) {
      const written = render(<RoleModule position="RB" usage={USAGE} trend={trend} writtenTrend="A sentence about a move this page is not showing." />);
      expect(written.container.querySelector('[data-role="trend-written"]')).toBeNull();
    }
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

    const written = render(<BooksModule books={empty} absence="No book has posted a number on him, which says nothing about him at all." />);
    const text = written.container.textContent ?? "";
    expect(text).toContain("No book has posted a number on him");
    expect(text).not.toContain("No props line posted for him yet.");
  });

  it("CallCard: the written per-game sentence replaces the templated talent-versus-games line", () => {
    const props = {
      verdict: "He is a reach where he is going.",
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
    // THE STATED FIGURE SURVIVES (review I4): the writer follows the fact rather than standing in
    // for it, so the group still says what it is and what it does.
    expect(text).toContain("SF to MIA.");
    expect(text).toContain("Changed team.");
  });

  it("WhyGroups: a law group keeps its net effect and adds the sentence after it", () => {
    const reasons = [{ code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 } as const];
    const written = render(
      <WhyGroups
        reasons={reasons}
        laws={[]}
        position="RB"
        capsule={{ narrative: { "whyGroup:age": "Backs his age fall off a shelf, and the tape agrees this time." } }}
      />,
    );
    const text = written.container.textContent ?? "";
    expect(text).toContain("Costs him 1.8 points a game.");
    expect(text).toContain("Backs his age fall off a shelf");
  });
});

/** The narrowest body `SeasonChartFallback` reads: it looks at `isRookie`, `availableSeasons`,
 *  `season`, `player` and `weeks`, and nothing else on the shape. */
function fallbackBody(over: Partial<PlayerSeasonBody> = {}): PlayerSeasonBody {
  return {
    player: { id: "rb1", name: "Rashad Long", position: "RB", nflTeam: "SF", headshotUrl: null, adp: 12.5 },
    availableSeasons: [],
    season: 2026,
    isRookie: true,
    positionRank: null,
    adpPercentile: null,
    expertRank: null,
    modelRank: null,
    pointsPerGame: null,
    pointsPerGamePercentile: null,
    weeks: [],
    ownedBy: null,
    isMockLeague: false,
    injuryDesignation: null,
    log: [],
    totals: null,
    kdefSeason: null,
    news: [],
    reasons: [],
    laws: [],
    ...over,
  } as PlayerSeasonBody;
}

describe("the written absence for a season nobody has (review I2)", () => {
  it("replaces the rookie sentence when the capsule wrote one", () => {
    const templated = render(<SeasonChartFallback body={fallbackBody()} switcher={undefined} played={false} />);
    expect(templated.container.textContent).toContain("His first NFL season.");

    const written = render(
      <SeasonChartFallback body={fallbackBody()} switcher={undefined} played={false} absence="No NFL snap on his record yet, so August is the whole of what you know." />,
    );
    const text = written.container.textContent ?? "";
    expect(text).toContain("No NFL snap on his record yet");
    expect(text).not.toContain("His first NFL season.");
  });

  it("replaces the no-record sentence for a veteran the store has nothing for", () => {
    const body = fallbackBody({ isRookie: false });
    expect(render(<SeasonChartFallback body={body} switcher={undefined} played={false} />).container.textContent).toContain("No prior seasons on record.");

    const written = render(<SeasonChartFallback body={body} switcher={undefined} played={false} absence="Nothing of his is on file, which says more about our records than about him." />);
    expect(written.container.textContent).toContain("Nothing of his is on file");
    expect(written.container.textContent).not.toContain("No prior seasons on record.");
  });

  it("never replaces a real chart, which is a stat", () => {
    const body = fallbackBody({ isRookie: false, availableSeasons: [2026], weeks: [{ week: 1, points: 12.5, percentile: 0.7 }] });
    const written = render(<SeasonChartFallback body={body} switcher={undefined} played absence="An absence note nobody should see here." />);
    expect(written.container.textContent).not.toContain("An absence note nobody should see here.");
  });
});

/** I6 — the books sentence and the books ABSENCE are two slots, and the absence line is the only
 *  one that stands in for the templated "no props line" sentence. */
describe("the books module's two slots (review I6)", () => {
  it("keeps a player's books sentence out of the props-absence line", () => {
    const winTotalOnly: PlayerFactsBooksNumbers = { propsLines: [], teamVegasWinTotal: 9.5 };
    const written = render(<BooksModule books={winTotalOnly} sentence="The books hang nine and a half wins on that team." />);
    const text = written.container.textContent ?? "";
    expect(text).toContain("No props line posted for him yet.");
    expect(text).not.toContain("The books hang nine and a half wins");
  });

  it("uses the absence slot for that line when there is one", () => {
    const winTotalOnly: PlayerFactsBooksNumbers = { propsLines: [], teamVegasWinTotal: 9.5 };
    const written = render(<BooksModule books={winTotalOnly} absence="No book has posted a number on him, which says nothing about him." />);
    const text = written.container.textContent ?? "";
    expect(text).toContain("No book has posted a number on him");
    expect(text).not.toContain("No props line posted for him yet.");
    expect(text).toContain("Team win total: 9.5 wins.");
  });
});
