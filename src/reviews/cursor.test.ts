import { describe, it, expect } from "vitest";
import { formatReviewCursor, parseReviewCursor } from "./cursor";

const CURSOR = { createdAt: "2026-08-19T12:00:00.000Z", id: "r1" };

describe("review cursor", () => {
  it("round-trips a cursor through its wire form", () => {
    expect(parseReviewCursor(formatReviewCursor(CURSOR))).toEqual(CURSOR);
  });

  it("carries the row id, not just the timestamp — the whole point of the compound key", () => {
    expect(formatReviewCursor(CURSOR)).toBe("2026-08-19T12:00:00.000Z|r1");
  });

  it("keeps an id containing the separator intact, splitting on the FIRST one only", () => {
    const odd = { createdAt: CURSOR.createdAt, id: "r1|extra" };
    expect(parseReviewCursor(formatReviewCursor(odd))).toEqual(odd);
  });

  it("refuses a bare timestamp with no id — the shape this feed handed out before ids joined the key", () => {
    expect(parseReviewCursor("2026-08-19T12:00:00.000Z")).toBeNull();
    expect(parseReviewCursor("2026-08-19T12:00:00.000Z|")).toBeNull();
  });

  it("refuses a timestamp that is not a full ISO instant", () => {
    expect(parseReviewCursor("2026-08-19|r1")).toBeNull();
    expect(parseReviewCursor("2026-08-19T12:00:00Z|r1")).toBeNull();
    expect(parseReviewCursor("not-a-date-at-all|r1")).toBeNull();
  });

  it("refuses an ISO-SHAPED timestamp that names no real instant", () => {
    // Passes the regex, fails `Date.parse` — the case that would reach `new Date(...)` as
    // `Invalid Date` and take a RangeError into the query layer.
    expect(parseReviewCursor("2026-13-45T99:00:00.000Z|r1")).toBeNull();
  });

  it("refuses an empty value and a leading separator", () => {
    expect(parseReviewCursor("")).toBeNull();
    expect(parseReviewCursor("|r1")).toBeNull();
  });
});
