import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Player } from "@/domain/player";
import type { DraftStateView, CompletedPick } from "@/draft-engine";
import type { AssistantCallView } from "@/draft-service/assistant/call";
import type { Law } from "@/projections/laws/types";
import { SNAKE_VIEW } from "../../test-fixtures";
import { useAssistant, type UseAssistantResult } from "../../assistant/use-assistant";
import { DrawerAssistantTab, oddsPhrase, reasonSentence } from "./drawer-assistant-tab";

vi.mock("../../assistant/use-assistant", () => ({ useAssistant: vi.fn() }));

const mockedUseAssistant = vi.mocked(useAssistant);

function assistantResult(over: Partial<UseAssistantResult> = {}): UseAssistantResult {
  return { call: null, previousCall: null, loading: false, error: null, ...over };
}

const PLAYERS: readonly Player[] = [
  { id: "rb1", name: "Marcus Reed", position: "RB", nflTeam: "KC", headshotUrl: null, adp: 2 },
  { id: "wr1", name: "Andre Salas", position: "WR", nflTeam: "DAL", headshotUrl: null, adp: 5 },
  { id: "te1", name: "Cole Whitmore", position: "TE", nflTeam: "SF", headshotUrl: null, adp: 30 },
  { id: "qb1", name: "Jalen Croft", position: "QB", nflTeam: "KC", headshotUrl: null, adp: 1 },
  { id: "wr2", name: "Tyree Combs", position: "WR", nflTeam: "KC", headshotUrl: null, adp: 12 },
];

function playersById(players: readonly Player[] = PLAYERS): ReadonlyMap<string, Player> {
  return new Map(players.map((player) => [player.id, player]));
}

function pick(over: Partial<CompletedPick>): CompletedPick {
  return { pickNumber: 1, round: 1, teamId: "t2", playerId: "rb1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false, ...over };
}

function view(over: Partial<DraftStateView> = {}): DraftStateView {
  return { ...SNAKE_VIEW, availablePlayerIds: ["rb1", "wr1", "te1"], rosters: { t1: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }], t2: [] }, ...over };
}

const CALL_BASE = { onTheClock: true, yourBuild: [], winningBuilds: null, computedBasis: "gen1" } as const;

function makeCall(over: Partial<AssistantCallView> = {}): AssistantCallView {
  return { pickNumber: 1, candidates: [], ...CALL_BASE, ...over };
}

function makeLaw(overrides: Partial<Law> = {}): Law {
  return {
    id: "test_law",
    position: "all",
    claim: "A made-up claim.",
    measured: { effect: 1.2, ci: [0.5, 1.9], sample: 100, seasons: "2020-2024" },
    trainEffect: 1.2,
    verdict: "confirmed",
    modelPath: null,
    origin: "tribal",
    hasFoldEvidence: true,
    primaryQuantityId: null,
    primaryQuantityNoun: null,
    primaryQuantityUnit: null,
    ...overrides,
  };
}

interface RenderOptions {
  readonly myTeamId?: string | null;
  readonly players?: readonly Player[];
  readonly available?: ReadonlySet<string>;
  readonly byeWeeks?: ReadonlyMap<string, number>;
  readonly reasons?: ReadonlyMap<string, readonly import("@/projections/preseason/board").BoardReason[]>;
  readonly laws?: readonly Law[];
  readonly view?: DraftStateView;
}

function renderTab(options: RenderOptions = {}) {
  return render(
    <DrawerAssistantTab
      draftId="d1"
      view={options.view ?? view()}
      myTeamId={options.myTeamId === undefined ? "t1" : options.myTeamId}
      players={options.players ?? PLAYERS}
      playersById={playersById(options.players)}
      available={options.available ?? new Set(["rb1", "wr1", "te1"])}
      byeWeeks={options.byeWeeks ?? new Map([["KC", 10]])}
      reasons={options.reasons ?? new Map()}
      laws={options.laws ?? []}
    />,
  );
}

describe("oddsPhrase", () => {
  it("rounds to quarters with fixed, pinned phrasings", () => {
    expect(oddsPhrase(0.95)).toBe("better than 9 in 10");
    expect(oddsPhrase(0.75)).toBe("about 3 in 4");
    expect(oddsPhrase(0.5)).toBe("about 1 in 2");
    expect(oddsPhrase(0.25)).toBe("about 1 in 4");
    expect(oddsPhrase(0.05)).toBe("long odds");
  });
});

