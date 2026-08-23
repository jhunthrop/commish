import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { DraftStateView } from "@/draft-engine";
import { renderSurface } from "@/components/ui/test-utils";
import { SNAKE_VIEW, playersById } from "../test-fixtures";
import { RoomDock } from "./room-dock";

const props = {
  view: SNAKE_VIEW,
  queue: ["rb1", "qb1"],
  playersById: playersById(),
  myTeamId: "t1",
  submitting: false,
  canAct: false,
  actionLabel: "Draft",
  onAct: () => {},
  onQueueChange: () => {},
};

/** `upcoming` is the engine's, not ours: t1 is three turns out on an 8-hour clock. */
const waiting: Partial<DraftStateView> = { onClockTeamId: "t2", upcoming: ["t2", "t2", "t1"] };

describe("RoomDock", () => {
  it("carries the queue, the roster fill and the wait — both themes, axe-clean", async () => {
    await renderSurface(<RoomDock {...props} view={{ ...SNAKE_VIEW, ...waiting }} />, async ({ container }) => {
      expect(screen.getByRole("list", { name: "Your queue" })).toBeInTheDocument();
      expect(screen.getByRole("list", { name: "Your roster" })).toBeInTheDocument();
      expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("You're up in 2 picks (~16h 0m).");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Task 4 fix round 1 (review F1): `RoomDock`'s call into `formatYourTurn` dropped
  // `view.pausedUntil` entirely, so a paused draft showed the flat, understated ETA instead of
  // the honest "once picks resume" copy — this pair pins both sides of that wire-up.
  it("gives the honest 'once picks resume' answer instead of a flat ETA while the room is paused", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, ...waiting, pausedUntil: "2026-09-15T09:00:00.000Z" };
    render(<RoomDock {...props} view={view} />);
    expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("You're up in 2 picks, once picks resume.");
  });

  it("keeps the flat ETA when the room isn't paused", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, ...waiting, pausedUntil: null };
    render(<RoomDock {...props} view={view} />);
    expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("You're up in 2 picks (~16h 0m).");
  });

  it("morphs its left edge into one button that drafts the top of the queue", () => {
    const onAct = vi.fn();
    render(<RoomDock {...props} canAct onAct={onAct} />);
    const action = screen.getByRole("button", { name: "Draft Marcus Reed" });
    fireEvent.click(action);
    expect(onAct).toHaveBeenCalledWith("rb1");
    expect(screen.getByTestId("room-dock")).toHaveAttribute("data-mode", "acting");
  });

  it("skips a queued player somebody already took, and strikes him through instead of dropping him", () => {
    const view = { ...SNAKE_VIEW, availablePlayerIds: ["qb1", "rb2", "wr1"] };
    render(<RoomDock {...props} view={view} canAct />);
    expect(screen.getByRole("button", { name: "Draft Jalen Croft" })).toBeInTheDocument();
    const chip = screen.getByText("Marcus Reed").closest("li")!;
    expect(within(chip).getByText("Marcus Reed").className).toContain("line-through");
    expect(within(chip).getByText("Already drafted")).toBeInTheDocument();
  });

  it("points at the pool rather than offering a button it cannot fill", () => {
    render(<RoomDock {...props} queue={[]} canAct />);
    expect(screen.getByTestId("dock-primary-empty")).toHaveTextContent("Your pick. Take somebody from the pool.");
    expect(screen.queryByRole("button", { name: /^Draft/ })).toBeNull();
  });

  it("says you are on the clock, from the engine's own lookahead, without a turn rule of its own", () => {
    render(<RoomDock {...props} view={{ ...SNAKE_VIEW, upcoming: ["t1", "t2"] }} />);
    expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("You're on the clock.");
  });

  it("falls back to a quiet line for a commissioner with no team in the draft", () => {
    render(<RoomDock {...props} myTeamId={null} />);
    expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("Watching the board.");
    expect(screen.queryByRole("list", { name: "Your roster" })).toBeNull();
  });

  it("reorders and removes from the queue with named, keyboard-reachable buttons", () => {
    const onQueueChange = vi.fn();
    render(<RoomDock {...props} onQueueChange={onQueueChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Jalen Croft up" }));
    expect(onQueueChange).toHaveBeenCalledWith(["qb1", "rb1"]);

    fireEvent.click(screen.getByRole("button", { name: "Move Marcus Reed down" }));
    expect(onQueueChange).toHaveBeenCalledWith(["qb1", "rb1"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Marcus Reed from your queue" }));
    expect(onQueueChange).toHaveBeenCalledWith(["qb1"]);
  });

  it("invites you to build a queue when you have none", () => {
    render(<RoomDock {...props} queue={[]} />);
    expect(screen.getByText(/Star players in the pool to build your queue/)).toBeInTheDocument();
  });

  it("counts my roster fill per slot, and only mine", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, rosters: { t1: [{ slot: "RB", slotIndex: 0, playerId: "rb1" }], t2: [] } };
    render(<RoomDock {...props} view={view} />);
    const fill = screen.getByRole("list", { name: "Your roster" });
    expect(within(fill).getByText("0/1")).toBeInTheDocument(); // QB
    expect(within(fill).getByText("1/2")).toBeInTheDocument(); // RB
  });

  it("hands its whole primary slot to the bid console while a lot is live", () => {
    render(<RoomDock {...props} bidConsole={<p>Bid console</p>} />);
    expect(screen.getByTestId("room-dock")).toHaveAttribute("data-mode", "bidding");
    expect(screen.getByText("Bid console")).toBeInTheDocument();
    expect(screen.queryByTestId("dock-your-turn")).toBeNull();
    // The queue is still there: a bid war is exactly when you re-plan the next three picks.
    expect(screen.getByRole("list", { name: "Your queue" })).toBeInTheDocument();
  });

  // Task 5, Phase 3.5: the skip's own courtesy. `canAct` stays false (it's genuinely t2's
  // turn), so this pins that the owed-pick message fires off a DIFFERENT signal (owedPicks)
  // than the ordinary turn check.
  it("tells the owing manager their pick passed and they can still make it, even on somebody else's turn", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, ...waiting, owedPicks: { t1: [1] } };
    render(<RoomDock {...props} view={view} canAct={false} />);
    expect(screen.getByTestId("dock-owed-pick")).toHaveTextContent("Your pick passed while you were away. Make it whenever you are ready.");
    // No accusation, no blame voice — the integrity notices discipline applies to this copy too.
    expect(screen.queryByText(/missed|failed/i)).toBeNull();
  });

  it("says nothing about an owed pick that belongs to somebody else", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, ...waiting, owedPicks: { t2: [1] } };
    render(<RoomDock {...props} view={view} canAct={false} />);
    expect(screen.queryByTestId("dock-owed-pick")).toBeNull();
    expect(screen.getByTestId("dock-your-turn")).toBeInTheDocument();
  });

  it("puts the real, current turn ahead of an owed-pick courtesy when both are true at once", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, owedPicks: { t1: [1] } };
    render(<RoomDock {...props} view={view} canAct queue={[]} />);
    expect(screen.getByTestId("dock-primary-empty")).toHaveTextContent("Your pick. Take somebody from the pool.");
    expect(screen.queryByTestId("dock-owed-pick")).toBeNull();
  });

  it("never strikes a queued player through before the draft has started", () => {
    const scheduled: DraftStateView = { ...SNAKE_VIEW, phase: "scheduled", availablePlayerIds: [], onClockTeamId: null, upcoming: [] };
    render(<RoomDock {...props} view={scheduled} />);
    expect(screen.queryByText("Already drafted")).toBeNull();
    expect(screen.getByText("Marcus Reed").className).not.toContain("line-through");
  });
});
