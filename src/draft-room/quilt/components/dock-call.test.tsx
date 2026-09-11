import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { advisorView, candidatePlayers } from "../../advisor/test-view";
import { PLAYERS, SNAKE_VIEW, playersById } from "../../test-fixtures";
import { DockCall, type DockCallProps } from "./dock-call";

/** Ten seats, the room at 1.07 on somebody else's clock; the advice decides your pick, 1.10. */
const VIEW = { ...SNAKE_VIEW, pickNumber: 7, onClockTeamId: "t2", draftOrder: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"], upcoming: ["t2", "t3", "t1"] };

function renderCall(over: Partial<DockCallProps> = {}) {
  const props: DockCallProps = {
    view: VIEW,
    myTeamId: "t1",
    // The room's own fixture players win over the advisor fixture's where ids collide (qb1).
    playersById: new Map([...candidatePlayers(), ...playersById(PLAYERS)]),
    advisor: advisorView({ pickNumber: 10, onTheClock: false, picksUntilYourTurn: 3 }),
    recomputing: false,
    queue: [],
    byeWeeks: new Map(),
    nextPickLabel: "2.01",
    available: new Set(["rb1", "wr1", "qb1"]),
    canDraft: false,
    submitting: false,
    queuedPlayerIds: new Set(),
    onDraft: vi.fn(),
    onQueueToggle: vi.fn(),
    ...over,
  };
  return render(<DockCall {...props} />);
}

describe("DockCall (our call beside the verb)", () => {
  it("prints the pick the advice decides, never the room's on-clock pick, off your clock", () => {
    renderCall();
    const call = screen.getByTestId("dock-call");
    expect(call).toHaveTextContent("our call for 1.10");
    expect(call).not.toHaveTextContent("1.07");
    expect(call).toHaveAttribute("data-on-clock", "false");
    // Off the clock: a quiet Queue, no solid verb.
    expect(screen.queryByTestId("dock-verb")).toBeNull();
    expect(screen.getByTestId("dock-queue-verb")).toHaveTextContent("Queue Marcus Reed");
  });

  it("says the figure's basis as runs still there at your next pick", () => {
    renderCall();
    expect(screen.getByTestId("big-number")).toHaveTextContent("92");
    expect(screen.getByTestId("big-number")).toHaveTextContent("of 200 runs, still there at 2.01");
  });

  it("falls back to the top of your queue with no runs yet, and the basis says so under a dash", () => {
    renderCall({ advisor: null, queue: ["qb1"], canDraft: true, nextPickLabel: null });
    const call = screen.getByTestId("dock-call");
    expect(call).toHaveTextContent("Jalen Croft");
    expect(call).toHaveTextContent("top of your queue");
    expect(call).not.toHaveTextContent("our call for");
    expect(screen.getByTestId("big-number")).toHaveTextContent("–");
    expect(screen.getByTestId("big-number")).toHaveTextContent("no runs yet");
    expect(screen.getByTestId("dock-verb")).toHaveTextContent("Draft Jalen Croft");
  });

  it("says it is updating, in one quiet word, while the advice is being recomputed", () => {
    renderCall({ recomputing: true });
    const word = screen.getByTestId("advisor-recomputing");
    expect(word).toHaveAttribute("data-active", "true");
    expect(word).toHaveTextContent("updating");
    expect(screen.getByTestId("big-number").className).toContain("opacity-60");
  });

  it("keeps the word in the flow but silent when the advice is current", () => {
    renderCall();
    expect(screen.getByTestId("advisor-recomputing")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("big-number").className).not.toContain("opacity-60");
  });
});
