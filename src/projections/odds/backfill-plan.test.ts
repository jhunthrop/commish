import { describe, expect, it } from "vitest";
import {
  eventsInWeekWindow,
  eventsNeedingFetch,
  hasBudgetRemaining,
  weekSnapshotInstants,
  SNAPSHOT_OFFSET_HOURS,
  WEEK_WINDOW_DAYS,
} from "./backfill-plan";
import type { OddsEvent } from "./http";

function event(over: Partial<OddsEvent> = {}): OddsEvent {
  return { id: "evt1", commenceTime: new Date("2023-09-08T00:20:00.000Z"), homeTeam: "Chiefs", awayTeam: "Lions", ...over };
}

describe("weekSnapshotInstants — one snapshot instant per week, strictly before that week's own first kickoff", () => {
  it("computes snapshotAt as SNAPSHOT_OFFSET_HOURS before each week's first kickoff", () => {
    const kickoffsByWeek = new Map<number, Date>([
      [1, new Date("2024-09-08T17:00:00.000Z")],
      [2, new Date("2024-09-15T17:00:00.000Z")],
    ]);
    const instants = weekSnapshotInstants(kickoffsByWeek);
    expect(instants).toEqual([
      {
        week: 1,
        firstKickoff: new Date("2024-09-08T17:00:00.000Z"),
        snapshotAt: new Date(new Date("2024-09-08T17:00:00.000Z").getTime() - SNAPSHOT_OFFSET_HOURS * 3_600_000),
      },
      {
        week: 2,
        firstKickoff: new Date("2024-09-15T17:00:00.000Z"),
        snapshotAt: new Date(new Date("2024-09-15T17:00:00.000Z").getTime() - SNAPSHOT_OFFSET_HOURS * 3_600_000),
      },
    ]);
  });

  it("every computed snapshotAt is strictly before its own week's first kickoff", () => {
    const kickoffsByWeek = new Map<number, Date>([[7, new Date("2024-10-24T20:15:00.000Z")]]);
    const [instant] = weekSnapshotInstants(kickoffsByWeek);
    expect(instant!.snapshotAt.getTime()).toBeLessThan(instant!.firstKickoff.getTime());
  });

  it("orders the result by week ascending, regardless of map insertion order", () => {
    const kickoffsByWeek = new Map<number, Date>([
      [3, new Date("2024-09-22T17:00:00.000Z")],
      [1, new Date("2024-09-08T17:00:00.000Z")],
      [2, new Date("2024-09-15T17:00:00.000Z")],
    ]);
    expect(weekSnapshotInstants(kickoffsByWeek).map((i) => i.week)).toEqual([1, 2, 3]);
  });

  it("returns an empty list for an empty map -- a season the store has not ingested", () => {
    expect(weekSnapshotInstants(new Map())).toEqual([]);
  });
});

describe("eventsInWeekWindow — bucketing a season's whole event list into one week", () => {
  it("keeps an event whose kickoff falls on the week's first kickoff itself (inclusive lower bound)", () => {
    const firstKickoff = new Date("2024-09-08T17:00:00.000Z");
    const events = [event({ id: "e1", commenceTime: firstKickoff })];
    expect(eventsInWeekWindow(events, firstKickoff)).toEqual(events);
  });

  it("keeps an event within WEEK_WINDOW_DAYS of the first kickoff", () => {
    const firstKickoff = new Date("2024-09-08T17:00:00.000Z");
    const withinWindow = new Date(firstKickoff.getTime() + (WEEK_WINDOW_DAYS - 1) * 86_400_000);
    const events = [event({ id: "e1", commenceTime: withinWindow })];
    expect(eventsInWeekWindow(events, firstKickoff)).toEqual(events);
  });

  it("drops an event before the week's first kickoff -- a prior week's late Monday game", () => {
    const firstKickoff = new Date("2024-09-08T17:00:00.000Z");
    const events = [event({ id: "e1", commenceTime: new Date(firstKickoff.getTime() - 60_000) })];
    expect(eventsInWeekWindow(events, firstKickoff)).toEqual([]);
  });

  it("drops an event at or past WEEK_WINDOW_DAYS out -- the following week's own opener", () => {
    const firstKickoff = new Date("2024-09-08T17:00:00.000Z");
    const nextWeek = new Date(firstKickoff.getTime() + WEEK_WINDOW_DAYS * 86_400_000);
    const events = [event({ id: "e1", commenceTime: nextWeek })];
    expect(eventsInWeekWindow(events, firstKickoff)).toEqual([]);
  });

  it("keeps only the matching events from a mixed multi-week list", () => {
    const firstKickoff = new Date("2024-09-08T17:00:00.000Z");
    const events = [
      event({ id: "prior-week", commenceTime: new Date("2024-09-01T17:00:00.000Z") }),
      event({ id: "this-week-a", commenceTime: new Date("2024-09-08T17:00:00.000Z") }),
      event({ id: "this-week-b", commenceTime: new Date("2024-09-09T20:00:00.000Z") }),
      event({ id: "next-week", commenceTime: new Date(firstKickoff.getTime() + WEEK_WINDOW_DAYS * 86_400_000) }),
    ];
    expect(eventsInWeekWindow(events, firstKickoff).map((e) => e.id)).toEqual(["this-week-a", "this-week-b"]);
  });
});

describe("eventsNeedingFetch — the resume/skip logic", () => {
  it("keeps every event when nothing has been archived yet", () => {
    const events = [event({ id: "e1" }), event({ id: "e2" })];
    expect(eventsNeedingFetch(events, new Set())).toEqual(events);
  });

  it("drops an event already archived, keeping the rest -- a resumed run", () => {
    const events = [event({ id: "e1" }), event({ id: "e2" }), event({ id: "e3" })];
    expect(eventsNeedingFetch(events, new Set(["e2"])).map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("returns an empty list when every event in the week is already archived", () => {
    const events = [event({ id: "e1" }), event({ id: "e2" })];
    expect(eventsNeedingFetch(events, new Set(["e1", "e2"]))).toEqual([]);
  });
});

describe("hasBudgetRemaining — the budget guard, checked against REAL credits used so far", () => {
  it("allows another call while usedThisRun is below the budget", () => {
    expect(hasBudgetRemaining(500, 9000)).toBe(true);
  });

  it("refuses once usedThisRun has reached the budget", () => {
    expect(hasBudgetRemaining(9000, 9000)).toBe(false);
  });

  it("refuses once usedThisRun has exceeded the budget", () => {
    expect(hasBudgetRemaining(9001, 9000)).toBe(false);
  });
});
