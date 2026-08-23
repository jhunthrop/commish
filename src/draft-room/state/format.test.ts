import { describe, it, expect } from "vitest";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
/**
 * Test-only cross-check that `rosterSpots` agrees with the engine's own `totalRosterSlots`;
 * this file never ships to the browser bundle, so the "no server-only values in draft-room
 * client code" rule doesn't apply to the risk it guards against.
 */
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { totalRosterSlots } from "@/draft-engine";
import { formatCountdown, formatClockLength, formatCoarseRemaining, formatGap, formatPausedUntil, formatTightening, formatYourTurn, rosterSpots } from "./format";

describe("formatCountdown", () => {
  it.each([
    [0, "0:00"],
    [-5_000, "0:00"],
    [9_400, "0:10"],
    [125_000, "2:05"],
    [3_849_000, "1:04:09"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});

describe("formatClockLength", () => {
  it.each([
    [8 * 60 * 60, "8 hours"],
    [60 * 60, "1 hour"],
    [10 * 60, "10 minutes"],
    [60, "1 minute"],
    [45, "45 seconds"],
    [1, "1 second"],
    [90, "90 seconds"],
  ])("renders %i seconds as %s", (seconds, expected) => {
    expect(formatClockLength(seconds)).toBe(expected);
  });
});

describe("formatCoarseRemaining", () => {
  it.each([
    [0, "Under a minute left"],
    [-5_000, "Under a minute left"],
    [59_000, "Under a minute left"],
    [60_000, "About 1 minute left"],
    [125_000, "About 2 minutes left"],
    [3_599_999, "About 60 minutes left"],
    [3_600_000, "About 1 hour left"],
    [8 * 3_600_000, "About 8 hours left"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatCoarseRemaining(ms)).toBe(expected);
  });

  it("rounds rather than truncates, so it agrees with what a human would say", () => {
    // 89 999 ms is 1.4999... minutes — rounds down to "1 minute", not up to "2".
    expect(formatCoarseRemaining(89_999)).toBe("About 1 minute left");
  });
});

describe("formatGap", () => {
  it.each([
    [0, "under a minute"],
    [-10, "under a minute"],
    [59_000, "under a minute"],
    [14 * 60_000, "14m"],
    [134 * 60_000, "2h 14m"],
  ])("renders %i ms as %s", (ms, expected) => {
    expect(formatGap(ms)).toBe(expected);
  });
});

describe("formatTightening", () => {
  it("is null when nothing is scheduled to change", () => {
    expect(formatTightening(null, 0)).toBeNull();
  });

  it("says what it shortens to and when", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    expect(formatTightening({ at: "2026-09-01T02:14:00.000Z", pickSeconds: 600 }, now)).toBe("Picks shorten to 10 minutes in 2h 14m");
  });

  it("routes an ETA that would land inside the freeze out to when picks resume instead", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    // The threshold itself (02:14 UTC) falls before `pausedUntil` (09:00 UTC) — an ETA that
    // ignored the freeze would undercount by nearly seven hours.
    expect(
      formatTightening({ at: "2026-09-01T02:14:00.000Z", pickSeconds: 600 }, now, "2026-09-01T09:00:00.000Z"),
    ).toBe("Picks shorten to 10 minutes in 9h 0m");
  });

  it("leaves the ETA alone when the threshold already lands after the freeze lifts", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    expect(
      formatTightening({ at: "2026-09-01T10:00:00.000Z", pickSeconds: 600 }, now, "2026-09-01T09:00:00.000Z"),
    ).toBe("Picks shorten to 10 minutes in 10h 0m");
  });
});

describe("formatPausedUntil", () => {
  it("says when picks resume, in Eastern time, regardless of the reader's own zone", () => {
    // 09:00 UTC in September is 5:00 AM EDT.
    expect(formatPausedUntil("2026-09-15T09:00:00.000Z")).toBe("Picks are paused until 5:00 AM Eastern. You can still make yours.");
  });

  it("reads correctly across a DST boundary too, since it always asks Eastern time, not a fixed offset", () => {
    // 2026-03-08T09:30:00.000Z is 5:30 AM EDT — spring-forward morning, after the shortened
    // freeze window pin in `pause.test.ts`.
    expect(formatPausedUntil("2026-03-08T09:30:00.000Z")).toBe("Picks are paused until 5:30 AM Eastern. You can still make yours.");
  });
});

describe("formatYourTurn", () => {
  const UPCOMING = ["t3", "t4", "t1", "t2", "t3"];

  it("says nothing to a spectator who fields no team", () => {
    expect(formatYourTurn(UPCOMING, null, 600)).toBeNull();
  });

  it("says nothing when this team is not in the lookahead at all", () => {
    expect(formatYourTurn(UPCOMING, "t9", 600)).toBeNull();
    expect(formatYourTurn([], "t1", 600)).toBeNull();
  });

  it("says you are on the clock when you are the one on it", () => {
    expect(formatYourTurn(UPCOMING, "t3", 600)).toBe("You're on the clock.");
  });

  it.each([
    [1, 600, "You're up in 1 pick (~10m)."],
    [2, 600, "You're up in 2 picks (~20m)."],
    [3, 28_800, "You're up in 3 picks (~24h 0m)."],
    [1, 15, "You're up in 1 pick (any moment)."],
  ])("counts %i picks ahead on a %i-second clock", (picksAway, clockSeconds, expected) => {
    const upcoming = [...Array.from({ length: picksAway }, (_, i) => `other${i}`), "t1"];
    expect(formatYourTurn(upcoming, "t1", clockSeconds)).toBe(expected);
  });

  it("counts the picks without estimating a wait when there is no clock to estimate from", () => {
    expect(formatYourTurn(["t2", "t1"], "t1", null)).toBe("You're up in 1 pick.");
  });

  it("gives an honest, qualitative answer instead of a wrong number while the room is paused", () => {
    // An ETA that ignores a six-hour freeze is worse than no ETA — the flat estimate would say
    // "~10m" here, which is not what actually happens next.
    expect(formatYourTurn(UPCOMING, "t1", 600, "2026-09-15T09:00:00.000Z")).toBe("You're up in 2 picks, once picks resume.");
  });

  it("still says nothing to a spectator, even while the room is paused", () => {
    expect(formatYourTurn(UPCOMING, null, 600, "2026-09-15T09:00:00.000Z")).toBeNull();
  });
});

describe("rosterSpots", () => {
  it("sums the league's declared slot counts", () => {
    expect(rosterSpots([{ slot: "QB", count: 1, eligiblePositions: ["QB"] }, { slot: "RB", count: 2, eligiblePositions: ["RB"] }])).toBe(3);
    expect(rosterSpots([])).toBe(0);
  });

  it("agrees with the engine's own total, which is what pins the two together", () => {
    expect(rosterSpots(STANDARD_ROSTER_SLOTS)).toBe(totalRosterSlots(STANDARD_ROSTER_SLOTS));
  });
});
