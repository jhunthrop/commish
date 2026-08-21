import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { lineupSlots, rosterSlots, statWeeks, teams } from "@/db/schema";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { scoreTeamsForWeek } from "@/stats-pipeline/finalize";
import { getLineup } from "./lineups";
import { seasonThroughWeek, type SeasonThroughWeekLeague } from "./test-support";
import {
  applyTradeInTx,
  assertNoPlayerOnTwoRosters,
  materializeLockedLineupsInTx,
  plannedTransfer,
  TransferRefusedError,
  type ApplyTradeInput,
  type FilledRosterSlot,
  type PlannedTransferInput,
  type TransferAsset,
  type TransferPlan,
  type TransferRefusal,
} from "./trade-transfer";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

// --- Step 1: the settled week a trade must not rewrite ----------------------------------------

/** `applyTradeInTx`'s own input shape, from the `{ give, get }` shorthand the brief's tests use —
 *  `give` leaves `league.teamA`, `get` arrives on it. */
function tradeOf(league: SeasonThroughWeekLeague, assets: { readonly give: readonly string[]; readonly get: readonly string[] }): ApplyTradeInput {
  return {
    leagueId: league.id,
    slotConfig: league.slotConfig,
    proposerTeamId: league.teamA,
    counterpartyTeamId: league.teamB,
    proposerAssets: assets.give.map((playerId) => ({ kind: "player" as const, playerId })),
    counterpartyAssets: assets.get.map((playerId) => ({ kind: "player" as const, playerId })),
  };
}

/** The real `scoreTeamsForWeek` (`@/stats-pipeline/finalize`), pinned to this fixture's own two
 *  teams — never a second scoring path, only a narrower call to the one that exists. */
async function scoreBothTeams(leagueId: string, teamA: string, teamB: string, weekNumber: number) {
  return scoreTeamsForWeek(db, leagueId, weekNumber, [teamA, teamB]);
}

describe("applyTradeInTx leaves an already-locked week's history alone", () => {
  it("leaves a settled week scoring exactly what it scored before the trade", async () => {
    // `getLineup` falls back to `roster_slots` for a team that never opened the lineup editor,
    // `finalizeWeek` scores through `getLineup`, and Plan B's `correctSettledWeek` re-scores a
    // settled week through the same call weeks later. Without materialization a week 9 trade
    // rewrites what a manager started in week 3.
    const league = await seasonThroughWeek(db, { week: 3, settled: true, lineupsSaved: false });
    const before = await scoreBothTeams(league.id, league.teamA, league.teamB, 3);

    await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));

    const after = await scoreBothTeams(league.id, league.teamA, league.teamB, 3);
    expect(after).toEqual(before);
    // Not a vacuous equality: the traded RB actually mattered to week 3's score, so a version of
    // this test that forgot to materialize would fail on a real number, not on `undefined`.
    expect(before.get(league.teamA)).toBeGreaterThan(0);
  });

  it("writes the lineup rows the fallback would have derived, rather than freezing an empty week", async () => {
    const league = await seasonThroughWeek(db, { week: 3, settled: true, lineupsSaved: false });
    const expected = await getLineup(db, { teamId: league.teamA, weekNumber: 3, slotConfig: league.slotConfig });

    await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));

    const saved = await db.select().from(lineupSlots).where(and(eq(lineupSlots.teamId, league.teamA), eq(lineupSlots.weekNumber, 3)));
    const savedAsRosterSlots: readonly RosterSlot[] = saved.map((row) => ({ slot: row.slot as RosterSlot["slot"], slotIndex: row.slotIndex, playerId: row.playerId }));
    expect(sortedBySlot(savedAsRosterSlots)).toEqual(sortedBySlot(expected));
  });

  it("leaves a week a manager DID save alone, because it was never at risk", async () => {
    // Materialization is a repair for the fallback, not a rewrite of a real save. A team with
    // saved rows is already immune, and re-deriving them would be the bug this test prevents.
    const league = await seasonThroughWeek(db, { week: 3, settled: true, lineupsSaved: true });
    const before = await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 3));

    await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));

    expect(await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 3))).toEqual(before);
  });

  it("leaves an UNLOCKED week to the fallback, so a trade actually changes the team you field", async () => {
    // The other direction, and the reason this is materialization of LOCKED weeks rather than of
    // every week. A trade must change what you field going forward; freezing an open week would
    // make a traded-for player unstartable until the manager noticed and re-saved.
    const league = await seasonThroughWeek(db, { week: 3, settled: true, currentWeek: 4, lineupsSaved: false });

    await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));

    expect(await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 4))).toEqual([]);
    const week4 = await getLineup(db, { teamId: league.teamA, weekNumber: 4, slotConfig: league.slotConfig });
    expect(week4.some((slot) => slot.playerId === "p_bench_wr")).toBe(true);
  });

  it("leaves the frozen week byte-equal after a SECOND, unrelated trade between the same two teams", async () => {
    // F2: the idempotency proof, driven through the trade path itself rather than a direct
    // second call to `materializeLockedLineupsInTx` — a second trade between the same two teams
    // is the real caller this property has to hold for. Week 3 is already frozen by the first
    // trade; the second trade's own materialization pass must find the existing rows and write
    // nothing new, not re-derive them from the roster the first trade already changed.
    const league = await seasonThroughWeek(db, { week: 3, settled: true, lineupsSaved: false });
    await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));
    const afterFirstTrade = await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 3));

    const secondTrade = await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_wr_a"], get: [] })));

    expect(secondTrade.materializedLineupRows).toBe(0);
    const afterSecondTrade = await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 3));
    expect(afterSecondTrade).toHaveLength(afterFirstTrade.length);
    expect(afterSecondTrade).toEqual(afterFirstTrade);
  });
});

