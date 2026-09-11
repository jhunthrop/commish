import { describe, it, expect } from "vitest";
import { byDay, dayKey, dayMarker } from "./day-chapters";

const NOW = new Date(2026, 8, 10, 15, 0, 0);

describe("dayMarker", () => {
  it("says Today and Yesterday, and names an older day", () => {
    expect(dayMarker(new Date(2026, 8, 10, 9, 0).toISOString(), NOW)).toBe("Today");
    expect(dayMarker(new Date(2026, 8, 9, 23, 59).toISOString(), NOW)).toBe("Yesterday");
    expect(dayMarker(new Date(2026, 8, 2, 12, 0).toISOString(), NOW)).toMatch(/September 2/);
  });
});

describe("byDay", () => {
  it("folds adjacent rows on the same day into one chapter and never reorders them", () => {
    const rows = [
      { id: "a", occurredAt: new Date(2026, 8, 10, 9, 0).toISOString() },
      { id: "b", occurredAt: new Date(2026, 8, 10, 8, 0).toISOString() },
      { id: "c", occurredAt: new Date(2026, 8, 9, 20, 0).toISOString() },
      { id: "d", occurredAt: new Date(2026, 8, 10, 7, 0).toISOString() },
    ];
    const chapters = byDay(rows);
    expect(chapters.map((chapter) => chapter.rows.map((row) => row.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(chapters[0]!.key).toBe(dayKey(rows[0]!.occurredAt));
  });

  it("answers no chapters for no rows, and leaves its input untouched", () => {
    const rows = [{ occurredAt: NOW.toISOString() }];
    expect(byDay([])).toEqual([]);
    byDay(rows);
    expect(rows).toHaveLength(1);
  });
});
