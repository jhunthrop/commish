import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { leagueNameFor, listTeamCards } from "./teams";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("listTeamCards", () => {
  it("orders by team id, not by insertion order, and carries each owner's avatar (or its absence)", async () => {
    const leagueId = "league_cards";
    // Two owners: one with an avatar, one without — so the card correctly reports both.
    await db.insert(users).values([
      { id: "user_z", email: "user_z@test.local", displayName: "Zed Owner", avatarUrl: "https://example.test/avatars/zed.png" },
      { id: "user_a", email: "user_a@test.local", displayName: "Ada Owner" },
    ]);
    await db.insert(leagues).values({
      id: leagueId, name: leagueId, format: "snake", teamCount: 2,
      commissionerUserId: "user_a", rosterSlots: [...STANDARD_ROSTER_SLOTS],
    });
    // Inserted in reverse id order — proves the result is actually ORDER BY id, not just
    // insertion order echoed back.
    await db.insert(teams).values([
      { id: "team_b", leagueId, userId: "user_z", name: "Team B" },
      { id: "team_a", leagueId, userId: "user_a", name: "Team A" },
    ]);

    const cards = await listTeamCards(db, leagueId);
    expect(cards.map((card) => card.id)).toEqual(["team_a", "team_b"]);
    expect(cards[0]).toMatchObject({ id: "team_a", name: "Team A", ownerDisplayName: "Ada Owner", ownerAvatarUrl: null });
    expect(cards[1]).toMatchObject({
      id: "team_b", name: "Team B", ownerDisplayName: "Zed Owner", ownerAvatarUrl: "https://example.test/avatars/zed.png",
    });
  });
});

describe("leagueNameFor", () => {
  it("returns the league's real name", async () => {
    const leagueId = "league_named";
    await db.insert(users).values({ id: "user_named", email: "user_named@test.local", displayName: "Owner" });
    await db.insert(leagues).values({
      id: leagueId, name: "The Real Name", format: "snake", teamCount: 2,
      commissionerUserId: "user_named", rosterSlots: [...STANDARD_ROSTER_SLOTS],
    });
    expect(await leagueNameFor(db, leagueId)).toBe("The Real Name");
  });

  it("falls back to the league id when the row somehow isn't there", async () => {
    // A draft's `leagueId` is a NOT NULL foreign key, so this can't happen through real
    // Postgres — a stub `Db` is the only way to put the code in the state it defends against.
    const stubDb = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) } as unknown as Db;
    expect(await leagueNameFor(stubDb, "league_ghost")).toBe("league_ghost");
  });
});
