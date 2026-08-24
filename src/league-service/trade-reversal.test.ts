import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DbTx } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, drafts, lineupSlots, matchups, memberNotices, players, rosterSlots, statWeeks, teams, tradeProposals, users } from "@/db/schema";
import type { RosterSlotConfig } from "@/domain/roster";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { raiseFlag } from "@/integrity-service/flags";
import { getLineup } from "./lineups";
import { acceptTrade, proposeTrade } from "./trades";
import { createLeague } from "./creation";
import { writeSchedule } from "./schedule";
import { reverseTradeInTx } from "./trade-reversal";
import { TransferRefusedError } from "./trade-transfer";

const db = createTestDb();
const clock = { now: () => "2026-09-10T00:00:00.000Z" };
const logger = getAuditLogger();

const SLOTS: readonly RosterSlotConfig[] = [
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
  { slot: "BENCH", count: 2, eligiblePositions: ["RB", "WR"] },
];

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

interface Fixture {
  readonly leagueId: string;
  readonly teamA: string;
  readonly teamB: string;
  readonly userA: string;
  readonly userB: string;
  readonly tradeId: string;
  readonly flagId: string;
  readonly weekNumber: number;
}

/**
 * A real, ACCEPTED trade — Alice's `p_rb1` (RB) for Bob's `p_wr1` (WR) — proposed and accepted
 * through the real service, valued at week 1 (open at accept time), plus a `trade_fairness` flag
 * raised directly against it (this suite does not need to cross the fairness threshold; it needs
 * a real flag naming a real trade). One open bench slot per team, so the swap always has room.
 */
async function seedAcceptedTrade(opts: { readonly flagId: string; readonly weekNumbers?: readonly number[] } = { flagId: "flag_1" }): Promise<Fixture> {
  const suffix = opts.flagId;
  const userA = `u_alice_${suffix}`;
  const userB = `u_bob_${suffix}`;
  await db.insert(users).values([
    { id: userA, email: `${userA}@test.local`, displayName: "Alice" },
    { id: userB, email: `${userB}@test.local`, displayName: "Bob" },
  ]);
  const created = await createLeague({ db, clock, newId: () => `lg_${suffix}_${crypto.randomUUID()}` }, {
    name: "Reversal League",
    format: "snake",
    teamCount: 2,
    scoringPreset: "ppr",
    auctionBudget: null,
    rosterSlots: SLOTS,
    owner: { kind: "member", userId: userA, teamName: "Team Alice" },
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  const teamId = created.teamId;
  if (teamId === null) throw new Error("expected a team id");
  const teamB = `team_bob_${suffix}`;
  await db.insert(teams).values({ id: teamB, leagueId: created.leagueId, userId: userB, name: "Team Bob" });
  await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));

  await db
    .insert(players)
    .values([
      { id: `p_rb1_${suffix}`, name: "Star RB", position: "RB", nflTeam: "KC" },
      { id: `p_wr1_${suffix}`, name: "Bench WR", position: "WR", nflTeam: "SF" },
    ])
    .onConflictDoNothing();
  await db.insert(rosterSlots).values([
    { teamId, slot: "RB", slotIndex: 0, playerId: `p_rb1_${suffix}` },
    { teamId: teamB, slot: "WR", slotIndex: 0, playerId: `p_wr1_${suffix}` },
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [teamId, teamB], weeks: 6 }));

  const proposed = await proposeTrade(db, {
    leagueId: created.leagueId,
    userId: userA,
    counterpartyTeamId: teamB,
    proposerAssets: [{ kind: "player", playerId: `p_rb1_${suffix}` }],
    counterpartyAssets: [{ kind: "player", playerId: `p_wr1_${suffix}` }],
    note: null,
    clock,
    deliver: async () => {},
  });
  if (!proposed.ok) throw new Error(proposed.reason);
  const accepted = await acceptTrade(db, { tradeId: proposed.tradeId, leagueId: created.leagueId, userId: userB, clock, deliver: async () => {} });
  if (!accepted.ok) throw new Error(accepted.reason);

  await db.transaction((tx) =>
    raiseFlag(tx, {
      flagType: "trade_fairness",
      subjectId: proposed.tradeId,
      leagueId: created.leagueId,
      evidence: {},
      raisedByUserId: null,
      occurredAt: clock.now(),
      newId: () => opts.flagId,
      audit: logger,
    }),
  );

  return { leagueId: created.leagueId, teamA: teamId, teamB, userA, userB, tradeId: proposed.tradeId, flagId: opts.flagId, weekNumber: 1 };
}

