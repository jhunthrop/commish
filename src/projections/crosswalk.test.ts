import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players } from "@/db/schema";
import {
  CROSSWALK_METHOD,
  comparableName,
  crosswalkInputs,
  crosswalkRows,
  nflPlayerIdFor,
  nflPlayerIdsFor,
  recordCrosswalk,
  resolveCrosswalk,
  seedTeamDefenseUniverse,
  type ProviderPlayer,
  type UniversePlayer,
} from "./crosswalk";
import { teamDefenseUniverseIds } from "./nflverse/team-codes";
import { recordNflPlayers } from "./universe";
import type { NflPlayerRow } from "./nflverse/players";

/**
 * The crosswalk's whole job is to be RIGHT or to say it does not know, so that is what these test.
 * A wrong edge here is not a missing number on a screen, it is another man's number on it, and no
 * later layer can detect that: a projection rendered under the wrong name looks exactly like a
 * projection.
 */
const db = createTestDb();
const RESOLVED_AT = new Date("2026-08-28T00:00:00.000Z");

function universePlayer(overrides: Partial<UniversePlayer> = {}): UniversePlayer {
  return { id: "00-0036900", espnId: "4362628", name: "Ja'Marr Chase", ...overrides };
}

function providerPlayer(overrides: Partial<ProviderPlayer> = {}): ProviderPlayer {
  return { id: "4362628", name: "Ja'Marr Chase", position: "WR", ...overrides };
}

function nflPlayerRow(overrides: Partial<NflPlayerRow> = {}): NflPlayerRow {
  return {
    id: "00-0036900",
    pfrId: "ChasJa00",
    espnId: "4362628",
    name: "Ja'Marr Chase",
    position: "WR",
    latestTeam: "CIN",
    rookieSeason: 2021,
    lastSeason: 2026,
    ...overrides,
  };
}

describe("resolveCrosswalk", () => {
  it("places a player by id, not by name", () => {
    const resolution = resolveCrosswalk([providerPlayer()], [universePlayer()]);
    expect(resolution.matched).toEqual([
      {
        playerId: "4362628",
        nflPlayerId: "00-0036900",
        method: "espn_id",
        nameAgrees: true,
        providerName: "Ja'Marr Chase",
        universeName: "Ja'Marr Chase",
      },
    ]);
    expect(resolution.unmatched).toEqual([]);
  });

  /**
   * The 11 real disagreements this found on live data are all of this shape, and every one of them
   * is a person a name join would have dropped. The match stands and the disagreement is reported;
   * the resolver does not get to decide that `Hollywood` and `Marquise` are the same man, and it
   * does not need to, because the id already said so.
   */
  it("keeps a match whose names disagree, and flags it", () => {
    const [match] = resolveCrosswalk(
      [providerPlayer({ name: "Hollywood Brown" })],
      [universePlayer({ name: "Marquise Brown" })],
    ).matched;
    expect(match?.nameAgrees).toBe(false);
    expect(match?.nflPlayerId).toBe("00-0036900");
  });

  it("treats a generational suffix as agreement rather than as a disagreement to chase", () => {
    const [match] = resolveCrosswalk(
      [providerPlayer({ name: "Travis Etienne Jr." })],
      [universePlayer({ name: "Travis Etienne" })],
    ).matched;
    expect(match?.nameAgrees).toBe(true);
  });

  /** The case a name join cannot settle and this one never has to. Two men, one name, one position,
   *  different ids: both resolve, and to the right people. */
  it("separates two players who share a name", () => {
    const resolution = resolveCrosswalk(
      [providerPlayer({ id: "1", name: "Josh Allen", position: "QB" }), providerPlayer({ id: "2", name: "Josh Allen", position: "QB" })],
      [universePlayer({ id: "00-0034857", espnId: "1", name: "Josh Allen" }), universePlayer({ id: "00-0030833", espnId: "2", name: "Josh Allen" })],
    );
    expect(resolution.matched.map((match) => [match.playerId, match.nflPlayerId])).toEqual([
      ["1", "00-0034857"],
      ["2", "00-0030833"],
    ]);
  });

  it("records a player the universe does not carry as unmatched, never as absent", () => {
    const resolution = resolveCrosswalk([providerPlayer({ id: "4571935", name: "Jahmal Banks" })], [universePlayer()]);
    expect(resolution.matched).toEqual([]);
    expect(resolution.unmatched).toEqual([
      { playerId: "4571935", name: "Jahmal Banks", position: "WR", reason: "no_espn_id" },
    ]);
  });

  it("records a team defence as a thing that is not a person", () => {
    const [miss] = resolveCrosswalk([providerPlayer({ id: "DEF_BUF", name: "Bills D/ST", position: "DEF" })], []).unmatched;
    expect(miss?.reason).toBe("not_an_nfl_player");
  });

  it("refuses an ambiguous id rather than picking one of the claimants", () => {
    const resolution = resolveCrosswalk(
      [providerPlayer()],
      [universePlayer({ id: "00-0036900" }), universePlayer({ id: "00-0011111", name: "Someone Else" })],
    );
    expect(resolution.matched).toEqual([]);
    expect(resolution.unmatched[0]?.reason).toBe("ambiguous_espn_id");
  });

  /** One man's projection on another man's screen is the failure the whole table exists to prevent,
   *  so it is loud here rather than a constraint violation three layers later. */
  it("throws when two league players would collapse onto one person", () => {
    expect(() =>
      resolveCrosswalk(
        [providerPlayer({ id: "4362628" }), providerPlayer({ id: "4362628" })],
        [universePlayer()],
      ),
    ).toThrow(/Two league players resolve to/);
  });

  it("reports the rate over everyone and over the people separately", () => {
    const resolution = resolveCrosswalk(
      [providerPlayer(), providerPlayer({ id: "9", name: "Nobody Known" }), providerPlayer({ id: "DEF_BUF", position: "DEF" })],
      [universePlayer()],
    );
    expect(resolution.matchRate).toBeCloseTo(1 / 3);
    expect(resolution.matchRateOfPeople).toBeCloseTo(1 / 2);
  });

  /** `metrics.ts`' rule: a sample that cannot answer says so rather than answering perfectly. */
  it("reports null rather than a perfect rate for an empty league", () => {
    const resolution = resolveCrosswalk([], []);
    expect(resolution.matchRate).toBeNull();
    expect(resolution.matchRateOfPeople).toBeNull();
  });

  it("ignores universe rows carrying no bridging id at all", () => {
    const resolution = resolveCrosswalk([providerPlayer()], [universePlayer({ espnId: null }), universePlayer({ id: "00-0000001", espnId: "" })]);
    expect(resolution.unmatched[0]?.reason).toBe("no_espn_id");
  });
});

