import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { GameStateChip, NOT_STARTED_DASH, pointsForGameState, type GameState } from "./game-state-chip";

const LIVE: GameState = { kind: "live", quarter: "Q3", clock: "8:42" };
const FINAL: GameState = { kind: "final" };
const SCHEDULED: GameState = { kind: "scheduled", kickoff: "4:25 ET" };

/**
 * THE DASH RULE, held at the vocabulary rather than at a surface (the Gameday spec): *"A player
 * who has not played reads as a dash and a kickoff time, never a zero. Folding 'has not played'
 * into 'scored nothing' is the most common lie a fantasy scoreboard tells."*
 *
 * The lie matters because a manager acts on it: `0.0` beside a player says he was on the field and
 * produced nothing, which is a start/sit decision's whole input. These tests are what stop the
 * next surface from passing its raw `0` straight through because the column happened to be typed
 * as a number.
 */
describe("pointsForGameState", () => {
  it("renders a scheduled player's points as a dash, never a zero", () => {
    expect(pointsForGameState(SCHEDULED, "0.0")).toBe(NOT_STARTED_DASH);
    // Whatever the caller is holding: a stored zero, an empty string, a stale figure. The state
    // decides, not the number.
    expect(pointsForGameState(SCHEDULED, "12.4")).toBe(NOT_STARTED_DASH);
  });

  it("prints a real zero once the game is under way, because then it is a fact", () => {
    // He played and did nothing — that IS the number, and dashing it would hide a bad afternoon.
    expect(pointsForGameState(LIVE, "0.0")).toBe("0.0");
    expect(pointsForGameState(FINAL, "0.0")).toBe("0.0");
    expect(pointsForGameState(LIVE, "12.4")).toBe("12.4");
    expect(pointsForGameState(FINAL, "12.4")).toBe("12.4");
  });
});

describe("GameStateChip", () => {
  it("reads a live game as its quarter and clock", async () => {
    await renderSurface(<GameStateChip state={LIVE} />, ({ container }) => {
      const chip = container.querySelector("[data-game-state]")!;
      expect(chip.getAttribute("data-game-state")).toBe("live");
      expect(chip.textContent).toContain("Q3 · 8:42");
    });
  });

  it("reads a finished game as Final and a scheduled one as its kickoff", async () => {
    await renderSurface(<GameStateChip state={FINAL} />, ({ getByText }) => {
      expect(getByText(/Final/)).toBeInTheDocument();
    });
    await renderSurface(<GameStateChip state={SCHEDULED} />, ({ container }) => {
      expect(container.querySelector("[data-game-state]")!.textContent).toContain("4:25 ET");
    });
  });

  it("gives each state its own ink from the legend, live in the live family", async () => {
    // Law 1: one meaning per channel. Live borrows the same pigment the rail's my-turn state and
    // the countdown's hot tone already spend, so "happening now" is one colour product-wide.
    const cases = [
      { state: LIVE, ink: "text-negative" },
      { state: FINAL, ink: "text-text-faint" },
      { state: SCHEDULED, ink: "text-text-muted" },
    ] as const;
    for (const { state, ink } of cases) {
      await renderSurface(<GameStateChip state={state} />, ({ container }) => {
        expect(container.querySelector("[data-game-state]")!.className).toContain(ink);
      });
    }
  });

  it("names the two states a screen reader would otherwise hear as bare numbers", async () => {
    // "Q3 · 8:42" and "4:25 ET" are legible on screen because of where they sit and what colour
    // they are. Both channels are gone by the time the string is announced.
    await renderSurface(<GameStateChip state={LIVE} />, ({ getByText }) => {
      expect(getByText(/Live,/).className).toContain("sr-only");
    });
    await renderSurface(<GameStateChip state={SCHEDULED} />, ({ getByText }) => {
      expect(getByText(/Kickoff/).className).toContain("sr-only");
    });
  });

  it("contains its own screen-reader lead, so a table of these cannot stretch the page", async () => {
    // `Stat`'s hard-won lesson, applied before it can cost a second e2e cycle: an `sr-only` box
    // with no positioned ancestor takes the initial containing block and extends the ROOT
    // scrollable area past every `overflow: hidden` between it and the page.
    await renderSurface(<GameStateChip state={LIVE} />, ({ container }) => {
      expect(container.querySelector("[data-game-state]")!.className).toMatch(/(^|\s)relative(\s|$)/);
    });
  });

  it("stays on one line, because a clock broken across two reads as a bug", async () => {
    await renderSurface(<GameStateChip state={LIVE} />, ({ container }) => {
      expect(container.querySelector("[data-game-state]")!.className).toContain("whitespace-nowrap");
    });
  });

  it("is axe-clean in both themes, in every state", async () => {
    for (const state of [LIVE, FINAL, SCHEDULED]) {
      await renderSurface(<GameStateChip state={state} />, async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      });
    }
  });
});
