import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftNudges, drafts, leagues } from "@/db/schema";
import { assembleAdvisorContext } from "@/ai-advisor/context";
import { listMessages, postMessage } from "@/chat-service/chat";
import { getLineup, setLineup } from "@/league-service/lineups";
import { listPublicLeagues } from "@/league-service/browse";
import { DRAFT_ALREADY_STARTED, joinPublicLeague } from "@/league-service/join";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
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
    // the DRAFT wrote rather than from a fixture. The length assertion comes first: `.every()`
    // on a possibly-empty array is vacuously true, so without it a regression that made
    // `getLineup` return `[]` would pass this line silently.
    const starters = before.filter((slot) => slot.slot !== "BENCH");
    expect(starters).toHaveLength(3);
    expect(starters.every((slot) => slot.playerId !== null)).toBe(true);

    const result = await setLineup(db, {
      leagueId: league.leagueId,
      teamId,
      weekNumber: 1,
      slots: before
        .filter((slot) => slot.slot !== "BENCH")
        .map((slot) => ({ slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })),
      userId: league.userIds[0]!,
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

  it("a store-driven draft writes no moderator claims, and still finishes complete", async () => {
    const league = await runRealDraft(db, "snake", "nudge");
    // The moderator's claim table is keyed on (draftId, pickNumber) and is NOT part of replay.
    // `runRealDraft` drives every turn with TIMER_EXPIRE directly through `store.applyAction`
    // and never through the ticker (`src/draft-service/ticker.ts:78` is the only caller of the
    // nudge scheduler) — so this asserts the real, falsifiable invariant a store-driven draft
    // proves: it is provably empty here, not merely "an array". Real nudge-path coverage (drive
    // `createNudgeScheduler` through a ticker run) is a separate, Phase 2 ledger item.
    const claims = await db.select().from(draftNudges).where(eq(draftNudges.draftId, league.draftId));
    expect(claims).toEqual([]);
    // A draft that ran to completion must leave the draft itself complete regardless of what
    // the moderator did or did not write.
    const [row] = await db.select().from(drafts).where(eq(drafts.id, league.draftId));
    expect(row?.status).toBe("complete");
  });

  it("public browse and public join both correctly exclude a league a real draft already started", async () => {
    const league = await runRealDraft(db, "snake", "browse");
    // `runRealDraft` runs the draft to completion, so this league's `drafts.status` is
    // "complete" — set by the store's OWN commit-on-completion, not by a seeded status column.
    // Flipping it public afterward is what proves the exclusion rule against a genuinely
    // drafted league, which a seeded fixture with a hand-set status can never do.
    await db.update(leagues).set({ isPublicMatchmade: true }).where(eq(leagues.id, league.leagueId));

    // Browse must never surface a league whose draft already ran, even though it is now public.
    const listed = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(listed.leagues.some((row) => row.id === league.leagueId)).toBe(false);

    // And the join door agrees: a stranger posting this league's real id is refused because its
    // draft already started, not silently seated into a league mid-season.
    const result = await joinPublicLeague(
      { db, newId: () => "browse_newcomer_team", clock: { now: () => new Date().toISOString() } },
      { leagueId: league.leagueId, userId: "browse_newcomer" },
    );
    expect(result).toEqual({ ok: false, status: 409, reason: DRAFT_ALREADY_STARTED });
  });
});
