import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { nflGames } from "@research/db/schema";
import { createTestDb, recordStatements, truncateAll } from "@research/db/test-db";
import { SEASON_CONFIG } from "@research/domain/season";
import { byeWeeksByTeam, fixtureLabelsByTeam } from "./nfl-schedule";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

/** `away` at `home` in every regular-season week except `except` — a season series whose one
 *  hole is the pair's bye. Omit `except` for a (hypothetical) team that never rests. */
function seasonSeries(home: string, away: string, { except }: { readonly except?: number } = {}) {
  return Array.from({ length: SEASON_CONFIG.fantasyRegularSeasonWeeks }, (_, index) => index + 1)
    .filter((week) => week !== except)
    .map((week) => ({
      gameId: `w${week}_${away}@${home}`,
      week,
      homeNflTeam: home,
      awayNflTeam: away,
      status: "scheduled" as const,
    }));
}

describe("byeWeeksByTeam", () => {
  it("names the one missing regular-season week for each team, from either side of the fixture", async () => {
    await db.insert(nflGames).values([
      ...seasonSeries("KC", "DEN", { except: 7 }),
      ...seasonSeries("SF", "SEA", { except: 11 }),
    ]);
    const byes = await byeWeeksByTeam(db);
    expect(byes.get("KC")).toBe(7);
    expect(byes.get("DEN")).toBe(7);
    expect(byes.get("SF")).toBe(11);
    expect(byes.get("SEA")).toBe(11);
  });

  it("omits a team with no bye inside the regular season", async () => {
    await db.insert(nflGames).values([
      ...seasonSeries("KC", "DEN", { except: 7 }),
      // SF/SEA play all fourteen weeks — no hole, so no bye to report.
      ...seasonSeries("SF", "SEA"),
    ]);
    const byes = await byeWeeksByTeam(db);
    expect(byes.get("KC")).toBe(7);
    expect(byes.has("SF")).toBe(false);
    expect(byes.has("SEA")).toBe(false);
  });

  it("omits a team whose schedule is only partially ingested, rather than inventing a bye", async () => {
    await db.insert(nflGames).values([
      { gameId: "w1_BAL@PIT", week: 1, homeNflTeam: "PIT", awayNflTeam: "BAL", status: "scheduled" as const },
    ]);
    expect((await byeWeeksByTeam(db)).size).toBe(0);
  });

  it("ignores games outside the regular-season window entirely", async () => {
    await db.insert(nflGames).values([
      ...seasonSeries("KC", "DEN", { except: 7 }),
      // A week-15 game neither fills KC's bye nor introduces MIA to the map.
      {
        gameId: "w15_MIA@KC",
        week: SEASON_CONFIG.fantasyRegularSeasonWeeks + 1,
        homeNflTeam: "KC",
        awayNflTeam: "MIA",
        status: "scheduled" as const,
      },
    ]);
    const byes = await byeWeeksByTeam(db);
    expect(byes.get("KC")).toBe(7);
    expect(byes.has("MIA")).toBe(false);
  });

  it("returns an empty map when no schedule has been ingested", async () => {
    expect((await byeWeeksByTeam(db)).size).toBe(0);
  });
});

describe("the reference memos (Neon cost audit finding 7)", () => {
  it("serves byes and a week's fixtures from memory on the second read: no statement at all", async () => {
    await db.insert(nflGames).values([...seasonSeries("KC", "DEN", { except: 7 })]);
    await byeWeeksByTeam(db);
    await fixtureLabelsByTeam(db, 1);
    const statements = await recordStatements(db, async (logged) => {
      expect((await byeWeeksByTeam(logged)).get("KC")).toBe(7);
      expect((await fixtureLabelsByTeam(logged, 1)).get("KC")).toMatchObject({ opp: "vs DEN" });
    });
    expect(statements).toEqual([]);
  });

  it("keys fixtures by week: another week reads once", async () => {
    await db.insert(nflGames).values([...seasonSeries("KC", "DEN", { except: 7 })]);
    await fixtureLabelsByTeam(db, 1);
    const statements = await recordStatements(db, (logged) => fixtureLabelsByTeam(logged, 2));
    expect(statements).toHaveLength(1);
  });
});
