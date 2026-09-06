import { describe, it, expect, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { firstRunPlan } from "@/identity";
import { PROFILE } from "@/account-room/test-fixtures";
import type { HomeBody } from "../contract";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import type { CreateSheetDefaults } from "./create-sheet";
import { CreateLeagueSheetHost } from "./create-league-sheet";
import { HomeBoard } from "./home-board";

// `FirstRunPanel` embeds `CreateLeaguePanel` and `JoinLeagueEntry`, both of which navigate via
// `next/navigation`'s `useRouter` — stubbed the same way `create-league-panel.test.tsx` does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const SHEET_DEFAULTS: CreateSheetDefaults = { teamCount: 12, scoringPreset: "half_ppr", draftDaysFromCreation: 7 };

const SCHEDULED_CARD: HomeBody["leagues"][number] = {
  id: "l1",
  name: "Sunday Money",
  format: "snake",
  teamCount: 10,
  filledTeams: 10,
  isCommissioner: false,
  myTeamId: "t1",
  draftId: "d1",
  draftStatus: "complete",
  record: { wins: 5, losses: 2, ties: 0 },
  weekNumber: 4,
  weekStatus: "scheduled",
  matchup: null,
  nextAction: { kind: "set-lineup", label: "Set your lineup" },
  lineupSet: true,
  medianGame: false,
  medianScore: null,
  kickoffAt: null,
  startTrigger: null,
  kickoffRolls: 0,
  myTeamName: "Sunday Money Team",
  myRank: null,
};

const LIVE_CARD: HomeBody["leagues"][number] = {
  ...SCHEDULED_CARD,
  id: "l2",
  name: "Auction Night",
  weekStatus: "in_progress",
  nextAction: { kind: "watch-scores", label: "Watch the scores" },
};

const FIRST_RUN = firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!;

const EMPTY: HomeBody = { leagues: [], firstRun: FIRST_RUN, liveState: null };
const EMPTY_NO_FIRST_RUN: HomeBody = { leagues: [], firstRun: null, liveState: null };
const ONE_SCHEDULED: HomeBody = { leagues: [SCHEDULED_CARD], firstRun: null, liveState: null };
const ONE_LIVE: HomeBody = { leagues: [LIVE_CARD], firstRun: null, liveState: null };

const BAY_BANDITS: HomeBody["leagues"][number] = { ...SCHEDULED_CARD, id: "l_bb", name: "Bay Bandits" };
const ONE_LEAGUE: HomeBody = { leagues: [BAY_BANDITS], firstRun: null, liveState: null };

const PRE_DRAFT_LEAGUE: HomeBody["leagues"][number] = {
  ...SCHEDULED_CARD,
  id: "l_predraft",
  name: "Rookie Room",
  draftId: "d_predraft",
  draftStatus: "scheduled",
  filledTeams: 10,
  teamCount: 12,
  weekNumber: 1,
  weekStatus: "scheduled",
  nextAction: null,
  startTrigger: "scheduled",
  kickoffAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  kickoffRolls: 0,
};
const ALL_PRE_DRAFT: HomeBody = { leagues: [PRE_DRAFT_LEAGUE], firstRun: null, liveState: null };

const PRE_DRAFT_LEAGUE_2: HomeBody["leagues"][number] = {
  ...PRE_DRAFT_LEAGUE,
  id: "l_predraft2",
  name: "Dynasty Draft",
  draftId: "d_predraft2",
  startTrigger: "when_full",
  kickoffAt: null,
};
const PRE_DRAFT_LEAGUE_3: HomeBody["leagues"][number] = {
  ...PRE_DRAFT_LEAGUE,
  id: "l_predraft3",
  name: "Best Ball Bash",
  draftId: "d_predraft3",
  kickoffAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(),
};
const ALL_PRE_DRAFT_MANY: HomeBody = {
  leagues: [PRE_DRAFT_LEAGUE, PRE_DRAFT_LEAGUE_2, PRE_DRAFT_LEAGUE_3],
  firstRun: null,
  liveState: null,
};

afterEach(() => {
  if (vi.isFakeTimers()) vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

describe("HomeBoard", () => {
  it("renders the server's payload immediately, in both themes", async () => {
    await renderSurface(<HomeBoard initial={ONE_SCHEDULED} />, async ({ container }) => {
      // The row's accessible name is the league plus its one state line (the rail's own rule).
      expect(screen.getByRole("link", { name: /Sunday Money\./ })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Founder ruling, 2026-09-05: "the same bottom sheet everywhere across the app when clicking
  // create league anywhere". `CreateLeagueCta`'s button reaches `CreateLeagueSheetHost`
  // (`./create-league-sheet.tsx`) — mounted here as a sibling the way `AppShell` mounts it for
  // real — through the module-scope trigger, never a link or a state of its own.
  it("opens the one create-league sheet from its own button, with a manager who already has leagues", () => {
    renderInLeague(
      <>
        <CreateLeagueSheetHost defaults={SHEET_DEFAULTS} />
        <HomeBoard initial={ONE_SCHEDULED} />
      </>,
      fixtureLeagueDeps({ ok: true, data: ONE_SCHEDULED }).deps,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create a league" }));
    expect(screen.getByRole("dialog", { name: "Start a league" })).toBeInTheDocument();
  });

  it("shows the first-run fork, not the plain empty state, when the caller has no leagues", async () => {
    await renderSurface(<HomeBoard initial={EMPTY} profile={PROFILE} />, async ({ container }) => {
      expect(screen.getByRole("heading", { name: FIRST_RUN.headline })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
      expect(screen.queryByText("No leagues yet")).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("falls back to the plain empty state on the defensive path, if a caller ever hands it zero leagues with no plan", () => {
    renderInLeague(<HomeBoard initial={EMPTY_NO_FIRST_RUN} />, fixtureLeagueDeps({ ok: true, data: EMPTY_NO_FIRST_RUN }).deps);
    expect(screen.getByText("No leagues yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a league" })).toBeInTheDocument();
  });

  // Task 17: `AppHome` only reads `profile` when `firstRun !== null`, so a `firstRun`-without-
  // `profile` combination should be equally unreachable in production — but nothing in either
  // prop's type ties them together, so this board still renders something real rather than
  // crashing a manager whose profile read somehow failed.
  it("falls back to the plain empty state on the defensive path, if a caller ever hands it a plan with no profile", () => {
    renderInLeague(<HomeBoard initial={EMPTY} />, fixtureLeagueDeps({ ok: true, data: EMPTY }).deps);
    expect(screen.getByText("No leagues yet")).toBeInTheDocument();
  });

  it("never polls when no league's week is in progress, even once visible and past the interval", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const fixture = fixtureLeagueDeps({ ok: true, data: ONE_SCHEDULED });
    renderInLeague(<HomeBoard initial={ONE_SCHEDULED} />, fixture.deps);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs * 3);
    });
    expect(fixture.calls).toEqual([]);
  });

  it("never polls while the document is hidden, even with a live week", async () => {
    vi.useFakeTimers();
    setVisibility("hidden");
    const fixture = fixtureLeagueDeps({ ok: true, data: ONE_LIVE });
    renderInLeague(<HomeBoard initial={ONE_LIVE} />, fixture.deps);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs * 3);
    });
    expect(fixture.calls).toEqual([]);
  });

  it("polls on the interval once visible and some week is in progress, and folds the response in", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const refreshed: HomeBody = { leagues: [{ ...LIVE_CARD, name: "Auction Night Refreshed" }], firstRun: null, liveState: null };
    const fixture = fixtureLeagueDeps({ ok: true, data: refreshed });
    renderInLeague(<HomeBoard initial={ONE_LIVE} />, fixture.deps);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs);
    });
    expect(fixture.calls).toEqual(["GET /api/home"]);
    expect(screen.getAllByRole("link", { name: /Auction Night Refreshed/ }).length).toBeGreaterThan(0);
  });

  it("stops polling on its own once a refreshed payload says every week is done", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const final: HomeBody = {
      leagues: [{ ...LIVE_CARD, weekStatus: "final", nextAction: { kind: "review-week", label: "See how the week went" } }],
      firstRun: null,
      liveState: null,
    };
    const fixture = fixtureLeagueDeps({ ok: true, data: final });
    renderInLeague(<HomeBoard initial={ONE_LIVE} />, fixture.deps);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs);
    });
    expect(fixture.calls).toEqual(["GET /api/home"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs * 3);
    });
    // No second call: the just-folded-in state has no in-progress week left.
    expect(fixture.calls).toEqual(["GET /api/home"]);
  });

  it("leaves the last-known board on screen when a background refresh fails", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const fixture = fixtureLeagueDeps({ ok: true, data: ONE_LIVE });
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => {
        throw new Error("offline");
      },
    };
    renderInLeague(<HomeBoard initial={ONE_LIVE} />, fixture.deps);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs);
    });
    expect(screen.getAllByRole("link", { name: /Auction Night/ }).length).toBeGreaterThan(0);
  });

  // The n=1 shape (the rail redesign): the board IS the rail's full-page row model at every
  // count — one league renders one row, no sort language, no table.
  it("degrades to one league without announcing a sort over a list of one", async () => {
    await renderSurface(<HomeBoard initial={ONE_LEAGUE} />, async ({ queryByText, queryByRole, getByRole }) => {
      expect(queryByText(/closest first/i)).toBeNull();
      expect(getByRole("link", { name: /Bay Bandits\./ })).toBeInTheDocument();
      expect(queryByRole("table")).toBeNull();
    });
  });

  // The amber budget, at n=1: a quiet league (set-lineup is not the needs-you set) gets the
  // plain Open affordance and NOTHING solid — the page's one solid amber verb exists only when
  // a league genuinely needs its manager.
  it("gives a quiet single league a plain Open affordance and spends no solid amber", () => {
    const { container } = render(<HomeBoard initial={ONE_LEAGUE} />);
    expect(screen.getByRole("link", { name: "Open Bay Bandits" })).toBeInTheDocument();
    expect(container.querySelector(".bg-accent")).toBeNull();
  });

  // Step 2b (F18c): a manager whose leagues have all not drafted yet has no games at all — the
  // gauntlet's "somebody else's dashboard" finding in its purest form, fixed by promoting the
  // nearest draft's own row to a hero rather than an empty board of games that do not exist.
  it("gives a manager with nothing but a future draft a screen about that draft", async () => {
    await renderSurface(<HomeBoard initial={ALL_PRE_DRAFT} />, async ({ getByTestId, getByText, queryByRole, container }) => {
      expect(getByTestId("pre-draft-hero")).toBeInTheDocument();
      expect(getByText("10 of 12 seated. 2 seats left.")).toBeInTheDocument();
      expect(queryByRole("table")).toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // The regression this round fixes: every league pre-draft used to promote the nearest one to
  // a hero and RETURN, hiding every sibling league from this page while the shell's rail (the
  // same `crossLeagueHome` read) kept showing all of them. The hero still leads; nothing this
  // manager is in disappears beneath it.
  it("leads with the nearest draft's hero but still lists every league when the manager has more than one", async () => {
    await renderSurface(<HomeBoard initial={ALL_PRE_DRAFT_MANY} />, async ({ getByTestId, getByRole, queryByRole, container }) => {
      expect(getByTestId("pre-draft-hero")).toBeInTheDocument();
      // The `when_full` league sorts nearest (`nearestPreDraft`'s own rule) and leads as the hero.
      expect(getByRole("heading", { name: "Dynasty Draft" })).toBeInTheDocument();
      // Every league the manager is in still renders as a row beneath the hero.
      expect(getByRole("link", { name: /Rookie Room\./ })).toBeInTheDocument();
      expect(getByRole("link", { name: /Dynasty Draft\./ })).toBeInTheDocument();
      expect(getByRole("link", { name: /Best Ball Bash\./ })).toBeInTheDocument();
      expect(queryByRole("table")).toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("keeps the single-league all-pre-draft screen hero-only, with nothing to repeat beneath it", () => {
    render(<HomeBoard initial={ALL_PRE_DRAFT} />);
    expect(screen.getByTestId("pre-draft-hero")).toBeInTheDocument();
    expect(screen.queryByTestId("league-rows-page")).not.toBeInTheDocument();
  });

  it("keeps the mixed-leagues page unchanged: no hero, the rows render as before", () => {
    const mixed: HomeBody = { leagues: [SCHEDULED_CARD, PRE_DRAFT_LEAGUE], firstRun: null, liveState: null };
    render(<HomeBoard initial={mixed} />);
    expect(screen.queryByTestId("pre-draft-hero")).not.toBeInTheDocument();
    expect(screen.getByTestId("league-rows-page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sunday Money\./ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Rookie Room\./ })).toBeInTheDocument();
  });

  // Wide-viewport overflow fix (2026-09-05): the hero card carries its own width cap so the
  // meter, countdown, and seat row all measure from the same center as the box grows toward a
  // 1440px+ column, instead of `Meter`'s own `max-w-xs` disagreeing with an uncapped card.
  it("caps the pre-draft hero card's width so the seat meter cannot drift from the league name at wide viewports", () => {
    const { getByTestId } = render(<HomeBoard initial={ALL_PRE_DRAFT} />);
    const card = getByTestId("pre-draft-hero").firstElementChild as HTMLElement;
    expect(card.className).toMatch(/\bmax-w-md\b/);
    expect(card.className).toMatch(/\bmx-auto\b/);
  });
});