function sortedBySlot(roster: readonly RosterSlot[]): readonly RosterSlot[] {
  return [...roster].sort((a, b) => a.slot.localeCompare(b.slot) || a.slotIndex - b.slotIndex);
}

// --- materializeLockedLineupsInTx, exercised directly ------------------------------------------

describe("materializeLockedLineupsInTx", () => {
  it("writes nothing when no week in the season has locked yet", async () => {
    const league = await seasonThroughWeek(db, { week: 3, settled: false, lineupsSaved: false });
    const written = await db.transaction((tx) =>
      materializeLockedLineupsInTx(tx, { leagueId: league.id, teamIds: [league.teamA, league.teamB], slotConfig: league.slotConfig }),
    );
    expect(written).toBe(0);
    expect(await db.select().from(lineupSlots)).toEqual([]);
  });

  it("writes one row per configured slot, per team, for the one locked week", async () => {
    const league = await seasonThroughWeek(db, { week: 3, settled: true, lineupsSaved: false });
    const written = await db.transaction((tx) =>
      materializeLockedLineupsInTx(tx, { leagueId: league.id, teamIds: [league.teamA, league.teamB], slotConfig: league.slotConfig }),
    );
    // Five configured slots (QB, RB, WR, BENCH x2) times two teams.
    expect(written).toBe(10);
    const rows = await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 3));
    expect(rows).toHaveLength(10);
  });

  it("is a no-op the second time it runs for the same already-materialized week, byte-equal", async () => {
    const league = await seasonThroughWeek(db, { week: 3, settled: true, lineupsSaved: false });
    await db.transaction((tx) =>
      materializeLockedLineupsInTx(tx, { leagueId: league.id, teamIds: [league.teamA, league.teamB], slotConfig: league.slotConfig }),
    );
    const before = await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 3));

    const secondRun = await db.transaction((tx) =>
      materializeLockedLineupsInTx(tx, { leagueId: league.id, teamIds: [league.teamA, league.teamB], slotConfig: league.slotConfig }),
    );

    expect(secondRun).toBe(0);
    const after = await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 3));
    expect(after).toHaveLength(before.length);
    expect(after).toEqual(before);
  });
});

