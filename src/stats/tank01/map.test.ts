import { describe, expect, it } from "vitest";
import { TANK01_CONFIG } from "./config";
import { mapBoxScoreToStatLines, mapGames, mapPlayerList, mapTeamsToDefensePlayers } from "./map";

describe("mapPlayerList", () => {
  it("keeps only the positions the scoring engine handles", () => {
    const players = mapPlayerList([
      { playerID: "4240499", longName: "Justin Jefferson", pos: "WR", team: "MIN" },
      { playerID: "3139477", longName: "Patrick Mahomes", pos: "QB", team: "KC" },
      { playerID: "1", longName: "A Long Snapper", pos: "LS", team: "SF" },
      { playerID: "2", longName: "A Linebacker", pos: "LB", team: "SF" },
    ]);
    expect(players).toEqual([
      { id: "4240499", name: "Justin Jefferson", position: "WR", nflTeam: "MIN" },
      { id: "3139477", name: "Patrick Mahomes", position: "QB", nflTeam: "KC" },
    ]);
  });

  it("drops an entry missing an id, a name or a team rather than emitting a broken player", () => {
    expect(mapPlayerList([{ playerID: "", longName: "Nobody", pos: "WR", team: "SF" }])).toEqual([]);
    expect(mapPlayerList([{ playerID: "9", longName: "", pos: "WR", team: "SF" }])).toEqual([]);
    expect(mapPlayerList([{ playerID: "9", longName: "Somebody", pos: "WR", team: "" }])).toEqual([]);
  });

  it("returns an empty list for a body that is not an array", () => {
    expect(mapPlayerList({})).toEqual([]);
    expect(mapPlayerList(null)).toEqual([]);
  });
});

describe("mapTeamsToDefensePlayers", () => {
  it("mints one DEF player per team, with the configured id prefix", () => {
    const defenses = mapTeamsToDefensePlayers([
      { teamID: "28", teamAbv: "SF", teamCity: "San Francisco", teamName: "49ers" },
      { teamID: "32", teamAbv: "WSH", teamCity: "Washington", teamName: "Commanders" },
    ]);
    expect(defenses).toEqual([
      { id: `${TANK01_CONFIG.defensePlayerIdPrefix}SF`, name: "San Francisco 49ers", position: "DEF", nflTeam: "SF" },
      { id: `${TANK01_CONFIG.defensePlayerIdPrefix}WSH`, name: "Washington Commanders", position: "DEF", nflTeam: "WSH" },
    ]);
  });
});

describe("mapGames", () => {
  it("reads the composite gameID, both teams and the mapped status off each scheduled game", () => {
    expect(
      mapGames(
        [
          { gameID: "20261018_CAR@WSH", away: "CAR", home: "WSH", gameStatus: "Completed" },
          { gameID: "20261018_SF@SEA", away: "SF", home: "SEA", gameStatus: "Scheduled" },
        ],
        7,
      ),
    ).toEqual([
      { gameId: "20261018_CAR@WSH", week: 7, status: "final", homeNflTeam: "WSH", awayNflTeam: "CAR" },
      { gameId: "20261018_SF@SEA", week: 7, status: "scheduled", homeNflTeam: "SEA", awayNflTeam: "SF" },
    ]);
  });

  it("ignores a game missing an id, a home team or an away team instead of producing a broken fixture", () => {
    expect(
      mapGames(
        [
          { away: "CAR", home: "WSH", gameID: "" },
          { gameID: "20261018_SF@SEA", home: "SEA" },
          { gameID: "20261018_NO@ATL", away: "NO" },
        ],
        7,
      ),
    ).toEqual([]);
  });

  it("stamps every game with the week it was asked for, not a week read off the payload", () => {
    const games = mapGames([{ gameID: "20261018_SF@SEA", away: "SF", home: "SEA", gameWeek: "1" }], 12);
    expect(games).toEqual([{ gameId: "20261018_SF@SEA", week: 12, status: "in_progress", homeNflTeam: "SEA", awayNflTeam: "SF" }]);
  });

  it("maps every configured spelling, case-insensitively, to its domain status", () => {
    for (const spelling of TANK01_CONFIG.gameStatuses.final) {
      expect(mapGames([{ gameID: "g", away: "A", home: "B", gameStatus: spelling.toUpperCase() }], 1)).toEqual([
        { gameId: "g", week: 1, status: "final", homeNflTeam: "B", awayNflTeam: "A" },
      ]);
    }
    for (const spelling of TANK01_CONFIG.gameStatuses.scheduled) {
      expect(mapGames([{ gameID: "g", away: "A", home: "B", gameStatus: spelling.toUpperCase() }], 1)).toEqual([
        { gameId: "g", week: 1, status: "scheduled", homeNflTeam: "B", awayNflTeam: "A" },
      ]);
    }
    for (const spelling of TANK01_CONFIG.gameStatuses.in_progress) {
      expect(mapGames([{ gameID: "g", away: "A", home: "B", gameStatus: spelling.toUpperCase() }], 1)).toEqual([
        { gameId: "g", week: 1, status: "in_progress", homeNflTeam: "B", awayNflTeam: "A" },
      ]);
    }
  });

  it("maps an unrecognized, missing or absent gameStatus to in_progress, the safe default", () => {
    expect(mapGames([{ gameID: "g", away: "A", home: "B", gameStatus: "Weather Delay" }], 1)).toEqual([
      { gameId: "g", week: 1, status: "in_progress", homeNflTeam: "B", awayNflTeam: "A" },
    ]);
    expect(mapGames([{ gameID: "g", away: "A", home: "B" }], 1)).toEqual([
      { gameId: "g", week: 1, status: "in_progress", homeNflTeam: "B", awayNflTeam: "A" },
    ]);
  });

  it("returns an empty list for a body that is not an array, and drops a non-object entry", () => {
    expect(mapGames({}, 1)).toEqual([]);
    expect(mapGames(null, 1)).toEqual([]);
    expect(mapGames([null, "not a game"], 1)).toEqual([]);
  });
});

