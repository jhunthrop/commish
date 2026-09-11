import { afterEach, describe, it, expect, vi } from "vitest";
import { byDay, dayKey, dayMarker, type ReaderClock } from "./day-chapters";

const NOW = new Date(2026, 8, 10, 15, 0, 0);
const CLOCK: ReaderClock = { nowMs: NOW.getTime(), locale: "en-US" };

afterEach(() => {
  vi.useRealTimers();
});

describe("dayMarker", () => {
  it("says Today and Yesterday, and names an older day", () => {
    expect(dayMarker(new Date(2026, 8, 10, 9, 0).toISOString(), CLOCK)).toBe("Today");
    expect(dayMarker(new Date(2026, 8, 9, 23, 59).toISOString(), CLOCK)).toBe("Yesterday");
    expect(dayMarker(new Date(2026, 8, 2, 12, 0).toISOString(), CLOCK)).toMatch(/September 2/);
  });

  // THE LEDGERED M1 FOLLOW-UP. The marker used to read `new Date()` and an implicit locale at
  // render, so its output depended on when React drew and on which environment drew it — the two
  // inputs a server render and a client hydration disagree about. Both are now arguments, and
  // these three cases are what "deterministic" has to mean for it.
  it("ignores the wall clock entirely: the same instant and the same reader clock is the same word", () => {
    const iso = new Date(2026, 8, 10, 9, 0).toISOString();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 1, 4, 0, 0));
    const drawnInTheFuture = dayMarker(iso, CLOCK);
    vi.setSystemTime(new Date(2020, 5, 5, 22, 0, 0));
    const drawnInThePast = dayMarker(iso, CLOCK);
    expect(drawnInTheFuture).toBe("Today");
    expect(drawnInThePast).toBe("Today");
  });

  it("takes the locale from the clock rather than the environment", () => {
    const iso = new Date(2026, 8, 2, 12, 0).toISOString();
    expect(dayMarker(iso, { ...CLOCK, locale: "en-US" })).toMatch(/September 2/);
    expect(dayMarker(iso, { ...CLOCK, locale: "de-DE" })).toMatch(/September 2026|2\. September/);
  });

  it("makes no relative claim when no clock was passed, and says so the same way every time", () => {
    const iso = new Date(2026, 8, 10, 9, 0).toISOString();
    // The day it actually is, never "Today": nothing told this render whose day it is.
    expect(dayMarker(iso, null)).not.toBe("Today");
    expect(dayMarker(iso, null)).toMatch(/September 10/);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 1));
    expect(dayMarker(iso, null)).toMatch(/September 10/);
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
