import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { MOTION } from "@/design/motion";
import { PLAYERS, SNAKE_VIEW, TEAMS } from "../../test-fixtures";
import { QuiltBoard } from "./quilt-board";
import { settleClassFor } from "./quilt-cell";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

afterEach(() => {
  vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
});

const playersById = new Map(PLAYERS.map((player) => [player.id, player]));
const pick = (pickNumber: number, round: number, teamId: string, playerId: string): CompletedPick => ({
  pickNumber,
  round,
  teamId,
  playerId,
  slot: "QB",
  slotIndex: 0,
  price: null,
  timestamp: "2026-09-01T00:00:00.000Z",
  auto: false,
});
/** Two seats, nine rounds, so a pick landing early leaves most of the board untouched. */
const view = (picks: readonly CompletedPick[], onClockTeamId: string): DraftStateView => ({
  ...SNAKE_VIEW,
  slotConfig: SNAKE_VIEW.slotConfig.map((slot) => ({ ...slot, count: slot.count * 3 })),
  picks,
  onClockTeamId,
  deadlineAt: "2026-09-01T00:01:00.000Z",
});

function renderBoard(state: DraftStateView) {
  return render(<QuiltBoard view={state} teams={TEAMS} playersById={playersById} myTeamId="t1" lens="picks" byeWeeks={new Map()} boardRanks={new Map()} onPeek={() => {}} peekedPlayerId={null} />);
}

describe("settleClassFor", () => {
  it("is nothing for a pick already on the board at mount, the settle for a landing, opacity-only under reduced motion", () => {
    expect(settleClassFor(false, false)).toBe("");
    expect(settleClassFor(false, true)).toBe("");
    expect(settleClassFor(true, false)).toBe(MOTION.settle.className);
    expect(settleClassFor(true, true)).toBe(MOTION.settleStill.className);
  });
});

describe("a pick landing is one cell settling, not a board repaint", () => {
  it("picks on the board at mount do not animate; the one that lands afterwards settles", () => {
    const first = pick(1, 1, "t1", "qb1");
    const { rerender } = renderBoard(view([first], "t2"));
    expect(screen.getByTestId("quilt-pick-cell")).not.toHaveAttribute("data-settle");

    rerender(<QuiltBoard view={view([first, pick(2, 1, "t2", "rb1")], "t2")} teams={TEAMS} playersById={playersById} myTeamId="t1" lens="picks" byeWeeks={new Map()} boardRanks={new Map()} onPeek={() => {}} peekedPlayerId={null} />);
    const cells = screen.getAllByTestId("quilt-pick-cell");
    expect(cells).toHaveLength(2);
    expect(cells[0]).not.toHaveAttribute("data-settle");
    expect(cells[1]).toHaveAttribute("data-settle", "landing");
    expect(cells[1]!.className).toContain(MOTION.settle.className);
  });

  it("under reduced motion the landing cell fades without moving", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const first = pick(1, 1, "t1", "qb1");
    const { rerender } = renderBoard(view([first], "t2"));
    rerender(<QuiltBoard view={view([first, pick(2, 1, "t2", "rb1")], "t2")} teams={TEAMS} playersById={playersById} myTeamId="t1" lens="picks" byeWeeks={new Map()} boardRanks={new Map()} onPeek={() => {}} peekedPlayerId={null} />);
    const landed = screen.getAllByTestId("quilt-pick-cell")[1]!;
    expect(landed.className).toContain(MOTION.settleStill.className);
    expect(landed.className).not.toContain(MOTION.settle.className);
  });

  it("a landing pick mutates the DOM only inside the rounds it touched; every other round's subtree is untouched", async () => {
    const first = pick(1, 1, "t1", "qb1");
    const { rerender, container } = renderBoard(view([first], "t2"));
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((delivered) => records.push(...delivered));
    observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });
    rerender(<QuiltBoard view={view([first, pick(2, 1, "t2", "rb1")], "t2")} teams={TEAMS} playersById={playersById} myTeamId="t1" lens="picks" byeWeeks={new Map()} boardRanks={new Map()} onPeek={() => {}} peekedPlayerId={null} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(records.length).toBeGreaterThan(0);
    const touchedRounds = new Set(
      records.map((record) => {
        const node = record.target instanceof Element ? record.target : record.target.parentElement;
        return node?.closest("[data-testid^='quilt-round-']")?.getAttribute("data-testid") ?? "outside";
      }),
    );
    // Pick 2 lands in round 1, t2's clock moves round 2 into the window (the snake turn) and
    // round 3 becomes its track; rounds 4 to 9 are not touched at all.
    expect([...touchedRounds].sort()).toEqual(["quilt-round-1", "quilt-round-2", "quilt-round-3"]);
  });
});
