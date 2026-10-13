import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Player } from "@research-ts/domain/player";
import type { PlayerDossierFacts } from "@/league-service/dossier-facts";
import type { PlayerSeasonBody } from "@/league-service/player";
import type { Law } from "@research-ts/projections/laws/types";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "../hooks/deps";
import { openPlayerPeek, PlayerPeekHost } from "./player-peek";
import { resetPlayerPeekHostsForTests } from "./use-peek-load";

/**
 * THE SEASON WIDENING'S UI COVERAGE (2026-09-04) — the bottom-sheet peek's own season label and
 * switcher, and the honest "his first NFL season" sentence a true rookie gets in place of a chart.
 * No test of this component existed before this widening (`PlayerPeekHost` was only ever mounted
 * as a sibling elsewhere, never asserted on directly), so these are new rather than extended —
 * see the task's own note on that.
 */

const PLAYER: Player = { id: "rb1", name: "Rashad Long", position: "RB", nflTeam: "SF", headshotUrl: null, adp: 2.5 };

function bodyFor(season: number, availableSeasons: readonly number[]): PlayerSeasonBody {
  return {
    player: PLAYER,
    availableSeasons,
    season,
    isRookie: false,
    positionRank: 1,
    adpPercentile: 0.9,
    expertRank: 5,
    modelRank: 4,
    pointsPerGame: 12.5,
    pointsPerGamePercentile: 0.7,
    weeks: [{ week: 1, points: 12.5, percentile: 0.7 }],
    ownedBy: null,
    isMockLeague: false,
    injuryDesignation: null,
    log: [{ week: 1, points: 12.5, carries: season === 2026 ? 15 : null, rushingYards: 80, targets: season === 2026 ? 3 : null, receptions: 2, receivingYards: 20, passingYards: 0, touchdowns: 1 }],
    totals: {
      games: 1, carries: season === 2026 ? 15 : null, rushingYards: 80, targets: season === 2026 ? 3 : null,
      receptions: 2, receivingYards: 20, passingYards: 0, touchdowns: 1, fantasyPoints: 12.5,
    },
    kdefSeason: null,
    news: [],
    reasons: [],
    laws: [],
  };
}

const ROOKIE_BODY: PlayerSeasonBody = {
  player: { ...PLAYER, id: "rb_rookie", name: "Fresh Back" },
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
};

/** THE THIRD STATE (fix round 1, CRITICAL) — `availableSeasons` is empty exactly like a true
 *  rookie's, but `isRookie` is `false`: a crosswalk miss, or a placed veteran the store has no
 *  weeks for. The UI must tell these apart. */
const NO_RECORD_BODY: PlayerSeasonBody = {
  ...ROOKIE_BODY,
  player: { ...PLAYER, id: "rb_unrecorded", name: "Quiet Veteran" },
  isRookie: false,
};

/** Answers `/player-season` from a season-keyed table of bodies, exactly as the real route
 *  answers `?season=`: absent means the service's own default. `calls` records every URL this
 *  fixture was asked for, so a test can assert on what a season switch actually requested. */
function fixtureDeps(bodiesBySeason: ReadonlyMap<number, PlayerSeasonBody>, defaultSeason: number, calls: string[] = []): LeagueRoomDeps {
  return {
    fetchJson: (url) => {
      calls.push(url);
      const parsed = new URL(url, "http://test");
      const seasonParam = parsed.searchParams.get("season");
      const season = seasonParam === null ? defaultSeason : Number(seasonParam);
      const body = bodiesBySeason.get(season);
      return Promise.resolve(new Response(JSON.stringify(body === undefined ? { ok: false, error: "no such season" } : { ok: true, data: body })));
    },
    openEventSource: () => ({ addEventListener: () => undefined, close: () => undefined }),
  };
}

function mount(deps: LeagueRoomDeps) {
  return render(
    <LeagueRoomDepsProvider deps={deps}>
      <PlayerPeekHost />
    </LeagueRoomDepsProvider>,
  );
}

