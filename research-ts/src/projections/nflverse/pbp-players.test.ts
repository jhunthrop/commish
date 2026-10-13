import { describe, expect, it } from "vitest";
import type { CsvRow } from "./csv";
import { PlayerPlayAggregator, playerTouchObservations, PBP_PLAYER_METRICS, PBP_PLAYER_SOURCE } from "./pbp-players";

/** A neutral first-down carry from midfield, which every test then varies one field of. */
function play(over: Partial<Record<string, string>> = {}): CsvRow {
  return {
    season: "2024",
    week: "3",
    season_type: "REG",
    posteam: "CLE",
    game_date: "2024-09-22",
    play_type: "run",
    rush_attempt: "1",
    qb_scramble: "0",
    qb_kneel: "0",
    two_point_attempt: "0",
    yardline_100: "50",
    rusher_player_id: "back",
    receiver_player_id: "",
    air_yards: "",
    ...over,
  };
}

function pass(over: Partial<Record<string, string>> = {}): CsvRow {
  return play({
    play_type: "pass",
    rush_attempt: "0",
    rusher_player_id: "",
    receiver_player_id: "wideout",
    air_yards: "12",
    ...over,
  });
}

function touchesOf(rows: readonly CsvRow[], playerId: string) {
  const aggregator = new PlayerPlayAggregator();
  for (const row of rows) aggregator.add(row);
  return aggregator.touches().find((touch) => touch.playerId === playerId);
}

describe("PlayerPlayAggregator — carries", () => {
  it("counts a designed carry and files it by where the ball was snapped from", () => {
    const touches = touchesOf(
      [play({ yardline_100: "50" }), play({ yardline_100: "18" }), play({ yardline_100: "4" })],
      "back",
    )!;
    expect(touches.carries).toBe(3);
    // Inside the ten is inside the twenty as well. A back who only ever gets the ball at the four
    // is a different player from one who gets it at the eighteen, so both bands are kept.
    expect(touches.redZoneCarries).toBe(2);
    expect(touches.insideTenCarries).toBe(1);
  });

  it("separates two backs who split carries evenly but not the goal line", () => {
    // The whole reason this file exists. A pooled carry share says these two are the same player.
    const rows = [
      play({ rusher_player_id: "starter", yardline_100: "50" }),
      play({ rusher_player_id: "starter", yardline_100: "45" }),
      play({ rusher_player_id: "goalline", yardline_100: "40" }),
      play({ rusher_player_id: "goalline", yardline_100: "2" }),
    ];
    expect(touchesOf(rows, "starter")!.carries).toBe(2);
    expect(touchesOf(rows, "goalline")!.carries).toBe(2);
    expect(touchesOf(rows, "starter")!.insideTenCarries).toBe(0);
    expect(touchesOf(rows, "goalline")!.insideTenCarries).toBe(1);
  });

  it("leaves scrambles and kneels out, on the same definition the line composite uses", () => {
    const touches = touchesOf(
      [play(), play({ qb_scramble: "1" }), play({ qb_kneel: "1" })],
      "back",
    )!;
    expect(touches.carries).toBe(1);
  });

  it("leaves two-point conversions out, so the inside-ten count is not a going-for-two count", () => {
    // Every two-point play is snapped from the two, so counting them would make the inside-ten
    // numbers measure a coach's fourth-quarter arithmetic rather than a back's role.
    expect(touchesOf([play({ two_point_attempt: "1", yardline_100: "2" })], "back")).toBeUndefined();
  });

  it("ignores a season type this product does not score", () => {
    expect(touchesOf([play({ season_type: "POST" })], "back")).toBeUndefined();
  });
});

describe("PlayerPlayAggregator — targets and air yards", () => {
  it("counts a target for the intended receiver whether or not he caught it", () => {
    const touches = touchesOf([pass(), pass({ air_yards: "30" })], "wideout")!;
    expect(touches.targets).toBe(2);
    expect(touches.airYards).toBeCloseTo(42, 10);
    expect(touches.airYardTargets).toBe(2);
  });

  it("counts a target with no readable air yards, and does not let it into the average", () => {
    // The denominator that matters for depth of target is the targets that CARRIED a depth. Dividing
    // a real air-yard sum by every target would read a field-stretcher as a checkdown back.
    const touches = touchesOf([pass({ air_yards: "20" }), pass({ air_yards: "NA" })], "wideout")!;
    expect(touches.targets).toBe(2);
    expect(touches.airYardTargets).toBe(1);
    expect(touches.airYards).toBeCloseTo(20, 10);
  });

  it("does not count a sack as a target", () => {
    // A sack carries play_type "pass" and no receiver. Requiring the id is what excludes it, with no
    // second flag to be kept in step.
    expect(touchesOf([pass({ receiver_player_id: "" })], "wideout")).toBeUndefined();
  });

  it("files a red-zone target by the snap, not by where the ball was caught", () => {
    const touches = touchesOf([pass({ yardline_100: "15", air_yards: "20" })], "wideout")!;
    expect(touches.redZoneTargets).toBe(1);
  });
});

describe("playerTouchObservations", () => {
  const aggregator = new PlayerPlayAggregator();
  aggregator.add(play({ yardline_100: "4" }));
  aggregator.add(pass());
  const touches = aggregator.touches();
  const asOf = () => new Date("2024-09-24T00:00:00.000Z");

  it("emits every count, zeros included, because a count is known whenever the man appears", () => {
    const { observations } = playerTouchObservations(touches, asOf, new Set(["back", "wideout"]));
    const forBack = observations.filter((row) => row.playerId === "back");
    const value = (metric: string) => forBack.find((row) => row.metric === metric)?.value;
    // Zero red-zone TARGETS for a back who took a goal-line carry is the fact the feature turns on.
    // A rate would have to omit it; a count states it.
    expect(value(PBP_PLAYER_METRICS.redZoneTargets)).toBe(0);
    expect(value(PBP_PLAYER_METRICS.insideTenCarries)).toBe(1);
    expect(forBack.every((row) => row.source === PBP_PLAYER_SOURCE)).toBe(true);
  });

  it("reports a touch-taker the universe does not carry rather than storing him", () => {
    const { observations, unknownPlayers } = playerTouchObservations(touches, asOf, new Set(["back"]));
    expect(unknownPlayers).toEqual(["wideout"]);
    expect(observations.some((row) => row.playerId === "wideout")).toBe(false);
  });

  it("stamps every count with the moment the game that produced it finished", () => {
    const { observations } = playerTouchObservations(touches, asOf, new Set(["back", "wideout"]));
    expect(observations.every((row) => row.asOf.getTime() === asOf().getTime())).toBe(true);
  });
});