describe("materializeLockedLineupsInTx's stat_weeks read", () => {
  it("takes FOR SHARE, matching setLineup: it blocks on a concurrent status flip rather than reading a stale snapshot", async () => {
    // F1: the boundary-week race. `persistTick` (`@/stats-pipeline/persist`) upserts `stat_weeks`
    // in its own transaction with no coordination, under the default READ COMMITTED isolation
    // `setLineup`'s own re-check documents and closes with `FOR SHARE` — the same hole exists
    // here: without the lock, a week flipping `scheduled` -> `in_progress` in a `persistTick`
    // transaction that commits AFTER this function's read but BEFORE the trade's roster write
    // would leave that week unmaterialized, and the roster move that follows would then
    // retroactively change what that week's fallback derives for a week that had, by the time
    // this transaction committed, already started.
    //
    // Driven for real, not simulated: a concurrent transaction updates the week's row and holds
    // it open (uncommitted), mirroring `lineups.test.ts`'s own precedent test for the identical
    // race class — the same deterministic promise-gate idiom, cheaper here than standing up
    // `lock-order.test.ts`'s two-connection `pg_stat_activity` machinery for a single-row block,
    // and just as real a proof: under READ COMMITTED, a plain (unlocked) SELECT does NOT block on
    // an uncommitted concurrent UPDATE — it reads the last COMMITTED value immediately. So this
    // test fails against an unlocked read (it would see the stale `scheduled` value and return 0)
    // and passes only because `FOR SHARE` genuinely blocks until the flip commits.
    const league = await seasonThroughWeek(db, { week: 5, settled: false, lineupsSaved: false });

    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const flip = db.transaction(async (tx) => {
      await tx.update(statWeeks).set({ status: "in_progress" }).where(eq(statWeeks.week, 5));
      await released;
    });

    const materializing = db.transaction((tx) =>
      materializeLockedLineupsInTx(tx, { leagueId: league.id, teamIds: [league.teamA, league.teamB], slotConfig: league.slotConfig }),
    );
    // Long enough for `materializeLockedLineupsInTx` to clear its earlier work and reach the
    // `FOR SHARE` read, so it is genuinely waiting on the held row when `release()` fires.
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    await flip;

    // Saw the POST-flip value, not the pre-flip "scheduled" snapshot: it materialized the week.
    expect(await materializing).toBe(10);
    const rows = await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 5));
    expect(rows).toHaveLength(10);
  });
});

// --- Step 3: plannedTransfer — pure, refusable, and reusing the one slot policy ----------------

function qb(playerId: string): TransferAsset {
  return { playerId, position: "QB" };
}
function rb(playerId: string): TransferAsset {
  return { playerId, position: "RB" };
}
function wr(playerId: string): TransferAsset {
  return { playerId, position: "WR" };
}

function slotOf(plan: TransferPlan | TransferRefusal, playerId: string): { readonly slot: string; readonly slotIndex: number } | undefined {
  if (!plan.ok) return undefined;
  const found = [...plan.proposer.roster, ...plan.counterparty.roster].find((slot) => slot.playerId === playerId);
  return found === undefined ? undefined : { slot: found.slot, slotIndex: found.slotIndex };
}

/** Drops role labels so a forward call and its mirror-perspective twin can be compared for real
 *  equality — sorted by `teamId`, which is the one thing both calls agree on regardless of which
 *  side they called "proposer". */
function normalize(plan: TransferPlan | TransferRefusal) {
  if (!plan.ok) throw new Error("expected a plan, got a refusal");
  return [plan.proposer, plan.counterparty].sort((a, b) => a.teamId.localeCompare(b.teamId));
}

const filled = (slot: RosterSlot["slot"], slotIndex: number, playerId: string): FilledRosterSlot => ({ slot, slotIndex, playerId });

const ONE_QB_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "BENCH", count: 2, eligiblePositions: ["QB", "RB", "WR"] },
];

