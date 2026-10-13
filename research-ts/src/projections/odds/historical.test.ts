import { describe, expect, it } from "vitest";
import { parseHistoricalEventOddsPage, parseHistoricalEventsPage } from "./historical";

describe("parseHistoricalEventsPage", () => {
  const validPayload = {
    timestamp: "2023-09-07T11:55:41Z",
    previous_timestamp: "2023-09-07T11:50:40Z",
    next_timestamp: "2023-09-07T12:00:41Z",
    data: [
      { id: "e1", commence_time: "2023-09-08T00:20:00Z", home_team: "Kansas City Chiefs", away_team: "Detroit Lions" },
    ],
  };

  it("parses the wrapper's own timestamp as a Date, separately from any event's commence_time", () => {
    const page = parseHistoricalEventsPage(validPayload);
    expect(page.timestamp).toEqual(new Date("2023-09-07T11:55:41Z"));
  });

  it("parses every event under data using the shared event parser", () => {
    const page = parseHistoricalEventsPage(validPayload);
    expect(page.events).toEqual([
      { id: "e1", commenceTime: new Date("2023-09-08T00:20:00Z"), homeTeam: "Kansas City Chiefs", awayTeam: "Detroit Lions" },
    ]);
  });

  it("rejects a response missing its own timestamp", () => {
    const rest: Record<string, unknown> = { ...validPayload };
    delete rest.timestamp;
    expect(() => parseHistoricalEventsPage(rest)).toThrow(/timestamp/);
  });

  it("rejects a response whose data is not an array", () => {
    expect(() => parseHistoricalEventsPage({ ...validPayload, data: {} })).toThrow(/data was not an array/);
  });

  it("rejects a non-object payload", () => {
    expect(() => parseHistoricalEventsPage(null)).toThrow(/was not an object/);
  });
});

describe("parseHistoricalEventOddsPage", () => {
  it("unwraps timestamp and passes data through unvalidated", () => {
    const payload = { timestamp: "2023-09-07T11:55:41Z", data: { id: "e1", bookmakers: [] } };
    const page = parseHistoricalEventOddsPage(payload);
    expect(page.timestamp).toEqual(new Date("2023-09-07T11:55:41Z"));
    expect(page.data).toEqual({ id: "e1", bookmakers: [] });
  });

  it("rejects a response missing its own timestamp", () => {
    expect(() => parseHistoricalEventOddsPage({ data: {} })).toThrow(/timestamp/);
  });

  it("rejects an unparseable timestamp", () => {
    expect(() => parseHistoricalEventOddsPage({ timestamp: "not-a-date", data: {} })).toThrow(/unparseable/);
  });
});
