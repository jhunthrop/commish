import { describe, expect, it } from "vitest";
import type { CsvRow } from "./csv";
import { lineYardsFor, PlayByPlayAggregator, playProfileObservations, PBP_METRICS } from "./pbp";

/** A neutral first-down play, which every test then varies one field of. */
function play(over: Partial<Record<string, string>> = {}): CsvRow {
  return {
    season: "2024",
    week: "3",
    season_type: "REG",
    posteam: "CLE",
    defteam: "BUF",
    game_id: "2024_03_CLE_BUF",
    game_date: "2024-09-22",
    play_type: "run",
    rush_attempt: "1",
    qb_scramble: "0",
    qb_kneel: "0",
    qb_spike: "0",
    qb_dropback: "0",
    sack: "0",
    yards_gained: "4",
    game_seconds_remaining: "3000",
    half_seconds_remaining: "1200",
    qtr: "1",
    wp: "0.5",
    fixed_drive: "1",
    pass_oe: "0",
    ...over,
  };
}

function profileOf(rows: readonly CsvRow[], team = "CLE") {
  const aggregator = new PlayByPlayAggregator();
  for (const row of rows) aggregator.add(row);
  return aggregator.profiles().find((profile) => profile.team === team)!;
}

describe("lineYardsFor", () => {
  it("credits the line the whole of the first three yards", () => {
    expect(lineYardsFor(3)).toBeCloseTo(3, 10);
  });

  it("credits half of the next five, so a nine-yard run is 5.5 and not zero", () => {
    // The band table is easiest to read as "everything past nine belongs to the back", and the
    // easiest way to implement it wrongly is to apply the top band's weight to the whole run.
    expect(lineYardsFor(9)).toBeCloseTo(5.5, 10);
  });

  it("credits nothing past nine, so a fifty-yard run and a nine-yard run say the same about the line", () => {
    expect(lineYardsFor(50)).toBeCloseTo(lineYardsFor(9), 10);
  });

  it("charges a loss at more than face value, because the back never had a chance", () => {
    expect(lineYardsFor(-3)).toBeCloseTo(-3.6, 10);
  });
});

describe("PlayByPlayAggregator — the offence's own numbers", () => {
  it("counts designed carries and leaves scrambles and kneels out of them", () => {
    const profile = profileOf([
      play({ yards_gained: "4" }),
      play({ yards_gained: "40", qb_scramble: "1" }),
      play({ yards_gained: "-1", qb_kneel: "1" }),
    ]);
    // A scramble's yards are the quarterback's and a kneel is the clock. Counting either would let
    // a mobile quarterback or a fourth-quarter lead read as a better offensive line.
    expect(profile.designedRushes).toBe(1);
    expect(profile.adjustedLineYards).toBeCloseTo(lineYardsFor(4), 10);
  });

  it("counts a carry stopped at the line as a stuff, and one that gained as not", () => {
    const profile = profileOf([play({ yards_gained: "0" }), play({ yards_gained: "-2" }), play({ yards_gained: "5" })]);
    expect(profile.stuffedRate).toBeCloseTo(2 / 3, 10);
  });

  it("takes sack rate over dropbacks, so a pass rush is not rewarded by deleting the plays it won", () => {
    const dropback = { play_type: "pass", rush_attempt: "0", qb_dropback: "1" } as const;
    const profile = profileOf([play(dropback), play({ ...dropback, sack: "1", yards_gained: "-7" }), play(dropback)]);
    expect(profile.dropbacks).toBe(3);
    expect(profile.sackRateAllowed).toBeCloseTo(1 / 3, 10);
  });

  it("measures pace from the clock between two plays of one drive", () => {
    const profile = profileOf([
      play({ game_seconds_remaining: "3000", fixed_drive: "1" }),
      play({ game_seconds_remaining: "2970", fixed_drive: "1" }),
      play({ game_seconds_remaining: "2940", fixed_drive: "1" }),
    ]);
    expect(profile.paceSecondsPerPlay).toBeCloseTo(30, 10);
  });

  it("does not measure pace across a change of possession — a punt is not tempo", () => {
    const profile = profileOf([
      play({ game_seconds_remaining: "3000", fixed_drive: "1" }),
      play({ game_seconds_remaining: "2400", fixed_drive: "3" }),
    ]);
    expect(profile.paceSecondsPerPlay).toBeNull();
  });

  it("ignores plays outside the situation-neutral window, where the scoreboard calls the tempo", () => {
    const blowout = { wp: "0.95" } as const;
    const profile = profileOf([play(blowout), play({ ...blowout, game_seconds_remaining: "2980" })]);
    expect(profile.neutralPlays).toBe(0);
    expect(profile.passRate).toBeNull();
  });

  it("ignores the two-minute drill, for the same reason", () => {
    const profile = profileOf([play({ half_seconds_remaining: "90" })]);
    expect(profile.neutralPlays).toBe(0);
  });

  it("skips the postseason, matching every other ingestion in the engine", () => {
    const aggregator = new PlayByPlayAggregator();
    aggregator.add(play({ season_type: "POST" }));
    expect(aggregator.profiles()).toEqual([]);
  });
});

describe("PlayByPlayAggregator — what the defence gave up", () => {
  it("credits the same play to the defence that faced it", () => {
    const defence = profileOf(
      [play({ yards_gained: "6" }), play({ yards_gained: "2" })],
      "BUF",
    );
    expect(defence.carriesFaced).toBe(2);
    expect(defence.rushYardsAllowedPerCarry).toBeCloseTo(4, 10);
    expect(defence.opponents).toEqual(["CLE"]);
  });

  it("counts a sack's lost yards against the offence, not for the defence's yards-per-dropback denominator twice", () => {
    const dropback = { play_type: "pass", rush_attempt: "0", qb_dropback: "1" } as const;
    const defence = profileOf([play({ ...dropback, yards_gained: "12" }), play({ ...dropback, sack: "1", yards_gained: "-8" })], "BUF");
    expect(defence.dropbacksFaced).toBe(2);
    expect(defence.passYardsAllowedPerDropback).toBeCloseTo(2, 10);
  });
});

describe("playProfileObservations", () => {
  it("emits no row for a rate with no opportunities behind it — absent is not zero", () => {
    const profile = profileOf([play({ play_type: "pass", rush_attempt: "0", qb_dropback: "1" })]);
    const rows = playProfileObservations([profile], () => new Date("2024-09-23T00:00:00.000Z"));
    const metrics = rows.map((row) => row.metric);
    // No designed carry happened, so there is no stuffed rate. A zero there would read as a line
    // that was never once beaten.
    expect(metrics).not.toContain(PBP_METRICS.stuffedRate);
    expect(metrics).toContain(PBP_METRICS.sackRateAllowed);
  });

  it("stamps every row with the moment the caller derived from the game's own date", () => {
    const profile = profileOf([play()]);
    const asOf = new Date("2024-09-23T00:00:00.000Z");
    const rows = playProfileObservations([profile], () => asOf);
    expect(rows.every((row) => row.asOf === asOf)).toBe(true);
  });
});
