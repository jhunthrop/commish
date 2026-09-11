import { afterEach, describe, it, expect, vi } from "vitest";
import { FALLBACK_TIME_ZONE, byDay, dayKey, dayMarker, type ReaderClock } from "./day-chapters";

const NOW = new Date(2026, 8, 10, 15, 0, 0);
const CLOCK: ReaderClock = { nowMs: NOW.getTime(), locale: "en-US", timeZone: "America/Los_Angeles" };
/** Noon on 10 September wherever the reader is: the same day in every zone, so a case that is
 *  about Today/Yesterday is not secretly also about a zone boundary. */
const NOON = new Date(Date.UTC(2026, 8, 10, 19, 0)).toISOString();

afterEach(() => {
  vi.useRealTimers();
});

describe("dayMarker", () => {
  it("says Today and Yesterday, and names an older day", () => {
    const clock: ReaderClock = { nowMs: new Date(Date.UTC(2026, 8, 10, 22, 0)).getTime(), locale: "en-US", timeZone: "UTC" };
    expect(dayMarker(new Date(Date.UTC(2026, 8, 10, 9, 0)).toISOString(), clock)).toBe("Today");
    expect(dayMarker(new Date(Date.UTC(2026, 8, 9, 23, 59)).toISOString(), clock)).toBe("Yesterday");
    expect(dayMarker(new Date(Date.UTC(2026, 8, 2, 12, 0)).toISOString(), clock)).toMatch(/September 2/);
  });

  // THE LEDGERED M1 FOLLOW-UP. The marker used to read `new Date()` and an implicit locale at
  // render, so its output depended on when React drew and on which environment drew it — the two
  // inputs a server render and a client hydration disagree about. All three are now arguments.
  it("ignores the wall clock entirely: the same instant and the same reader clock is the same word", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 1, 4, 0, 0));
    const drawnInTheFuture = dayMarker(NOON, CLOCK);
    vi.setSystemTime(new Date(2020, 5, 5, 22, 0, 0));
    const drawnInThePast = dayMarker(NOON, CLOCK);
    expect(drawnInTheFuture).toBe("Today");
    expect(drawnInThePast).toBe("Today");
  });

  it("takes the locale from the clock rather than the environment", () => {
    const iso = new Date(Date.UTC(2026, 8, 2, 19, 0)).toISOString();
    expect(dayMarker(iso, { ...CLOCK, locale: "en-US" })).toMatch(/September 2/);
    expect(dayMarker(iso, { ...CLOCK, locale: "de-DE" })).toMatch(/September 2026|2\. September/);
  });

  it("makes no relative claim when no clock was passed, and says so the same way every time", () => {
    expect(dayMarker(NOON, null)).not.toBe("Today");
    expect(dayMarker(NOON, null)).toMatch(/September 10/);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 1));
    expect(dayMarker(NOON, null)).toMatch(/September 10/);
  });

  /**
   * THE ZONE IS AN ARGUMENT TOO (the whole-branch review, H4). Pinning the locale without pinning
   * the zone left the exact mismatch the fix was for: an instant near midnight resolves to two
   * different calendar days in two different runtimes, so a UTC server and a Pacific client
   * disagree on the very render pass that has to agree byte for byte.
   *
   * 06:00 UTC on 11 September is 23:00 on 10 September in Los Angeles. One instant, two days.
   */
  const NEAR_MIDNIGHT = new Date(Date.UTC(2026, 8, 11, 6, 0)).toISOString();

  it("resolves an instant near midnight in the zone it was handed, not the runtime's", () => {
    // A clock well clear of both candidate days, so neither side can answer "Yesterday" and
    // the assertion is about the DAY each zone resolves rather than about the relative words.
    const utc: ReaderClock = { nowMs: new Date(Date.UTC(2026, 8, 20, 18, 0)).getTime(), locale: "en-US", timeZone: "UTC" };
    const pacific: ReaderClock = { ...utc, timeZone: "America/Los_Angeles" };
    expect(dayMarker(NEAR_MIDNIGHT, utc)).toMatch(/September 11/);
    expect(dayMarker(NEAR_MIDNIGHT, pacific)).toMatch(/September 10/);
  });

  it("counts Today and Yesterday in the reader's own zone", () => {
    // 23:00 Pacific on the 10th: "today" for a Pacific reader whose clock says 23:30 that night,
    // and "yesterday" for a UTC reader for whom the 11th began an hour ago.
    const pacific: ReaderClock = { nowMs: new Date(Date.UTC(2026, 8, 11, 6, 30)).getTime(), locale: "en-US", timeZone: "America/Los_Angeles" };
    const utc: ReaderClock = { ...pacific, timeZone: "UTC" };
    expect(dayMarker(NEAR_MIDNIGHT, pacific)).toBe("Today");
    expect(dayMarker(NEAR_MIDNIGHT, utc)).toBe("Today");
    // An hour earlier in Pacific terms is still the 10th there, and already the 11th in UTC.
    const justBefore = new Date(Date.UTC(2026, 8, 11, 5, 0)).toISOString();
    expect(dayMarker(justBefore, { ...pacific, nowMs: new Date(Date.UTC(2026, 8, 12, 6, 30)).getTime() })).toBe("Yesterday");
  });

  it("falls back to UTC when nothing has told it the reader's zone", () => {
    expect(FALLBACK_TIME_ZONE).toBe("UTC");
    expect(dayMarker(NEAR_MIDNIGHT, null)).toMatch(/September 11/);
  });
});