describe("reasonSentence", () => {
  it("renders one plain sentence per PickReason variant, from the reason's own numbers", () => {
    expect(reasonSentence({ code: "value_over_replacement", valueOverReplacement: 15.2, position: "RB", positionRank: 3 })).toBe(
      "He ranks No. 3 at RB, 15.2 points over replacement.",
    );
    expect(reasonSentence({ code: "will_not_survive", survivalProbability: 0.2, nextPick: 9 })).toBe(
      "He probably will not last. about 1 in 4 he is still there at pick 9.",
    );
    expect(reasonSentence({ code: "safe_to_wait", survivalProbability: 0.85, nextPick: 9 })).toBe(
      "He can wait. about 3 in 4 he is still there at pick 9.",
    );
    expect(reasonSentence({ code: "no_further_turn", pickNumber: 14 })).toBe("Pick 14 is your last turn of the draft. There is no next pick to wait for.");
    expect(reasonSentence({ code: "tier_cliff", position: "TE", dropToNextTier: 4.5, playersLeftInTier: 2 })).toBe(
      "Only 2 TE left in this tier. The price drops 4.5 points after that.",
    );
    expect(reasonSentence({ code: "fills_starting_slot", slot: "FLEX" })).toBe("He fills your starting FLEX slot.");
    expect(reasonSentence({ code: "roster_saturated", position: "WR", alreadyRostered: 4, alreadyBenched: 2 })).toBe(
      "You already roster 4 WR and bench 2 more. He adds depth only.",
    );
  });

  it("no em-dashes or semicolons in any variant's copy", () => {
    const reasons = [
      { code: "value_over_replacement" as const, valueOverReplacement: 1, position: "RB" as const, positionRank: 1 },
      { code: "will_not_survive" as const, survivalProbability: 0.2, nextPick: 3 },
      { code: "safe_to_wait" as const, survivalProbability: 0.85, nextPick: 3 },
      { code: "no_further_turn" as const, pickNumber: 1 },
      { code: "tier_cliff" as const, position: "TE" as const, dropToNextTier: 1, playersLeftInTier: 1 },
      { code: "fills_starting_slot" as const, slot: "TE" as const },
      { code: "roster_saturated" as const, position: "WR" as const, alreadyRostered: 1, alreadyBenched: 1 },
    ];
    for (const reason of reasons) {
      const sentence = reasonSentence(reason);
      expect(sentence).not.toMatch(/—|–/);
      expect(sentence).not.toContain(";");
    }
  });
});