async function tradeRow(tradeId: string) {
  const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, tradeId));
  return row!;
}

async function ownerTeamOf(playerId: string): Promise<string | null> {
  const [row] = await db.select({ teamId: rosterSlots.teamId }).from(rosterSlots).where(eq(rosterSlots.playerId, playerId));
  return row?.teamId ?? null;
}

async function noticesFor(userId: string) {
  return db.select().from(memberNotices).where(eq(memberNotices.userId, userId));
}

async function auditEventsOn(scope: string, eventType: "roster_move") {
  return db.select().from(auditEvents).where(and(eq(auditEvents.chainScope, scope), eq(auditEvents.eventType, eventType)));
}

describe("reverseTradeInTx", () => {
  it("puts both sides back, stamps the original row, and leaves its status accepted", async () => {
    const fx = await seedAcceptedTrade({ flagId: "flag_basic" });
    const result = await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "Put it back.", clock }),
    );
    expect(result).toMatchObject({ ok: true, tradeId: fx.tradeId });

    expect(await ownerTeamOf(`p_rb1_${fx.flagId}`)).toBe(fx.teamA);
    expect(await ownerTeamOf(`p_wr1_${fx.flagId}`)).toBe(fx.teamB);

    const row = await tradeRow(fx.tradeId);
    expect(row.status).toBe("accepted"); // the acceptance HAPPENED
    expect(row.reversedAt).not.toBeNull();
    expect(row.reversedByFlagId).toBe(fx.flagId);
  });

  it("refuses when a traded player has since moved on, and says whose problem that is not", async () => {
    const fx = await seedAcceptedTrade({ flagId: "flag_moved" });
    // A THIRD manager: Bob trades the player he got from Alice onward to Carol.
    const userC = "u_carol_moved";
    await db.insert(users).values({ id: userC, email: `${userC}@test.local`, displayName: "Carol" });
    const teamC = "team_carol_moved";
    await db.insert(teams).values({ id: teamC, leagueId: fx.leagueId, userId: userC, name: "Team Carol" });
    await db.insert(players).values({ id: "p_carol_1", name: "Carol's Player", position: "RB", nflTeam: "LAC" });
    await db.insert(rosterSlots).values({ teamId: teamC, slot: "BENCH", slotIndex: 0, playerId: "p_carol_1" });
    const secondProposed = await proposeTrade(db, {
      leagueId: fx.leagueId,
      userId: fx.userB,
      counterpartyTeamId: teamC,
      proposerAssets: [{ kind: "player", playerId: `p_rb1_${fx.flagId}` }], // Bob now owns this, from the first trade
      counterpartyAssets: [{ kind: "player", playerId: "p_carol_1" }],
      note: null,
      clock,
      deliver: async () => {},
    });
    if (!secondProposed.ok) throw new Error(secondProposed.reason);
    const secondAccepted = await acceptTrade(db, { tradeId: secondProposed.tradeId, leagueId: fx.leagueId, userId: userC, clock, deliver: async () => {} });
    expect(secondAccepted.ok).toBe(true);

    const result = await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "n", clock }),
    );
    expect(result).toEqual({
      ok: false,
      status: 409,
      reason: "One of these players has been traded again since. Undoing this trade would take a player off a third team, so it needs a different decision.",
    });

    // Nothing moved, nothing stamped — a refused reversal writes nothing at all.
    const row = await tradeRow(fx.tradeId);
    expect(row.reversedAt).toBeNull();
    expect(row.reversedByFlagId).toBeNull();
    expect(await ownerTeamOf(`p_rb1_${fx.flagId}`)).toBe(teamC);
  });

  it("refuses a second reversal of the same trade — the guard is in the UPDATE's own WHERE", async () => {
    const fx = await seedAcceptedTrade({ flagId: "flag_twice" });
    const first = await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "n", clock }),
    );
    expect(first.ok).toBe(true);

    const second = await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: "flag_twice_again", operatorUserId: "u_op2", note: "n", clock }),
    );
    expect(second).toMatchObject({ ok: false, status: 409, reason: "This trade has already been reversed." });

    // The FIRST flag's own stamp survives untouched by the second attempt.
    const row = await tradeRow(fx.tradeId);
    expect(row.reversedByFlagId).toBe(fx.flagId);
  });

  /**
   * STATE 2 (fix round 1, HIGH): the SAME flag id, called a second time, is idempotent — reports
   * success without re-running the transfer, never refusing. This is the branch that heals a
   * `resolveFlag` retry after its own (later, separate) platform-chain transaction failed: the
   * reversal already committed as this flag's own work, and re-entering `reverseTradeInTx` with
   * the identical `flagId` must let the caller proceed to close the flag rather than getting stuck
   * behind the ordinary double-reversal refusal state 3 (the test just above) uses.
   */
  it("is idempotent for the SAME flag id — reports success without moving anything a second time", async () => {
    const fx = await seedAcceptedTrade({ flagId: "flag_idempotent" });
    const first = await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "n", clock }),
    );
    expect(first).toMatchObject({ ok: true, tradeId: fx.tradeId });

    const again = await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "n", clock }),
    );
    expect(again).toEqual({ ok: true, tradeId: fx.tradeId, weekNumber: fx.weekNumber, notices: [] });

    // Rosters unchanged by the second call — nothing moved twice.
    expect(await ownerTeamOf(`p_rb1_${fx.flagId}`)).toBe(fx.teamA);
    expect(await ownerTeamOf(`p_wr1_${fx.flagId}`)).toBe(fx.teamB);
    // Exactly ONE reversal roster_move on the league chain, never two.
    const moves = await auditEventsOn(fx.leagueId, "roster_move");
    const reversalMoves = moves.filter((m) => (m.payload as { readonly reason?: string }).reason === "trade_reversed");
    expect(reversalMoves).toHaveLength(1);
    // No second notice pair either — the second call sent none.
    expect((await noticesFor(fx.userA)).filter((n) => n.noticeType === "trade_reversed")).toHaveLength(1);
    expect((await noticesFor(fx.userB)).filter((n) => n.noticeType === "trade_reversed")).toHaveLength(1);
  });

  it("refuses a trade id this league doesn't recognize, honestly", async () => {
    const fx = await seedAcceptedTrade({ flagId: "flag_ghost" });
    const result = await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: "trade_ghost", leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "n", clock }),
    );
    expect(result).toEqual({ ok: false, status: 404, reason: "We could not find that trade." });
  });

  it("tells BOTH managers, which no other resolution in this product does", async () => {
    const fx = await seedAcceptedTrade({ flagId: "flag_both" });
    await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "Two accounts, one household.", clock }),
    );

    // `acceptTrade` already sent each manager one `trade_executed` notice — the reversal's own
    // `trade_reversed` notice is the SECOND one each of them has, not the only one.
    const aliceReversal = (await noticesFor(fx.userA)).find((n) => n.noticeType === "trade_reversed");
    const bobReversal = (await noticesFor(fx.userB)).find((n) => n.noticeType === "trade_reversed");
    expect(aliceReversal).toBeDefined();
    expect(bobReversal).toBeDefined();
    expect(aliceReversal!.context).toMatchObject({ gotBackSummary: "Star RB", gaveBackSummary: "Bench WR", note: "Two accounts, one household." });
    expect(bobReversal!.context).toMatchObject({ gotBackSummary: "Bench WR", gaveBackSummary: "Star RB" });
    expect(aliceReversal!.auditEventId).not.toBeNull();
    expect(bobReversal!.auditEventId).not.toBeNull();
  });

  it("appends ONE roster_move to the LEAGUE chain, never a second trade_accepted-shaped event", async () => {
    const fx = await seedAcceptedTrade({ flagId: "flag_chain" });
    await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "n", clock }),
    );

    const moves = await auditEventsOn(fx.leagueId, "roster_move");
    // The original trade's own roster_move, then the reversal's — both on the league chain.
    expect(moves).toHaveLength(2);
    const reversal = moves.find((m) => (m.payload as { readonly reason?: string }).reason === "trade_reversed");
    expect(reversal).toBeDefined();
    expect(reversal!.actorId).toBe("u_op");
    expect(reversal!.payload).toMatchObject({ tradeId: fx.tradeId, flagId: fx.flagId });
  });

  /**
   * MATERIALIZATION SYMMETRY, hand-computed. Trade accepted week 1 (open at accept time), week 2
   * locks AFTERWARD — never materialized by the original trade, since it wasn't locked yet — and
   * the reversal runs once week 2 IS locked. The reversal's own `applyTradeInTx` call must freeze
   * week 2 before moving anything, or the reversal itself rewrites what each team fielded in a
   * week that already locked, exactly the bug materialization exists to prevent.
   */
  it("materializes a week that locked BETWEEN accept and reversal, not just the trade's own week", async () => {
    const fx = await seedAcceptedTrade({ flagId: "flag_materialize" });
    // Nobody saved week 2's lineup, so `getLineup` still falls back to the CURRENT roster — read
    // it now, before the week locks, as the "what would the fallback derive" oracle.
    const slotConfig = SLOTS;
    const expectedA = await getLineup(db, { teamId: fx.teamA, weekNumber: 2, slotConfig });
    const expectedB = await getLineup(db, { teamId: fx.teamB, weekNumber: 2, slotConfig });
    expect(await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 2))).toEqual([]); // not frozen yet

    await db.insert(statWeeks).values({ week: 2, status: "final" });

    const reversed = await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "n", clock }),
    );
    expect(reversed.ok).toBe(true);

    const savedA = await db.select().from(lineupSlots).where(and(eq(lineupSlots.teamId, fx.teamA), eq(lineupSlots.weekNumber, 2)));
    const savedB = await db.select().from(lineupSlots).where(and(eq(lineupSlots.teamId, fx.teamB), eq(lineupSlots.weekNumber, 2)));
    const asRoster = (rows: typeof savedA) => rows.map((r) => ({ slot: r.slot, slotIndex: r.slotIndex, playerId: r.playerId })).sort((a, b) => a.slot.localeCompare(b.slot) || a.slotIndex - b.slotIndex);
    const expectedSorted = (rows: typeof expectedA) => [...rows].sort((a, b) => a.slot.localeCompare(b.slot) || a.slotIndex - b.slotIndex);

    // Frozen at the PRE-REVERSAL roster (post-accept: Alice holds the WR, Bob holds the RB) —
    // never re-derived from the post-reversal roster, which would put the RB back on Alice's
    // fallback for a week that, by the time the reversal ran, had already locked.
    expect(asRoster(savedA)).toEqual(expectedSorted(expectedA));
    expect(asRoster(savedB)).toEqual(expectedSorted(expectedB));
    expect(savedA.some((r) => r.playerId === `p_wr1_${fx.flagId}`)).toBe(true); // Alice fielded the WR that week
    expect(savedB.some((r) => r.playerId === `p_rb1_${fx.flagId}`)).toBe(true); // Bob fielded the RB that week

    // And the CURRENT roster (after the reversal) has moved back, so the frozen week and the
    // present-day roster genuinely disagree — the property that makes this test non-vacuous.
    expect(await ownerTeamOf(`p_rb1_${fx.flagId}`)).toBe(fx.teamA);
    expect(await ownerTeamOf(`p_wr1_${fx.flagId}`)).toBe(fx.teamB);
  });

  it("never re-scores a week that was already played with those rosters (ruling 18)", async () => {
    const fx = await seedAcceptedTrade({ flagId: "flag_settled" });
    const { scoreTeamsForWeek } = await import("@/stats-pipeline/finalize");
    await db
      .insert(statWeeks)
      .values({ week: fx.weekNumber, status: "final" })
      .onConflictDoUpdate({ target: statWeeks.week, set: { status: "final" } });
    const before = await scoreTeamsForWeek(db, fx.leagueId, fx.weekNumber, [fx.teamA, fx.teamB]);

    await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "n", clock }),
    );

    const after = await scoreTeamsForWeek(db, fx.leagueId, fx.weekNumber, [fx.teamA, fx.teamB]);
    expect(after).toEqual(before);
  });

  it("throws TransferRefusedError (not a plain refusal) for a genuine roster-space conflict, mirroring acceptTrade", async () => {
    // Belt-and-suspenders proof that applyTradeInTx's OWN re-check is still reachable: the
    // reversal returns p_wr1 (WR) to Bob, whose WR slot and both BENCH slots (also WR-eligible)
    // get filled by unrelated players between accept and reversal — only Bob's RB slot (not
    // WR-eligible) is left, so the incoming WR has nowhere to land. `acceptTrade`'s own
    // `defaultLineup` write already put a row for every slot (filled or null) on Bob's roster, so
    // this is an UPDATE of those existing rows, not a fresh insert.
    const fx = await seedAcceptedTrade({ flagId: "flag_full" });
    await db.insert(players).values([
      { id: "p_filler_wr", name: "Filler WR", position: "WR", nflTeam: "DAL" },
      { id: "p_filler_1", name: "Filler One", position: "WR", nflTeam: "MIA" },
      { id: "p_filler_2", name: "Filler Two", position: "WR", nflTeam: "NYJ" },
    ]);
    await db.update(rosterSlots).set({ playerId: "p_filler_wr" }).where(and(eq(rosterSlots.teamId, fx.teamB), eq(rosterSlots.slot, "WR"), eq(rosterSlots.slotIndex, 0)));
    await db.update(rosterSlots).set({ playerId: "p_filler_1" }).where(and(eq(rosterSlots.teamId, fx.teamB), eq(rosterSlots.slot, "BENCH"), eq(rosterSlots.slotIndex, 0)));
    await db.update(rosterSlots).set({ playerId: "p_filler_2" }).where(and(eq(rosterSlots.teamId, fx.teamB), eq(rosterSlots.slot, "BENCH"), eq(rosterSlots.slotIndex, 1)));

    await expect(
      db.transaction((tx) => reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "n", clock })),
    ).rejects.toBeInstanceOf(TransferRefusedError);

    // The whole transaction rolled back — the guarded UPDATE's own stamp never survived.
    const row = await tradeRow(fx.tradeId);
    expect(row.reversedAt).toBeNull();
  });

  /**
   * THE GUARDED UPDATE'S OWN ZERO-MATCH BRANCH, proved by a stub — unreachable through real
   * Postgres given this function's own lock order. STEP 3's team locks (`FOR UPDATE`, sorted)
   * fully serialize any two concurrent reversals of the SAME trade: the loser only reaches STEP 4
   * (the ownership re-check) after the winner has already committed, and that re-check finds the
   * winner's own moved players gone from where THIS reversal expects them — refusing via
   * `PLAYER_MOVED_AGAIN` before the guarded `UPDATE` is ever reached. So the `WHERE reversed_at IS
   * NULL` guard's own zero-match branch is a genuine belt, matching every other "judge by this
   * write's own returned rows" guard in this codebase, proved directly the same "impossible-state
   * guard" way `raiseFlag`'s `existingOpenFlagFor` and `resolveFlag`'s `alreadyResolvedOrMissing`
   * are (`@/integrity-service/flags`, `@/integrity-service/raise-flag`) — a stub `DbTx` that
   * answers every read honestly (an open, reversible trade) but makes the stamp `UPDATE` itself
   * match zero rows, standing in for a race this function's own lock order otherwise prevents.
   */
  it("refuses cleanly when the guarded UPDATE itself matches zero rows, proved by a stub", async () => {
    const existingRow = {
      id: "trade_stub",
      leagueId: "lg_stub",
      proposerTeamId: "team_stub_p",
      counterpartyTeamId: "team_stub_c",
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: "p_stub_gave" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_stub_got" }],
      status: "accepted",
      reversedAt: null,
    };
    const stubTx = {
      select: () => ({
        from: (table: unknown) => {
          if (table === tradeProposals) return { where: async () => [existingRow] };
          // `currentWeekOf`'s own read (final review, MEDIUM 4): no schedule at all, which
          // `currentWeekNumber` answers as week 1 — its documented floor.
          if (table === matchups) return { where: async () => [] };
          if (table === rosterSlots) {
            return {
              where: async () => [
                { teamId: existingRow.proposerTeamId, playerId: "p_stub_got" },
                { teamId: existingRow.counterpartyTeamId, playerId: "p_stub_gave" },
              ],
            };
          }
          // `stat_weeks`/`teams`: either an empty result (stat_weeks, read-only) or an irrelevant
          // row (teams, whose own id this function never reads back) is enough — both chains end
          // in `.for(...)`, never `.returning()`, so no write-shaped result is needed here.
          return { where: () => ({ for: async () => [] }) };
        },
      }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }), // the race loss
    } as unknown as DbTx;

    const result = await reverseTradeInTx(stubTx, {
      tradeId: "trade_stub",
      leagueId: "lg_stub",
      flagId: "flag_stub",
      operatorUserId: "u_op",
      note: "n",
      clock,
    });
    expect(result).toEqual({ ok: false, status: 409, reason: "This trade has already been reversed." });
  });

  /**
   * The `movedIds.length === 0` short circuit, proved directly rather than by a stub —
   * `applyTradeInTx`'s own identical shape is proved the same way one file over
   * (`trade-transfer.test.ts`, "moves nothing when neither side names an asset"). A real trade can
   * never actually reach this: `isBalancedProposal` refuses `proposeTrade` for an empty side, so
   * this row is inserted directly, bypassing that door — the one honest way to put a REAL accepted
   * trade in a shape only a direct write could ever produce.
   */
  it("moves nothing and skips the players query when the trade named no assets on either side", async () => {
    const suffix = "empty";
    const userA = `u_alice_${suffix}`;
    const userB = `u_bob_${suffix}`;
    await db.insert(users).values([
      { id: userA, email: `${userA}@test.local`, displayName: "Alice" },
      { id: userB, email: `${userB}@test.local`, displayName: "Bob" },
    ]);
    const created = await createLeague({ db, clock, newId: () => `lg_${suffix}_${crypto.randomUUID()}` }, {
      name: "Empty Trade League",
      format: "snake",
      teamCount: 2,
      scoringPreset: "ppr",
      auctionBudget: null,
      rosterSlots: SLOTS,
      owner: { kind: "member", userId: userA, teamName: "Team Alice" },
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: false,
    });
    if (!created.ok) throw new Error(created.reason);
    if (created.teamId === null) throw new Error("expected a team id");
    const teamB = `team_bob_${suffix}`;
    await db.insert(teams).values({ id: teamB, leagueId: created.leagueId, userId: userB, name: "Team Bob" });

    const proposedAt = new Date(clock.now());
    await db.insert(tradeProposals).values({
      id: "trade_empty",
      leagueId: created.leagueId,
      proposerTeamId: created.teamId,
      counterpartyTeamId: teamB,
      weekNumber: 1,
      proposerAssets: [],
      counterpartyAssets: [],
      fingerprint: "fp_trade_empty",
      note: null,
      status: "accepted",
      proposedAt,
      expiresAt: new Date(proposedAt.getTime() + 72 * 60 * 60 * 1000),
      settledAt: proposedAt,
      settledByUserId: userA,
    });
    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_fairness",
        subjectId: "trade_empty",
        leagueId: created.leagueId,
        evidence: {},
        raisedByUserId: null,
        occurredAt: clock.now(),
        newId: () => "flag_empty",
      }),
    );

    const result = await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: "trade_empty", leagueId: created.leagueId, flagId: flag.id, operatorUserId: "u_op", note: "n", clock }),
    );
    expect(result).toMatchObject({ ok: true, tradeId: "trade_empty" });
  });

  it("defaults clock, audit and notify to the real process-wide ones when none are supplied", async () => {
    const fx = await seedAcceptedTrade({ flagId: "flag_defaults" });
    const result = await db.transaction((tx) =>
      reverseTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, flagId: fx.flagId, operatorUserId: "u_op", note: "n" }),
    );
    expect(result).toMatchObject({ ok: true, tradeId: fx.tradeId });
  });
});
