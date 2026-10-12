import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research-ts/db/schema";
import { auditEvents, teams, users } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@research-ts/domain/draft";
import { teamOnClock } from "@/draft-engine";
import { createDraftStore } from "@/draft-service/store";
import { SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { verifyFullChainIntegrity } from "@/integrity-service/verify";
import { createInvite, createLeague, acceptInvite } from "@/league-service";
import { joinPublicLeague } from "@/league-service/join";

const db = createTestDb();
const clock = { now: () => "2026-09-01T00:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;
const publish = async () => "1-0";

/** One player per position per team slot, so a three-team sprint draft always fills. */
const POOL_ROWS = [
  { id: "qb1", name: "QB One", position: "QB" as const, nflTeam: "KC" },
  { id: "qb2", name: "QB Two", position: "QB" as const, nflTeam: "SF" },
  { id: "qb3", name: "QB Three", position: "QB" as const, nflTeam: "DAL" },
  { id: "rb1", name: "RB One", position: "RB" as const, nflTeam: "KC" },
  { id: "rb2", name: "RB Two", position: "RB" as const, nflTeam: "SF" },
  { id: "rb3", name: "RB Three", position: "RB" as const, nflTeam: "DAL" },
  { id: "wr1", name: "WR One", position: "WR" as const, nflTeam: "KC" },
  { id: "wr2", name: "WR Two", position: "WR" as const, nflTeam: "SF" },
  { id: "wr3", name: "WR Three", position: "WR" as const, nflTeam: "DAL" },
];

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Commissioner Casey" },
    { id: "u2", email: "u2@test.local", displayName: "Invite Door Robin" },
    { id: "u3", email: "u3@test.local", displayName: "Public Door Sam" },
  ]);
  await db.insert(players).values(POOL_ROWS);
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * The brief's own exit criterion for this wave, run for real rather than asserted by
 * inspection: a full lifecycle — a league created, a member through EACH join door, and a
 * draft pick — lands on one gapless, hash-linked chain that `verifyFullChainIntegrity` confirms
 * clean. A regression in any of the four wired writers (a missing append, a chain picked
 * wrong, a lock taken out of order) would show up here as `valid: false` or a `verifiedThrough`
 * that doesn't match the row count — not just as a per-writer unit test passing in isolation.
 */
describe("audit chain — a full create → join(both doors) → pick lifecycle", () => {
  it("is valid, gapless, and verifiedThrough matches the row count", async () => {
    const created = await createLeague(
      { db, clock, newId },
      {
        name: "Sunday Money", format: "snake", teamCount: 3, scoringPreset: "ppr", auctionBudget: null,
        rosterSlots: SPRINT_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Commish" },
        experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: true,
      },
    );
    if (!created.ok) throw new Error(created.reason);

    // Door 1: invite accept.
    const invite = await createInvite({ db, clock, random: () => 0.5 }, { leagueId: created.leagueId, createdByUserId: "u1" });
    if (!invite.ok) throw new Error(invite.reason);
    const doorInvite = await acceptInvite({ db, clock, newId }, { code: invite.code, userId: "u2" });
    if (!doorInvite.ok) throw new Error(doorInvite.reason);

    // Door 2: public browse join — still open, since the draft hasn't started yet.
    const doorPublic = await joinPublicLeague({ db, newId, clock }, { leagueId: created.leagueId, userId: "u3" });
    if (!doorPublic.ok) throw new Error(doorPublic.reason);

    // One real pick, through the real store.
    const store = createDraftStore({ db, publish, clock });
    const started = await store.startDraft(created.draftId);
    if (!started.ok) throw new Error(started.reason);
    const state = await store.getDraftState(created.draftId);
    if (state === null) throw new Error("draft vanished");
    const onClock = teamOnClock(state);
    if (onClock === null) throw new Error("nobody on the clock");
    const [team] = await db.select({ userId: teams.userId }).from(teams).where(eq(teams.id, onClock));
    if (team === undefined) throw new Error("team not found");
    const picked = await store.applyAction(
      created.draftId,
      { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: clock.now(), teamId: onClock, playerId: state.pool[0]!.playerId },
      { actor: { id: team.userId } },
    );
    if (!picked.ok) throw new Error(picked.reason);

    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.chainScope, created.leagueId))
      .orderBy(asc(auditEvents.sequence));
    expect(rows.map((row) => row.eventType)).toEqual(["league_created", "member_joined", "member_joined", "draft_pick"]);
    expect(rows.map((row) => row.payload.via)).toEqual([undefined, "invite", "public_browse", undefined]);

    const result = await verifyFullChainIntegrity(db, created.leagueId);
    expect(result).toMatchObject({ valid: true, verifiedThrough: rows.length });
  });
});