describe("mapBoxScoreToStatLines", () => {
  const BOX = {
    gameID: "20261018_SF@SEA",
    playerStats: {
      "12483": {
        playerID: "12483",
        longName: "A Quarterback",
        Passing: { passAttempts: "27", passCompletions: "16", passYds: "160", passTD: "2", int: "1" },
        Rushing: { carries: "4", rushYds: "18", rushTD: "0" },
        // The gotcha this assertion exists for: a QB's lost fumble is reported under Defense.
        Defense: { fumblesLost: "1", totalTackles: "1" },
      },
      "4240499": {
        playerID: "4240499",
        longName: "A Receiver",
        Receiving: { receptions: "9", targets: "12", recYds: "134", recTD: "1" },
      },
      "9999": {
        playerID: "9999",
        longName: "A Kicker",
        Kicking: { fgMade: "3", fgAttempts: "4", xpMade: "2" },
      },
    },
    DST: {
      away: { teamAbv: "SF", defTD: "1", defensiveInterceptions: "2", sacks: "4.0", ptsAllowed: "17" },
      home: { teamAbv: "SEA", defTD: "0", defensiveInterceptions: "0", sacks: "1.5", ptsAllowed: "24" },
    },
  };

  // Every case below is about parsing, not filtering, so the id set is deliberately "everything
  // BOX mentions" — the filtering behavior itself is covered by the dedicated cases further down.
  const BOX_LISTED_IDS = new Set([
    "12483",
    "4240499",
    "9999",
    `${TANK01_CONFIG.defensePlayerIdPrefix}SF`,
    `${TANK01_CONFIG.defensePlayerIdPrefix}SEA`,
  ]);

  it("parses every stat out of its string, from the group it actually lives in", () => {
    const lines = mapBoxScoreToStatLines(BOX, 7, BOX_LISTED_IDS);
    const qb = lines.find((line) => line.playerId === "12483");
    expect(qb).toEqual({
      playerId: "12483",
      week: 7,
      passingYards: 160,
      passingTouchdowns: 2,
      interceptions: 1,
      rushingYards: 18,
      rushingTouchdowns: 0,
      receivingYards: 0,
      receivingTouchdowns: 0,
      receptions: 0,
      fumblesLost: 1,
      fieldGoalsMade: 0,
      extraPointsMade: 0,
      sacks: 0,
      defensiveInterceptions: 0,
      defensiveTouchdowns: 0,
    });
  });

  it("zero-fills every group a player does not have, because groups are absent and not empty", () => {
    const wr = mapBoxScoreToStatLines(BOX, 7, BOX_LISTED_IDS).find((line) => line.playerId === "4240499");
    expect(wr?.receptions).toBe(9);
    expect(wr?.receivingYards).toBe(134);
    expect(wr?.passingYards).toBe(0);
    expect(wr?.fumblesLost).toBe(0);
  });

  it("reads kicking out of the Kicking group", () => {
    const k = mapBoxScoreToStatLines(BOX, 7, BOX_LISTED_IDS).find((line) => line.playerId === "9999");
    expect(k?.fieldGoalsMade).toBe(3);
    expect(k?.extraPointsMade).toBe(2);
  });

  it("emits one DEF stat line per side, keyed by the same id listPlayers mints", () => {
    const lines = mapBoxScoreToStatLines(BOX, 7, BOX_LISTED_IDS);
    const sf = lines.find((line) => line.playerId === `${TANK01_CONFIG.defensePlayerIdPrefix}SF`);
    expect(sf?.defensiveTouchdowns).toBe(1);
    expect(sf?.defensiveInterceptions).toBe(2);
    expect(sf?.sacks).toBe(4);
  });

  it("keeps a half sack as a half sack", () => {
    const sea = mapBoxScoreToStatLines(BOX, 7, BOX_LISTED_IDS).find(
      (line) => line.playerId === `${TANK01_CONFIG.defensePlayerIdPrefix}SEA`,
    );
    expect(sea?.sacks).toBe(1.5);
  });

  it("drops a stat line for a player getWeeklyStatLines was not told to list, instead of a foreign-key failure at seed time", () => {
    // The bug this guards against: a box score's playerStats carries no position, so it includes
    // every player who appeared, not only the scored positions listPlayers() kept. "12483" is a
    // real entry in BOX but deliberately absent from this id set.
    const lines = mapBoxScoreToStatLines(BOX, 7, new Set(["4240499", "9999"]));
    expect(lines.map((line) => line.playerId)).not.toContain("12483");
    expect(lines.map((line) => line.playerId).sort()).toEqual(["4240499", "9999"]);
  });

  it("drops a DEF stat line for a team defense that was not listed", () => {
    const lines = mapBoxScoreToStatLines(BOX, 7, new Set(["12483", "4240499", "9999", `${TANK01_CONFIG.defensePlayerIdPrefix}SF`]));
    expect(lines.map((line) => line.playerId)).not.toContain(`${TANK01_CONFIG.defensePlayerIdPrefix}SEA`);
  });

  it("keeps negative rushing/receiving/passing yardage rather than clamping it to zero", () => {
    // Real NFL data: a sack-for-loss or a broken-up screen routinely nets negative yardage.
    const lines = mapBoxScoreToStatLines(
      {
        playerStats: {
          "1": {
            playerID: "1",
            Passing: { passYds: "-2" },
            Rushing: { rushYds: "-4" },
            Receiving: { recYds: "-1" },
          },
        },
      },
      3,
      new Set(["1"]),
    );
    expect(lines[0]?.passingYards).toBe(-2);
    expect(lines[0]?.rushingYards).toBe(-4);
    expect(lines[0]?.receivingYards).toBe(-1);
  });

  it("never produces NaN from a missing, empty or non-numeric value", () => {
    const lines = mapBoxScoreToStatLines(
      { playerStats: { "1": { playerID: "1", Passing: { passYds: "", passTD: "n/a" } } } },
      3,
      new Set(["1"]),
    );
    expect(lines[0]?.passingYards).toBe(0);
    expect(lines[0]?.passingTouchdowns).toBe(0);
  });

  it("tolerates a 2022-era box score with no DST block at all", () => {
    expect(() => mapBoxScoreToStatLines({ playerStats: {} }, 1, new Set())).not.toThrow();
    expect(mapBoxScoreToStatLines({ playerStats: {} }, 1, new Set())).toEqual([]);
  });
});

