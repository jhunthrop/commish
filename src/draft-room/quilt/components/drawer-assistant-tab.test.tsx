import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import type { AdvisorView, NowCandidate, PlanTurn } from "@/draft-service/assistant/view";
import { SNAKE_VIEW } from "../../test-fixtures";
import { useAdvisor, type UseAdvisorResult } from "../../advisor/use-advisor";
import { DrawerAssistantTab } from "./drawer-assistant-tab";

vi.mock("../../advisor/use-advisor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../advisor/use-advisor")>()),
  useAdvisor: vi.fn(),
}));

const mockedUseAdvisor = vi.mocked(useAdvisor);

function advisorResult(over: Partial<UseAdvisorResult> = {}): UseAdvisorResult {
  return { view: null, previousPlan: null, prePickView: null, recomputing: false, error: null, ...over };
}

const PLAYERS: readonly Player[] = [
  { id: "rb1", name: "Marcus Reed", position: "RB", nflTeam: "KC", headshotUrl: null, adp: 2 },
  { id: "wr1", name: "Andre Salas", position: "WR", nflTeam: "DAL", headshotUrl: null, adp: 5 },
  { id: "te1", name: "Cole Whitmore", position: "TE", nflTeam: "SF", headshotUrl: null, adp: 30 },
  { id: "qb1", name: "Jalen Croft", position: "QB", nflTeam: "KC", headshotUrl: null, adp: 1 },
];
const NAMES = Object.fromEntries(PLAYERS.map((player) => [player.id, player.name]));
const TEAMS: readonly TeamCard[] = [
  { id: "t1", name: "Your Team", ownerName: "You", isMine: true } as unknown as TeamCard,
  { id: "t2", name: "The Rivals", ownerName: "Rival", isMine: false } as unknown as TeamCard,
];

function candidate(playerId: string, over: Partial<NowCandidate> = {}): NowCandidate {
  const player = PLAYERS.find((entry) => entry.id === playerId)!;
  return {
    playerId,
    position: player.position,
    valueOverReplacement: 41.2,
    positionRank: 3,
    makeItBack: { survival: 0.46, runs: 200 },
    fillsSlot: player.position,
    reasons: [],
    templateReason: `${player.name} fills your ${player.position} slot, 41.2 points over replacement.`,
    templateShape: `value:${PLAYERS.findIndex((entry) => entry.id === playerId)}`,
    ...over,
  };
}

function turn(over: Partial<PlanTurn> = {}): PlanTurn {
  return { turn: 1, pickNumber: 4, round: 2, position: "RB", targets: [{ playerId: "rb1", position: "RB", valueOverReplacement: 41.2, positionRank: 3, oddsByTurn: [{ survival: 0.46, runs: 200 }], reachFromTurn: null }], fallback: null, ...over };
}

function makeView(over: Partial<AdvisorView> = {}): AdvisorView {
  return {
    pickNumber: 1,
    onTheClock: true,
    picksUntilYourTurn: 0,
    teamCount: 2,
    stamp: { computedAtPick: 1, sequence: 1 },
    now: [candidate("rb1"), candidate("wr1", { templateReason: "Andre Salas is the receiver the board rates next." })],
    plan: { computedAtPick: 1, runs: 200, horizon: 3, reachFloor: 0.25, turns: [turn()] },
    signals: {
      run: { position: "RB", count: 3, window: 4 },
      collapses: [{ position: "WR", tierLabel: "A", playersLeftInTier: 1, dropToNextTier: 22.6 }],
      ahead: [{ teamId: "t2", seat: 2, pickNumber: 2, runs: 200, topPosition: { position: "RB", share: 0.54 }, topPlayer: { playerId: "rb1", share: 0.3 }, driver: { kind: "archetype", name: "best_available", basis: "prior", picksObserved: 1 } }],
    },
    yourBuild: [],
    winningBuilds: null,
    computedBasis: "gen1",
    names: NAMES,
    strategyTemplate: "Backs are going. Aim for a back at 2.01.",
    voice: { status: "absent", strategy: null, reasons: {} },
    ledger: { numbers: [], names: [] },
    ...over,
  };
}