describe("PlayerPeekHost — season label and switcher", () => {
  it("labels the season explicitly and renders no switcher for a player with only one season", async () => {
    const bodies = new Map([[2026, bodyFor(2026, [2026])]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });

    await waitFor(() => expect(screen.getByText("2026 season")).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "Season" })).not.toBeInTheDocument();
  });

  it("renders a segmented switcher for a player with more than one season, and refetches on a press", async () => {
    const user = userEvent.setup();
    const bodies = new Map([
      [2026, bodyFor(2026, [2026, 2025])],
      [2025, bodyFor(2025, [2026, 2025])],
    ]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });

    await waitFor(() => expect(screen.getByText("2026 season")).toBeInTheDocument());
    const group = screen.getByRole("group", { name: "Season" });
    expect(within(group).getByRole("button", { name: "2026" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "false");

    // The current season's game log carries real carries/targets; pressing 2025 switches to the
    // prior season's fixture, whose log carries `null` for both (the store cannot honestly fill
    // them — see `PlayerGameLogRow`'s own docblock).
    expect(screen.getAllByText("15").length).toBeGreaterThan(0);
    await user.click(within(group).getByRole("button", { name: "2025" }));

    await waitFor(() => expect(screen.getByText("2025 season")).toBeInTheDocument());
    expect(within(screen.getByRole("group", { name: "Season" })).getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "true");
  });

  it("gives a true rookie one honest sentence in place of the chart, with the Outlook/reasons sections unaffected", async () => {
    const bodies = new Map([[2026, ROOKIE_BODY]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb_rookie", name: "Fresh Back" });

    await waitFor(() => expect(screen.getByText("His first NFL season.")).toBeInTheDocument());
    expect(screen.queryByText(/No scored week for him/)).not.toBeInTheDocument();
    expect(screen.queryByText("No prior seasons on record.")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Season" })).not.toBeInTheDocument();
  });

  it("gives a veteran with no recorded season the honest 'no record' sentence, never the rookie one (fix round 1, CRITICAL)", async () => {
    const bodies = new Map([[2026, NO_RECORD_BODY]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb_unrecorded", name: "Quiet Veteran" });

    await waitFor(() => expect(screen.getByText("No prior seasons on record.")).toBeInTheDocument());
    expect(screen.queryByText("His first NFL season.")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Season" })).not.toBeInTheDocument();
  });

  it("resets any picked season when a different player's card is opened", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const bodies = new Map([
      [2026, bodyFor(2026, [2026, 2025])],
      [2025, bodyFor(2025, [2026, 2025])],
    ]);
    mount(fixtureDeps(bodies, 2026, calls));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("2026 season")).toBeInTheDocument());
    await user.click(within(screen.getByRole("group", { name: "Season" })).getByRole("button", { name: "2025" }));
    await waitFor(() => expect(screen.getByText("2025 season")).toBeInTheDocument());
    expect(calls.at(-1)).toContain("season=2025");

    // A different player's card — if the picked "2025" survived onto it, this fetch would carry
    // `season=2025` too, a choice made on a name this manager never pressed.
    openPlayerPeek({ leagueId: "lg1", playerId: "rb2", name: "Second Back" });
    await waitFor(() => expect(calls.at(-1)).toContain("playerId=rb2"));
    expect(calls.at(-1)).not.toContain("season=");
  });
});

describe("PlayerPeekHost — context honesty (Task 4, 2026-09-04)", () => {
  it("states the real roster fact in a real league", async () => {
    const bodies = new Map([[2026, { ...bodyFor(2026, [2026]), ownedBy: "Team Two" }]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("On Team Two")).toBeInTheDocument());
  });

  it("states free agency in a real league", async () => {
    const bodies = new Map([[2026, bodyFor(2026, [2026])]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("Free agent in this league")).toBeInTheDocument());
  });

  it("says nothing about roster status in a mock/practice league — there is no real room to be a free agent in", async () => {
    const bodies = new Map([[2026, { ...bodyFor(2026, [2026]), isMockLeague: true }]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("2026 season")).toBeInTheDocument());
    expect(screen.queryByText("Free agent in this league")).not.toBeInTheDocument();
    expect(screen.queryByText(/^On /)).not.toBeInTheDocument();
  });
});

describe("PlayerPeekHost — the Outlook, grouped (2026-09-04 redesign)", () => {
  const REASONS: PlayerSeasonBody["reasons"] = [
    { code: "market_anchor", marketPoints: 200, delta: 14.2 },
    { code: "scarcity", positionRank: 4, replacementLevel: 140 },
    { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
    { code: "law", lawId: "rb_workload_cliff", effect: -0.9, magnitude: 320 },
    { code: "changed_team", from: "SF", to: "MIA" },
    { code: "availability", expectedGames: 14, floorGames: 10, ceilingGames: 17 },
    { code: "rookie", overallPick: null, landingMultiplier: 1 },
    { code: "new_play_caller", team: "MIA" },
  ];

  it("renders nothing when the board never ranked him", async () => {
    const bodies = new Map([[2026, bodyFor(2026, [2026])]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("2026 season")).toBeInTheDocument());
    expect(screen.queryByText("Outlook")).not.toBeInTheDocument();
  });

  it("opens with a verdict sentence, then caps at 5 groups behind a 'The full case (N)' expander", async () => {
    const user = userEvent.setup();
    const bodies = new Map([[2026, { ...bodyFor(2026, [2026]), reasons: REASONS }]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });

    await waitFor(() => expect(screen.getByText("Outlook")).toBeInTheDocument());
    expect(screen.getByText(/He is going later than he should/)).toBeInTheDocument();
    // 6 groups total (2 law groups + 4 fact groups: changed_team, availability, rookie,
    // new_play_caller — market_anchor/scarcity feed the verdict, never a peer chip) capped to 5,
    // the weakest (last-listed) fact group hidden behind the expander.
    expect(screen.getByText("The full case (6)")).toBeInTheDocument();
    expect(screen.queryByText(/New play caller/)).not.toBeInTheDocument();

    await user.click(screen.getByText("The full case (6)"));
    expect(screen.getByText(/New play caller/)).toBeInTheDocument();
    expect(screen.queryByText("The full case (6)")).not.toBeInTheDocument();
  });

  it("presses a law group open to show its own member laws as receipts", async () => {
    const user = userEvent.setup();
    const bodies = new Map([[2026, { ...bodyFor(2026, [2026]), reasons: REASONS }]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });

    await waitFor(() => expect(screen.getByText(/Age 29 season/)).toBeInTheDocument());
    // The receipt sentence is not visible until the group is pressed open.
    expect(screen.queryByText(/costs him 1\.8 pts a game/)).not.toBeInTheDocument();
    await user.click(screen.getByText(/Age 29 season/));
    expect(screen.getByText(/Age 29 season: costs him 1\.8 pts a game/)).toBeInTheDocument();
  });

  it("labels a single-law group plainly, with no 'together' prefix", async () => {
    const bodies = new Map([[2026, { ...bodyFor(2026, [2026]), reasons: REASONS }]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText(/Age 29 season/)).toBeInTheDocument());
    expect(screen.queryByText(/together/)).not.toBeInTheDocument();
  });

  it("fix round 1 (HIGH + MEDIUM 2): a tribal law and a discovered law over the SAME quantity merge into one group, labelled 'together' with the summed effect", async () => {
    const discoveredAgeLaw: Law = {
      id: "and:RB:threshold:RB:age:q70+threshold:RB:experienceYear:q70",
      position: "RB",
      claim: "Fixture claim.",
      measured: { effect: -0.7, ci: [-1, -0.4], sample: 80, seasons: "fixture" },
      trainEffect: -0.7,
      verdict: "confirmed",
      modelPath: null,
      hasFoldEvidence: true,
      origin: "discovered",
      primaryQuantityId: "age",
      primaryQuantityNoun: "age",
      primaryQuantityUnit: "two_decimal",
    };
    const mergedReasons: PlayerSeasonBody["reasons"] = [
      { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
      { code: "law", lawId: discoveredAgeLaw.id, effect: -0.7, magnitude: 29 },
    ];
    const bodies = new Map([[2026, { ...bodyFor(2026, [2026]), reasons: mergedReasons, laws: [discoveredAgeLaw] }]]);
    mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText(/together -2\.5 pts, Age 29 season · 2 laws/)).toBeInTheDocument());
    // Only ONE group rendered for the quantity — the stammer this fix closes.
    expect(screen.queryByText(/^-2\.5 pts, Age 29 season$/)).not.toBeInTheDocument();
  });
});

/**
 * THE PEEK BECOMES THE DOSSIER (Task 5) — once `body.dossier` is real, the mock's own module
 * order composes: `CallCard` full width, then the two-column grid (`RangeRail`/`RoleModule`,
 * `ReadCard`/`BooksModule`, `SeasonStrip`/`StoryModule`+news), then `WhyGroups` capped at 5,
 * printing no verdict of its own (`CallCard` already stated it). `body.dossier` absent — `null`
 * OR `undefined` alike — falls back to the pre-dossier composition every test above this block
 * already pins byte-for-byte (`SourceStrip`, `Outlook` with its verdict, the season chart, news
 * below the fold).
 */
describe("PlayerPeekHost — the dossier composition (Task 5)", () => {
  const DOSSIER_REASONS: PlayerSeasonBody["reasons"] = [
    { code: "market_anchor", marketPoints: 200, delta: 14.2 },
    { code: "scarcity", positionRank: 4, replacementLevel: 140 },
  ];

  const DOSSIER: PlayerDossierFacts = {
    market: { adp: 24.3, positionAdp: "RB3", boardRank: 9, positionRank: 4, replacementLevel: 140, playersLeftInTier: null, dropToNextTier: null, marketAnchorPoints: 200, marketAnchorDelta: 14.2 },
    projection: {
      projectedPoints: 214.2, floorPoints: 150, medianPoints: 210, ceilingPoints: 280, typicalLow: 190, typicalHigh: 230,
      perGamePoints: 15, perGamePositionRank: { value: 15, positionRank: 8, qualifierCount: 32 },
    },
    availability: { expectedGames: 15.4, floorGames: 10, ceilingGames: 17 },
    usage: {
      season: 2025, snapShare: 0.62, snapShareRank: { value: 0.62, positionRank: 4, qualifierCount: 32, namedNeighbor: null },
      targetShare: null, targetShareRank: null, redZoneShare: null, redZoneShareRank: null,
    },
    trend: null,
    books: { propsLines: [{ market: "player_rush_yds", medianLine: 70.5 }], teamVegasWinTotal: 9.5 },
    lastSeasonStory: {
      season: 2025, pointsRank: { value: 260, positionRank: 4, qualifierCount: 32, namedNeighbor: null }, pointsPerGame: 18.1, gamesPlayed: 15,
      bestWeek: { week: 12, points: 34.6 }, weeksAboveMedian: 9, touchesRank: null,
      receivingYardsRank: { value: 410, positionRank: 12, qualifierCount: 45, namedNeighbor: null },
    },
    injury: { state: "unknown" },
    newsCount: 1,
    basis: { scoringLabel: "PPR" },
    byeWeek: 8,
  };

  function dossierBody(overrides: Partial<PlayerSeasonBody> = {}): PlayerSeasonBody {
    return {
      ...bodyFor(2026, [2026]),
      reasons: DOSSIER_REASONS,
      dossier: DOSSIER,
      capsule: { bodyCompact: "The compact read.", bodyFull: "The full read.", source: "llm", narrative: null },
      injuryDesignation: "Q",
      news: [{ title: "Rashad Long: full practice", link: "https://example.com/1" }],
      ...overrides,
    };
  }

  it("composes the call card, the two-column grid modules, and the why slot, in the mock's own order", async () => {
    // `season: 2025` — matching `DOSSIER.lastSeasonStory.season` (fix round 1, CRITICAL 2: a
    // mismatched pair renders the honest fallback instead of `SeasonStrip`; see the dedicated
    // regression test below for that case). This test's own purpose is proving every module is
    // present, `SeasonStrip` included, so it needs the season on screen to actually match.
    const bodies = new Map([[2026, dossierBody({ season: 2025 })]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByLabelText("The call")).toBeInTheDocument());

    const sheet = screen.getByRole("dialog");
    // Every named module is present at all (a missing one would make the order check vacuous).
    expect(screen.getByLabelText("The call")).toBeInTheDocument();
    expect(screen.getByLabelText("Season range")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toBeInTheDocument();
    expect(screen.getByLabelText("The read")).toBeInTheDocument();
    expect(screen.getByLabelText("The books")).toBeInTheDocument();
    expect(screen.getByLabelText("2025 season")).toBeInTheDocument();
    // No Story card: the fixture carries a designation but no season-ending story and no news,
    // and the header already wears the pill (founder, 2026-09-07).
    expect(screen.queryByLabelText("Story")).toBeNull();
    expect(screen.getByText("Why")).toBeInTheDocument();

    // DOM order IS the mobile stacking order (no media query runs in jsdom): the call, then the
    // grid's six cells in the mock's own row order, then the why slot.
    const labelled = Array.from(sheet.querySelectorAll("[aria-label]")).map((el) => el.getAttribute("aria-label"));
    const positions = ["The call", "Season range", "Role", "The read", "The books", "2025 season"].map((label) => labelled.indexOf(label));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("fix round 1, CRITICAL 2: shows the honest season fallback, never a mismatched SeasonStrip, when the story's own season differs from the one on screen", async () => {
    // The default `dossierBody()`'s own `season` is 2026 (the current season, already played);
    // `DOSSIER.lastSeasonStory.season` is always 2025 (last season) — the realistic default
    // mismatch this fix closes.
    const bodies = new Map([[2026, dossierBody()]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByLabelText("The call")).toBeInTheDocument());

    expect(screen.queryByLabelText("2025 season")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Rashad Long, points by week")).toBeInTheDocument();
  });

  it("prints the verdict exactly once, from the call card, never doubled by WhyGroups", async () => {
    const bodies = new Map([[2026, dossierBody()]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByLabelText("The call")).toBeInTheDocument());

    // A single match — `getByText` throws on more than one, which is the whole point of this
    // assertion: it fails loudly if the Outlook ever prints this sentence a second time.
    expect(screen.getByText(/He is going later than he should/)).toBeInTheDocument();
    expect(screen.getByLabelText("The call").textContent).toContain("He is going later than he should");
  });

  it("still shows the grouped evidence and the capped expander in the why slot, minus the capsule prose it used to carry", async () => {
    const bodies = new Map([[2026, dossierBody()]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("Why")).toBeInTheDocument());
    // No fired law/fact reasons beyond market_anchor/scarcity (both feed the verdict, never a
    // peer group), so there is nothing left to cap — the presence of the section header, with no
    // group rows, is the honest shape here.
    expect(screen.queryByText(/The full case/)).not.toBeInTheDocument();
  });

  it("states a real law group as a sentence in WhyGroups, capped at 5 with an expander for the rest", async () => {
    const richReasons: PlayerSeasonBody["reasons"] = [
      ...DOSSIER_REASONS,
      { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
      { code: "law", lawId: "rb_workload_cliff", effect: -0.9, magnitude: 320 },
      { code: "changed_team", from: "SF", to: "MIA" },
      { code: "availability", expectedGames: 14, floorGames: 10, ceilingGames: 17 },
      { code: "rookie", overallPick: null, landingMultiplier: 1 },
      { code: "new_play_caller", team: "MIA" },
    ];
    const bodies = new Map([[2026, dossierBody({ reasons: richReasons })]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("Age 29 season.")).toBeInTheDocument());
    expect(screen.getByText("Costs him 1.8 points a game.")).toBeInTheDocument();
    // 6 groups total, capped to 5 in the peek — the same cap Outlook used before this task.
    expect(screen.getByText("The full case (6)")).toBeInTheDocument();
  });

  /** THE BYE IS A CHIP BESIDE THE POSITION NOW (Sideline research round), and who has him is his
   *  own line with a face on it, so the two facts are no longer joined into one sentence. Both are
   *  still in the header, which is what this test has always been about. */
  it("carries the bye week and the roster fact in the header", async () => {
    const bodies = new Map([[2026, dossierBody()]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("Bye 8")).toBeInTheDocument());
    expect(screen.getByText("Free agent in this league")).toBeInTheDocument();
  });

  it("wears the designation once, in the header, and draws no story card just to repeat it", async () => {
    const bodies = new Map([[2026, dossierBody({ injuryDesignation: "Q" })]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("Q")).toBeInTheDocument());
    // A card whose whole content was the word "Questionable" said nothing the header had not
    // (founder, 2026-09-07); the story cell exists only for a season-ending story or news.
    expect(screen.queryByLabelText("Story")).toBeNull();
    expect(screen.queryByText("Questionable")).toBeNull();
  });

  it("relocates the news list beside the story module rather than duplicating it below the fold", async () => {
    const bodies = new Map([[2026, dossierBody()]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("News")).toBeInTheDocument());
    expect(screen.getAllByText("Rashad Long: full practice")).toHaveLength(1);
  });

  it("review fix: keeps Books paired in its own row's grid, and the season strip full width, when the capsule is absent", async () => {
    // The capsule sweep has not reached most players yet (Task 4's own note) — this is the
    // COMMON state, not an edge case, and it must never cascade the later rows out of their pairs.
    // `season: 2025` matches `DOSSIER.lastSeasonStory.season` so `SeasonStrip` itself renders
    // (fix round 1, CRITICAL 2) — this test's own subject is the grid pairing, not the strip.
    const bodies = new Map([[2026, dossierBody({ capsule: null, season: 2025 })]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByLabelText("The books")).toBeInTheDocument());

    // No "The read" card at all — never a placeholder standing in for the missing capsule.
    expect(screen.queryByLabelText("The read")).not.toBeInTheDocument();

    // Books sits alone in ITS OWN row's grid (never shifted into the season/story row below it)
    // and spans both columns rather than leaving the right column visibly empty.
    const booksRow = screen.getByLabelText("The books").closest(".grid")!;
    expect(booksRow.children).toHaveLength(1);
    expect((booksRow.children[0] as HTMLElement).className).toContain("lg:col-span-2");

    // The season strip spans its whole row on its own: a finished season is eighteen columns and
    // never shares the row (founder, 2026-09-07). With no news there is no cell beneath it.
    const seasonRow = screen.getByLabelText("2025 season").closest(".grid")!;
    // Never side by side: whatever sits in this row (the strip, then the news cell when there is
    // news) spans the whole row.
    expect(seasonRow.children.length).toBeGreaterThanOrEqual(1);
    for (const child of Array.from(seasonRow.children)) expect((child as HTMLElement).className).toContain("lg:col-span-2");
    expect(screen.queryByLabelText("Story")).toBeNull();
  });

  it("falls back to today's layout — source strip, Outlook with its own verdict, no dossier modules — when the dossier is null", async () => {
    const bodies = new Map([[2026, { ...bodyFor(2026, [2026]), reasons: DOSSIER_REASONS, dossier: null }]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("Outlook")).toBeInTheDocument());

    expect(screen.getByText(/He is going later than he should/)).toBeInTheDocument();
    expect(screen.queryByLabelText("The call")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Season range")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
  });

  it("falls back to today's layout when the dossier field is simply absent (a fixture predating this task)", async () => {
    const legacyBody = bodyFor(2026, [2026]);
    const bodies = new Map([[2026, legacyBody]]);
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByText("2026 season")).toBeInTheDocument());
    expect(screen.queryByLabelText("The call")).not.toBeInTheDocument();
  });

  it("follows the copy rules in every string this task added — no em-dash, no semicolon", async () => {
    const bodies = new Map([[2026, dossierBody()]]);
    const { container } = render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2026)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });
    await waitFor(() => expect(screen.getByLabelText("The call")).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/;/);
  });
});

/**
 * THE KICKER PEEK (founder, 2026-09-06: "none of the kicker stats are showing and same for
 * defense"). The board ranks neither position, so a kicker's peek has always taken the fallback
 * composition, which was a source strip of dashes over an empty chart. It now draws the season the
 * archive holds, names its basis, and carries a role module built from his actual kicks.
 */
describe("PlayerPeekHost, a kicker", () => {
  const KICKER_BODY: PlayerSeasonBody = {
    ...bodyFor(2025, [2025]),
    player: { id: "k1", name: "A Kicker", position: "K", nflTeam: "BAL", headshotUrl: null, adp: 140.2 },
    log: [],
    totals: null,
    weeks: [
      { week: 1, points: 11, percentile: null },
      { week: 2, points: null, percentile: null },
      { week: 3, points: 8, percentile: null },
    ],
    pointsPerGame: 9.5,
    pointsPerGamePercentile: null,
    kdefSeason: {
      playerId: "k1",
      position: "K",
      season: 2025,
      weeks: [],
      points: 148.5,
      games: 16,
      pointsPerGame: 9.3,
      weeksMissingPointsAllowed: 0,
      facts: {
        kind: "K",
        fieldGoalsMade: 24,
        fieldGoalsAttempted: 28,
        extraPointsMade: 38,
        extraPointsAttempted: 40,
        distanceBands: [
          { label: "0 to 39", made: 12, attempted: 12 },
          { label: "40 to 49", made: 7, attempted: 9 },
          { label: "50 or more", made: 5, attempted: 7 },
        ],
        longestMadeBand: "50 or more",
      },
    },
  };

  async function openKicker() {
    const bodies = new Map([[2025, KICKER_BODY]]);
    const rendered = render(
      <LeagueRoomDepsProvider deps={fixtureDeps(bodies, 2025)}>
        <PlayerPeekHost />
      </LeagueRoomDepsProvider>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "k1", name: "A Kicker" });
    await waitFor(() => expect(screen.getByText("2025 season")).toBeInTheDocument());
    return rendered;
  }

  it("draws his points by week and names the basis under the chart", async () => {
    await openKicker();
    expect(screen.getByRole("group", { name: "A Kicker, points by week" })).toBeInTheDocument();
    expect(screen.getByTestId("season-basis").textContent).toContain("A record of games that were played, not a forecast.");
  });

  it("carries his kicking numbers instead of three offensive share bars", async () => {
    const { container } = await openKicker();
    const role = screen.getByRole("region", { name: "Role" });
    expect(role.textContent).toContain("24 of 28 · 86%");
    expect(role.textContent).toContain("40 to 49 yards");
    expect(container.querySelector("[data-role-share]")).toBeNull();
  });

  it("follows the copy rules on the kicker surface too", async () => {
    const { container } = await openKicker();
    expect(container.textContent).not.toMatch(/[—;]/);
  });
});

/**
 * THE LOADING STATE (founder, 2026-09-07, on a screenshot of the sheet mid-load) — the header
 * renders from the row that was pressed and the body used to be empty dark for five to fifteen
 * seconds on a cold start or an off-board player.
 */
describe("PlayerPeekHost — while the wire is still out", () => {
  /** A `fetchJson` that never resolves, which is exactly the state under test. */
  function pendingDeps(): LeagueRoomDeps {
    return {
      fetchJson: () => new Promise<Response>(() => {}),
      openEventSource: () => ({ addEventListener: () => undefined, close: () => undefined }),
    };
  }

  it("renders the module frame and one line of copy, and no composition at all", async () => {
    const { container } = mount(pendingDeps());
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });

    await waitFor(() => expect(screen.getByText("Pulling his numbers.")).toBeInTheDocument());
    expect(container.querySelector('[data-peek="pending"]')).not.toBeNull();
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
    // The name the manager pressed is already on screen; nothing else claims to be. It appears
    // twice on purpose now that the peek rides `Modal`: once as the dialog's own accessible name
    // (`sr-only`) and once as the visible line, which is what the reader sees while the wire is out.
    expect(screen.getByRole("dialog", { name: "Rashad Long" })).toBeInTheDocument();
    expect(screen.getAllByText("Rashad Long").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("The call")).not.toBeInTheDocument();
    // The old bare "Loading…" line is gone from the copy. The `Skeleton` primitive keeps its own
    // screen-reader-only "Loading…", which is its accessible label rather than visible chatter.
    const visible = [...container.querySelectorAll("p")].map((node) => node.textContent);
    expect(visible).toContain("Pulling his numbers.");
    expect(visible).not.toContain("Loading…");
  });

  it("follows the copy rules: no em-dash, no semicolon, no spinner chatter", async () => {
    const { container } = mount(pendingDeps());
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });

    await waitFor(() => expect(screen.getByText("Pulling his numbers.")).toBeInTheDocument());
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/—/);
    expect(text).not.toMatch(/;/);
    expect(text).not.toMatch(/please wait/i);
  });

  it("drops the frame the moment the body lands, and renders the composition", async () => {
    const bodies = new Map([[2026, bodyFor(2026, [2026])]]);
    const { container } = mount(fixtureDeps(bodies, 2026));
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });

    await waitFor(() => expect(screen.getByText("2026 season")).toBeInTheDocument());
    expect(container.querySelector('[data-peek="pending"]')).toBeNull();
    expect(screen.queryByText("Pulling his numbers.")).not.toBeInTheDocument();
  });

  it("says the honest failure instead of the frame when the load fails", async () => {
    const failing: LeagueRoomDeps = {
      fetchJson: () => Promise.resolve(new Response(JSON.stringify({ ok: false, error: "nope" }))),
      openEventSource: () => ({ addEventListener: () => undefined, close: () => undefined }),
    };
    const { container } = mount(failing);
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });

    await waitFor(() => expect(screen.getByText("We could not load him. Close this and try again.")).toBeInTheDocument());
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
  });
});

