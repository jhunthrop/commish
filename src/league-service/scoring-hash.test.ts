import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { leagues, users } from "@/db/schema";
import { HALF_PPR_SCORING, PPR_SCORING, STANDARD_SCORING } from "@research-ts/domain/scoring";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { scoringHashOf } from "@research-ts/scoring/hash";
import { createLeague } from "./creation";
import { backfillLeagueScoringHashes, scoringHashesInUse } from "./scoring-hash";
import { writeLeagueScoring } from "./settings";

const db = createTestDb();
const clock = { now: () => "2026-09-07T12:00:00.000Z" };
let nextId = 0;
const newId = (): string => `id_${++nextId}`;

async function league(name: string, preset: "ppr" | "standard"): Promise<string> {
  const created = await createLeague({ db, clock, newId }, {
    name, format: "snake", teamCount: 12, scoringPreset: preset,
    auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  return created.leagueId;
}

async function storedHash(leagueId: string): Promise<string | null> {
  const [row] = await db.select({ hash: leagues.scoringHash }).from(leagues).where(eq(leagues.id, leagueId));
  return row?.hash ?? null;
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Manager 1" });
});

afterAll(async () => {
  await truncateAll(db);
});

describe("a league's stored scoring hash", () => {
  it("is written by league creation, from the preset the league was created with", async () => {
    const leagueId = await league("Sunday Money", "ppr");
    expect(await storedHash(leagueId)).toBe(scoringHashOf(PPR_SCORING));
  });

  it("keeps two presets apart", async () => {
    const ppr = await league("Sunday Money", "ppr");
    const standard = await league("Old School", "standard");
    expect(await storedHash(ppr)).not.toBe(await storedHash(standard));
    expect(await storedHash(standard)).toBe(scoringHashOf(STANDARD_SCORING));
  });

  it("moves with the settings, in the one write path", async () => {
    const leagueId = await league("Sunday Money", "ppr");
    const result = await writeLeagueScoring(db, clock, { leagueId, rules: HALF_PPR_SCORING });
    expect(result.previous).toBe(scoringHashOf(PPR_SCORING));
    expect(result.hash).toBe(scoringHashOf(HALF_PPR_SCORING));
    expect(await storedHash(leagueId)).toBe(scoringHashOf(HALF_PPR_SCORING));
  });
});

describe("backfillLeagueScoringHashes", () => {
  it("fills a league whose hash was never computed", async () => {
    const leagueId = await league("Sunday Money", "ppr");
    await db.update(leagues).set({ scoringHash: null }).where(eq(leagues.id, leagueId));

    expect(await backfillLeagueScoringHashes(db)).toBe(1);
    expect(await storedHash(leagueId)).toBe(scoringHashOf(PPR_SCORING));
  });

  it("writes nothing on a second run", async () => {
    await league("Sunday Money", "ppr");
    await backfillLeagueScoringHashes(db);
    expect(await backfillLeagueScoringHashes(db)).toBe(0);
  });

  it("corrects a hash that disagrees with the league's own settings row", async () => {
    const leagueId = await league("Sunday Money", "ppr");
    await db.update(leagues).set({ scoringHash: "not the right digest" }).where(eq(leagues.id, leagueId));

    expect(await backfillLeagueScoringHashes(db)).toBe(1);
    expect(await storedHash(leagueId)).toBe(scoringHashOf(PPR_SCORING));
  });
});

describe("scoringHashesInUse", () => {
  it("names each distinct hash once", async () => {
    await league("Sunday Money", "ppr");
    await league("Sunday Money II", "ppr");
    await league("Old School", "standard");

    expect([...(await scoringHashesInUse(db))].sort()).toEqual([scoringHashOf(PPR_SCORING), scoringHashOf(STANDARD_SCORING)].sort());
  });

  it("leaves out a league whose hash has never been computed rather than counting it under another", async () => {
    const leagueId = await league("Sunday Money", "ppr");
    await db.update(leagues).set({ scoringHash: null }).where(eq(leagues.id, leagueId));

    expect(await scoringHashesInUse(db)).toEqual([]);
  });
});
