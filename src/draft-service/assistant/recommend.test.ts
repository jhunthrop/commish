import { describe, expect, it } from "vitest";
import { teamOnClock } from "@/draft-engine";
import { ADVISOR_CONFIG } from "./config";
import { askingWindow, onClockShortlist, recommendNow, valuedEvidence } from "./recommend";
import { FIXTURE_POOL, FIXTURE_SHAPE, FIXTURE_TEAM_IDS, fixtureAdvance, fixtureStart, fixtureValued } from "./test-fixture";

const ASKING = FIXTURE_TEAM_IDS[3]!;

describe("askingWindow", () => {
  it("names the seat's current-or-next decision and the turn after it", () => {
    expect(askingWindow(fixtureStart(), ASKING)).toEqual({ pickNumber: 4, nextPickNumber: 17 });
    expect(askingWindow(fixtureAdvance(fixtureStart(), 3), ASKING)).toEqual({ pickNumber: 4, nextPickNumber: 17 });
    expect(askingWindow(fixtureAdvance(fixtureStart(), 4), ASKING)).toEqual({ pickNumber: 17, nextPickNumber: 24 });
  });

  it("has no next turn at the seat's forced last pick, and is null once the seat is done", () => {
    const state = fixtureAdvance(fixtureStart(), 143); // pick 144 is up: seat 4's 15th and last
    expect(teamOnClock(state)).toBe(ASKING);
    expect(askingWindow(state, ASKING)).toEqual({ pickNumber: 144, nextPickNumber: null });
    expect(askingWindow(fixtureAdvance(fixtureStart(), 149), ASKING)).toBeNull();
  });
});

describe("valuedEvidence", () => {
  it("values every evidence row once and prices it by the market rank when the feed has one, the value rank otherwise", () => {
    const pool = FIXTURE_POOL.map((entry, index) => ({ playerId: entry.playerId, position: entry.position, projectedPoints: entry.projectedPoints, marketRank: index < 5 ? index + 1 : null }));
    const valued = valuedEvidence(pool, FIXTURE_SHAPE);
    expect(valued.size).toBe(pool.length);
    expect(valued.get(pool[0]!.playerId)!.averageDraftPosition).toBe(1);
    const unpriced = valued.get(pool[10]!.playerId)!;
    expect(Number.isInteger(unpriced.averageDraftPosition)).toBe(true);
  });
});

describe("recommendNow and onClockShortlist", () => {
  it("ranks the configured shortlist for the seat's decision, empty once it has no turn left", () => {
    const state = fixtureAdvance(fixtureStart(), 3);
    const shortlist = recommendNow({ state, askingTeamId: ASKING, valued: fixtureValued(), shape: FIXTURE_SHAPE });
    expect(shortlist).toHaveLength(ADVISOR_CONFIG.shortlistSize);
    expect(new Set(shortlist.map((rec) => rec.playerId)).size).toBe(shortlist.length);
    expect(recommendNow({ state: fixtureAdvance(fixtureStart(), 149), askingTeamId: ASKING, valued: fixtureValued(), shape: FIXTURE_SHAPE })).toEqual([]);
  });

  it("holds the on-clock seat's own shortlist, and nothing when nobody is on the clock", () => {
    const state = fixtureAdvance(fixtureStart(), 3);
    const held = onClockShortlist(state, fixtureValued(), FIXTURE_SHAPE);
    expect(held).toEqual(new Set(recommendNow({ state, askingTeamId: ASKING, valued: fixtureValued(), shape: FIXTURE_SHAPE }).map((rec) => rec.playerId)));
    expect(onClockShortlist(fixtureAdvance(fixtureStart(), 150), fixtureValued(), FIXTURE_SHAPE).size).toBe(0);
  });
});
