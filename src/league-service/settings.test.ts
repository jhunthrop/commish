import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { createLeague } from "./creation";
import { renameMyTeam, setDraftGradesVisible } from "./settings";

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

describe("renameMyTeam", () => {
  it("renames the caller's own team and answers the stored name", async () => {
    const { leagueId } = await league();
    const result = await renameMyTeam(db, { leagueId, userId: "u1", name: "Bay Bandits" });
    expect(result).toEqual({ ok: true, name: "Bay Bandits" });

    const [row] = await db.select({ name: teams.name }).from(teams).where(eq(teams.leagueId, leagueId));
    expect(row?.name).toBe("Bay Bandits");
  });

  it("cannot touch anybody else's seat, and says so without disclosing that the league exists", async () => {
    const { leagueId } = await league();
    await db.insert(users).values({ id: "u2", email: "u2@test.local", displayName: "Manager 2" });

    const result = await renameMyTeam(db, { leagueId, userId: "u2", name: "Hostile Takeover" });
    expect(result).toEqual({ ok: false, reason: "That league does not exist.", status: 404 });

    const [row] = await db.select({ name: teams.name }).from(teams).where(eq(teams.leagueId, leagueId));
    expect(row?.name).toBe("Team One");
  });

  it("leaves a seat in a DIFFERENT league alone, even for the same manager", async () => {
    const first = await league();
    const second = await createLeague({ db, clock, newId }, {
      name: "Second Money", format: "snake", teamCount: 12, scoringPreset: "ppr",
      auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team Two" },
      experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
    });
    if (!second.ok) throw new Error(second.reason);

    await renameMyTeam(db, { leagueId: first.leagueId, userId: "u1", name: "Renamed" });
    const [other] = await db.select({ name: teams.name }).from(teams).where(eq(teams.leagueId, second.leagueId));
    expect(other?.name).toBe("Team Two");
  });
});
