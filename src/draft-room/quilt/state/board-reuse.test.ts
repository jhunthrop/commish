import { describe, expect, it } from "vitest";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { SNAKE_VIEW } from "../../test-fixtures";
import { buildQuiltRows, reuseQuiltRows } from "./board";

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

/** Two seats, NINE rounds (the fixture's three slot counts tripled), so a pick landing early
 *  leaves most of the board untouched — the case the reuse exists for. */
const view = (overrides: Partial<DraftStateView>): DraftStateView => ({
  ...SNAKE_VIEW,
  slotConfig: SNAKE_VIEW.slotConfig.map((slot) => ({ ...slot, count: slot.count * 3 })),
  ...overrides,
});

describe("reuseQuiltRows (a pick landing changes the rows it touched, never the board)", () => {
  it("hands back the previous array when nothing changed, even though every pick object is new", () => {
    const first = buildQuiltRows(view({ picks: [pick(1, 1, "t1", "qb1")], onClockTeamId: "t2" }), "t1");
    const again = buildQuiltRows(view({ picks: [pick(1, 1, "t1", "qb1")], onClockTeamId: "t2" }), "t1");
    expect(again).not.toBe(first);
    expect(reuseQuiltRows(first, again)).toBe(first);
  });

  it("keeps every round whose content did not change, by identity, and replaces exactly the rounds that did", () => {
    const before = buildQuiltRows(view({ picks: [pick(1, 1, "t1", "qb1")], onClockTeamId: "t2" }), "t1");
    const rebuilt = buildQuiltRows(view({ picks: [pick(1, 1, "t1", "qb1"), pick(2, 1, "t2", "rb1")], onClockTeamId: "t2" }), "t1");
    const after = reuseQuiltRows(before, rebuilt);
    expect(after).not.toBe(before);
    expect(after).toHaveLength(9);
    const changed = after.map((row, index) => JSON.stringify(row) !== JSON.stringify(before[index]));
    // Round 1 took the pick, round 2 became the active window (t2's clock), round 3 its track.
    expect(changed).toEqual([true, true, true, false, false, false, false, false, false]);
    after.forEach((row, index) => {
      if (changed[index]) expect(row).not.toBe(before[index]);
      else expect(row).toBe(before[index]);
    });
  });

  it("with no previous rows the next rows are taken as they are", () => {
    const rows = buildQuiltRows(view({}), "t1");
    expect(reuseQuiltRows(null, rows)).toBe(rows);
  });
});
