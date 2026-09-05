import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { renderSurface } from "@/components/ui/test-utils";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import type { MockResultsInfo } from "../contract";
import { DraftRoomDepsProvider, type DraftRoomDeps } from "../hooks/deps";
import { SHEET_SEED_STORAGE_KEY } from "../quilt/state/sheet-seed";
import { MOCK_RESULTS_COPY, MOCK_RESULTS_INFO, PLAYERS, SNAKE_VIEW, TEAMS } from "../test-fixtures";
import { MockResults, spokenRounds } from "./mock-results";

const pushed: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));

const COPY = MOCK_RESULTS_COPY;

// PLAYERS (test-fixtures) is [qb1, rb1, rb2, wr1] — pool rank order 1..4, no tight end.
const COMPLETE_VIEW: DraftStateView = {
  ...SNAKE_VIEW,
  phase: "complete",
  onClockTeamId: null,
  picks: [
    { pickNumber: 1, round: 1, teamId: "t1", playerId: "rb1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
    { pickNumber: 2, round: 1, teamId: "t2", playerId: "wr1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:01:00.000Z", auto: false },
    { pickNumber: 3, round: 2, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:02:00.000Z", auto: false },
  ],
  rosters: {
    t1: [
      { slot: "QB", slotIndex: 0, playerId: "qb1" },
      { slot: "RB", slotIndex: 0, playerId: "rb1" },
      { slot: "RB", slotIndex: 1, playerId: null },
    ],
    t2: [
      { slot: "QB", slotIndex: 0, playerId: null },
      { slot: "RB", slotIndex: 0, playerId: "wr1" },
      { slot: "RB", slotIndex: 1, playerId: null },
    ],
  },
};

const BYES = new Map<string, number>();

interface Mounted {
  readonly requests: { url: string; body: unknown }[];
}

function mount(
  overrides: {
    view?: DraftStateView;
    players?: readonly Player[];
    myTeamId?: string | null;
    results?: MockResultsInfo;
    byeWeeks?: ReadonlyMap<string, number>;
    board?: React.ReactNode;
  } = {},
): Mounted {
  const requests: { url: string; body: unknown }[] = [];
  const deps: DraftRoomDeps = {
    fetchJson: (url, init) => {
      requests.push({ url, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
      return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { draftId: "d9" } })));
    },
    openEventSource: () => ({ addEventListener: () => {}, close: () => {} }),
  };
  render(
    <DraftRoomDepsProvider deps={deps}>
      <MockResults
        view={overrides.view ?? COMPLETE_VIEW}
        teams={TEAMS}
        board={overrides.board ?? null}
        players={overrides.players ?? PLAYERS}
        byeWeeks={overrides.byeWeeks ?? BYES}
        myTeamId={overrides.myTeamId === undefined ? "t1" : overrides.myTeamId}
        results={overrides.results ?? MOCK_RESULTS_INFO}
      />
    </DraftRoomDepsProvider>,
  );
  return { requests };
}

beforeEach(() => {
  pushed.length = 0;
  window.localStorage.clear();
});