const ONE_QB_LEAGUE: PlannedTransferInput = {
  slotConfig: ONE_QB_SLOTS,
  proposer: { teamId: "p1", roster: [filled("QB", 0, "p_qb_mine")] },
  counterparty: { teamId: "p2", roster: [filled("QB", 0, "p_qb_theirs")] },
  give: [],
  get: [],
};

const RB_WR_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
];

const LEAGUE: PlannedTransferInput = {
  slotConfig: RB_WR_SLOTS,
  proposer: { teamId: "team_p1", roster: [filled("RB", 0, "a")] },
  counterparty: { teamId: "team_p2", roster: [filled("WR", 0, "b")] },
  give: [],
  get: [],
};

const MIRRORED_LEAGUE: PlannedTransferInput = {
  slotConfig: RB_WR_SLOTS,
  proposer: { teamId: "team_p2", roster: [filled("WR", 0, "b")] },
  counterparty: { teamId: "team_p1", roster: [filled("RB", 0, "a")] },
  give: [],
  get: [],
};

/** One QB slot, both bench spots full on BOTH sides — `"a"` (an RB, occupying one of the
 *  proposer's two bench spots) is the one asset `give` ever clears, so a test can free exactly
 *  one bench spot back up by sending it, or leave the roster genuinely full by sending nothing. */
const ONE_QB_LEAGUE_FULL_BENCH: PlannedTransferInput = {
  slotConfig: ONE_QB_SLOTS,
  proposer: {
    teamId: "fb1",
    roster: [filled("QB", 0, "p_qb_holder"), filled("BENCH", 0, "benched_wr"), filled("BENCH", 1, "a")],
  },
  counterparty: {
    teamId: "fb2",
    roster: [filled("QB", 0, "x_owner"), filled("BENCH", 0, "y_owner"), filled("BENCH", 1, "z_owner")],
  },
  give: [],
  get: [],
};

const LEAGUE_WITH_FULL_RB_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
  { slot: "BENCH", count: 1, eligiblePositions: ["RB", "WR"] },
];

const LEAGUE_WITH_FULL_RB: PlannedTransferInput = {
  slotConfig: LEAGUE_WITH_FULL_RB_SLOTS,
  proposer: { teamId: "fr1", roster: [filled("RB", 0, "existing_rb"), filled("WR", 0, "a")] },
  counterparty: { teamId: "fr2", roster: [filled("RB", 0, "x")] },
  give: [],
  get: [],
};