describe("PlayerPeekHost — one host for the whole app, and the innermost takes the press", () => {
  /** One season's body per host, so a test can tell WHICH host answered by whose wire was used. */
  function hostDeps(): { readonly deps: LeagueRoomDeps; readonly calls: string[] } {
    const calls: string[] = [];
    return { deps: fixtureDeps(new Map([[2026, bodyFor(2026, [2026])]]), 2026, calls), calls };
  }

  beforeEach(() => {
    resetPlayerPeekHostsForTests();
  });

  it("takes the press from the shell's own host, with no page-level host mounted anywhere", async () => {
    const shell = hostDeps();
    render(
      <LeagueRoomDepsProvider deps={shell.deps}>
        <PlayerPeekHost scope="shell" />
      </LeagueRoomDepsProvider>,
    );
    expect(openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" })).toBe(true);
    await waitFor(() => expect(screen.getByText("2026 season")).toBeInTheDocument());
    expect(shell.calls).toHaveLength(1);
  });

  it("hands the press to a surface's own host when both are mounted, whatever order they mounted in", async () => {
    const shell = hostDeps();
    const surface = hostDeps();
    render(
      <>
        <LeagueRoomDepsProvider deps={shell.deps}>
          <PlayerPeekHost scope="shell" />
        </LeagueRoomDepsProvider>
        <LeagueRoomDepsProvider deps={surface.deps}>
          <PlayerPeekHost />
        </LeagueRoomDepsProvider>
      </>,
    );
    openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" });

    await waitFor(() => expect(surface.calls).toHaveLength(1));
    // One sheet, and it belongs to the surface: the shell's own wire was never asked.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(shell.calls).toHaveLength(0);
  });

  it("falls back to the shell once the surface host leaves", async () => {
    const shell = hostDeps();
    const surface = hostDeps();
    const view = render(
      <>
        <LeagueRoomDepsProvider deps={shell.deps}>
          <PlayerPeekHost scope="shell" />
        </LeagueRoomDepsProvider>
        <LeagueRoomDepsProvider deps={surface.deps}>
          <PlayerPeekHost />
        </LeagueRoomDepsProvider>
      </>,
    );
    view.rerender(
      <LeagueRoomDepsProvider deps={shell.deps}>
        <PlayerPeekHost scope="shell" />
      </LeagueRoomDepsProvider>,
    );
    expect(openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" })).toBe(true);
    await waitFor(() => expect(shell.calls).toHaveLength(1));
    expect(surface.calls).toHaveLength(0);
  });

  it("says it could not take the press when nothing is mounted at all", () => {
    expect(openPlayerPeek({ leagueId: "lg1", playerId: "rb1", name: "Rashad Long" })).toBe(false);
  });
});
