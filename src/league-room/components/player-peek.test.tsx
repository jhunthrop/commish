import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Player } from "@/domain/player";
import type { PlayerSeasonBody } from "@/league-service/player";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "../hooks/deps";
import { openPlayerPeek, PlayerPeekHost } from "./player-peek";

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
    expect(screen.getByText(/The market is underpricing him/)).toBeInTheDocument();
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
    expect(screen.queryByText(/measured -1\.8 pts per game/)).not.toBeInTheDocument();
    await user.click(screen.getByText(/Age 29 season/));
    expect(screen.getByText(/Age 29 season: measured -1\.8 pts per game/)).toBeInTheDocument();
  });
});