describe("plannedTransfer", () => {
  it("swaps two quarterbacks in a one-QB league, because it clears both sides before it fills either", () => {
    const plan = plannedTransfer({ ...ONE_QB_LEAGUE, give: [qb("p_qb_mine")], get: [qb("p_qb_theirs")] });
    expect(plan.ok).toBe(true);
    expect(slotOf(plan, "p_qb_theirs")).toEqual({ slot: "QB", slotIndex: 0 });
    expect(slotOf(plan, "p_qb_mine")).toEqual({ slot: "QB", slotIndex: 0 });
  });

  it("returns the same plan whichever side the caller passes first", () => {
    const forward = plannedTransfer({ ...LEAGUE, give: [rb("a")], get: [wr("b")] });
    const mirror = plannedTransfer({ ...MIRRORED_LEAGUE, give: [wr("b")], get: [rb("a")] });
    expect(normalize(forward)).toEqual(normalize(mirror));
  });

  it("refuses a package with no legal home and names the position, not the slot machinery", () => {
    const plan = plannedTransfer({ ...ONE_QB_LEAGUE_FULL_BENCH, give: [rb("a")], get: [qb("x"), qb("y")] });
    expect(plan).toEqual({
      ok: false,
      reason: "There's no room on your roster for two quarterbacks. Send a player at that position, or free up a bench spot first.",
    });
  });

  it("names a single unplaceable position in the singular", () => {
    // Nothing frees a spot this time (`give: []`): the roster is genuinely full, and the single
    // incoming QB has nowhere to land.
    const plan = plannedTransfer({ ...ONE_QB_LEAGUE_FULL_BENCH, give: [], get: [qb("x")] });
    expect(plan).toEqual({
      ok: false,
      reason: "There's no room on your roster for a quarterback. Send a player at that position, or free up a bench spot first.",
    });
  });

  it("puts a player nobody can start on the bench rather than refusing the trade", () => {
    // assignSlot's own preference order, unchanged. A third running back is a bench player, not
    // an illegal trade, and a refusal here would make depth untradeable.
    const plan = plannedTransfer({ ...LEAGUE_WITH_FULL_RB, give: [wr("a")], get: [rb("x")] });
    expect(slotOf(plan, "x")).toEqual({ slot: "BENCH", slotIndex: 0 });
  });

  it("refuses on the counterparty's illegal roster too, when the proposer's own side is fine", () => {
    const plan = plannedTransfer({ ...ONE_QB_LEAGUE_FULL_BENCH, give: [qb("p_extra_qb")], get: [] });
    // The proposer placement (empty `get`) trivially succeeds; the counterparty must place an
    // incoming QB into a roster with no free QB or bench slot.
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain("no room");
  });

  /**
   * THE GAP-INDEX REGRESSION, at `plannedTransfer`'s own level (found by `reverseTradeInTx`'s
   * lock-order proof, Task 7; the underlying fix lives in `assignSlot`, `@/draft-engine/slotting`
   * — see that test file's own regression case for the mechanism). A two-RB roster gives away the
   * LOWER-indexed occupant and keeps the higher-indexed one, then receives a new RB back — exactly
   * the shape a reversal produces when the trade it is undoing shares a position with something
   * picked up in between. Before the fix, the incoming player silently overwrote the survivor at
   * the SAME slot index instead of taking the now-open lower one, and the survivor vanished from
   * the plan entirely.
   */
  it("fills the freed lower index rather than colliding with a kept higher-indexed occupant", () => {
    const twoRbSlots: readonly RosterSlotConfig[] = [{ slot: "RB", count: 2, eligiblePositions: ["RB"] }];
    const plan = plannedTransfer({
      slotConfig: twoRbSlots,
      proposer: { teamId: "gap1", roster: [filled("RB", 1, "p_survivor")] }, // index 0 already open
      counterparty: { teamId: "gap2", roster: [] },
      give: [],
      get: [rb("p_incoming")],
    });
    expect(plan.ok).toBe(true);
    expect(slotOf(plan, "p_survivor")).toEqual({ slot: "RB", slotIndex: 1 }); // never displaced
    expect(slotOf(plan, "p_incoming")).toEqual({ slot: "RB", slotIndex: 0 }); // the TRUE open index
  });
});

// --- Step 4: applyTradeInTx, and the assertion that no player ends up on two teams -------------

/** A minimal, real, two-team DB fixture for the write-path tests — its own small league rather
 *  than `seasonThroughWeek`'s history-focused one, since these tests are about the write itself. */
async function tradeLeague(): Promise<SeasonThroughWeekLeague> {
  return seasonThroughWeek(db, { week: 1, settled: false, lineupsSaved: false });
}

