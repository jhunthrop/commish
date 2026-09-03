import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { DraftStateView } from "@/draft-engine";
import { renderSurface } from "@/components/ui/test-utils";
import { SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { RoomDock } from "./room-dock";

const props = {
  view: SNAKE_VIEW,
  queue: ["rb1", "qb1"],
  playersById: playersById(),
  teams: TEAMS,
  myTeamId: "t1",
  submitting: false,
  canAct: false,
  actionLabel: "Draft",
  onAct: () => {},
  onQueueChange: () => {},
};

/** `upcoming` is the engine's, not ours: t1 is three turns out on an 8-hour clock. */
const waiting: Partial<DraftStateView> = { onClockTeamId: "t2", upcoming: ["t2", "t2", "t1"] };

/**
 * Sunday v5 law 6 rewired the dock onto `LowerThird`: every fact is a `{label, value}` cell
 * (`<span>{label}</span><span>{value}</span>`, siblings), rather than the v4-era dock's own
 * hand-built sentences (`dock-your-turn`, `dock-primary-empty`, `dock-owed-pick`). This reads a
 * cell's value off the label most of this suite already asserts on.
 */
function cellValue(label: string): HTMLElement {
  return screen.getByText(label).nextElementSibling as HTMLElement;
}

describe("RoomDock", () => {
  it("carries the queue, the roster fill and the wait — both themes, axe-clean", async () => {
    await renderSurface(<RoomDock {...props} view={{ ...SNAKE_VIEW, ...waiting }} />, async ({ container }) => {
      expect(screen.getByRole("list", { name: "Your queue" })).toBeInTheDocument();
      expect(screen.getByRole("list", { name: "Your roster" })).toBeInTheDocument();
      // The old single sentence ("You're up in 2 picks (~16h 0m).") split into its own lower
      // third cell (Sunday v5 law 6): the figure and its caption, not a sentence.
      expect(cellValue("Picks until yours").textContent).toBe("2~16h 0m");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Task 4 fix round 1 (review F1) pinned `view.pausedUntil` reaching the wait estimate. The
  // honest reassurance COPY ("once picks resume") moved off the dock entirely in Sunday v5 —
  // it is `RoomRail`'s `paused-message` now (the masthead owns schedule-level facts) — so the
  // dock's own half of this contract is simply that it prints no estimate it cannot back up.
  it("gives no wait estimate while the room is paused, only the bare pick count", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, ...waiting, pausedUntil: "2026-09-15T09:00:00.000Z" };
    render(<RoomDock {...props} view={view} />);
    expect(cellValue("Picks until yours").textContent).toBe("2");
  });

  it("keeps the flat ETA when the room isn't paused", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, ...waiting, pausedUntil: null };
    render(<RoomDock {...props} view={view} />);
    expect(cellValue("Picks until yours").textContent).toBe("2~16h 0m");
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

  // `PickFromPoolButton` took over the primary verb slot when the queue can supply nothing
  // draftable (Sunday v5) — the old standalone "dock-primary-empty" sentence is gone, and the
  // verb IS the pool-pointer now.
  it("points at the pool rather than offering a button it cannot fill", () => {
    render(<RoomDock {...props} queue={[]} canAct />);
    expect(screen.getByTestId("dock-verb")).toHaveTextContent("Pick from the pool");
    expect(cellValue("Queued").textContent).toBe("Nobody");
    expect(screen.queryByRole("button", { name: /^Draft/ })).toBeNull();
  });

  // The 360px squeeze pin used to target the v4 dock's free-flowing sentences
  // (`basis-full`/`lg:basis-auto` on `dock-your-turn`/`dock-primary-empty`), which no longer
  // exist — `LowerThird`'s cells are fixed, border-separated columns instead of wrapped prose,
  // and `flex-wrap` on the strip itself is what keeps THAT layout honest at phone width now.
  it("wraps the lower third's cells at phone width instead of squeezing them", () => {
    const { container } = render(<RoomDock {...props} />);
    const strip = container.querySelector("#room-clock > div");
    expect(strip?.className).toContain("flex-wrap");
  });

  // The old "You're on the clock." sentence was `formatYourTurn`'s; the dock no longer calls
  // it (Sunday v5 law 6 pulled the turn cell from `turnSummary` directly, the same authority
  // `RoomRail` reads). The engine's own `onClockTeamId === myTeamId` is still the whole rule —
  // nothing here re-derives whose turn it is.
  it("says the turn is mine, from the engine's own onClockTeamId, without a turn rule of its own", () => {
    render(<RoomDock {...props} view={{ ...SNAKE_VIEW, upcoming: ["t1", "t2"] }} />);
    expect(screen.getByText("Your pick")).toBeInTheDocument();
    expect(cellValue("Your pick").textContent).toContain("You");
  });

  // E11's live-board silence still holds, but for a different cell: a commissioner has no seat
  // to run a personalized ETA against, so `picksUntilYours` returns null and the "Picks until
  // yours" cell is never pushed — the generic "who's on the clock" cell is not personal, so it
  // still renders (a spectator can see the board same as anyone).
  it("shows no personalized wait for a commissioner with no team in the draft — E11's live-board silence", () => {
    render(<RoomDock {...props} myTeamId={null} />);
    expect(screen.queryByText("Picks until yours")).toBeNull();
    expect(screen.queryByText("Pick until yours")).toBeNull();
    expect(screen.getByText("On the clock")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your roster" })).toBeNull();
  });

  // E11 (2026-08-26 design review): the dock no longer claims to be "Watching the board." over
  // an empty pre-start board. Sunday v5 folded that into the SAME phase cell every other state
  // uses ("Draft" / "Not started"), rather than a bespoke waiting sentence — the room-wide
  // kickoff story ("Waiting for kickoff", the countdown) lives in the masthead (`RoomRail`) and
  // the Quilt now, not repeated here.
  it("says the draft has not started rather than claiming to watch an empty board (E11)", () => {
    const scheduled: DraftStateView = { ...SNAKE_VIEW, phase: "scheduled", onClockTeamId: null, deadlineAt: null, clockSeconds: null, upcoming: [] };
    render(<RoomDock {...props} view={scheduled} />);
    expect(cellValue("Draft").textContent).toBe("Not started");
    expect(screen.queryByText("Watching the board.")).toBeNull();
  });

  // Task 10's persona checkpoint, finding 1: in a practice room the flat `picksAway ×
  // clockSeconds` ETA overstated the wait roughly tenfold (bots pick in seconds, never the
  // full clock). The dock still prices a practice opponent's turn at the seeded delay's own
  // expected value (`MockRoomInfo.expectedBotPickSeconds`) — only the rendering split from a
  // sentence into a figure + caption.
  it("prices practice opponents' turns honestly in the wait estimate", () => {
    const bots = [
      { id: "t2", name: "Bench Mob", ownerDisplayName: "Coach Bee", ownerAvatarUrl: null, isBot: true },
    ];
    const view: DraftStateView = { ...SNAKE_VIEW, onClockTeamId: "t2", upcoming: ["t2", "t2", "t1"] };
    // both intervening turns are the bot's: 2 × 6s, never 2 × 8h
    render(<RoomDock {...props} view={view} teams={bots} expectedBotPickSeconds={6} />);
    expect(cellValue("Picks until yours").textContent).toBe("2any moment");
  });

  it("chip controls wait for the chip's own intent on hover devices, stay always-on for touch (review E8)", () => {
    render(<RoomDock {...props} />);
    // Fifteen idle ghost buttons was the finding; the fix is opacity-only reveal gated on
    // @media(hover:hover) — touch keeps every control visible, keyboard focus reveals what it
    // lands on, and the buttons never leave the DOM or lose their names.
    const up = screen.getByRole("button", { name: "Move Jalen Croft up" });
    expect(up.className).toContain("[@media(hover:hover)]:opacity-0");
    expect(up.className).toContain("group-hover/chip:opacity-100");
    expect(up.className).toContain("group-focus-within/chip:opacity-100");
    expect(up.className).toContain("focus-visible:opacity-100");
    expect(up.closest("li")?.className).toContain("group/chip");
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

  // E2's mobile-only clock ECHO is gone by design (room-dock.tsx's own docblock: "the echo, its
  // `lg:hidden` gating and the `aria-hidden` duplication it needed are all gone"). Sunday v5
  // law 6 gives the room exactly one clock, in the lower third's own "Pick clock" cell, visible
  // at every width — these two tests replace the old echo pin with that single clock's own
  // behavior.
  it("shows the pick clock in the live channel while the draft is live and unpaused", () => {
    const live: DraftStateView = { ...SNAKE_VIEW, deadlineAt: new Date(Date.now() + 42_000).toISOString() };
    render(<RoomDock {...props} view={live} />);
    expect(cellValue("Pick clock").className).toContain("text-live");
  });

  it("omits the pick clock before the draft starts, after it ends, or while picks are paused", () => {
    const scheduled: DraftStateView = { ...SNAKE_VIEW, phase: "scheduled", availablePlayerIds: [], onClockTeamId: null, upcoming: [], deadlineAt: null };
    const { rerender } = render(<RoomDock {...props} view={scheduled} />);
    expect(screen.queryByText("Pick clock")).toBeNull();

    const complete: DraftStateView = { ...SNAKE_VIEW, phase: "complete" };
    rerender(<RoomDock {...props} view={complete} />);
    expect(screen.queryByText("Pick clock")).toBeNull();

    const paused: DraftStateView = {
      ...SNAKE_VIEW,
      ...waiting,
      deadlineAt: new Date(Date.now() + 42_000).toISOString(),
      pausedUntil: new Date(Date.now() + 600_000).toISOString(),
    };
    rerender(<RoomDock {...props} view={paused} />);
    expect(screen.queryByText("Pick clock")).toBeNull();
  });

  // D1 (2026-08-26 design review): at 360px the first queue chip's box leaked past this
  // `<ol>`'s `overflow-x-auto` clip into the PAGE's scrollable overflow — a 186px phantom
  // sideways pan (scrollWidth 546 vs 360, Chromium, real compiled CSS). `contain: layout` on
  // the `<ol>` was the fix the review verified in-browser (`overflow-hidden` on the parent was
  // tried and did NOT restore 360). happy-dom computes no layout, so this pins the class;
  // `e2e/mobile-360.spec.ts` proves the page-level effect against the real engine.
  it("contains the queue rail's own layout so a chip can never leak into page overflow (D1)", () => {
    render(<RoomDock {...props} />);
    expect(screen.getByRole("list", { name: "Your queue" }).className).toContain("[contain:layout]");
  });

  it("invites you to build a queue when you have none", () => {
    render(<RoomDock {...props} queue={[]} />);
    // Fun pass, Task 4: "to build your queue" narrated the list the sentence sits under.
    // The instruction and C3's sanctioned safety-net phrase survive; the narration does not.
    expect(screen.getByText(/Star players in the pool\./)).toBeInTheDocument();
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
    expect(screen.queryByText("Picks until yours")).toBeNull();
    // The queue is still there: a bid war is exactly when you re-plan the next three picks.
    expect(screen.getByRole("list", { name: "Your queue" })).toBeInTheDocument();
  });

  // Task 5, Phase 3.5: the skip's own courtesy. `canAct` stays false (it's genuinely t2's
  // turn), so this pins that the verb fires off a DIFFERENT signal (`owedPicks`) than the
  // ordinary turn check. The v4 dock said so in a dedicated "dock-owed-pick" sentence; Sunday
  // v5 folded that courtesy into the same one verb slot every turn uses — there is no second
  // notice, only a verb that is live for a reason the turn cell does not have to explain.
  it("keeps the draft verb live for a manager who owes a pick, even on somebody else's turn", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, ...waiting, owedPicks: { t1: [1] } };
    render(<RoomDock {...props} view={view} canAct={false} />);
    expect(screen.getByTestId("dock-verb")).toHaveTextContent("Draft Marcus Reed");
    // The turn cell still tells the truth: it is genuinely t2's turn, not mine.
    expect(cellValue("On the clock").textContent).toContain("Iron Owls");
    // No accusation, no blame voice — the integrity notices discipline applies to this copy too.
    expect(screen.queryByText(/missed|failed/i)).toBeNull();
  });

  it("renders no draft verb when the owed pick belongs to somebody else, not to me", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, ...waiting, owedPicks: { t2: [1] } };
    render(<RoomDock {...props} view={view} canAct={false} />);
    expect(screen.queryByTestId("dock-verb")).toBeNull();
    expect(screen.getByText("On the clock")).toBeInTheDocument();
  });

  it("never doubles the verb when a real turn and an owed pick are both true at once", () => {
    const view: DraftStateView = { ...SNAKE_VIEW, owedPicks: { t1: [1] } };
    render(<RoomDock {...props} view={view} canAct queue={[]} />);
    expect(screen.getAllByTestId("dock-verb")).toHaveLength(1);
    expect(screen.getByTestId("dock-verb")).toHaveTextContent("Pick from the pool");
  });

  it("never strikes a queued player through before the draft has started", () => {
    const scheduled: DraftStateView = { ...SNAKE_VIEW, phase: "scheduled", availablePlayerIds: [], onClockTeamId: null, upcoming: [] };
    render(<RoomDock {...props} view={scheduled} />);
    expect(screen.queryByText("Already drafted")).toBeNull();
    expect(screen.getByText("Marcus Reed").className).not.toContain("line-through");
  });

  // E3 (2026-08-26 design review): below `lg` the pool linearizes after the whole board — a
  // 6,100–10,300px scroll away from the sticky dock — so a way to reach it without scrolling
  // matters most on a phone. Sunday v5 merged the old standalone "Jump to the pool" link into
  // the dock's ONE verb slot: `PickFromPoolButton` fills that slot whenever nothing queued can
  // be drafted, at every width — the pool is not always in view even at `lg` for a manager who
  // has scrolled the board, so this is no longer the mobile-only shortcut it used to be.
  describe("the 'Pick from the pool' verb (empty-queue fallback)", () => {
    it("renders only when actionable and the queue has nothing left to draft", () => {
      const { rerender } = render(<RoomDock {...props} queue={[]} canAct={false} />);
      expect(screen.queryByRole("button", { name: "Pick from the pool" })).toBeNull();

      rerender(<RoomDock {...props} queue={[]} canAct />);
      expect(screen.getByRole("button", { name: "Pick from the pool" })).toBeInTheDocument();
    });

    it("stays visible at every width — it fills the room's one verb slot, not a mobile-only shortcut", () => {
      render(<RoomDock {...props} queue={[]} canAct />);
      expect(screen.getByRole("button", { name: "Pick from the pool" }).className).not.toContain("lg:hidden");
    });

    it("scrolls the pool target into view, smoothly by default", () => {
      const pool = document.createElement("div");
      pool.id = "player-pool";
      document.body.appendChild(pool);
      const scrollIntoView = vi.fn();
      pool.scrollIntoView = scrollIntoView;

      render(<RoomDock {...props} queue={[]} canAct />);
      fireEvent.click(screen.getByRole("button", { name: "Pick from the pool" }));
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

      pool.remove();
    });

    it("scrolls instantly instead when the user prefers reduced motion", () => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
      const pool = document.createElement("div");
      pool.id = "player-pool";
      document.body.appendChild(pool);
      const scrollIntoView = vi.fn();
      pool.scrollIntoView = scrollIntoView;

      render(<RoomDock {...props} queue={[]} canAct />);
      fireEvent.click(screen.getByRole("button", { name: "Pick from the pool" }));
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });

      pool.remove();
      vi.unstubAllGlobals();
    });
  });
});
