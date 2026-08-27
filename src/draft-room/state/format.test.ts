import { describe, it, expect } from "vitest";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
/**
 * Test-only cross-check that `rosterSpots` agrees with the engine's own `totalRosterSlots`;
 * this file never ships to the browser bundle, so the "no server-only values in draft-room
 * client code" rule doesn't apply to the risk it guards against.
 */
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { totalRosterSlots } from "@/draft-engine";
import type { PickReview } from "./pick-review";
import {
  formatClockLength,
  formatGap,
  formatOrdinal,
  formatPausedUntil,
  formatPickFact,
  formatTightening,
  formatYourTurn,
  rosterSpots,
  type PickFactCopy,
} from "./format";

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

  // Task 10's persona checkpoint, finding 1: a practice opponent's turn never runs the pick
  // clock — pricing it at the clock overstated a mock's wait roughly tenfold. A bot seat is
  // priced at the seeded delay's expected value; a human seat still gets the full clock.
  describe("with practice-opponent seats priced honestly", () => {
    const botSeats = { ids: new Set(["b1", "b2"]), pickSeconds: 6 };

    it("prices an all-bot wait in seconds, not clocks", () => {
      // 2 bot turns × 6s = 12s -> under the one-minute floor
      expect(formatYourTurn(["b1", "b2", "t1"], "t1", 60, null, botSeats)).toBe("You're up in 2 picks (any moment).");
    });

    it("prices a mixed wait as bots-at-delay plus humans-at-clock", () => {
      // 6s + 600s + 6s = 612s -> ~10m
      expect(formatYourTurn(["b1", "t9", "b2", "t1"], "t1", 600, null, botSeats)).toBe("You're up in 3 picks (~10m).");
    });

    it("changes nothing for a room with no bot seats given", () => {
      expect(formatYourTurn(["t2", "t2", "t1"], "t1", 600, null, null)).toBe("You're up in 2 picks (~20m).");
    });
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

describe("formatOrdinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [9, "9th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [101, "101st"],
    [111, "111th"],
  ])("renders %i as %s", (n, expected) => {
    expect(formatOrdinal(n)).toBe(expected);
  });
});

const PICK_FACT_COPY: PickFactCopy = {
  took: "You took {name} at pick {pickNumber}.",
  bestAvailable: "The board's best player available.",
  positionBestAvailable: "The board's best {position} available.",
  rankedHigherAvailable: "{count} ranked higher were available.",
  positionRank: "{position}{rank} on the board.",
};

function review(overrides: Partial<PickReview>): PickReview {
  return { pickNumber: 1, playerId: "p1", bestAvailableDelta: 0, positionRank: 1, positionBestDelta: 0, ...overrides };
}

describe("formatPickFact", () => {
  it("states the board's own best player available when the delta is 0", () => {
    expect(formatPickFact(PICK_FACT_COPY, review({ pickNumber: 12, positionRank: 2 }), "Bijan Robinson", "RB")).toBe(
      "You took Bijan Robinson at pick 12. The board's best player available. RB2 on the board.",
    );
  });

  it("states the board's own best player AT THE POSITION when only the position delta is 0 (the round-15-kicker case)", () => {
    expect(
      formatPickFact(PICK_FACT_COPY, review({ pickNumber: 180, bestAvailableDelta: 550, positionRank: 12, positionBestDelta: 0 }), "Xavier Walker", "K"),
    ).toBe("You took Xavier Walker at pick 180. The board's best K available. K12 on the board.");
  });

  it("states the honest reach when neither delta is 0", () => {
    expect(formatPickFact(PICK_FACT_COPY, review({ pickNumber: 13, bestAvailableDelta: 1, positionRank: 9, positionBestDelta: 1 }), "Nico Collins", "WR")).toBe(
      "You took Nico Collins at pick 13. 1 ranked higher were available. WR9 on the board.",
    );
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