async function rosterSnapshot(leagueId: string, teamA: string, teamB: string) {
  return db
    .select({ teamId: rosterSlots.teamId, slot: rosterSlots.slot, slotIndex: rosterSlots.slotIndex, playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .innerJoin(teams, eq(teams.id, rosterSlots.teamId))
    .where(and(eq(teams.leagueId, leagueId), eq(rosterSlots.teamId, teamA)))
    .then(async (a) => [
      ...a,
      ...(await db
        .select({ teamId: rosterSlots.teamId, slot: rosterSlots.slot, slotIndex: rosterSlots.slotIndex, playerId: rosterSlots.playerId })
        .from(rosterSlots)
        .where(eq(rosterSlots.teamId, teamB))),
    ]);
}

describe("applyTradeInTx", () => {
  it("moves both sides in one transaction: the giver loses it, the receiver gains it", async () => {
    const league = await tradeLeague();
    await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));

    const teamARoster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, league.teamA));
    const teamBRoster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, league.teamB));
    expect(teamARoster.some((row) => row.playerId === "p_bench_wr")).toBe(true);
    expect(teamARoster.some((row) => row.playerId === "p_star_rb")).toBe(false);
    expect(teamBRoster.some((row) => row.playerId === "p_star_rb")).toBe(true);
    expect(teamBRoster.some((row) => row.playerId === "p_bench_wr")).toBe(false);
  });

  it("never leaves a player on two rosters, and says so out loud rather than trusting the schema", async () => {
    // `roster_slots` has PK (team_id, slot, slot_index), a nullable `player_id`, no FK and no
    // unique index on the player. A botched transfer is invisible to Postgres. This assertion
    // runs inside the transaction and rolls the whole trade back if it ever fires.
    const league = await tradeLeague();
    await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));
    const rows = await db
      .select({ playerId: rosterSlots.playerId })
      .from(rosterSlots)
      .innerJoin(teams, eq(teams.id, rosterSlots.teamId))
      .where(eq(teams.leagueId, league.id));
    const owned = rows.map((row) => row.playerId).filter((id): id is string => id !== null);
    expect(new Set(owned).size).toBe(owned.length);
  });

  it("rolls back both sides when the second side cannot be placed", async () => {
    // Team A sends BOTH its WR and its one open bench spot's occupant, receiving nothing back.
    // Team B's bench has exactly one free spot: the first incoming player (the WR) takes it
    // cleanly, filling the bench — the SECOND incoming player then has nowhere left to land, and
    // the whole trade (including team A's otherwise-clean give) must roll back rather than commit
    // team A's side while team B's refuses.
    const league = await seasonThroughWeek(db, { week: 1, settled: false, lineupsSaved: false });
    const before = await rosterSnapshot(league.id, league.teamA, league.teamB);

    await expect(
      db.transaction((tx) =>
        applyTradeInTx(tx, {
          leagueId: league.id,
          slotConfig: league.slotConfig,
          proposerTeamId: league.teamA,
          counterpartyTeamId: league.teamB,
          proposerAssets: [{ kind: "player", playerId: "p_wr_a" }, { kind: "player", playerId: "p_bench_a1" }],
          counterpartyAssets: [],
        }),
      ),
    ).rejects.toThrow(TransferRefusedError);

    expect(await rosterSnapshot(league.id, league.teamA, league.teamB)).toEqual(before);
  });

  it("refuses when a proposer's own asset has already left their roster", async () => {
    const league = await tradeLeague();
    await expect(
      db.transaction((tx) =>
        applyTradeInTx(tx, {
          leagueId: league.id,
          slotConfig: league.slotConfig,
          proposerTeamId: league.teamA,
          counterpartyTeamId: league.teamB,
          proposerAssets: [{ kind: "player", playerId: "p_ghost" }],
          counterpartyAssets: [{ kind: "player", playerId: "p_bench_wr" }],
        }),
      ),
    ).rejects.toThrow(TransferRefusedError);
  });

  it("refuses when a counterparty's asset has already left their roster", async () => {
    const league = await tradeLeague();
    await expect(
      db.transaction((tx) =>
        applyTradeInTx(tx, {
          leagueId: league.id,
          slotConfig: league.slotConfig,
          proposerTeamId: league.teamA,
          counterpartyTeamId: league.teamB,
          proposerAssets: [{ kind: "player", playerId: "p_star_rb" }],
          counterpartyAssets: [{ kind: "player", playerId: "p_ghost" }],
        }),
      ),
    ).rejects.toThrow(TransferRefusedError);
  });

  it("materializes the traded-from week before moving anything, reported in its own result", async () => {
    const league = await seasonThroughWeek(db, { week: 3, settled: true, lineupsSaved: false });
    const result = await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));
    expect(result.materializedLineupRows).toBe(10);
  });

  it("reads a null-playerId roster row correctly on a second trade over the same vacated slot", async () => {
    // After the first trade, `applyTradeInTx`'s own upsert writes an explicit `playerId: null`
    // row for whatever slot lost its occupant and gained no replacement (`defaultLineup`'s
    // shape). A second trade reading that roster back must treat that row as empty, not as a
    // player named `"null"` — the branch a fresh roster (no prior trade) never exercises.
    const league = await tradeLeague();
    await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_bench_a1"], get: [] })));
    // Team A's BENCH slot 0 (`p_bench_a1`) is now null; BENCH slot 1 was already null from the
    // fixture itself. A second, unrelated trade must still read team A's roster correctly.
    const second = await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_wr_a"], get: ["p_bench_wr"] })));
    expect(second.proposer.roster.some((slot) => slot.playerId === "p_bench_wr")).toBe(true);
  });

  it("moves nothing when neither side names an asset, without ever querying players", async () => {
    // Degenerate but well-defined: an empty trade materializes and rewrites both rosters to
    // themselves. `movingIds` is empty, so the position lookup is skipped entirely rather than
    // issuing a query with an empty `IN ()`.
    const league = await tradeLeague();
    const result = await db.transaction((tx) =>
      applyTradeInTx(tx, { leagueId: league.id, slotConfig: league.slotConfig, proposerTeamId: league.teamA, counterpartyTeamId: league.teamB, proposerAssets: [], counterpartyAssets: [] }),
    );
    expect(result.proposer.roster.find((slot) => slot.slot === "RB")?.playerId).toBe("p_star_rb");
    expect(result.counterparty.roster.find((slot) => slot.slot === "WR")?.playerId).toBe("p_wr_b");
  });

  it("is the only function in this codebase that performs a trade roster swap", () => {
    // Grep, not import graph: the claim is that no second implementation exists, and a second one
    // would not import the first.
    const writers = grepSourceTree(/\.insert\(rosterSlots\)|\.update\(rosterSlots\)/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$|test-support/ });
    // `seed-trades.ts` (Phase 3 Plan C, Task 9) deals its own dedicated league's rosters the
    // identical "snake order over `rankedPlayers`, `assignSlot` decides the slot" way
    // `seed-season-league.ts` already does — a second SEEDER, never a second TRANSFER
    // implementation. `applyTradeInTx` remains the only writer that ever moves an ALREADY-
    // OWNED player between two rosters; this file's own trade fixtures are proposed and accepted
    // through that same, real function, not through a shortcut this list would need to catch.
    expect(writers).toEqual(["src/data/seed/seed-season-league.ts", "src/data/seed/seed-trades.ts", "src/draft-service/commit.ts", "src/league-service/trade-transfer.ts"]);
  });
});

describe("assertNoPlayerOnTwoRosters", () => {
  it("passes silently when every player id is unique", () => {
    expect(() => assertNoPlayerOnTwoRosters([{ playerId: "a" }, { playerId: "b" }, { playerId: null }])).not.toThrow();
  });

  it("throws if it ever finds the same player on two rows — the belt to the missing brace", () => {
    expect(() => assertNoPlayerOnTwoRosters([{ playerId: "a" }, { playerId: "a" }])).toThrow(/landed on two rosters/);
  });
});

// --- grepSourceTree, the same walk-and-filter idiom `src/moderation/removal.test.ts` uses -------

interface GrepOptions {
  readonly dirs: readonly string[];
  readonly exclude: RegExp;
}

function walk(dir: string, exclude: RegExp): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, exclude);
    if (!/\.tsx?$/.test(entry.name) || exclude.test(entry.name)) return [];
    return [full];
  });
}

function grepSourceTree(pattern: RegExp, { dirs, exclude }: GrepOptions): readonly string[] {
  return dirs
    .flatMap((dir) => walk(join(process.cwd(), dir), exclude))
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(process.cwd(), path))
    .sort();
}