describe("dayKey", () => {
  it("keys the calendar day in the zone it was handed", () => {
    const iso = new Date(Date.UTC(2026, 8, 11, 6, 0)).toISOString();
    expect(dayKey(iso, "UTC")).toBe("2026-09-11");
    expect(dayKey(iso, "America/Los_Angeles")).toBe("2026-09-10");
  });
});

describe("byDay", () => {
  it("folds adjacent rows on the same day into one chapter and never reorders them", () => {
    const rows = [
      { id: "a", occurredAt: new Date(Date.UTC(2026, 8, 10, 16, 0)).toISOString() },
      { id: "b", occurredAt: new Date(Date.UTC(2026, 8, 10, 15, 0)).toISOString() },
      { id: "c", occurredAt: new Date(Date.UTC(2026, 8, 9, 20, 0)).toISOString() },
      { id: "d", occurredAt: new Date(Date.UTC(2026, 8, 10, 14, 0)).toISOString() },
    ];
    const chapters = byDay(rows, "UTC");
    expect(chapters.map((chapter) => chapter.rows.map((row) => row.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(chapters[0]!.key).toBe(dayKey(rows[0]!.occurredAt, "UTC"));
  });

  // The grouping is the other half of H4: two runtimes that disagree about which day an instant
  // fell on also disagree about how many chapters there are, which is a DOM shape mismatch rather
  // than a text one.
  it("groups an instant near midnight into the chapter its own zone puts it in", () => {
    const rows = [
      { id: "late", occurredAt: new Date(Date.UTC(2026, 8, 11, 6, 0)).toISOString() },
      { id: "earlier", occurredAt: new Date(Date.UTC(2026, 8, 11, 3, 0)).toISOString() },
    ];
    expect(byDay(rows, "UTC").map((c) => c.rows.length)).toEqual([2]);
    // In Los Angeles the first is 23:00 on the 10th and the second 20:00 on the 10th: still one
    // chapter, but a DIFFERENT one, and the key says so.
    expect(byDay(rows, "America/Los_Angeles")[0]!.key).toBe("2026-09-10");
    expect(byDay(rows, "UTC")[0]!.key).toBe("2026-09-11");
  });

  it("answers no chapters for no rows, and leaves its input untouched", () => {
    const rows = [{ occurredAt: NOON }];
    expect(byDay([], "UTC")).toEqual([]);
    byDay(rows, "UTC");
    expect(rows).toHaveLength(1);
  });
});
