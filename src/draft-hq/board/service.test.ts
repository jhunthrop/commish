import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research-ts/db/client";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { nflPlayers, nflverseTeamDefenseWeeks, playerCrosswalk, players, preseasonBoardReasons, preseasonProjections } from "@research-ts/db/schema";
import { leagues, scoringSettings, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { HALF_PPR_SCORING, PPR_SCORING } from "@research-ts/domain/scoring";
import { roundPoints } from "@research-ts/scoring";
import { valueOrderFor } from "@/draft-service/sim/value-order";
import type { TeamDefenseWeekRow } from "@research-ts/projections/nflverse/team-defense-weeks";
import { boardSourceFor } from "@research-ts/projections/preseason/board-formats";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { leagueBoardFormat } from "@/league-service/board-format";
import { BOARD_LAST_SEASON, boardRows, isProjectedRow, resolveBoardFormat } from "@research-ts/board/service";

/** One archived defense week for the Rams, in the archive's OWN spelling (`LA`) — the fold onto
 *  the product's `DST-LAR` is the reader's job, and this fixture must not do it for it. */
function defenseWeekRow(overrides: Partial<TeamDefenseWeekRow>): TeamDefenseWeekRow & { readonly source: string } {
  return {
    season: BOARD_LAST_SEASON, week: 1, team: "LA", opponentTeam: "SF",
    sacks: 0, interceptions: 0, fumbleRecoveries: 0, defensiveTouchdowns: 0, safeties: 0,
    puntBlocks: 0, extraPointBlocks: 0, fieldGoalBlocks: 0, specialTeamsTouchdowns: 0,
    passingYardsAllowed: 0, rushingYardsAllowed: 0, sackYardsLostAllowed: 0, pointsAllowed: null,
    source: "nflverse_team_defense_weeks",
    ...overrides,
  };
}

/**
 * `boardRows` is the one place the stored evidence board (keyed on `nfl_players.id`) is joined
 * back to the product's own player directory (`players`, keyed on the stats provider's id) and
 * recomputed for a league's own shape — real enough machinery (a reverse crosswalk join plus
 * `decide/replacement.ts`'s value/tier math) that it earns a DB-backed test over the seam a unit
 * test of `valueBoard` alone cannot see: does the join actually resolve.
 */
describe("boardRows", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  afterEach(async () => {
    await truncateAll(db);
  });

  async function seedPlayer(input: { readonly id: string; readonly nflId: string; readonly name: string; readonly position: "RB" | "WR" | "QB"; readonly team: string; readonly points: number; readonly rank: number; readonly adp: number | null }): Promise<void> {
    await db.insert(nflPlayers).values({ id: input.nflId, name: input.name, position: input.position });
    await db.insert(players).values({ id: input.id, name: input.name, position: input.position, nflTeam: input.team, adp: input.adp });
    await db.insert(playerCrosswalk).values({ playerId: input.id, nflPlayerId: input.nflId, method: "espn_id", resolvedAt: new Date() });
    await db.insert(preseasonProjections).values({
      season: PRODUCT_SEASON,
      source: BOARD_SOURCE,
      playerId: input.nflId,
      rank: input.rank,
      positionRank: 1,
      projectedPoints: input.points,
      valueOverReplacement: input.points,
      valueRank: input.rank,
      expectedGames: 17,
      floorPoints: input.points - 20,
      medianPoints: input.points,
      ceilingPoints: input.points + 20,
      tier: 0,
      asOf: new Date("2026-08-01T00:00:00Z"),
      momentKind: "live",
    });
  }

  it("joins a stored board back to real players and recomputes value/tier under the given shape", async () => {
    await seedPlayer({ id: "p1", nflId: "00-0000001", name: "Top Back", position: "RB", team: "SF", points: 300, rank: 1, adp: 1.2 });
    await seedPlayer({ id: "p2", nflId: "00-0000002", name: "Second Back", position: "RB", team: "DAL", points: 250, rank: 2, adp: 3.5 });
    await seedPlayer({ id: "p3", nflId: "00-0000003", name: "A Receiver", position: "WR", team: "MIA", points: 280, rank: 3, adp: null });

    const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS }, asOf: new Date("2026-09-04T00:00:00Z") });

    expect(rows).toHaveLength(3);
    // VALUE ordering (founder ruling 2026-09-04): the WR's 280 points clear the WR replacement
    // line by more than the second RB's 250 clear the RB line, so the served order flips the
    // raw points-rank order — QBs stop crowning the board for the same reason. `rank` stays the
    // stored points-rank provenance; `overallRank` is the served, value-ordered rank.
    expect(rows.map((row) => row.name)).toEqual(["Top Back", "A Receiver", "Second Back"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 3, 2]);
    expect(rows.map((row) => row.overallRank)).toEqual([1, 2, 3]);
    for (let i = 1; i < rows.length; i += 1) {
      expect((rows[i - 1]!.valueRank ?? Infinity) <= (rows[i]!.valueRank ?? Infinity)).toBe(true);
    }
    const topBack = rows.find((row) => row.playerId === "p1");
    expect(topBack?.name).toBe("Top Back");
    expect(topBack?.marketAdp).toBe(1.2);
    expect(topBack?.valueOverReplacement).not.toBeNull();
    // Market edge = ADP minus rank; a player with no ADP reads null rather than a fabricated edge.
    const unlisted = rows.find((row) => row.playerId === "p3");
    expect(unlisted?.marketAdp).toBeNull();
  });

  /** The roster-status gate (2026-09-08): a stored `roster_status` reason, as the board writes it. */
  async function seedRosterStatus(nflId: string, status: "injured_reserve" | "practice_squad", team: string): Promise<void> {
    await db.insert(preseasonBoardReasons).values({
      season: PRODUCT_SEASON,
      source: BOARD_SOURCE,
      playerId: nflId,
      code: "roster_status",
      detail: "",
      payload: { status, source: "tank01_player_list", observedAt: "2026-09-05T22:35:00.000Z", team },
    });
  }

  it("carries a ranked player's roster status as a note, read off the board's own reason", async () => {
    await seedPlayer({ id: "p1", nflId: "00-0000001", name: "Top Back", position: "RB", team: "KC", points: 300, rank: 1, adp: 1.2 });
    await seedRosterStatus("00-0000001", "injured_reserve", "KC");

    const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS }, asOf: new Date("2026-09-08T00:00:00Z") });
    expect(rows.find((row) => row.playerId === "p1")?.rosterStatus).toEqual({
      status: "injured_reserve",
      source: "tank01_player_list",
      observedAt: "2026-09-05T22:35:00.000Z",
      team: "KC",
      excluded: false,
    });
  });

  it("renders a player the gate took off the board as a band row at the very end, with no projection and no place in the value order", async () => {
    await seedPlayer({ id: "p1", nflId: "00-0000001", name: "Top Back", position: "RB", team: "KC", points: 300, rank: 1, adp: 1.2 });
    // The excluded man: a product row and a crosswalk, but NO projection row, only the status reason.
    await db.insert(nflPlayers).values({ id: "00-0000009", name: "Squad Back", position: "RB" });
    await db.insert(players).values({ id: "p9", name: "Squad Back", position: "RB", nflTeam: "NO", adp: 240.5 });
    await db.insert(playerCrosswalk).values({ playerId: "p9", nflPlayerId: "00-0000009", method: "espn_id", resolvedAt: new Date() });
    await seedRosterStatus("00-0000009", "practice_squad", "NO");

    const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS }, asOf: new Date("2026-09-08T00:00:00Z") });
    const band = rows.at(-1);
    expect(band?.playerId).toBe("p9");
    expect(band?.rosterStatus?.excluded).toBe(true);
    expect(band?.rosterStatus?.status).toBe("practice_squad");
    expect(isProjectedRow(band!)).toBe(false);
    expect(band?.valueRank).toBeNull();
    expect(band?.overallRank).toBeNull();
    expect(band?.tier).toBeNull();
    expect(band?.marketAdp).toBe(240.5);
    expect(band?.team).toBe("NO");
    // The ranked rows are exactly as they would be without him.
    expect(rows.filter((row) => row.overallRank !== null).map((row) => row.playerId)).toEqual(["p1"]);
  });

  it("breaks an exact value tie by the market's order, and the badges follow the served order", async () => {
    // Founder audit 2026-09-04: two RBs identical in points and value were split by a sort
    // artifact against the market. The earlier ADP now leads the tie, and wears the 1 badge.
    await seedPlayer({ id: "t1", nflId: "00-0000011", name: "Later Market Back", position: "RB", team: "ATL", points: 200, rank: 1, adp: 4.2 });
    await seedPlayer({ id: "t2", nflId: "00-0000012", name: "Earlier Market Back", position: "RB", team: "DET", points: 200, rank: 2, adp: 2.5 });
    const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS }, asOf: new Date("2026-09-04T00:00:00Z") });
    const names = rows.filter((row) => row.position === "RB").map((row) => row.name);
    expect(names).toEqual(["Earlier Market Back", "Later Market Back"]);
    const earlier = rows.find((row) => row.name === "Earlier Market Back");
    const later = rows.find((row) => row.name === "Later Market Back");
    expect(earlier?.positionRankInValue).toBe(1);
    expect(later?.positionRankInValue).toBe(2);
  });

  it("hands the Simulator the identical order it serves, tie by the market included", async () => {
    // The Board and the Simulator sit side by side on one screen, so they share ONE comparator
    // (`compareBoardOrder`). Two backs identical to the hundredth in points, and therefore in
    // value, with the earlier ADP belonging to the LATER player id: only the market can separate
    // them, and both surfaces have to separate them the same way.
    const SHAPE = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };
    const tied = [
      { id: "s1", nflId: "00-0000021", name: "Later Market", points: 210.55, rank: 1, adp: 6.4 },
      { id: "s2", nflId: "00-0000022", name: "Earlier Market", points: 210.55, rank: 2, adp: 3.1 },
    ] as const;
    for (const row of tied) {
      await seedPlayer({ ...row, position: "RB", team: "ATL" });
    }
    await seedPlayer({ id: "s3", nflId: "00-0000023", name: "Best Back", position: "RB", team: "SF", points: 320, rank: 3, adp: 1.1 });

    const rows = await boardRows(db, { shape: SHAPE, asOf: new Date("2026-09-04T00:00:00Z") });
    const boardOrder = rows.map((row) => row.playerId);
    expect(boardOrder).toEqual(["s3", "s2", "s1"]);

    // The sim reads the same players out of `evidencePoolFor`'s own shape: points plus a market
    // RANK rather than an ADP, which agrees with the ADP on order and is all a tiebreak reads.
    const simOrder = valueOrderFor(
      rows.filter(isProjectedRow).map((row) => ({ playerId: row.playerId, position: row.position, projectedPoints: row.projectedPoints, marketRank: row.marketAdp })),
      SHAPE,
    ).map((entry) => entry.playerId);
    expect(simOrder).toEqual(boardOrder);
  });

  it("drops a stored row whose player the crosswalk cannot resolve back to the product's own directory", async () => {
    await db.insert(nflPlayers).values({ id: "00-orphan", name: "Ghost Player", position: "RB" });
    await db.insert(preseasonProjections).values({
      season: PRODUCT_SEASON,
      source: BOARD_SOURCE,
      playerId: "00-orphan",
      rank: 1,
      positionRank: 1,
      projectedPoints: 300,
      valueOverReplacement: 300,
      valueRank: 1,
      expectedGames: 17,
      floorPoints: 280,
      medianPoints: 300,
      ceilingPoints: 320,
      tier: 0,
      asOf: new Date("2026-08-01T00:00:00Z"),
      momentKind: "live",
    });

    const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS }, asOf: new Date("2026-09-04T00:00:00Z") });
    expect(rows).toHaveLength(0);
  });

  it("returns nothing when no board has been built for the season yet", async () => {
    const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } });
    expect(rows).toEqual([]);
  });

  /**
   * A POSITION THAT SHIPS IN MARKET ORDER (the 2026-09-05 kicker and team defence round). Both the
   * kicker and the team defence failed their preregistered gates on 2025, so `preseason_projections`
   * holds not one row for either. Without these rows their board tabs read "No players match this
   * filter", which is not what the decision rule asks for and is not even true: the players exist
   * and the market has an opinion about them.
   */
  describe("a position with no projection", () => {
    async function seedMarketOnly(input: { readonly id: string; readonly position: "K" | "DEF"; readonly team: string; readonly adp: number | null }): Promise<void> {
      await db.insert(players).values({ id: input.id, name: `${input.team} ${input.position}`, position: input.position, nflTeam: input.team, adp: input.adp, posAdp: `${input.position}1` });
    }

    it("lists the position in the market's own order, with every projection field absent", async () => {
      await seedPlayer({ id: "p1", nflId: "00-0000001", name: "Top Back", position: "RB", team: "SF", points: 300, rank: 1, adp: 1.2 });
      await seedMarketOnly({ id: "k-late", position: "K", team: "DEN", adp: 150.4 });
      await seedMarketOnly({ id: "k-early", position: "K", team: "DAL", adp: 130.1 });
      await seedMarketOnly({ id: "def-one", position: "DEF", team: "BAL", adp: 120.0 });

      const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } });
      const kickers = rows.filter((row) => row.position === "K");

      expect(kickers.map((row) => row.playerId)).toEqual(["k-early", "k-late"]);
      expect(kickers.map((row) => row.marketOrderRank)).toEqual([1, 2]);
      expect(rows.filter((row) => row.position === "DEF").map((row) => row.marketOrderRank)).toEqual([1]);

      for (const row of rows.filter((entry) => entry.position === "K" || entry.position === "DEF")) {
        // NULL, never 0, on every one of them. A zero is a claim; absence is the truth.
        expect(row.projectedPoints).toBeNull();
        expect(row.floorPoints).toBeNull();
        expect(row.medianPoints).toBeNull();
        expect(row.ceilingPoints).toBeNull();
        expect(row.valueOverReplacement).toBeNull();
        expect(row.valueRank).toBeNull();
        expect(row.positionRankInValue).toBeNull();
        expect(row.tier).toBeNull();
        expect(row.playersLeftInTier).toBeNull();
        expect(row.dropToNextTier).toBeNull();
        expect(row.rank).toBeNull();
        expect(row.overallRank).toBeNull();
        expect(row.reasons).toEqual([]);
        // The one thing it does carry.
        expect(row.marketAdp).not.toBeNull();
      }
    });

    it("leaves a player the market has no opinion about off the board entirely", async () => {
      await seedMarketOnly({ id: "k-unlisted", position: "K", team: "NYJ", adp: null });
      const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } });
      expect(rows).toEqual([]);
    });

    it("cannot perturb a single projected row, which is gate G4's guarantee at the surface", async () => {
      await seedPlayer({ id: "p1", nflId: "00-0000001", name: "Top Back", position: "RB", team: "SF", points: 300, rank: 1, adp: 1.2 });
      await seedPlayer({ id: "p2", nflId: "00-0000002", name: "A Receiver", position: "WR", team: "MIA", points: 280, rank: 2, adp: 3.5 });
      const shape = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };
      const withoutMarketRows = await boardRows(db, { shape });

      await seedMarketOnly({ id: "k-one", position: "K", team: "DAL", adp: 130.1 });
      await seedMarketOnly({ id: "def-one", position: "DEF", team: "BAL", adp: 120.0 });
      const withMarketRows = await boardRows(db, { shape });

      expect(withMarketRows.filter((row) => row.position !== "K" && row.position !== "DEF")).toEqual(withoutMarketRows);
      // And they land AFTER every projected row rather than interleaved into the value order.
      expect(withMarketRows.slice(0, withoutMarketRows.length)).toEqual(withoutMarketRows);
    });

    /**
     * LAST SEASON IS THE ONE NUMBER THESE ROWS CAN CARRY (the 2026-09-06 round). The engine
     * projects nothing for either position and that is unchanged. The archive holds what they
     * actually did, and `kdefSeasonLines` scores it under this league's own rules.
     */
    it("carries last season's measured points, games and rate on a market-order row", async () => {
      await seedMarketOnly({ id: "DST-LAR", position: "DEF", team: "LAR", adp: 120.0 });
      await db.insert(nflverseTeamDefenseWeeks).values([
        defenseWeekRow({ week: 1, sacks: 3, interceptions: 2, pointsAllowed: 10, passingYardsAllowed: 180, rushingYardsAllowed: 90 }),
        defenseWeekRow({ week: 2, sacks: 1, interceptions: 0, pointsAllowed: 24, passingYardsAllowed: 250, rushingYardsAllowed: 120 }),
      ]);

      const [row] = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } });
      expect(row?.lastSeason?.season).toBe(BOARD_LAST_SEASON);
      expect(row?.lastSeason?.games).toBe(2);
      expect(row?.lastSeason?.points).toBeGreaterThan(0);
      expect(row?.lastSeason?.pointsPerGame).toBe(roundPoints(row!.lastSeason!.points / 2));
      // Still no projection. The two facts sit side by side without either becoming the other.
      expect(row?.projectedPoints).toBeNull();
    });

    it("leaves lastSeason null on a market-order row the archive holds nothing for", async () => {
      await seedMarketOnly({ id: "DST-LAR", position: "DEF", team: "LAR", adp: 120.0 });
      const [row] = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } });
      expect(row?.lastSeason).toBeNull();
    });

    it("leaves lastSeason null on every projected row, whatever the archive holds", async () => {
      await seedPlayer({ id: "p1", nflId: "00-0000001", name: "Top Back", position: "RB", team: "SF", points: 300, rank: 1, adp: 1.2 });
      const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } });
      expect(rows.map((row) => row.lastSeason)).toEqual([null]);
    });

    it("a half-PPR league reads the HALF board, decided by its scoring row, and a league-free read names its format (the scoring-formats round)", async () => {
      await db.insert(users).values({ id: "u1", email: "one@example.com", displayName: "One" });
      await db.insert(leagues).values({ id: "half-league", name: "Half Points", format: "snake", teamCount: 12, commissionerUserId: "u1" });
      await db.insert(scoringSettings).values({ leagueId: "half-league", ...HALF_PPR_SCORING });
      await seedPlayer({ id: "p1", nflId: "00-0000001", name: "Catch Machine", position: "WR", team: "SF", points: 300, rank: 1, adp: 1.2 });
      // The same man on the half board, 45 points lighter (ninety catches at half a point less).
      await db.insert(preseasonProjections).values({
        season: PRODUCT_SEASON, source: boardSourceFor("half"), playerId: "00-0000001", rank: 1, positionRank: 1,
        projectedPoints: 255, valueOverReplacement: 255, valueRank: 1, expectedGames: 17,
        floorPoints: 235, medianPoints: 255, ceilingPoints: 275, tier: 0, asOf: new Date("2026-08-01T00:00:00Z"), momentKind: "live",
      });

      const shape = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };
      const [pprRow] = await boardRows(db, { shape });
      const [leagueRow] = await boardRows(db, { shape, resolved: await leagueBoardFormat(db, "half-league") });
      const [chosenRow] = await boardRows(db, { shape, format: "half" });
      expect(pprRow!.projectedPoints).toBe(300);
      expect(leagueRow!.projectedPoints).toBe(255);
      expect(chosenRow!.projectedPoints).toBe(255);
      // Inside a league the league decides: a selector's format is ignored when a league is named.
      const [ignored] = await boardRows(db, { shape, resolved: await leagueBoardFormat(db, "half-league"), format: "std" });
      expect(ignored!.projectedPoints).toBe(255);
      expect(resolveBoardFormat({ resolved: await leagueBoardFormat(db, "half-league") }).basisLine).toBe(`${PRODUCT_SEASON} board, 12-team half PPR, in board order`);
    });

    it("measures last season under the LEAGUE's own scoring when one is named", async () => {
      await db.insert(users).values({ id: "u1", email: "one@example.com", displayName: "One" });
      await db.insert(leagues).values({ id: "l1", name: "Sack Heavy", format: "snake", teamCount: 12, commissionerUserId: "u1" });
      await db.insert(scoringSettings).values({ leagueId: "l1", ...PPR_SCORING, pointsPerSack: 10 });
      await seedMarketOnly({ id: "DST-LAR", position: "DEF", team: "LAR", adp: 120.0 });
      await db.insert(nflverseTeamDefenseWeeks).values([defenseWeekRow({ week: 1, sacks: 4, pointsAllowed: 10 })]);

      const shape = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };
      const [generic] = await boardRows(db, { shape });
      const [league] = await boardRows(db, { shape, resolved: await leagueBoardFormat(db, "l1") });
      expect(league!.lastSeason!.points - generic!.lastSeason!.points).toBe(4 * (10 - PPR_SCORING.pointsPerSack));
    });
  });
});
