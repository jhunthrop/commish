import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditEvents, leagues, lineupSlots, memberNotices, players, rosterSlots, statWeeks, teams, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { RosterSlot } from "@/domain/roster";
import { validateLineup } from "@/domain/roster-eligibility";
import { startersOf } from "@/league";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { copyViolations } from "@/integrity/copy-rules";
import { renderNotice } from "@/integrity/notices";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { notifyAffectedMember } from "@/integrity-service/notify";
import {
  autoSetLineupInTx,
  autoSetLineupsForWeek,
  changedPlayersClauseFor,
  plannedAutoLineup,
  type PlannedAutoLineupInput,
} from "./auto-lineup";
import { setLineup, toRosterSlots, type LineupSlotInput } from "./lineups";
import { writeSchedule } from "./schedule";
import { SLOTS } from "./test-support";

const db = createTestDb();
const NOW = "2026-09-14T17:00:00.000Z";
const LATER = "2026-09-14T17:05:00.000Z";

const STARTER_CONFIG = SLOTS.filter((config) => config.slot !== "BENCH");
const PLAYER_POSITIONS: Readonly<Record<string, string>> = {
  qb_alice_1: "QB", qb_alice_2: "QB", rb_alice_1: "RB", rb_alice_2: "RB",
  qb_bob_1: "QB", qb_bob_2: "QB", rb_bob_1: "RB", rb_bob_2: "RB",
  qb_carol_1: "QB", qb_carol_2: "QB", rb_carol_1: "RB", rb_carol_2: "RB",
  qb_priv_1: "QB", qb_priv_2: "QB", rb_priv_1: "RB", rb_priv_2: "RB",
};

/** Every player any fixture below can name, so a single `players` insert covers the whole file. */
async function seedPlayers(): Promise<void> {
  await db.insert(players).values(
    Object.entries(PLAYER_POSITIONS).map(([id, position]) => ({ id, name: id, position: position as "QB" | "RB", nflTeam: "FA" })),
  );
}

/**
 * A public matchmade league with three teams (alice, bob, carol), each holding a legal QB/RB
 * starting pair plus a QB/RB bench pair — the same `SLOTS` shape `lineups.test.ts` builds off,
 * widened to three teams and `isPublicMatchmade: true` so `enforcementAppliesTo` reaches it.
 */