describe("MockResults — the debrief", () => {
  it("states the heading, the meta line, and the summary counts, axe-clean in both themes", async () => {
    await renderSurface(
      <DraftRoomDepsProvider deps={{ fetchJson: () => Promise.reject(new Error("no")), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
        <MockResults view={COMPLETE_VIEW} teams={TEAMS} board={null} players={PLAYERS} byeWeeks={BYES} myTeamId="t1" results={MOCK_RESULTS_INFO} />
      </DraftRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByRole("heading", { name: COPY.heading, level: 1 })).toBeInTheDocument();
        expect(screen.getByText(/seat \d+ of \d+/)).toBeInTheDocument();
        // Pick 1.01 (rb1) left qb1 on the board — one ranked higher, so only pick 2.01 (qb1,
        // the board's own top player) counts best available: 1 of 2, stated exactly.
        expect(screen.getByText("1 of 2")).toBeInTheDocument();
        expect(screen.getByText(COPY.statBestAvailableCaption)).toBeInTheDocument();
        // The reach caption states its threshold — the number never judges silently.
        expect(screen.getByText(/reaches, 5 or more ranked higher/)).toBeInTheDocument();
        // No tight end all draft: the honest zero, never an invented round.
        expect(screen.getByText(COPY.statNoTeCaption)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("renders the verdict lane: board slot, sticker rank, the honest fact clause — never a letter grade", () => {
    mount();
    const picks = screen.getByRole("list", { name: COPY.picksHeading });
    // Two-team room: pick 1 is 1.01, pick 3 is 2.01.
    expect(within(picks).getByText("1.01")).toBeInTheDocument();
    expect(within(picks).getByText("2.01")).toBeInTheDocument();
    expect(within(picks).getByText("Marcus Reed")).toBeInTheDocument();
    expect(within(picks).getByText("RB1")).toBeInTheDocument();
    expect(within(picks).getByText("Best RB available")).toBeInTheDocument();
    expect(within(picks).getByText("Best available")).toBeInTheDocument();
    expect(screen.queryByText(/grade/i)).not.toBeInTheDocument();
  });

  // Task 2 (player-name adoption sweep): "Your picks" rows go through `PlayerName` — a real
  // button with the player's own name as its accessible name, wired to the product's one
  // pressable-name primitive (never a second local peek).
  it("makes every pick-log name a pressable button that opens the season peek", async () => {
    const deps: DraftRoomDeps = { fetchJson: () => Promise.reject(new Error("no")), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) };
    render(
      <DraftRoomDepsProvider deps={deps}>
        <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
          <PlayerPeekHost />
          <MockResults view={COMPLETE_VIEW} teams={TEAMS} board={null} players={PLAYERS} byeWeeks={BYES} myTeamId="t1" results={MOCK_RESULTS_INFO} />
        </LeagueRoomDepsProvider>
      </DraftRoomDepsProvider>,
    );
    const name = screen.getByRole("button", { name: "Marcus Reed" });
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Marcus Reed" })).toBeInTheDocument();
  });

  it("runs it back at the SAME table — this room's own re-derived settings and the seat just played", async () => {
    const { requests } = mount();
    fireEvent.click(screen.getByRole("button", { name: COPY.runBackVerb }));
    await waitFor(() => expect(pushed).toEqual(["/app/drafts/d9"]));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("/api/mock-drafts");
    expect(requests[0]!.body).toEqual({
      mode: "solo",
      teamCount: 2,
      pickSeconds: 60,
      scoringPreset: "half_ppr",
      rosterShape: "standard",
      draftSlot: 1,
    });
  });

  it("offers another seat — the same table, a different chair", async () => {
    const { requests } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Try seat 2 instead" }));
    await waitFor(() => expect(pushed).toEqual(["/app/drafts/d9"]));
    expect(requests[0]!.body).toMatchObject({ mode: "solo", draftSlot: 2 });
  });

  it("self-omits both rematch buttons when the room's table could not be re-derived, rather than posting a guess", () => {
    mount({ results: { ...MOCK_RESULTS_INFO, table: null } });
    expect(screen.queryByRole("button", { name: COPY.runBackVerb })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try seat/ })).not.toBeInTheDocument();
    // Still never a dead end: the quiet way out remains.
    expect(screen.getByRole("link", { name: COPY.openLobbyLabel })).toBeInTheDocument();
  });

  it("seeds the sheet: the mock picks in pick order, then the rest of the board — and says so once", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: COPY.seedVerb }));
    expect(screen.getByText(COPY.seededConfirmation)).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(SHEET_SEED_STORAGE_KEY)!) as { order: string[] };
    // t1's picks (rb1 then qb1) lead; the rest of the snapshot follows in board order.
    expect(stored.order).toEqual(["rb1", "qb1", "rb2", "wr1"]);
    expect(screen.getByRole("button", { name: COPY.seedVerb })).toBeDisabled();
  });

  it("keeps the amber budget: RUN IT BACK is the page's only solid verb", () => {
    mount();
    const solids = screen.getAllByRole("button").filter((button) => button.className.includes("bg-accent"));
    expect(solids).toHaveLength(1);
    expect(solids[0]).toHaveTextContent(COPY.runBackVerb);
  });

  describe("the team you built", () => {
    it("names the bye stack only from the real schedule read, and only past the threshold", () => {
      // All three rostered players' NFL teams share week 8 — KC (qb1), SF (rb1) plus a third
      // teammate would be needed; t1 rosters qb1 (KC) and rb1 (SF) only, so even a shared week
      // stays under the threshold and the clause drops.
      mount({ byeWeeks: new Map([["KC", 8], ["SF", 8]]) });
      expect(screen.queryByText(/Byes stack/)).not.toBeInTheDocument();
    });

    it("states the stack when three rostered players sit out the same week", () => {
      const view: DraftStateView = {
        ...COMPLETE_VIEW,
        rosters: {
          ...COMPLETE_VIEW.rosters,
          t1: [
            { slot: "QB", slotIndex: 0, playerId: "qb1" },
            { slot: "RB", slotIndex: 0, playerId: "rb1" },
            { slot: "RB", slotIndex: 1, playerId: "rb2" },
          ],
        },
      };
      mount({ view, byeWeeks: new Map([["KC", 8], ["SF", 8], ["NYJ", 8]]) });
      // The clause rides the team card's observation sentence (joined with the shape clause).
      expect(screen.getByText(/Byes stack in week 8: 3 of your players sit out together\./)).toBeInTheDocument();
    });
  });

  describe("your grade (Task 11, plan ruling R-2)", () => {
    it("renders nothing when the debrief carries no grade to show", () => {
      mount();
      expect(screen.queryByRole("region", { name: "Your grade" })).not.toBeInTheDocument();
    });

    it("cites the letter, the components, and the basis line", () => {
      mount({
        results: {
          ...MOCK_RESULTS_INFO,
          yourGrade: {
            grade: {
              teamId: "t1",
              letter: "B",
              components: { valueCaptured: -3.2, startingSlotsFilled: 4, startingSlotsTotal: 5, byeCollisions: 2, projectedPoints: 142.7 },
              projectedRank: 2,
            },
            boardGeneration: "2026-08-18T00:00:00.000Z",
          },
        },
      });
      const card = screen.getByRole("region", { name: "Your grade" });
      expect(within(card).getByText("B")).toBeInTheDocument();
      expect(within(card).getByText(/-3\.2/)).toBeInTheDocument();
      expect(within(card).getByText(/4 of 5/)).toBeInTheDocument();
      expect(within(card).getByText("2")).toBeInTheDocument();
      expect(within(card).getByText(/142\.7/)).toBeInTheDocument();
      expect(within(card).getByText(/Graded against our board of August 18/)).toBeInTheDocument();
    });

    it("is axe-clean with the card present", async () => {
      await renderSurface(
        <DraftRoomDepsProvider deps={{ fetchJson: () => Promise.reject(new Error("no")), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
          <MockResults
            view={COMPLETE_VIEW}
            teams={TEAMS}
            board={null}
            players={PLAYERS}
            byeWeeks={BYES}
            myTeamId="t1"
            results={{
              ...MOCK_RESULTS_INFO,
              yourGrade: {
                grade: {
                  teamId: "t1",
                  letter: "B",
                  components: { valueCaptured: -3.2, startingSlotsFilled: 4, startingSlotsTotal: 5, byeCollisions: 2, projectedPoints: 142.7 },
                  projectedRank: 2,
                },
                boardGeneration: "2026-08-18T00:00:00.000Z",
              },
            }}
          />
        </DraftRoomDepsProvider>,
        async ({ container }) => {
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });
  });

  describe("across your last mocks", () => {
    it("renders nothing at all under two completed mocks", () => {
      mount();
      expect(screen.queryByText(/Across your last/)).not.toBeInTheDocument();
    });

    it("states only the stored patterns, dropping the TE clause when a mock never drafted one", () => {
      mount({
        results: {
          ...MOCK_RESULTS_INFO,
          habits: { mockCount: 3, firstTeRounds: null, earlyBestAvailableCount: 2 },
        },
      });
      expect(screen.getByText("Across your last 3 mocks")).toBeInTheDocument();
      expect(screen.queryByText(/first tight end went/)).not.toBeInTheDocument();
      expect(screen.getByText("Your first two rounds were all best available in 2 of 3 mocks.")).toBeInTheDocument();
    });

    it("speaks the TE rounds as a list when every mock has one", () => {
      mount({
        results: {
          ...MOCK_RESULTS_INFO,
          habits: { mockCount: 3, firstTeRounds: [6, 7, 5], earlyBestAvailableCount: 3 },
        },
      });
      expect(screen.getByText("Your first tight end went in rounds 6, 7 and 5.")).toBeInTheDocument();
    });
  });

  it("gives a commissioner with no team the heading, the way out, and the finished board — no lane, no habits", () => {
    mount({ myTeamId: null, board: <p>the finished board</p> });
    expect(screen.queryByRole("list", { name: COPY.picksHeading })).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.takeItHeading)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: COPY.heading })).toBeInTheDocument();
    expect(screen.getByText("the finished board")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COPY.openLobbyLabel })).toBeInTheDocument();
  });
});

describe("spokenRounds", () => {
  it("joins rounds the way a sentence says them", () => {
    expect(spokenRounds([6])).toBe("6");
    expect(spokenRounds([6, 7])).toBe("6 and 7");
    expect(spokenRounds([6, 7, 5])).toBe("6, 7 and 5");
  });
});
