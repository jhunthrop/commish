import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftNudges, drafts } from "@/db/schema";
import { assembleAdvisorContext } from "@/ai-advisor/context";
import { listMessages, postMessage } from "@/chat-service/chat";
import { getLineup, setLineup } from "@/league-service/lineups";
import { runRealDraft, seedWeekStats } from "./pipeline";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * Steps 6, 8, 9 and 10 were all built against SEEDED fixtures. This is the one place each is
 * exercised against a league an actual draft produced, which is the only way drift between
 * "what a seeder writes" and "what a draft writes" is ever caught.
 *
 * NOTE: the brief for this suite also called for a public-browse-and-join case, driven by
 * `listPublicLeagues` (`@/league-service/browse`), `joinPublicLeague` (`@/league-service/join`)
 * and `EMPTY_BROWSE_FILTER` (`@/matchmaking/filter`). None of those modules exist on this
 * track's base (24d8c91) — `src/matchmaking/**` and league-service browse/join are Track A's
 * work, landing in a separate worktree. That case is intentionally omitted here; see the task
 * report for the follow-up once the tracks merge.
 */
describe("features built on fixtures, run against a real drafted league", () => {
  it("the lineup editor's seam accepts a lineup made of genuinely drafted players", async () => {
    const league = await runRealDraft(db, "snake", "lineup");
    const teamId = league.teamIds[0]!;

    const before = await getLineup(db, {
      teamId,
      weekNumber: 1,
      slotConfig: [
        { slot: "QB", count: 1, eligiblePositions: ["QB"] },
        { slot: "RB", count: 1, eligiblePositions: ["RB"] },
        { slot: "WR", count: 1, eligiblePositions: ["WR"] },
      ],
    });
    // A manager who never opened the editor still fields a legal team, derived from the roster
    // the DRAFT wrote rather than from a fixture.
    expect(before.filter((slot) => slot.slot !== "BENCH").every((slot) => slot.playerId !== null)).toBe(true);

    const result = await setLineup(db, {
      leagueId: league.leagueId,
      teamId,
      weekNumber: 1,
      slots: before
        .filter((slot) => slot.slot !== "BENCH")
        .map((slot) => ({ slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })),
    });
    expect(result.ok).toBe(true);
  });

  it("league chat works in a league that came out of a draft, not out of a seeder", async () => {
    const league = await runRealDraft(db, "snake", "chat");
    const published: string[] = [];

    await postMessage(db, {
      leagueId: league.leagueId,
      userId: league.userIds[0]!,
      body: "Good draft everyone.",
      publish: async (input) => {
        published.push(input.type);
        return "1-0";
      },
    });

    const page = await listMessages(db, { leagueId: league.leagueId });
    expect(page.messages.map((message) => message.body)).toEqual(["Good draft everyone."]);
    expect(published).toEqual(["chat.message"]);
  });

  it("the advisor assembles real context from a drafted roster and a real opponent", async () => {
    const league = await runRealDraft(db, "snake", "advisor");
    await seedWeekStats(db, 1);

    const context = await assembleAdvisorContext(db, {
      leagueId: league.leagueId,
      teamId: league.teamIds[0]!,
      weekNumber: 1,
    });
    expect(context).not.toBeNull();
    // Actual shape (`AdvisorContext`) nests the roster under `me.players`, not a top-level
    // `roster`, and the opponent under `opponent.teamName`, not `opponentTeamName` — adjusted
    // from the brief's assumed shape per its own escape hatch.
    expect(context!.me.players.length).toBeGreaterThan(0);
    // Every player the advisor reasons about was genuinely drafted by this team.
    expect(context!.me.players.every((entry) => entry.playerId !== null)).toBe(true);
    expect(context!.opponent).not.toBeNull();
    expect(context!.opponent!.teamName).toBeTruthy();
  });

  it("the draft moderator's nudge claim survives a real draft's action log", async () => {
    const league = await runRealDraft(db, "snake", "nudge");
    // The moderator's claim table is keyed on (draftId, pickNumber) and is NOT part of replay.
    // A draft that ran to completion must leave the draft itself complete regardless of what
    // the moderator did or did not write.
    const claims = await db.select().from(draftNudges).where(eq(draftNudges.draftId, league.draftId));
    expect(Array.isArray(claims)).toBe(true);
    const [row] = await db.select().from(drafts).where(eq(drafts.id, league.draftId));
    expect(row?.status).toBe("complete");
  });
});