async function publicLeague(weeks = 4): Promise<{ readonly leagueId: string; readonly alice: string; readonly bob: string; readonly carol: string }> {
  const leagueId = "league_auto";
  await db.insert(users).values([
    { id: "u_alice", email: "alice@test.local", displayName: "Alice" },
    { id: "u_bob", email: "bob@test.local", displayName: "Bob" },
    { id: "u_carol", email: "carol@test.local", displayName: "Carol" },
  ]);
  await db.insert(leagues).values({
    id: leagueId, name: "Auto League", format: "snake", teamCount: 3, commissionerUserId: "u_alice",
    rosterSlots: SLOTS, isPublicMatchmade: true, experienceTier: "experienced",
  });
  await db.insert(teams).values([
    { id: "team_alice", leagueId, userId: "u_alice", name: "Alice's Team" },
    { id: "team_bob", leagueId, userId: "u_bob", name: "Bob's Team" },
    { id: "team_carol", leagueId, userId: "u_carol", name: "Carol's Team" },
  ]);
  await db.insert(rosterSlots).values([
    { teamId: "team_alice", slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
    { teamId: "team_alice", slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
    { teamId: "team_alice", slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
    { teamId: "team_alice", slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    { teamId: "team_bob", slot: "QB", slotIndex: 0, playerId: "qb_bob_1" },
    { teamId: "team_bob", slot: "RB", slotIndex: 0, playerId: "rb_bob_1" },
    { teamId: "team_bob", slot: "BENCH", slotIndex: 0, playerId: "qb_bob_2" },
    { teamId: "team_bob", slot: "BENCH", slotIndex: 1, playerId: "rb_bob_2" },
    { teamId: "team_carol", slot: "QB", slotIndex: 0, playerId: "qb_carol_1" },
    { teamId: "team_carol", slot: "RB", slotIndex: 0, playerId: "rb_carol_1" },
    { teamId: "team_carol", slot: "BENCH", slotIndex: 0, playerId: "qb_carol_2" },
    { teamId: "team_carol", slot: "BENCH", slotIndex: 1, playerId: "rb_carol_2" },
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId, teamIds: ["team_alice", "team_bob", "team_carol"], weeks }));
  return { leagueId, alice: "team_alice", bob: "team_bob", carol: "team_carol" };
}

/** A PRIVATE league (the default `isPublicMatchmade: false`), same shape, one team — Step 5's
 *  matched pair on the lineup half: enforcement must never reach it. */
async function privateLeagueTeam(weeks = 4): Promise<{ readonly leagueId: string; readonly teamId: string }> {
  const leagueId = "league_private";
  await db.insert(users).values({ id: "u_priv", email: "priv@test.local", displayName: "Priv" });
  await db.insert(users).values({ id: "u_priv_2", email: "priv2@test.local", displayName: "Priv Two" });
  await db.insert(leagues).values({
    id: leagueId, name: "Private League", format: "snake", teamCount: 2, commissionerUserId: "u_priv",
    rosterSlots: SLOTS, isPublicMatchmade: false,
  });
  await db.insert(teams).values([
    { id: "team_priv", leagueId, userId: "u_priv", name: "Priv Team" },
    { id: "team_priv_2", leagueId, userId: "u_priv_2", name: "Priv Team Two" },
  ]);
  await db.insert(rosterSlots).values([
    { teamId: "team_priv", slot: "QB", slotIndex: 0, playerId: "qb_priv_1" },
    { teamId: "team_priv", slot: "RB", slotIndex: 0, playerId: "rb_priv_1" },
    { teamId: "team_priv", slot: "BENCH", slotIndex: 0, playerId: "qb_priv_2" },
    { teamId: "team_priv", slot: "BENCH", slotIndex: 1, playerId: "rb_priv_2" },
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId, teamIds: ["team_priv", "team_priv_2"], weeks }));
  return { leagueId, teamId: "team_priv" };
}

async function lockWeek(week: number): Promise<void> {
  await db.insert(statWeeks).values({ week, status: "in_progress" }).onConflictDoUpdate({ target: statWeeks.week, set: { status: "in_progress" } });
}

async function savedLineup(teamId: string, week: number): Promise<readonly RosterSlot[] | null> {
  const rows = await db.select().from(lineupSlots).where(and(eq(lineupSlots.teamId, teamId), eq(lineupSlots.weekNumber, week)));
  return rows.length === 0 ? null : toRosterSlots(rows);
}

/** Sorted by playerId so a comparison against a hand-written expectation is order-independent
 *  without either side having to guess `lineup_slots`' own row order. */
function bySlot(lineup: readonly RosterSlot[]): readonly RosterSlot[] {
  return [...lineup].sort((a, b) => (a.slot === b.slot ? a.slotIndex - b.slotIndex : a.slot < b.slot ? -1 : 1));
}

async function noticesFor(userId: string): Promise<readonly (typeof memberNotices.$inferSelect)[]> {
  return db.select().from(memberNotices).where(eq(memberNotices.userId, userId));
}

async function auditEventsFor(leagueId: string): Promise<readonly (typeof auditEvents.$inferSelect)[]> {
  return db.select().from(auditEvents).where(eq(auditEvents.chainScope, leagueId));
}

async function tradeAway(teamId: string, playerId: string): Promise<void> {
  await db.update(rosterSlots).set({ playerId: null }).where(and(eq(rosterSlots.teamId, teamId), eq(rosterSlots.playerId, playerId)));
}

/** Flips `INTEGRITY_CONFIG.participation.enforceTierSegregation` for one call — the SAME
 *  deploy-wide switch `enforcementAppliesTo` (`./enforcement`) already reads, and every automated
 *  action in this plan is documented to ask it rather than a second flag of its own. Mirrors
 *  `enforcement.test.ts`'s own `withEnforcement` helper. */
async function withEnforcementOff<T>(fn: () => Promise<T>): Promise<T> {
  const config = INTEGRITY_CONFIG.participation as { enforceTierSegregation: boolean };
  const original = config.enforceTierSegregation;
  config.enforceTierSegregation = false;
  try {
    return await fn();
  } finally {
    config.enforceTierSegregation = original;
  }
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("plannedAutoLineup", () => {
  const base: PlannedAutoLineupInput = {
    strategy: "repeat_previous_week",
    slotConfig: SLOTS,
    roster: [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ],
    previousLineup: null,
    playerPositions: PLAYER_POSITIONS,
  };

  it("falls back to the roster's own default lineup when there is no previous week", () => {
    expect(bySlot(plannedAutoLineup(base))).toEqual(bySlot(base.roster));
  });

  it("repeats the previous week's starters exactly when the roster hasn't changed", () => {
    const previousLineup: readonly RosterSlot[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    const planned = plannedAutoLineup({ ...base, previousLineup });
    expect(bySlot(planned)).toEqual(bySlot(previousLineup));
  });

  it("drops a player no longer on the roster and refills the slot from the bench, legally", () => {
    const previousLineup: readonly RosterSlot[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    // rb_alice_1 left the roster (a trade); rb_alice_2 is still owned, sitting on the bench.
    const roster: readonly RosterSlot[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: null },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    const planned = plannedAutoLineup({ ...base, roster, previousLineup });
    const starters = startersOf(planned);
    expect(starters.map((slot) => slot.playerId)).not.toContain("rb_alice_1");
    expect(starters.find((slot) => slot.slot === "RB")?.playerId).toBe("rb_alice_2");
    const playerPositions = base.playerPositions;
    expect(validateLineup({ slotConfig: STARTER_CONFIG, roster: starters, playerPositions })).toEqual({ valid: true });
  });

  it("leaves a starter slot empty when no eligible replacement is available anywhere on the roster", () => {
    const previousLineup: readonly RosterSlot[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    // Every RB-eligible player is gone from the roster — nobody is left to fill the RB slot.
    const roster: readonly RosterSlot[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: null },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: null },
    ];
    const planned = plannedAutoLineup({ ...base, roster, previousLineup });
    expect(startersOf(planned).find((slot) => slot.slot === "RB")?.playerId).toBeNull();
  });

  it("leaves a starter slot alone when the current roster config no longer declares its slot type", () => {
    // A stale slot from before a commissioner reshaped the league's roster — `FLEX` no longer
    // exists in this league's own `slotConfig` (`base.slotConfig` is QB/RB/BENCH only).
    const previousLineup: readonly RosterSlot[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "FLEX" as RosterSlot["slot"], slotIndex: 0, playerId: null },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    expect(() => plannedAutoLineup({ ...base, previousLineup })).not.toThrow();
  });

  it("is deterministic: the same inputs always plan the same lineup", () => {
    const previousLineup: readonly RosterSlot[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    const input = { ...base, previousLineup };
    expect(bySlot(plannedAutoLineup(input))).toEqual(bySlot(plannedAutoLineup(input)));
  });
});

describe("changedPlayersClauseFor", () => {
  it("says nothing changed when nothing did", () => {
    expect(changedPlayersClauseFor([])).toBe("");
  });

  it("names the one player who left, copy-clean", () => {
    const clause = changedPlayersClauseFor(["Christian McCaffrey"]);
    expect(clause).toBe(" Christian McCaffrey is no longer on your roster, so we filled that spot from your bench.");
    expect(copyViolations(clause)).toEqual([]);
  });

  it("names every player who left when there is more than one, copy-clean", () => {
    const clause = changedPlayersClauseFor(["Christian McCaffrey", "Justin Jefferson"]);
    expect(clause).toBe(" Christian McCaffrey and Justin Jefferson are no longer on your roster, so we filled those spots from your bench.");
    expect(copyViolations(clause)).toEqual([]);
  });

  it("stays copy-clean once folded into the real notice template, for all three shapes", () => {
    for (const dropped of [[], ["Christian McCaffrey"], ["Christian McCaffrey", "Justin Jefferson"]] as const) {
      const notice = renderNotice("lineup_auto_set", {
        leagueName: "Sunday Money", week: 4, carriedFrom: 3, changedPlayers: changedPlayersClauseFor(dropped),
      });
      expect(copyViolations(`${notice.title} ${notice.body}`)).toEqual([]);
    }
  });
});

describe("autoSetLineupsForWeek", () => {
  it("carries last week's chosen lineup into a locked week the manager never opened", async () => {
    await seedPlayers();
    const { leagueId, alice } = await publicLeague();
    const aliceWeek3: readonly LineupSlotInput[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    const set = await setLineup(db, { leagueId, teamId: alice, weekNumber: 3, slots: aliceWeek3, userId: "u_alice" });
    expect(set.ok).toBe(true);
    const week3Saved = await savedLineup(alice, 3);

    await lockWeek(4);
    const outcome = await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });
    expect(outcome.leaguesFailed).toEqual([]);

    expect(bySlot((await savedLineup(alice, 4))!)).toEqual(bySlot(week3Saved!));
    const notices = await noticesFor("u_alice");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.noticeType).toBe("lineup_auto_set");
    expect(notices[0]!.leagueId).toBe(leagueId);

    const events = await auditEventsFor(leagueId);
    const autoSetEvent = events.find((event) => (event.payload as { action?: string }).action === "lineup_auto_set");
    expect(autoSetEvent).toBeDefined();
    expect(autoSetEvent!.actorId).toBeNull();
    expect((autoSetEvent!.payload as { subjectUserId?: string }).subjectUserId).toBe("u_alice");
  });

  it("leaves a manager who already set their lineup completely alone", async () => {
    await seedPlayers();
    const { leagueId, bob } = await publicLeague();
    const bobWeek4: readonly LineupSlotInput[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_bob_2" },
      { slot: "RB", slotIndex: 0, playerId: "rb_bob_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_bob_1" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_bob_2" },
    ];
    await setLineup(db, { leagueId, teamId: bob, weekNumber: 4, slots: bobWeek4, userId: "u_bob" });
    const bobSavedBefore = await savedLineup(bob, 4);

    await lockWeek(4);
    await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });

    expect(bySlot((await savedLineup(bob, 4))!)).toEqual(bySlot(bobSavedBefore!));
    expect(await noticesFor("u_bob")).toHaveLength(0);
  });

  it("writes exactly what the fallback would have derived when there is no previous week, and sends no notice", async () => {
    await seedPlayers();
    const { carol } = await publicLeague();
    await lockWeek(1);
    const wouldHaveBeen = await savedLineup(carol, 1); // null: nothing saved yet, nothing to compare
    expect(wouldHaveBeen).toBeNull();

    await autoSetLineupsForWeek(db, { weekNumber: 1, occurredAt: NOW });

    const written = await savedLineup(carol, 1);
    expect(written).not.toBeNull();
    expect(bySlot(written!).map((slot) => slot.playerId).sort()).toEqual(["qb_carol_1", "qb_carol_2", "rb_carol_1", "rb_carol_2"].sort());
    // A materialization, not a decision: nothing was carried FORWARD from an earlier choice, so
    // there is nothing to tell this manager.
    expect(await noticesFor("u_carol")).toHaveLength(0);
  });

  it("drops a player who is no longer on the roster and refills the slot legally", async () => {
    await seedPlayers();
    const { leagueId, alice } = await publicLeague();
    const aliceWeek3: readonly LineupSlotInput[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    await setLineup(db, { leagueId, teamId: alice, weekNumber: 3, slots: aliceWeek3, userId: "u_alice" });
    await tradeAway(alice, "rb_alice_1");
    await lockWeek(4);
    await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });

    const lineup = (await savedLineup(alice, 4))!;
    expect(lineup.map((slot) => slot.playerId)).not.toContain("rb_alice_1");
    expect(validateLineup({ slotConfig: STARTER_CONFIG, roster: startersOf(lineup), playerPositions: PLAYER_POSITIONS })).toEqual({ valid: true });

    const notices = await noticesFor("u_alice");
    expect(notices).toHaveLength(1);
    expect((notices[0]!.context as { changedPlayers?: string }).changedPlayers).toContain("no longer on your roster");
  });

  it("never touches a private league, for the identical unset lineup", async () => {
    await seedPlayers();
    const { teamId: privateTeam } = await privateLeagueTeam();
    await lockWeek(4);
    await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });
    expect(await savedLineup(privateTeam, 4)).toBeNull();
  });

  it("does nothing at all while enforcement is off, and leaves no partial state behind", async () => {
    await seedPlayers();
    const { leagueId, alice } = await publicLeague();
    await lockWeek(4);
    const outcome = await withEnforcementOff(() => autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW }));
    expect(outcome.teamsSet).toBe(0);
    expect(await savedLineup(alice, 4)).toBeNull();
    expect(await noticesFor("u_alice")).toHaveLength(0);
    expect(await auditEventsFor(leagueId)).toEqual([]);
  });

  it("is idempotent: a second run over the same week writes nothing and notices nobody again", async () => {
    await seedPlayers();
    const { leagueId, alice } = await publicLeague();
    const aliceWeek3: readonly LineupSlotInput[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    await setLineup(db, { leagueId, teamId: alice, weekNumber: 3, slots: aliceWeek3, userId: "u_alice" });
    await lockWeek(4);
    const first = await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });
    expect(first.teamsSet).toBeGreaterThan(0);
    const savedAfterFirst = await savedLineup(alice, 4);

    const second = await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: LATER });
    expect(second.teamsSet).toBe(0);

    expect(bySlot((await savedLineup(alice, 4))!)).toEqual(bySlot(savedAfterFirst!));
    expect(await noticesFor("u_alice")).toHaveLength(1);
  });

  it("does nothing while the week is still scheduled — the trigger's own precondition, defended a second time", async () => {
    await seedPlayers();
    const { alice } = await publicLeague();
    // No `lockWeek` call: `stat_weeks` has no row at all for week 4, which reads as `"scheduled"`.
    const outcome = await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });
    expect(outcome.teamsSet).toBe(0);
    expect(await savedLineup(alice, 4)).toBeNull();
  });

  /**
   * `attemptLeague`'s own precedent (`@/stats-pipeline/correction`): a league whose OWN
   * transaction throws is reported by id and reason, never lost to an unhandled rejection, and
   * never stops any other league examined the same run — asserted here by seeding a SECOND,
   * unrelated public league in the same week and proving it still gets set.
   */
  it("reports a league whose own transaction fails, by id and reason, without stopping the rest of the run", async () => {
    await seedPlayers();
    const { leagueId, alice } = await publicLeague();
    const aliceWeek3: readonly LineupSlotInput[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    // `previousLineup !== null` is what makes this league actually reach `notify`/`audit`, which
    // is where the injected failure below lives.
    await setLineup(db, { leagueId, teamId: alice, weekNumber: 3, slots: aliceWeek3, userId: "u_alice" });
    await lockWeek(4);

    const brokenAudit: AuditLogger = {
      record: async () => {
        throw new Error("simulated audit append failure");
      },
      recordAll: async () => {
        throw new Error("simulated audit append failure");
      },
    };
    const outcome = await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW, audit: brokenAudit });

    expect(outcome.leaguesFailed).toEqual([{ leagueId, reason: "simulated audit append failure" }]);
    // The whole per-league transaction rolled back — no partial write survives the failure.
    expect(await savedLineup(alice, 4)).toBeNull();
    expect(await noticesFor("u_alice")).toHaveLength(0);
  });

  it("stringifies a non-Error thrown value for the failure reason", async () => {
    await seedPlayers();
    const { leagueId, alice } = await publicLeague();
    const aliceWeek3: readonly LineupSlotInput[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { slot: "RB", slotIndex: 0, playerId: "rb_alice_1" },
      { slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ];
    await setLineup(db, { leagueId, teamId: alice, weekNumber: 3, slots: aliceWeek3, userId: "u_alice" });
    await lockWeek(4);

    const brokenAudit: AuditLogger = {
      record: async () => {
        throw "simulated non-Error failure";
      },
      recordAll: async () => {
        throw "simulated non-Error failure";
      },
    };
    const outcome = await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW, audit: brokenAudit });

    expect(outcome.leaguesFailed).toEqual([{ leagueId, reason: "simulated non-Error failure" }]);
  });

  it("names a dropped player 'A player who is no longer listed' when its own row can no longer resolve a name", async () => {
    await seedPlayers();
    const { alice } = await publicLeague();
    // A "ghost" player: owned by alice and started in week 3, but with no `players` row at all —
    // the same "resolved at read time, falls back for an id that no longer resolves" property
    // `activity-view.ts`'s own name resolvers document, exercised here for the notice's own
    // dropped-player clause. Written directly (never through `setLineup`, which validates every
    // starter against the real `players` table and would refuse a name it cannot resolve) — the
    // same "a row from before a guard existed" class `activity-view.test.ts`'s own hostile-name
    // fixtures already stand in for.
    await db.insert(rosterSlots).values({ teamId: alice, slot: "BENCH", slotIndex: 2, playerId: "ghost_player" });
    await db.insert(lineupSlots).values([
      { teamId: alice, weekNumber: 3, slot: "QB", slotIndex: 0, playerId: "qb_alice_1" },
      { teamId: alice, weekNumber: 3, slot: "RB", slotIndex: 0, playerId: "ghost_player" },
      { teamId: alice, weekNumber: 3, slot: "BENCH", slotIndex: 0, playerId: "qb_alice_2" },
      { teamId: alice, weekNumber: 3, slot: "BENCH", slotIndex: 1, playerId: "rb_alice_2" },
    ]);
    // The ghost leaves the roster before week 4 locks, and a real RB is available to replace it.
    await tradeAway(alice, "ghost_player");
    await lockWeek(4);

    await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });

    const notices = await noticesFor("u_alice");
    expect(notices).toHaveLength(1);
    expect((notices[0]!.context as { changedPlayers?: string }).changedPlayers).toContain("A player who is no longer listed");
  });

  it("returns 0 without writing anything when the league row is gone by the time the transaction opens", async () => {
    await lockWeek(4);
    const teamsSet = await db.transaction((tx) =>
      autoSetLineupInTx(tx, "league_missing", 4, NOW, { audit: getAuditLogger(), notify: notifyAffectedMember }),
    );
    expect(teamsSet).toBe(0);
  });
});
