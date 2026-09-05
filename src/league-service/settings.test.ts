import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { createLeague } from "./creation";
import { setDraftGradesVisible } from "./settings";

const db = createTestDb();
const clock = { now: () => "2026-09-05T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

async function league(): Promise<{ readonly leagueId: string }> {
  await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Manager 1" });
  const created = await createLeague({ db, clock, newId }, {
    name: "Sunday Money", format: "snake", teamCount: 12, scoringPreset: "ppr",
    auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  return { leagueId: created.leagueId };
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("setDraftGradesVisible", () => {
  it("defaults on, exactly as `draft-grades-job.test.ts` already relies on for a league nobody has touched", async () => {
    const { leagueId } = await league();
    const [row] = await db.select({ draftGradesVisible: leagues.draftGradesVisible }).from(leagues).where(eq(leagues.id, leagueId));
    expect(row?.draftGradesVisible).toBe(true);
  });

  it("flips the flag both ways, freely — no state-machine gate on a display preference", async () => {
    const { leagueId } = await league();
    await setDraftGradesVisible(db, { leagueId, visible: false });
    let [row] = await db.select({ draftGradesVisible: leagues.draftGradesVisible }).from(leagues).where(eq(leagues.id, leagueId));
    expect(row?.draftGradesVisible).toBe(false);

    await setDraftGradesVisible(db, { leagueId, visible: true });
    [row] = await db.select({ draftGradesVisible: leagues.draftGradesVisible }).from(leagues).where(eq(leagues.id, leagueId));
    expect(row?.draftGradesVisible).toBe(true);
  });
});