describe("comparableName", () => {
  it("sets aside the punctuation two feeds disagree about", () => {
    expect(comparableName("Ja'Marr Chase")).toBe(comparableName("JaMarr Chase"));
    expect(comparableName("D.J. Moore")).toBe(comparableName("DJ Moore"));
  });

  /**
   * A HYPHEN IS DROPPED RATHER THAN SPACED, so `Amon-Ra` and `Amon Ra` do NOT compare equal. That
   * is a real limitation and it is recorded rather than fixed, because this function only decides
   * whether to FLAG a pair for a human — the id already made the match — and because the same
   * reduction is `benchmarks.ts`' join key, where changing it would silently move a published
   * resolution rate every measurement in the engine has been taken under.
   */
  it("does not reconcile a hyphen with a space, and the flag is the only cost", () => {
    expect(comparableName("Amon-Ra St. Brown")).not.toBe(comparableName("Amon Ra St Brown"));
  });

  it("keeps a first name, so two brothers do not become one man", () => {
    expect(comparableName("Travis Kelce")).not.toBe(comparableName("Jason Kelce"));
  });
});

describe("the stored crosswalk", () => {
  beforeEach(async () => {
    await truncateAll(db);
    await recordNflPlayers(db, [nflPlayerRow(), nflPlayerRow({ id: "00-0034857", pfrId: "AlleJo02", espnId: "3918298", name: "Josh Allen", position: "QB" })]);
    await db.insert(players).values([
      { id: "4362628", name: "Ja'Marr Chase", position: "WR", nflTeam: "CIN" },
      { id: "3918298", name: "Josh Allen", position: "QB", nflTeam: "BUF" },
      { id: "player_051", name: "Andre Fisher", position: "RB", nflTeam: "FA" },
    ]);
  });

  it("writes a row for every league player, placed or not", async () => {
    const { matched, unmatched } = await write();
    expect(matched).toBe(2);
    expect(unmatched).toBe(1);
    expect(await nflPlayerIdFor(db, "4362628")).toBe("00-0036900");
    expect(await nflPlayerIdFor(db, "player_051")).toBeNull();
  });

  /** A re-run after the release has listed somebody must be able to change his row from unmatched
   *  to matched — the one write in this neighbourhood that is an update rather than an insert. */
  it("lets a later run place a player who was unplaceable before", async () => {
    await write();
    await recordNflPlayers(db, [nflPlayerRow({ id: "00-0099999", pfrId: "FishAn00", espnId: "player_051", name: "Andre Fisher", position: "RB" })]);
    await write();
    expect(await nflPlayerIdFor(db, "player_051")).toBe("00-0099999");
  });

  it("leaves an unplaced player out of the batch map rather than mapping him to null", async () => {
    await write();
    const ids = await nflPlayerIdsFor(db, ["4362628", "player_051", "not-a-player"]);
    expect([...ids]).toEqual([["4362628", "00-0036900"]]);
  });

  it("returns null for a player nobody has ever resolved", async () => {
    expect(await nflPlayerIdFor(db, "4362628")).toBeNull();
  });

  /** Reads both sides out of the database exactly as the operator script does, so these tests
   *  exercise the query that ships rather than a hand-built pair of arrays. */
  async function write(): Promise<{ matched: number; unmatched: number }> {
    const { providers, universe } = await crosswalkInputs(db);
    const resolution = resolveCrosswalk(providers, universe);
    await recordCrosswalk(db, crosswalkRows(resolution, RESOLVED_AT));
    return { matched: resolution.matched.length, unmatched: resolution.unmatched.length };
  }
});

