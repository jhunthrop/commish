import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research-ts/db/client";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@research-ts/db/schema";
import { drafts, leagues, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { boardRows } from "@research-ts/board/service";
import { basisSentence, boardOptionsFor, draftAreaContext } from "./context";
import { sheetEntryViews } from "../sheet/view";
import { sheetColumnsPayload } from "../sheet/columns-payload";
import { createSheet, upsertEntry, getSheet } from "../sheet/service";

/**
 * ONE RULE UNDER ONE HEADING (fix round 1, H3).
 *
 * The Board and Your sheet print the same named quantity for the same player under one
 * `<h1>Draft</h1>`, and they used to compute it differently: the board took the caller's
 * next-drafting league, the sheet hard-wired league-free. Nacua read 69.1 on one stop and 162.8
 * on the other, each with an honest basis, which is worse than either being wrong. DB-backed,
 * because the thing being asserted is that two real reads agree.
 */
describe("the Draft area's league context", () => {
  let db: Db;
  const USER = "user-ctx";
  const LEAGUE = "league-ctx";
  const NACUA = "p-nacua";

  async function seedPlayer(input: { readonly id: string; readonly nflId: string; readonly name: string; readonly position: "RB" | "WR"; readonly points: number; readonly rank: number }): Promise<void> {
    await db.insert(nflPlayers).values({ id: input.nflId, name: input.name, position: input.position });
    await db.insert(players).values({ id: input.id, name: input.name, position: input.position, nflTeam: "LAR", adp: input.rank });
    await db.insert(playerCrosswalk).values({ playerId: input.id, nflPlayerId: input.nflId, method: "espn_id", resolvedAt: new Date() });
    await db.insert(preseasonProjections).values({
      season: PRODUCT_SEASON,
      source: BOARD_SOURCE,
      playerId: input.nflId,
      rank: input.rank,
      positionRank: input.rank,
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

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(users).values({ id: USER, displayName: "Ctx", email: "ctx@example.com" });
    // A two-team league, which is where the two stops disagreed most loudly: replacement is the
    // second starter, so every number collapses toward zero and the gap is impossible to miss.
    await db.insert(leagues).values({ id: LEAGUE, name: "Two Team League", format: "snake", teamCount: 2, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: USER });
    await db.insert(teams).values({ id: "team-ctx", leagueId: LEAGUE, userId: USER, name: "Mine" });
    await db.insert(drafts).values({ id: "draft-ctx", leagueId: LEAGUE, format: "snake", status: "scheduled", kickoffAt: new Date(Date.now() + 86_400_000) });

    await seedPlayer({ id: NACUA, nflId: "00-0000101", name: "Puka Nacua", position: "WR", points: 344.3, rank: 1 });
    await seedPlayer({ id: "p-chase", nflId: "00-0000102", name: "Ja'Marr Chase", position: "WR", points: 329.4, rank: 2 });
    await seedPlayer({ id: "p-gibbs", nflId: "00-0000103", name: "Jahmyr Gibbs", position: "RB", points: 257.2, rank: 3 });
  });

  afterEach(async () => {
    await truncateAll(db);
  });

  it("gives both stops the same number for the same player, with no query at all", async () => {
    const context = await draftAreaContext(db, USER, {});
    // With no `?league=`, the context defaults to the caller's next-drafting league on BOTH stops.
    expect(context.selected?.leagueId).toBe(LEAGUE);
    expect(context.shape.teamCount).toBe(2);

    const board = await boardRows(db, boardOptionsFor(context));
    const onBoard = board.find((row) => row.playerId === NACUA);

    const sheet = await createSheet(db, USER, { name: "Mine" });
    await upsertEntry(db, USER, sheet.id, NACUA);
    const stored = await getSheet(db, USER, sheet.id);
    const { entries, board: sheetBoard } = await sheetEntryViews(db, stored!, boardOptionsFor(context));
    const payload = sheetColumnsPayload(entries, sheetBoard);
    const onSheet = payload.values.find(([id]) => id === NACUA);

    expect(onBoard?.valueOverReplacement).not.toBeNull();
    expect(onSheet?.[1]).toBe(onBoard?.valueOverReplacement);
  });

  it("carries the league and the format to the next stop, so a stop change moves nothing else", async () => {
    const inLeague = await draftAreaContext(db, USER, { league: LEAGUE });
    expect(inLeague.query).toEqual({ league: LEAGUE });

    const generic = await draftAreaContext(db, USER, { league: "generic", format: "std" });
    expect(generic.query).toEqual({ league: "generic", format: "std" });
    expect(generic.isGeneric).toBe(true);
    expect(generic.shape.teamCount).toBe(12);
  });

  it("degrades a stale league id to the generic board rather than a 404", async () => {
    const context = await draftAreaContext(db, USER, { league: "league-that-left" });
    expect(context.isGeneric).toBe(true);
    expect(context.selected).toBeNull();
  });
});

describe("the basis sentence", () => {
  it("states the league's OWN team count, and only that one", () => {
    // M2: it used to read "…: 2 teams, its own roster shape. 2026 board, 12-team PPR, in board
    // order" — two team counts for one set of numbers, because the stored board's own 12-team
    // clause rode along beside the league's real shape.
    const sentence = basisSentence(
      {
        leagues: [],
        selected: { leagueId: "l", leagueName: "Two Team League", format: "snake", teamCount: 2, rosterSlots: STANDARD_ROSTER_SLOTS, kickoffAt: "" },
        isGeneric: false,
        pickerValue: "next",
        shape: { teamCount: 2, rosterSlots: STANDARD_ROSTER_SLOTS },
        format: "ppr",
        explicitFormat: false,
        resolved: { format: "ppr", exact: true, source: "s", label: "PPR", rules: {} as never, basisLine: "", scoringLine: "", note: null },
        query: {},
      },
      2026,
    );
    expect(sentence).toBe("Two Team League: 2 teams, its own roster shape. PPR, 2026 projections.");
    expect(sentence).not.toContain("12-team");
  });

  it("keeps the twelve on the generic board, where it is the whole point of the word", () => {
    const sentence = basisSentence(
      {
        leagues: [],
        selected: null,
        isGeneric: true,
        pickerValue: "generic",
        shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS },
        format: "half",
        explicitFormat: true,
        resolved: { format: "half", exact: true, source: "s", label: "Half PPR", rules: {} as never, basisLine: "", scoringLine: "", note: null },
        query: {},
      },
      2026,
    );
    expect(sentence).toBe("Generic board: 12 teams, a standard roster shape. Half PPR, 2026 projections.");
  });
});