// Every mapper reads an untrusted, externally-controlled payload, so each has to survive shapes
// the happy-path fixtures above never exercise: a body that is not the expected type at all, an
// array entry that is not an object, and the group()/playerID fallbacks map.ts defends with but
// no upstream capture happens to trigger.
describe("defensive parsing of shapes the fixtures never exercise", () => {
  it("mapPlayerList drops a non-object entry instead of throwing", () => {
    expect(mapPlayerList([null, "not a player", 42])).toEqual([]);
  });

  it("mapTeamsToDefensePlayers returns an empty list for a body that is not an array", () => {
    expect(mapTeamsToDefensePlayers({})).toEqual([]);
    expect(mapTeamsToDefensePlayers(null)).toEqual([]);
  });

  it("mapTeamsToDefensePlayers drops a non-object entry and one missing teamAbv", () => {
    expect(mapTeamsToDefensePlayers([null, { teamCity: "Nowhere", teamName: "Nobodies" }])).toEqual([]);
  });

  it("mapTeamsToDefensePlayers falls back to the abbreviation when city and name are both blank", () => {
    expect(mapTeamsToDefensePlayers([{ teamAbv: "SF" }])).toEqual([
      { id: `${TANK01_CONFIG.defensePlayerIdPrefix}SF`, name: "SF", position: "DEF", nflTeam: "SF" },
    ]);
  });

  it("mapBoxScoreToStatLines returns an empty list for a body that is not an object at all", () => {
    expect(mapBoxScoreToStatLines("not a box score", 1, new Set())).toEqual([]);
    expect(mapBoxScoreToStatLines(null, 1, new Set())).toEqual([]);
  });

  it("mapBoxScoreToStatLines treats a missing playerStats key as no players", () => {
    expect(mapBoxScoreToStatLines({}, 1, new Set())).toEqual([]);
  });

  it("falls back to the object key as the player id when playerID is absent", () => {
    const lines = mapBoxScoreToStatLines({ playerStats: { "55555": { Kicking: { fgMade: "1" } } } }, 4, new Set(["55555"]));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.playerId).toBe("55555");
    expect(lines[0]?.fieldGoalsMade).toBe(1);
  });

  it("drops an entry keyed by an empty string with no playerID rather than emitting a blank id", () => {
    expect(mapBoxScoreToStatLines({ playerStats: { "": { Kicking: { fgMade: "1" } } } }, 4, new Set([""]))).toEqual([]);
  });

  it("zero-fills every stat for an entry whose value is not an object at all", () => {
    const lines = mapBoxScoreToStatLines({ playerStats: { "77777": "garbage" } }, 2, new Set(["77777"]));
    // Every field spelled out literally — not derived from `lines[0]` — so a mutation to
    // `emptyStats`'s defaults (see the DEF-synthesis case in the "emits a literal DEF line"
    // test below for the same principle) is caught here too.
    expect(lines).toEqual([
      {
        playerId: "77777",
        week: 2,
        passingYards: 0,
        passingTouchdowns: 0,
        interceptions: 0,
        rushingYards: 0,
        rushingTouchdowns: 0,
        receivingYards: 0,
        receivingTouchdowns: 0,
        receptions: 0,
        fumblesLost: 0,
        fieldGoalsMade: 0,
        extraPointsMade: 0,
        sacks: 0,
        defensiveInterceptions: 0,
        defensiveTouchdowns: 0,
      },
    ]);
  });

  it("emits one line per TEAM defense, not one per DST key, when a response repeats a side under a second casing", () => {
    // Behavior (3) in `mapBoxScoreToStatLines`'s docblock: some 2022-era responses carry the same
    // side under two differently-cased keys. `Object.values` yields both, and emitting both put
    // one player id in the tick's lines twice — which `persistTick` cannot survive, because
    // Postgres rejects a whole multi-row ON CONFLICT DO UPDATE (21000) when a key repeats.
    const lines = mapBoxScoreToStatLines(
      {
        playerStats: {},
        DST: {
          home: { teamAbv: "SF", sacks: "3.0", defensiveInterceptions: "1", defTD: "0" },
          Home: { teamAbv: "SF", sacks: "4.0", defensiveInterceptions: "2", defTD: "1" },
          away: { teamAbv: "SEA", sacks: "1.0", defensiveInterceptions: "0", defTD: "0" },
        },
      },
      1,
      new Set([`${TANK01_CONFIG.defensePlayerIdPrefix}SF`, `${TANK01_CONFIG.defensePlayerIdPrefix}SEA`]),
    );

    expect(lines.map((line) => line.playerId)).toEqual([
      `${TANK01_CONFIG.defensePlayerIdPrefix}SF`,
      `${TANK01_CONFIG.defensePlayerIdPrefix}SEA`,
    ]);
    // Last side wins, which for a genuinely duplicate-cased key is the same numbers either way.
    expect(lines[0]!.sacks).toBe(4);
    expect(lines[0]!.defensiveTouchdowns).toBe(1);
  });

  it("drops a DST side that is not an object, and one missing teamAbv", () => {
    expect(
      mapBoxScoreToStatLines({ playerStats: {}, DST: { away: null, home: { ptsAllowed: "10" } } }, 1, new Set()),
    ).toEqual([]);
  });

  it("emits a literal DEF stat line, not one compared against its own computed values", () => {
    // Proven by mutation: before this fix, `emits one DEF stat line per side` above compared
    // fourteen of `emptyStats`'s fields against themselves, so setting `emptyStats`'s
    // `passingYards`/`interceptions` to 999 left every test in this file green. This case pins
    // every field to a literal, including the eleven the player branch always overrides but the
    // DEF branch never does.
    const lines = mapBoxScoreToStatLines(
      { playerStats: {}, DST: { away: { teamAbv: "SF", defTD: "1", defensiveInterceptions: "2", sacks: "4.0" } } },
      7,
      new Set([`${TANK01_CONFIG.defensePlayerIdPrefix}SF`]),
    );
    expect(lines).toEqual([
      {
        playerId: `${TANK01_CONFIG.defensePlayerIdPrefix}SF`,
        week: 7,
        passingYards: 0,
        passingTouchdowns: 0,
        interceptions: 0,
        rushingYards: 0,
        rushingTouchdowns: 0,
        receivingYards: 0,
        receivingTouchdowns: 0,
        receptions: 0,
        fumblesLost: 0,
        fieldGoalsMade: 0,
        extraPointsMade: 0,
        sacks: 4,
        defensiveInterceptions: 2,
        defensiveTouchdowns: 1,
      },
    ]);
  });
});