/**
 * TEAM DEFENCES (the 2026-09-05 K and DEF round). A defence is still not a person, and this is the
 * table saying so DELIBERATELY rather than unconditionally: every club now has a synthetic universe
 * row (`nflverse/team-codes.ts`) for the projection store's foreign key to point at, and these
 * assert that the edge is drawn to the right one and refused where the row is absent.
 */
describe("team defences", () => {
  const defenses = new Set(teamDefenseUniverseIds());

  it("places a product defence on its synthetic universe row", () => {
    const resolution = resolveCrosswalk(
      [{ id: "DST-LAR", name: "Los Angeles Rams", position: "DEF" }],
      [],
      defenses,
    );
    expect(resolution.unmatched).toEqual([]);
    expect(resolution.matched).toEqual([
      {
        playerId: "DST-LAR",
        nflPlayerId: "team-def:LA",
        method: CROSSWALK_METHOD.teamDefense,
        nameAgrees: true,
        providerName: "Los Angeles Rams",
        universeName: "team-def:LA",
      },
    ]);
  });

  it("records a defence whose synthetic row has not been seeded, rather than claiming an edge", () => {
    const resolution = resolveCrosswalk(
      [{ id: "DST-LAR", name: "Los Angeles Rams", position: "DEF" }],
      [],
      new Set(),
    );
    expect(resolution.matched).toEqual([]);
    expect(resolution.unmatched[0]?.reason).toBe("no_team_defense_row");
  });

  it("still records a defence id no team code answers to", () => {
    const resolution = resolveCrosswalk([{ id: "DST-XXX", name: "Nowhere", position: "DEF" }], [], defenses);
    expect(resolution.unmatched[0]?.reason).toBe("not_an_nfl_player");
  });

  it("counts a placed defence in the all-players rate and leaves the people rate alone", () => {
    const resolution = resolveCrosswalk(
      [
        { id: "DST-LAR", name: "Los Angeles Rams", position: "DEF" },
        { id: "9", name: "A Kicker", position: "K" },
      ],
      [{ id: "00-0000009", espnId: "9", name: "A Kicker" }],
      defenses,
    );
    expect(resolution.matchRate).toBe(1);
    expect(resolution.matchRateOfPeople).toBe(1);
  });

  it("places a kicker through the same espn id join every other person uses", () => {
    const resolution = resolveCrosswalk(
      [{ id: "3055899", name: "Justin Tucker", position: "K" }],
      [{ id: "00-0029597", espnId: "3055899", name: "Justin Tucker" }],
      defenses,
    );
    expect(resolution.matched[0]?.method).toBe(CROSSWALK_METHOD.espnId);
  });
});

describe("seedTeamDefenseUniverse", () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("writes thirty two rows and is a no-op on a re-run", async () => {
    expect(await seedTeamDefenseUniverse(db)).toBe(32);
    expect(await seedTeamDefenseUniverse(db)).toBe(0);
  });

  it("makes every seeded row visible to the resolver's own inputs read", async () => {
    await seedTeamDefenseUniverse(db);
    const { teamDefenses } = await crosswalkInputs(db);
    expect(teamDefenses.size).toBe(32);
    expect(teamDefenses.has("team-def:LA")).toBe(true);
    expect(teamDefenses.has("team-def:WAS")).toBe(true);
  });

  it("draws a real edge end to end, from a product defence to its universe row", async () => {
    await seedTeamDefenseUniverse(db);
    await db.insert(players).values({ id: "DST-LAR", name: "Los Angeles Rams", position: "DEF", nflTeam: "LAR" });
    const { providers, universe, teamDefenses } = await crosswalkInputs(db);
    const resolution = resolveCrosswalk(providers, universe, teamDefenses);
    await recordCrosswalk(db, crosswalkRows(resolution, RESOLVED_AT));
    expect(await nflPlayerIdFor(db, "DST-LAR")).toBe("team-def:LA");
  });
});
