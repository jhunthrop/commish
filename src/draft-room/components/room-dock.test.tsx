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

  it("contains every growing dock sentence on its own line at phone width — the 360px squeeze pin", () => {
    // The mobile-360 fixture caught display-size text squeezed to a sliver inside the dock's
    // flex-wrap row (unqualified shrink/flex terms); the fix is room-rail's own NEW-3 idiom,
    // `basis-full lg:basis-auto`. This pins the class shape so a jsdom CI run catches a
    // regression the browser walk would otherwise be alone in seeing.
    const { rerender } = render(<RoomDock {...props} queue={[]} canAct />);
    expect(screen.getByTestId("dock-primary-empty").className).toContain("basis-full");
    expect(screen.getByTestId("dock-primary-empty").className).toContain("lg:basis-auto");
    rerender(<RoomDock {...props} view={{ ...SNAKE_VIEW, upcoming: ["t1", "t2"] }} />);
    expect(screen.getByTestId("dock-your-turn").className).toContain("basis-full");
    expect(screen.getByTestId("dock-your-turn").className).toContain("lg:basis-auto");
  });

  it("says you are on the clock, from the engine's own lookahead, without a turn rule of its own", () => {
    render(<RoomDock {...props} view={{ ...SNAKE_VIEW, upcoming: ["t1", "t2"] }} />);
    expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("You're on the clock.");
  });

  it("says nothing at all for a commissioner with no team in the draft — E11's live-board silence", () => {
    // MERGED SEMANTICS (the design lane's fix pass, E11): when `formatYourTurn` has nothing to
    // say on a LIVE board, the standing line is silent — a sentence with no information was the
    // finding. Pre-start keeps its honest kickoff line (tested above).
    render(<RoomDock {...props} myTeamId={null} />);
    expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("");
    expect(screen.queryByRole("list", { name: "Your roster" })).toBeNull();
  });

  // E11 (the draft-room design review, fixed at Task 10's persona checkpoint): the dock used
  // to claim "Watching the board." over an empty pre-start board — there is nothing to watch
  // yet, and the rail above already says why.
  it("says it is waiting for kickoff, not watching the board, before the draft starts", () => {
    const scheduled: DraftStateView = { ...SNAKE_VIEW, phase: "scheduled", onClockTeamId: null, deadlineAt: null, clockSeconds: null, upcoming: [] };
    render(<RoomDock {...props} view={scheduled} />);
    expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("Waiting for kickoff.");
  });

  // Task 10's persona checkpoint, finding 1: in a practice room the flat `picksAway ×
  // clockSeconds` ETA overstated the wait roughly tenfold (bots pick in seconds, never the
  // full clock), and a first-timer who walks away on a wrong "~8m" misses her first pick.
  // The dock now prices a practice opponent's turn at the seeded delay's own expected value,
  // carried on the wire (`MockRoomInfo.expectedBotPickSeconds`), and a human seat at the clock.
  it("prices practice opponents' turns honestly in the wait estimate", () => {
    const bots = [
      { id: "t2", name: "Bench Mob", ownerDisplayName: "Coach Bee", ownerAvatarUrl: null, isBot: true },
    ];
    const view: DraftStateView = { ...SNAKE_VIEW, onClockTeamId: "t2", upcoming: ["t2", "t2", "t1"] };
    // both intervening turns are the bot's: 2 × 6s, never 2 × 8h
    render(<RoomDock {...props} view={view} teams={bots} expectedBotPickSeconds={6} />);
    expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("You're up in 2 picks (any moment).");
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

  // E2 (2026-08-26 design review): below `lg` only the dock sticks, and the rail — the room's
  // ONLY clock — scrolled away, so a phone user deep in the pool acted against an invisible
  // clock. The dock now carries a compact echo of the same clock, `lg:hidden` (never spoken
  // twice at desktop widths) and `aria-hidden` (the rail still owns the screen-reader story —
  // a second live region would double every announcement).
  it("rides the sticky dock with the clock below lg, hot on my turn, calm on theirs (E2)", () => {
    const live = { ...SNAKE_VIEW, deadlineAt: new Date(Date.now() + 42_000).toISOString() };
    const { rerender } = render(<RoomDock {...props} view={live} canAct />);
    const clock = screen.getByTestId("dock-clock");
    expect(clock.className).toContain("lg:hidden");
    expect(clock).toHaveAttribute("aria-hidden", "true");
    expect(clock).toHaveTextContent("You're on the clock");
    expect(clock.querySelector(".text-negative")).not.toBeNull();

    rerender(<RoomDock {...props} view={{ ...live, ...waiting }} />);
    const calm = screen.getByTestId("dock-clock");
    expect(calm).toHaveTextContent("On the clock");
    expect(calm).not.toHaveTextContent("You're on the clock");
    expect(calm.querySelector(".text-negative")).toBeNull();
  });

  it("shows no dock clock before the draft starts, after it ends, or while picks are paused (E2)", () => {
    const scheduled: DraftStateView = { ...SNAKE_VIEW, phase: "scheduled", availablePlayerIds: [], onClockTeamId: null, upcoming: [], deadlineAt: null };
    const { rerender } = render(<RoomDock {...props} view={scheduled} />);
    expect(screen.queryByTestId("dock-clock")).toBeNull();

    // Paused: a frozen countdown is a false clock — the standing sentence beside it already
    // says "once picks resume", so the compact clock stands down entirely.
    const paused: DraftStateView = { ...SNAKE_VIEW, ...waiting, deadlineAt: new Date(Date.now() + 42_000).toISOString(), pausedUntil: new Date(Date.now() + 600_000).toISOString() };
    rerender(<RoomDock {...props} view={paused} />);
    expect(screen.queryByTestId("dock-clock")).toBeNull();
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
    expect(screen.getByTestId("dock-owed-pick")).// Fun pass, Task 4: "Make it whenever you are ready" was a softener on a sentence that
    // already carried no blame. The dock says what happened and what to do.
    toHaveTextContent("Your pick passed. Take it now.");
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

  // E11 (2026-08-26 design review): "Watching the board." over an empty, not-yet-started
  // board was a claim with nothing to watch. The scheduled phase gets its own sentence.
  it("waits for kickoff before the draft starts, instead of claiming to watch an empty board (E11)", () => {
    const scheduled: DraftStateView = { ...SNAKE_VIEW, phase: "scheduled", availablePlayerIds: [], onClockTeamId: null, upcoming: [], deadlineAt: null };
    render(<RoomDock {...props} view={scheduled} />);
    expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("Waiting for kickoff.");
    expect(screen.queryByText("Watching the board.")).toBeNull();
  });

  it("never strikes a queued player through before the draft has started", () => {
    const scheduled: DraftStateView = { ...SNAKE_VIEW, phase: "scheduled", availablePlayerIds: [], onClockTeamId: null, upcoming: [] };
    render(<RoomDock {...props} view={scheduled} />);
    expect(screen.queryByText("Already drafted")).toBeNull();
    expect(screen.getByText("Marcus Reed").className).not.toContain("line-through");
  });

  // E3 (2026-08-26 design review): below `lg` the pool linearizes after the whole board — a
  // 6,100–10,300px scroll away from the sticky dock — so "Your pick. Take somebody from the
  // pool." pointed at content nowhere near the screen. `lg:hidden` because at `lg+` the pool
  // is its own always-visible rail (`RoomLayout`); the affordance would point at something
  // already in view. Gated on `canAct` — this is an on-turn shortcut, not a standing nav item.
  describe("the 'Jump to the pool' affordance (E3)", () => {
    it("renders only while it is my turn to act", () => {
      const { rerender } = render(<RoomDock {...props} canAct={false} />);
      expect(screen.queryByRole("button", { name: "Jump to the pool" })).toBeNull();

      rerender(<RoomDock {...props} canAct />);
      expect(screen.getByRole("button", { name: "Jump to the pool" })).toBeInTheDocument();
    });

    it("carries lg:hidden — it is a mobile-only shortcut, redundant at lg where the pool is always visible", () => {
      render(<RoomDock {...props} canAct />);
      expect(screen.getByRole("button", { name: "Jump to the pool" }).className).toContain("lg:hidden");
    });

    it("scrolls the pool target into view, smoothly by default", () => {
      const pool = document.createElement("div");
      pool.id = "player-pool";
      document.body.appendChild(pool);
      const scrollIntoView = vi.fn();
      pool.scrollIntoView = scrollIntoView;

      render(<RoomDock {...props} canAct />);
      fireEvent.click(screen.getByRole("button", { name: "Jump to the pool" }));
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

      render(<RoomDock {...props} canAct />);
      fireEvent.click(screen.getByRole("button", { name: "Jump to the pool" }));
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });

      pool.remove();
      vi.unstubAllGlobals();
    });
  });
});
