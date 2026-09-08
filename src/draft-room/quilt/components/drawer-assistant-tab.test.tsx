import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { advisorView, candidatePlayers } from "../../advisor/test-view";
import type { UseAdvisorResult } from "../../advisor/use-advisor";
import { DrawerAssistantTab } from "./drawer-assistant-tab";

function advisorResult(over: Partial<UseAdvisorResult> = {}): UseAdvisorResult {
  return { view: null, recomputing: false, error: null, ...over };
}

interface RenderOptions {
  readonly advisor: UseAdvisorResult;
  readonly myTeamId?: string | null;
  readonly canDraft?: boolean;
  readonly queue?: readonly string[];
  readonly onDraft?: (playerId: string) => void;
  readonly onQueueToggle?: (playerId: string) => void;
}

function renderTab(options: RenderOptions) {
  return render(
    <DrawerAssistantTab
      myTeamId={options.myTeamId === undefined ? "t1" : options.myTeamId}
      advisor={options.advisor}
      playersById={candidatePlayers()}
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

  it("renders the lead card from the room's own player facts, the selector and the rows under it, no strip when there is nothing to report, axe-clean", async () => {
    const { container } = renderTab({ advisor: advisorResult({ view: advisorView() }) });
    expect(screen.getByTestId("advisor-card")).toHaveAttribute("data-on-clock", "true");
    expect(screen.getByTestId("advisor-name")).toHaveTextContent("Marcus Reed");
    expect(screen.getByTestId("advisor-facts")).toHaveTextContent("RB 3, KC, bye 10");
    expect(screen.getByTestId("advisor-odds")).toHaveTextContent("92 of 200");
    expect(screen.getByTestId("advisor-why")).toHaveTextContent(/fills your RB slot/);
    expect(screen.getByRole("group", { name: "Show" })).toBeInTheDocument();
    expect(screen.getAllByTestId("advisor-candidate")).toHaveLength(4);
    expect(screen.queryByRole("list", { name: "Runs and tiers" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("routes Draft on the card and on a row through the room's own pick path on the clock", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    renderTab({ advisor: advisorResult({ view: advisorView() }), onDraft });
    await user.click(within(screen.getByTestId("advisor-card")).getByRole("button", { name: "Draft" }));
    await user.click(screen.getByRole("button", { name: "Draft Cole Whitfield" }));
    expect(onDraft).toHaveBeenNthCalledWith(1, "rb1");
    expect(onDraft).toHaveBeenNthCalledWith(2, "te1");
  });

  it("routes Queue through the room's own queue off the clock, showing where each pick sits", async () => {
    const user = userEvent.setup();
    const onQueueToggle = vi.fn();
    renderTab({ advisor: advisorResult({ view: advisorView({ onTheClock: false, picksUntilYourTurn: 3, pickNumber: 4 }) }), canDraft: false, queue: ["wr1", "rb1"], onQueueToggle });
    expect(screen.queryByRole("button", { name: /^Draft/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Queued 2" }));
    expect(onQueueToggle).toHaveBeenCalledWith("rb1");
    expect(screen.getByRole("button", { name: "Queued 1, Andre Salas" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("advisor-header")).toHaveTextContent("Your next pick is 1.04, 3 picks away");
  });
});