function pick(over: Partial<CompletedPick>): CompletedPick {
  return { pickNumber: 1, round: 1, teamId: "t1", playerId: "rb1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false, ...over };
}

interface RenderOptions {
  readonly myTeamId?: string | null;
  readonly view?: DraftStateView;
  readonly canDraft?: boolean;
  readonly queue?: readonly string[];
  readonly onDraft?: (playerId: string) => void;
  readonly onQueueToggle?: (playerId: string) => void;
}

function renderTab(options: RenderOptions = {}) {
  return render(
    <DrawerAssistantTab
      draftId="d1"
      view={options.view ?? { ...SNAKE_VIEW, rosters: { t1: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }], t2: [] } }}
      myTeamId={options.myTeamId === undefined ? "t1" : options.myTeamId}
      teams={TEAMS}
      playersById={new Map(PLAYERS.map((player) => [player.id, player]))}
      queue={options.queue ?? []}
      byeWeeks={new Map([["KC", 10]])}
      laws={[]}
      canDraft={options.canDraft ?? true}
      submitting={false}
      queuedPlayerIds={new Set(options.queue ?? [])}
      onDraft={options.onDraft ?? (() => {})}
      onQueueToggle={options.onQueueToggle ?? (() => {})}
    />,
  );
}

describe("DrawerAssistantTab", () => {
  it("gives the commissioner the honest no-seat line", () => {
    mockedUseAdvisor.mockReturnValue(advisorResult());
    renderTab({ myTeamId: null });
    expect(screen.getByText("You have no seat in this draft. The advisor argues for a seat.")).toBeInTheDocument();
  });

  it("tells the empty state and the network failure apart", () => {
    mockedUseAdvisor.mockReturnValue(advisorResult());
    const { unmount } = renderTab();
    expect(screen.getByText("The advisor has nothing to say right now.")).toBeInTheDocument();
    unmount();
    mockedUseAdvisor.mockReturnValue(advisorResult({ error: "boom" }));
    renderTab();
    expect(screen.getByText("We could not reach the advisor. It tries again on the next pick.")).toBeInTheDocument();
  });

  it("renders the three bands from the view: signals with the seat's own name and basis, the plan with its stamp, the now card with slot, value and runs", async () => {
    mockedUseAdvisor.mockReturnValue(advisorResult({ view: makeView() }));
    const { container } = renderTab();
    expect(screen.getByTestId("advisor-strategy")).toHaveTextContent("Backs are going. Aim for a back at 2.01.");
    expect(screen.getByTestId("advisor-run")).toHaveTextContent("3 of the last 4 picks were RB.");
    expect(screen.getByTestId("advisor-collapse")).toHaveTextContent("One WR left in tier A, then a 22.6 point drop.");
    const seat = screen.getByTestId("advisor-seat-ahead");
    expect(seat).toHaveTextContent("The Rivals");
    expect(seat).toHaveTextContent("Took a RB in 108 of 200 runs, most often Marcus Reed.");
    expect(seat).toHaveTextContent("The neutral prior: only 1 pick so far.");
    expect(screen.getByTestId("advisor-stamp")).toHaveTextContent("As of 1.01 · 200 runs");
    expect(screen.getByTestId("advisor-plan-target")).toHaveTextContent("92 of 200");
    const rows = screen.getAllByTestId("advisor-now-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("RB")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("+41.2");
    expect(within(rows[0]!).getByTestId("advisor-odds-line")).toHaveTextContent("Still there at 2.02 in 92 of 200 runs.");
    expect(within(rows[0]!).getByTestId("advisor-reason")).toHaveAttribute("data-voice", "template");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("puts Draft on every row when you are on the clock and routes it through the room's own pick path", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    mockedUseAdvisor.mockReturnValue(advisorResult({ view: makeView() }));
    renderTab({ onDraft });
    const drafts = screen.getAllByRole("button", { name: "Draft" });
    expect(drafts).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Queue" })).toBeNull();
    await user.click(drafts[1]!);
    expect(onDraft).toHaveBeenCalledWith("wr1");
  });

  it("puts Queue on every row when you are not on the clock, showing the queue order, through the room's own queue", async () => {
    const user = userEvent.setup();
    const onQueueToggle = vi.fn();
    mockedUseAdvisor.mockReturnValue(advisorResult({ view: makeView({ onTheClock: false, picksUntilYourTurn: 3, pickNumber: 4 }) }));
    renderTab({ canDraft: false, queue: ["wr1"], onQueueToggle });
    expect(screen.queryByRole("button", { name: "Draft" })).toBeNull();
    expect(screen.getByRole("button", { name: "Queued 1" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Queue" }));
    expect(onQueueToggle).toHaveBeenCalledWith("rb1");
    expect(screen.getByTestId("advisor-now")).toHaveTextContent("3 picks away");
  });

  it("shows the writer's sentences when they landed, marked as written, and the template otherwise", () => {
    mockedUseAdvisor.mockReturnValue(advisorResult({ view: makeView({ voice: { status: "ready", strategy: "Backs are gone, take the receiver.", reasons: { rb1: "Marcus Reed is the last back worth a starter slot." } } }) }));
    renderTab();
    expect(screen.getByTestId("advisor-strategy")).toHaveTextContent("Backs are gone, take the receiver.");
    expect(screen.getByTestId("advisor-strategy")).toHaveAttribute("data-voice", "written");
    const reasons = screen.getAllByTestId("advisor-reason");
    expect(reasons[0]).toHaveAttribute("data-voice", "written");
    expect(reasons[1]).toHaveAttribute("data-voice", "template");
  });

  it("names what changed since the plan the manager last saw, and shows recomputing without blanking the view", () => {
    const previousPlan = { ...makeView().plan, computedAtPick: 1, turns: [turn({ targets: [{ playerId: "rb1", position: "RB", valueOverReplacement: 41.2, positionRank: 3, oddsByTurn: [{ survival: 0.9, runs: 200 }], reachFromTurn: null }, { playerId: "te1", position: "RB", valueOverReplacement: 1, positionRank: 9, oddsByTurn: [{ survival: 0.5, runs: 200 }], reachFromTurn: null }] })] };
    mockedUseAdvisor.mockReturnValue(advisorResult({ view: makeView({ stamp: { computedAtPick: 2, sequence: 2 } }), previousPlan, recomputing: true }));
    renderTab();
    const changed = screen.getByTestId("advisor-changed");
    expect(changed).toHaveTextContent("Cole Whitmore came off the plan.");
    expect(changed).toHaveTextContent("Marcus Reed at 2.02 moved down, 90% to 46%.");
    expect(screen.getByTestId("advisor-recomputing")).toBeInTheDocument();
    expect(screen.getAllByTestId("advisor-now-row")).toHaveLength(2);
  });

  it("renders the post-pick beat from the latched view once this seat's pick is in the log", () => {
    const prePickView = makeView();
    mockedUseAdvisor.mockReturnValue(advisorResult({ view: makeView({ onTheClock: false, stamp: { computedAtPick: 2, sequence: 2 } }), prePickView }));
    renderTab({ view: { ...SNAKE_VIEW, picks: [pick({ pickNumber: 1, playerId: "wr1" })], rosters: { t1: [], t2: [] } } });
    expect(screen.getByTestId("assistant-beat")).toHaveTextContent("Our board had Marcus Reed first. 92 of 200 runs still had him at your next turn.");
  });

  it("keeps the bye-cluster note for the top candidate", () => {
    mockedUseAdvisor.mockReturnValue(advisorResult({ view: makeView() }));
    renderTab();
    expect(screen.getByTestId("advisor-note")).toHaveTextContent("Marcus Reed shares Bye 10 with 1 rostered player. Drafting him would make it 2.");
  });
});