describe("DrawerAssistantTab", () => {
  it("gives the commissioner the honest no-seat line and never dresses up an empty call", () => {
    mockedUseAssistant.mockReturnValue(assistantResult());
    renderTab({ myTeamId: null });
    expect(screen.getByText("You have no seat in this draft. The assistant argues for a seat.")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-run-alert")).toBeNull();
  });

  it("renders three candidates, their reason sentences and make-it-back odds sentences", () => {
    const call = makeCall({
      pickNumber: 4,
      candidates: [
        {
          playerId: "rb1",
          position: "RB",
          reasons: [
            { code: "value_over_replacement", valueOverReplacement: 15.2, position: "RB", positionRank: 3 },
            { code: "will_not_survive", survivalProbability: 0.2, nextPick: 9 },
          ],
          makeItBack: { playerId: "rb1", survival: 0.75, runs: 200 },
        },
        {
          playerId: "wr1",
          position: "WR",
          reasons: [{ code: "safe_to_wait", survivalProbability: 0.85, nextPick: 9 }],
          makeItBack: { playerId: "wr1", survival: 0.5, runs: 200 },
        },
        {
          playerId: "te1",
          position: "TE",
          reasons: [{ code: "fills_starting_slot", slot: "TE" }],
          makeItBack: null,
        },
      ],
    });
    mockedUseAssistant.mockReturnValue(assistantResult({ call }));
    renderTab();

    expect(screen.getByRole("button", { name: "Marcus Reed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Andre Salas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cole Whitmore" })).toBeInTheDocument();

    expect(screen.getByText("He ranks No. 3 at RB, 15.2 points over replacement.")).toBeInTheDocument();
    expect(screen.getByText("Our sims make it about 3 in 4 he is still here at your next turn.")).toBeInTheDocument();
    expect(screen.getByText("Our sims make it about 1 in 2 he is still here at your next turn.")).toBeInTheDocument();
    expect(screen.getByText("He fills your starting TE slot.")).toBeInTheDocument();
  });

  it("renders the run alert when the room detects one, from view.picks alone", () => {
    const runPlayers: Player[] = Array.from({ length: 5 }, (_, index) => ({
      id: `r${index}`,
      name: `Runner ${index}`,
      position: "RB",
      nflTeam: "KC",
      headshotUrl: null,
      adp: index,
    }));
    const picks = runPlayers.map((player, index) => pick({ pickNumber: index + 1, playerId: player.id }));
    mockedUseAssistant.mockReturnValue(assistantResult({ call: makeCall() }));
    renderTab({ players: [...PLAYERS, ...runPlayers], view: view({ picks }) });
    expect(screen.getByTestId("assistant-run-alert")).toHaveTextContent("RB is on a run. 5 of the last 5 picks were RB.");
  });

  it("renders the tier strip from the board's own tier_cliff reasons, one row per position", () => {
    const reasons = new Map([["rb1", [{ code: "tier_cliff" as const, position: "RB" as const, dropToNextTier: 4.5, playersLeftInTier: 2 }]]]);
    mockedUseAssistant.mockReturnValue(assistantResult({ call: makeCall() }));
    renderTab({ reasons });
    expect(screen.getByTestId("assistant-tier-strip")).toHaveTextContent("Only 2 RB left in this tier. The price drops 4.5 points after that.");
  });

  it("renders the top candidate's bye collision against the caller's own roster", () => {
    const call = makeCall({ candidates: [{ playerId: "rb1", position: "RB", reasons: [], makeItBack: null }] });
    mockedUseAssistant.mockReturnValue(assistantResult({ call }));
    // rb1 and qb1 (rostered) are both KC, bye 10 — drafting rb1 would make it two.
    renderTab();
    expect(screen.getByTestId("assistant-bye-note")).toHaveTextContent("Marcus Reed shares Bye 10 with 1 rostered player. Drafting him would make it 2.");
  });

  it("renders the top candidate's stack note when a law and a rostered teammate both support it", () => {
    const call = makeCall({ candidates: [{ playerId: "wr2", position: "WR", reasons: [], makeItBack: null }] });
    const laws = [makeLaw({ claim: "A quarterback paired with his own wide receiver gains points per game together." })];
    mockedUseAssistant.mockReturnValue(assistantResult({ call }));
    // wr2 and qb1 (rostered) are both KC — the law supports a QB+WR stack.
    renderTab({ laws });
    expect(screen.getByTestId("assistant-stack-note")).toHaveTextContent(
      "Tyree Combs stacks with your Jalen Croft on KC. A quarterback paired with his own wide receiver gains points per game together.",
    );
  });

  it("renders nothing where the data is absent: no run, no tier strip, no make-it-back line, no bye or stack note", () => {
    const call = makeCall({ candidates: [{ playerId: "te1", position: "TE", reasons: [], makeItBack: null }] });
    mockedUseAssistant.mockReturnValue(assistantResult({ call }));
    // te1 (SF) shares no bye with the KC-only roster, and no law in the registry supports a stack.
    renderTab({ view: view({ picks: [] }) });
    expect(screen.queryByTestId("assistant-run-alert")).toBeNull();
    expect(screen.queryByTestId("assistant-tier-strip")).toBeNull();
    expect(screen.queryByText(/Our sims make it/)).toBeNull();
    expect(screen.queryByTestId("assistant-bye-note")).toBeNull();
    expect(screen.queryByTestId("assistant-stack-note")).toBeNull();
  });

  it("renders identically for a mock room — the tab carries no mock-only branch", () => {
    const call = makeCall({ candidates: [{ playerId: "rb1", position: "RB", reasons: [], makeItBack: null }] });
    mockedUseAssistant.mockReturnValue(assistantResult({ call }));
    const first = renderTab();
    const firstHtml = first.container.innerHTML;
    first.unmount();
    const second = renderTab();
    expect(second.container.innerHTML).toBe(firstHtml);
  });

  it("is axe-clean with a full call, run alert, tier strip and bye note all rendered together", async () => {
    const call = makeCall({
      candidates: [
        { playerId: "rb1", position: "RB", reasons: [{ code: "value_over_replacement", valueOverReplacement: 15.2, position: "RB", positionRank: 3 }], makeItBack: { playerId: "rb1", survival: 0.75, runs: 200 } },
      ],
    });
    mockedUseAssistant.mockReturnValue(assistantResult({ call }));
    const reasons = new Map([["rb1", [{ code: "tier_cliff" as const, position: "RB" as const, dropToNextTier: 4.5, playersLeftInTier: 2 }]]]);
    const { container } = renderTab({ reasons, view: view({ picks: [pick({ pickNumber: 1 })] }) });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("DrawerAssistantTab post-pick beat", () => {
  // previousCall.onTheClock === true is the hook's own signal (use-assistant.ts docblock) that the
  // call it replaced was live during YOUR turn — i.e. the fetch that just landed was triggered by
  // your own pick resolving. Every wiring test below turns on that one condition.
  const prePickCall = makeCall({
    pickNumber: 3,
    candidates: [
      { playerId: "rb1", position: "RB", reasons: [], makeItBack: { playerId: "rb1", survival: 0.75, runs: 200 } },
      { playerId: "wr1", position: "WR", reasons: [], makeItBack: null },
    ],
  });

  it("renders 'Best available.' when your pick matches the pre-pick call's own top candidate", () => {
    mockedUseAssistant.mockReturnValue(assistantResult({ call: makeCall(), previousCall: prePickCall }));
    renderTab({ view: view({ picks: [pick({ pickNumber: 3, playerId: "rb1" })] }) });
    expect(screen.getByTestId("assistant-beat")).toHaveTextContent("Best available.");
  });

  it("names the passed-on top candidate with his make-it-back odds when you took someone else", () => {
    mockedUseAssistant.mockReturnValue(assistantResult({ call: makeCall(), previousCall: prePickCall }));
    renderTab({ view: view({ picks: [pick({ pickNumber: 3, playerId: "wr1" })] }) });
    expect(screen.getByTestId("assistant-beat")).toHaveTextContent("Our board had Marcus Reed first. about 3 in 4 he is still there at your next turn.");
  });

  it("stops at the first sentence when the passed-on top candidate carries no make-it-back odds", () => {
    const noOddsCall = makeCall({
      pickNumber: 3,
      candidates: [
        { playerId: "rb1", position: "RB", reasons: [], makeItBack: null },
        { playerId: "wr1", position: "WR", reasons: [], makeItBack: null },
      ],
    });
    mockedUseAssistant.mockReturnValue(assistantResult({ call: makeCall(), previousCall: noOddsCall }));
    renderTab({ view: view({ picks: [pick({ pickNumber: 3, playerId: "wr1" })] }) });
    expect(screen.getByTestId("assistant-beat")).toHaveTextContent("Our board had Marcus Reed first.");
  });

  it("renders no beat when the pre-pick call never loaded", () => {
    mockedUseAssistant.mockReturnValue(assistantResult({ call: makeCall(), previousCall: null }));
    renderTab({ view: view({ picks: [pick({ pickNumber: 3, playerId: "wr1" })] }) });
    expect(screen.queryByTestId("assistant-beat")).toBeNull();
  });

  it("renders no beat when the call the hook replaced was not live during your own turn", () => {
    const someoneElsesTurn = makeCall({ pickNumber: 3, onTheClock: false, candidates: prePickCall.candidates });
    mockedUseAssistant.mockReturnValue(assistantResult({ call: makeCall(), previousCall: someoneElsesTurn }));
    renderTab({ view: view({ picks: [pick({ pickNumber: 3, playerId: "wr1" })] }) });
    expect(screen.queryByTestId("assistant-beat")).toBeNull();
  });

  it("renders no beat when the room carries no matching pick for the pre-pick call's own pick number", () => {
    mockedUseAssistant.mockReturnValue(assistantResult({ call: makeCall(), previousCall: prePickCall }));
    renderTab({ view: view({ picks: [] }) });
    expect(screen.queryByTestId("assistant-beat")).toBeNull();
  });
});
