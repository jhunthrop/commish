import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Player } from "@/domain/player";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { SNAKE_VIEW } from "../../test-fixtures";
import { advisorView, nextPick } from "../../advisor/test-view";
import type { UseAdvisorResult } from "../../advisor/use-advisor";
import { DrawerAssistantTab } from "./drawer-assistant-tab";

function advisorResult(over: Partial<UseAdvisorResult> = {}): UseAdvisorResult {
  return { view: null, prePickView: null, recomputing: false, error: null, ...over };
}

const PLAYERS: readonly Player[] = [
  { id: "rb1", name: "Marcus Reed", position: "RB", nflTeam: "KC", headshotUrl: null, adp: 2 },
  { id: "wr1", name: "Andre Salas", position: "WR", nflTeam: "DAL", headshotUrl: null, adp: 5 },
];

function pick(over: Partial<CompletedPick>): CompletedPick {
  return { pickNumber: 1, round: 1, teamId: "t1", playerId: "rb1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false, ...over };
}

interface RenderOptions {
  readonly advisor: UseAdvisorResult;
  readonly myTeamId?: string | null;
  readonly view?: DraftStateView;
  readonly canDraft?: boolean;
  readonly queue?: readonly string[];
  readonly onDraft?: (playerId: string) => void;
  readonly onQueueToggle?: (playerId: string) => void;
}

function renderTab(options: RenderOptions) {
  return render(
    <DrawerAssistantTab
      view={options.view ?? SNAKE_VIEW}
      myTeamId={options.myTeamId === undefined ? "t1" : options.myTeamId}
      advisor={options.advisor}
      playersById={new Map(PLAYERS.map((player) => [player.id, player]))}
      queue={options.queue ?? []}
      byeWeeks={new Map([["KC", 10]])}
      canDraft={options.canDraft ?? true}
      submitting={false}
      onDraft={options.onDraft ?? (() => {})}
      onQueueToggle={options.onQueueToggle ?? (() => {})}
    />,
  );
}

describe("DrawerAssistantTab", () => {
  it("gives the commissioner the honest no-seat line", () => {
    renderTab({ advisor: advisorResult(), myTeamId: null });
    expect(screen.getByText("You have no seat in this draft. The advisor argues for a seat.")).toBeInTheDocument();
  });

  it("tells the empty state, the first read and the network failure apart", () => {
    const { unmount } = renderTab({ advisor: advisorResult() });
    expect(screen.getByText("The advisor has nothing to say right now.")).toBeInTheDocument();
    unmount();
    const second = renderTab({ advisor: advisorResult({ recomputing: true }) });
    expect(screen.getByText("Reading the board.")).toBeInTheDocument();
    second.unmount();
    renderTab({ advisor: advisorResult({ error: "boom" }) });
    expect(screen.getByText("We could not reach the advisor. It tries again on the next pick.")).toBeInTheDocument();
  });

  it("renders the one card from the room's own player facts: name, team, bye, the odds and the why, axe-clean", async () => {
    const { container } = renderTab({ advisor: advisorResult({ view: advisorView() }) });
    expect(screen.getByTestId("advisor-card")).toHaveAttribute("data-on-clock", "true");
    expect(screen.getByTestId("advisor-name")).toHaveTextContent("Marcus Reed");
    expect(screen.getByTestId("advisor-facts")).toHaveTextContent("RB 3, KC, bye 10");
    expect(screen.getByTestId("advisor-odds")).toHaveTextContent("92 of 200");
    expect(screen.getByTestId("advisor-why")).toHaveTextContent(/fills your RB slot/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("routes Draft through the room's own pick path on the clock", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    renderTab({ advisor: advisorResult({ view: advisorView() }), onDraft });
    await user.click(screen.getByRole("button", { name: "Draft" }));
    expect(onDraft).toHaveBeenCalledWith("rb1");
  });

  it("routes Queue through the room's own queue off the clock, showing where the pick sits", async () => {
    const user = userEvent.setup();
    const onQueueToggle = vi.fn();
    renderTab({ advisor: advisorResult({ view: advisorView({ onTheClock: false, picksUntilYourTurn: 3, pickNumber: 4 }) }), canDraft: false, queue: ["wr1", "rb1"], onQueueToggle });
    expect(screen.queryByRole("button", { name: "Draft" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Queued 2" }));
    expect(onQueueToggle).toHaveBeenCalledWith("rb1");
    expect(screen.getByTestId("advisor-header")).toHaveTextContent("Your next pick is 1.04, 3 picks away");
  });

  it("renders the post-pick beat from the latched view once this seat's pick is in the log", () => {
    const prePickView = advisorView();
    renderTab({
      advisor: advisorResult({ view: advisorView({ onTheClock: false, stamp: { computedAtPick: 2, sequence: 2 }, pick: nextPick({ playerId: "wr1", position: "WR" }) }), prePickView }),
      view: { ...SNAKE_VIEW, picks: [pick({ pickNumber: 1, playerId: "wr1" })] },
    });
    expect(screen.getByTestId("assistant-beat")).toHaveTextContent("Our board had Marcus Reed first. 92 of 200 runs still had him at your next turn.");
  });
});
