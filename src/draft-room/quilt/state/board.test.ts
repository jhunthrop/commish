import { describe, expect, it } from "vitest";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { SNAKE_VIEW } from "../../test-fixtures";
import { buildQuiltRows, pickLabel, totalRounds } from "./board";

const pick = (pickNumber: number, round: number, teamId: string, playerId: string): CompletedPick => ({
  pickNumber,
  round,
  teamId,
  playerId,
  slot: "RB",
  slotIndex: 0,
  price: null,
  timestamp: "2026-09-01T00:00:00.000Z",
  auto: false,
});

/** Two seats, three rounds (QB 1 + RB 2 in the fixture's slotConfig). */
const view = (overrides: Partial<DraftStateView>): DraftStateView => ({ ...SNAKE_VIEW, ...overrides });

describe("buildQuiltRows", () => {
  it("renders every round: the active window full, the next a track, the rest micro", () => {
    // Round 1 complete, round 2 underway (t2 picked first on the snake return, t2 on clock is
    // wrong — t2 picks 3rd overall; keep t2 on clock at its round-2 turn). The full window is
    // the active round plus the prior three, clamped at the start: round 2 shows two full rows.
    const picks = [pick(1, 1, "t1", "qb1"), pick(2, 1, "t2", "rb1"), pick(3, 2, "t2", "rb2")];
    const rows = buildQuiltRows(view({ picks, onClockTeamId: "t1", pickNumber: 4 }), "t1");
    expect(rows.map((row) => row.kind)).toEqual(["full", "full", "track"]);
    expect(rows).toHaveLength(totalRounds(SNAKE_VIEW));
  });

  it("at the draft's start the window clamps to the one existing round", () => {
    const rows = buildQuiltRows(view({ picks: [], onClockTeamId: "t1", pickNumber: 1 }), "t1");
    expect(rows.map((row) => row.kind)).toEqual(["full", "track", "micro"]);
  });

  it("mid-draft the window is the active round plus the prior three: round 7 keeps 4–7 full", () => {
    // Ten rounds (QB 1 + RB 9); both seats through round 6, t1 opening round 7.
    const slotConfig = [
      { slot: "QB", count: 1, eligiblePositions: ["QB"] },
      { slot: "RB", count: 9, eligiblePositions: ["RB"] },
    ] as const;
    const picks = Array.from({ length: 12 }, (_, index) =>
      pick(index + 1, Math.floor(index / 2) + 1, index % 2 === 0 ? "t1" : "t2", `p${index + 1}`),
    );
    const rows = buildQuiltRows(view({ slotConfig, picks, onClockTeamId: "t1", pickNumber: 13 }), "t1");
    expect(rows.map((row) => row.kind)).toEqual([
      "micro",
      "micro",
      "micro",
      "full",
      "full",
      "full",
      "full",
      "track",
      "micro",
      "micro",
    ]);
  });

  it("marks the on-clock cell in the team's own next round", () => {
    const picks = [pick(1, 1, "t1", "qb1")];
    const rows = buildQuiltRows(view({ picks, onClockTeamId: "t2", pickNumber: 2 }), null);
    const round1 = rows[0]!;
    expect(round1.kind).toBe("full");
    expect(round1.cells.find((cell) => cell.teamId === "t2")?.onClock).toBe(true);
    expect(round1.cells.find((cell) => cell.teamId === "t1")?.pick?.playerId).toBe("qb1");
  });

  it("labels my own upcoming cells with the snake pick number", () => {
    const rows = buildQuiltRows(view({ picks: [], onClockTeamId: "t1", pickNumber: 1 }), "t2");
    // t2 holds seat 2: pick 1.02 forward, 2.01 on the snake return.
    expect(rows[0]!.cells.find((cell) => cell.teamId === "t2")?.yourPickLabel).toBe(pickLabel(1, 2));
    expect(rows[1]!.cells.find((cell) => cell.teamId === "t2")?.yourPickLabel).toBe(pickLabel(2, 1));
    // The on-clock cell is never doubly labeled as mine.
    expect(rows[0]!.cells.find((cell) => cell.teamId === "t1")?.yourPickLabel).toBeNull();
  });

  it("never labels rounds a team has already filled", () => {
    const picks = [pick(1, 1, "t1", "qb1")];
    const rows = buildQuiltRows(view({ picks, onClockTeamId: "t2", pickNumber: 2 }), "t1");
    expect(rows[0]!.cells.find((cell) => cell.teamId === "t1")?.yourPickLabel).toBeNull();
    expect(rows[1]!.cells.find((cell) => cell.teamId === "t1")?.yourPickLabel).toBe(pickLabel(2, 2));
  });
});
