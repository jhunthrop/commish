import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deadlineAfter, MS_PER_HOUR, pausedMillisBetween, pausedUntil, type PauseWindow } from "./pause";

const ET: PauseWindow = { zone: "America/New_York", startHour: 2, endHour: 5, appliesAtOrAbovePickSeconds: 60 * 60 };

/** Runs `fn` with `process.env.TZ` set to `tz`, restoring whatever was there before — the
 *  mechanism behind "reads no ambient clock and no ambient zone" below. */
function underTz<T>(tz: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

describe("deadlineAfter", () => {
  it("pushes a deadline that would land inside the window out to the far side of it", () => {
    // A four-hour pick clock started at 11:30 PM ET would expire at 3:30 AM ET, inside the freeze.
    // Awake time is what the manager actually gets: 11:30 PM to 2:00 AM is two and a half hours,
    // and the remaining ninety minutes run from 5:00 AM. The answer is a FIXPOINT, not one
    // addition: the first extension pushes the deadline INTO the rest of the window, so the
    // overlap has to be recomputed against the moved deadline until it stops moving.
    expect(deadlineAfter("2026-09-15T03:30:00.000Z", 4 * 60 * 60, ET)) // 11:30 PM ET on the 14th
      .toBe("2026-09-15T10:30:00.000Z"); //  6:30 AM ET, 4h of awake time
  });

  it("does not move a deadline that never touches the window", () => {
    expect(deadlineAfter("2026-09-15T14:00:00.000Z", 60 * 60, ET)).toBe("2026-09-15T15:00:00.000Z");
  });

  it("extends across two windows when a clock is long enough to span a whole day", () => {
    // An eight-hour clock started at 1 AM ET crosses one window; the extension itself cannot
    // reach the next one, and the fixpoint is what proves that rather than assuming it.
    expect(deadlineAfter("2026-09-15T05:00:00.000Z", 8 * 60 * 60, ET)).toBe("2026-09-15T16:00:00.000Z");
  });

  it("reads no ambient clock and no ambient zone", () => {
    // Every input is an argument. The test runs under TZ=UTC and TZ=Australia/Sydney and gets
    // identical answers, which is the property that lets a pure engine own a timezone at all.
    const start = "2026-09-15T03:30:00.000Z";
    expect(underTz("Australia/Sydney", () => deadlineAfter(start, 4 * 60 * 60, ET))).toBe(
      underTz("UTC", () => deadlineAfter(start, 4 * 60 * 60, ET)),
    );
  });

  it("extends a deadline that starts exactly at the window's open", () => {
    // 2:00 AM ET on 9/15 is 06:00Z. A ten-minute clock starting exactly there is entirely
    // inside the freeze, so the whole 10 minutes runs after the window closes at 5 AM.
    expect(deadlineAfter("2026-09-15T06:00:00.000Z", 10 * 60, ET)).toBe("2026-09-15T09:10:00.000Z");
  });

  it("does not extend a deadline that starts exactly at the window's close", () => {
    // 5:00 AM ET (09:00Z) is the window's exclusive end — a clock starting there never
    // touches the freeze at all.
    expect(deadlineAfter("2026-09-15T09:00:00.000Z", 10 * 60, ET)).toBe("2026-09-15T09:10:00.000Z");
  });

  it("survives spring forward, where 2 AM does not exist", () => {
    // 8 March 2026, the US spring-forward date: clocks jump 2 AM to 3 AM ET, so the window is
    // one hour shorter that night. A clock starting at 1 AM ET (06:00Z) that would otherwise run
    // 90 minutes into the shortened, 2-hour freeze comes out the other side at 5 AM plus however
    // much of the 90 minutes the freeze actually absorbed.
    expect(deadlineAfter("2026-03-08T06:00:00.000Z", 90 * 60, ET)).toBe("2026-03-08T09:30:00.000Z");
  });

  it("throws rather than spin forever against a window that never lets go", () => {
    // A window covering the entire local day (0-24) never releases a clock: every candidate
    // deadline is itself still inside the window, so the fixpoint's own "paused so far" keeps
    // growing without ever converging. This is the pathological config the iteration ceiling
    // exists for, not a case any deploy of `DRAFT_PAUSE_WINDOW` could ever produce.
    const allDay: PauseWindow = { zone: "America/New_York", startHour: 0, endHour: 24, appliesAtOrAbovePickSeconds: 0 };
    expect(() => deadlineAfter("2026-09-15T14:00:00.000Z", 60, allDay)).toThrow(/did not converge/);
  });
});

describe("pausedMillisBetween", () => {
  it("survives spring forward, where 2 AM does not exist", () => {
    // 8 March 2026: clocks jump 2 AM to 3 AM ET, so the window is one hour shorter that night.
    // The freeze runs 3 AM to 5 AM local, which is the honest answer and the one this test pins
    // rather than a silent hour of extra clock.
    expect(pausedMillisBetween("2026-03-08T06:00:00.000Z", "2026-03-08T11:00:00.000Z", ET)).toBe(2 * MS_PER_HOUR);
  });

  it("survives fall back, where 1 AM happens twice", () => {
    // 1 November 2026: the window is a normal three hours because it starts after the repeat.
    expect(pausedMillisBetween("2026-11-01T05:00:00.000Z", "2026-11-01T11:00:00.000Z", ET)).toBe(3 * MS_PER_HOUR);
  });

  it("is zero for an empty or backwards range", () => {
    expect(pausedMillisBetween("2026-09-15T06:30:00.000Z", "2026-09-15T06:30:00.000Z", ET)).toBe(0);
    expect(pausedMillisBetween("2026-09-15T09:00:00.000Z", "2026-09-15T06:30:00.000Z", ET)).toBe(0);
  });

  it("sums the freeze across two separate nights in one range", () => {
    // 9/15 10 PM ET through 9/17 10 PM ET spans two full overnight windows (9/16 and 9/17's own
    // 2-5 AM occurrences) and misses 9/15's (already past when the range starts).
    const from = "2026-09-16T02:00:00.000Z"; // 10 PM ET on 9/15
    const to = "2026-09-18T02:00:00.000Z"; // 10 PM ET on 9/17
    expect(pausedMillisBetween(from, to, ET)).toBe(2 * 3 * MS_PER_HOUR);
  });

  it("reads a fractional-offset zone correctly, not just whole-hour ones", () => {
    // India Standard Time is UTC+5:30 — proof `zoneOffsetMinutes` parses the ":30" and isn't
    // only ever exercised against America/New_York's whole-hour offsets.
    const ist: PauseWindow = { zone: "Asia/Kolkata", startHour: 2, endHour: 5, appliesAtOrAbovePickSeconds: 0 };
    // 2 AM IST on 9/15 is 2026-09-14T20:30:00.000Z; 5 AM IST is 2026-09-14T23:30:00.000Z.
    expect(pausedMillisBetween("2026-09-14T20:30:00.000Z", "2026-09-14T23:30:00.000Z", ist)).toBe(3 * MS_PER_HOUR);
  });

  it("reads UTC itself correctly — the bare 'GMT' offset string, not 'GMT+n'", () => {
    const utc: PauseWindow = { zone: "UTC", startHour: 2, endHour: 5, appliesAtOrAbovePickSeconds: 0 };
    expect(pausedMillisBetween("2026-09-15T02:00:00.000Z", "2026-09-15T05:00:00.000Z", utc)).toBe(3 * MS_PER_HOUR);
    expect(pausedMillisBetween("2026-09-15T05:00:00.000Z", "2026-09-15T06:00:00.000Z", utc)).toBe(0);
  });

  it("reads a positive whole-hour offset with no minutes component too", () => {
    const jst: PauseWindow = { zone: "Asia/Tokyo", startHour: 2, endHour: 5, appliesAtOrAbovePickSeconds: 0 };
    // 2 AM JST on 9/15 is 2026-09-14T17:00:00.000Z; 5 AM JST is 2026-09-14T20:00:00.000Z.
    expect(pausedMillisBetween("2026-09-14T17:00:00.000Z", "2026-09-14T20:00:00.000Z", jst)).toBe(3 * MS_PER_HOUR);
  });

  it("rejects a timestamp that isn't a real ISO instant", () => {
    expect(() => pausedMillisBetween("not-a-date", "2026-09-15T06:00:00.000Z", ET)).toThrow(/ISO timestamp/);
    expect(() => pausedMillisBetween("2026-09-15T06:00:00.000Z", "not-a-date", ET)).toThrow(/ISO timestamp/);
  });
});

describe("pausedUntil", () => {
  it("is null before the window opens", () => {
    expect(pausedUntil("2026-09-15T05:59:00.000Z", ET)).toBeNull(); // 1:59 AM ET
  });

  it("resumes exactly at the window's open, inclusive", () => {
    expect(pausedUntil("2026-09-15T06:00:00.000Z", ET)).toBe("2026-09-15T09:00:00.000Z"); // 2:00 AM ET
  });

  it("is still paused one instant before the window's close", () => {
    expect(pausedUntil("2026-09-15T08:59:59.999Z", ET)).toBe("2026-09-15T09:00:00.000Z");
  });

  it("is null exactly at the window's close, exclusive", () => {
    expect(pausedUntil("2026-09-15T09:00:00.000Z", ET)).toBeNull(); // 5:00 AM ET
  });

  it("is null well after the window closes", () => {
    expect(pausedUntil("2026-09-15T14:00:00.000Z", ET)).toBeNull();
  });
});

describe("the pause stays out of the reducer", () => {
  // `reduce.ts`, `snake.ts` and `auction.ts` decide what an action DOES; `apply-pick.ts` is the
  // shared pick-application helper they both call. `admit.ts` and `selectors.ts` decide whether
  // a command is allowed and what a viewer sees. A pause window read on the first list would
  // mean a deploy that shifted the window turned every persisted TIMER_EXPIRE inside it into a
  // different outcome on replay, which is the exact failure the 60s to 90s clock-floor change
  // caused once already (`admit.ts`'s own docblock).
  const REDUCER_FILES = ["reduce.ts", "snake.ts", "auction.ts", "apply-pick.ts"].map((file) => join(__dirname, file));

  it("keeps the pause out of the reducer, because a changed window must never break replay", () => {
    for (const file of REDUCER_FILES) {
      expect(readFileSync(file, "utf8")).not.toMatch(/pauseWindow|deadlineAfter|pausedUntil|pausedMillisBetween/);
    }
  });
});
