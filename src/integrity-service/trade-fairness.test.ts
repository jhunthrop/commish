import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { auditEvents, drafts, integrityFlags, players, playerStatLines, rosterSlots, teams, tradeProposals, users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { assembleAdvisorContext } from "@/ai-advisor/context";
import { createTradeAnalyzer } from "@/ai-advisor/trade";
import type { LlmClient } from "@/lib/llm/client";
import type { TradeProposal } from "@/domain/trade";
import type { AuditEventType } from "@/domain/audit";
import { advisorFixture } from "@/league-service/test-support";
import { createLeague } from "@/league-service/creation";
import { writeSchedule } from "@/league-service/schedule";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { createAuditLogger } from "./audit-logger";
import {
  evaluateTradeBeforeExecute,
  raiseTradeFairnessFlag,
  sweepUnflaggedTrades,
  type EvaluateTradeInput,
} from "./trade-fairness";

const db = createTestDb();

const SLOTS = [
  { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const] },
];

const clock = { now: () => "2026-08-21T00:00:00.000Z" };

/**
 * One league, two teams. `p_star` scores a huge line in every one of the three weeks the
 * `weekNumber: 4` trend window reads (weeks 1-3): 300 rushing yards and 5 touchdowns a week is
 * 60 fantasy points a week under standard scoring, which is what makes the gap in
 * `GROTESQUELY_LOPSIDED` real arithmetic rather than a hand-picked number. `p_scrub` never plays
 * at all, so it values at exactly 0.
 */
/** `idSuffix` lets a single test stand up TWO independent fairness leagues (e.g. a
 *  league-scoping proof) without colliding on the fixture's own fixed player/team ids —
 *  the same seam `advisorFixture` (`@/league-service/test-support`) already carries. */
async function fairnessLeague(db: Db, idSuffix = ""): Promise<{ readonly leagueId: string; readonly teamA: string; readonly teamB: string }> {
  const userA = `fair_u_a${idSuffix}`;
  const userB = `fair_u_b${idSuffix}`;
  await db.insert(users).values([
    { id: userA, email: `${userA}@test.local`, displayName: "Manager A" },
    { id: userB, email: `${userB}@test.local`, displayName: "Manager B" },
  ]);
  const created = await createLeague({ db, clock, newId: () => `fair_lg_${crypto.randomUUID()}` }, {
    name: "Fairness League",
    format: "snake",
    teamCount: 2,
    scoringPreset: "standard",
    auctionBudget: null,
    rosterSlots: SLOTS,
    commissionerUserId: userA,
    teamName: "Team A",
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  const teamB = `fair_team_b${idSuffix}`;
  await db.insert(teams).values({ id: teamB, leagueId: created.leagueId, userId: userB, name: "Team B" });
  await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));

  const pStar = `p_star${idSuffix}`;
  const pScrub = `p_scrub${idSuffix}`;
  const pEvenA = `p_even_a${idSuffix}`;
  const pEvenB = `p_even_b${idSuffix}`;
  await db.insert(players).values([
    { id: pStar, name: "Star", position: "RB", nflTeam: "KC" },
    { id: pScrub, name: "Scrub", position: "RB", nflTeam: "SF" },
    { id: pEvenA, name: "Even A", position: "RB", nflTeam: "DAL" },
    { id: pEvenB, name: "Even B", position: "RB", nflTeam: "MIA" },
  ]);
  await db.insert(rosterSlots).values([
    { teamId: created.teamId, slot: "RB", slotIndex: 0, playerId: pStar },
    { teamId: created.teamId, slot: "BENCH", slotIndex: 0, playerId: pEvenA },
    { teamId: teamB, slot: "RB", slotIndex: 0, playerId: pScrub },
    { teamId: teamB, slot: "BENCH", slotIndex: 0, playerId: pEvenB },
  ]);
  await db.insert(playerStatLines).values([
    ...[1, 2, 3].map((week) => ({ playerId: pStar, week, rushingYards: 300, rushingTouchdowns: 5 })),
    ...[1, 2, 3].map((week) => ({ playerId: pEvenA, week, rushingYards: 50 })),
    ...[1, 2, 3].map((week) => ({ playerId: pEvenB, week, rushingYards: 50 })),
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [created.teamId, teamB], weeks: 4 }));

  return { leagueId: created.leagueId, teamA: created.teamId, teamB };
}

async function grotesquelyLopsided(db: Db): Promise<EvaluateTradeInput> {
  const league = await fairnessLeague(db);
  return {
    leagueId: league.leagueId,
    weekNumber: 4,
    proposerTeamId: league.teamA,
    counterpartyTeamId: league.teamB,
    proposerAssetIds: ["p_star"],
    counterpartyAssetIds: ["p_scrub"],
  };
}

describe("evaluateTradeBeforeExecute", () => {
  it("never holds a trade while no hold threshold is configured, however lopsided it is", async () => {
    await truncateAll(db);
    expect(INTEGRITY_CONFIG.trade.autoHoldThreshold).toBeNull();
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, input));
    expect(evaluation.gap).toBeGreaterThan(50);
    expect(evaluation.hold).toBe(false);
    expect(evaluation.flagWorthy).toBe(true);
  });

  it("holds when a threshold IS supplied, so Plan D inherits a proven branch and not an idea", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...input, autoHoldThreshold: 40 }));
    expect(evaluation.hold).toBe(true);
  });

  it("does not hold a threshold the gap never reaches", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...input, autoHoldThreshold: 1000 }));
    expect(evaluation.hold).toBe(false);
  });

  it("values a ghost player as a refusal rather than as zero points", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    await expect(
      db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...input, proposerAssetIds: ["p_star", "p_ghost"] })),
    ).rejects.toThrow(/couldn't value/);
  });

  it("refuses when a whole team no longer resolves in the league", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    await expect(
      db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...input, counterpartyTeamId: "team_ghost" })),
    ).rejects.toThrow(/couldn't value/);
  });

  it("reports an even trade as even, with no flag and no hold", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    const evaluation = await db.transaction((tx) =>
      evaluateTradeBeforeExecute(tx, {
        leagueId: league.leagueId,
        weekNumber: 4,
        proposerTeamId: league.teamA,
        counterpartyTeamId: league.teamB,
        proposerAssetIds: ["p_even_a"],
        counterpartyAssetIds: ["p_even_b"],
      }),
    );
    expect(evaluation.balance.verdict).toBe("even");
    expect(evaluation.flagWorthy).toBe(false);
    expect(evaluation.hold).toBe(false);
  });

  it("carries both valued sides through — the evidence Task 6 writes verbatim", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, input));
    expect(evaluation.giving).toEqual([expect.objectContaining({ playerId: "p_star" })]);
    expect(evaluation.receiving).toEqual([expect.objectContaining({ playerId: "p_scrub" })]);
  });
});

const stubLlm: LlmClient = {
  generateCompletion: async () => ({ text: "n/a", inputTokens: 0, outputTokens: 0 }),
};

describe("evaluateTradeBeforeExecute and the member-facing advisor — the dual-use thesis", () => {
  it("gives the member-facing advisor and the automatic detector the identical verdict, from one call", async () => {
    // Strategy §4.2's dual-use thesis, made a test rather than a promise: "the same model that
    // tells a member whether a trade is fair is the model that powers the platform's own
    // collusion detection." One function, two callers, asserted against a real trade read out of
    // a real league rather than a hand-built fixture.
    await truncateAll(db);
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { leagueId: fixture.leagueId, teamId: fixture.teamId, weekNumber: 4 });
    if (context === null || context.opponent === null) throw new Error("no context");
    const opponent = context.opponent;

    const proposal: TradeProposal = {
      leagueId: fixture.leagueId,
      weekNumber: 4,
      from: { teamId: context.me.teamId, playerIds: ["rb_change"] },
      to: { teamId: opponent.teamId, playerIds: ["wr_volume"] },
    };

    const advisory = await createTradeAnalyzer({ enabled: false, llm: stubLlm })({ context, opponent, proposal });
    const automatic = await db.transaction((tx) =>
      evaluateTradeBeforeExecute(tx, {
        leagueId: fixture.leagueId,
        weekNumber: 4,
        proposerTeamId: context.me.teamId,
        counterpartyTeamId: opponent.teamId,
        proposerAssetIds: ["rb_change"],
        counterpartyAssetIds: ["wr_volume"],
      }),
    );

    expect(advisory).not.toBeNull();
    expect(automatic.balance.verdict).toBe(advisory!.verdict);
    expect(automatic.balance.flags).toEqual(advisory!.flags);
    expect(automatic.balance.givingValue).toBe(advisory!.givingValue);
    expect(automatic.balance.receivingValue).toBe(advisory!.receivingValue);
  });

  it("leaves the pre-accept advisory route completely untouched", () => {
    // The spec asks for this explicitly. POST /api/leagues/[leagueId]/advisor/trade gained no
    // import, no branch and no write from this phase.
    const source = readFileSync(join(process.cwd(), "src/app/api/leagues/[leagueId]/advisor/trade/route.ts"), "utf8");
    expect(source).not.toContain("@/integrity");
    expect(source).not.toContain("acceptTrade");
  });
});

const NOW = "2026-08-21T00:00:00.000Z";
const logger = createAuditLogger({ newId: () => `evt_${crypto.randomUUID()}` });

async function openFlags(db: Db) {
  return db.select().from(integrityFlags).where(isNull(integrityFlags.resolvedAt));
}

async function auditEventsOn(db: Db, scope: string, eventType: AuditEventType) {
  return db.select().from(auditEvents).where(and(eq(auditEvents.chainScope, scope), eq(auditEvents.eventType, eventType)));
}

let flagIdSeq = 0;
const nextFlagId = () => `tf_flag_${(flagIdSeq += 1)}`;

describe("raiseTradeFairnessFlag", () => {
  it("raises exactly one flag, with the analyzer's own reasons and both valued sides, for a trade at or past the threshold", async () => {
    await truncateAll(db);
    flagIdSeq = 0;
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, input));

    const flag = await raiseTradeFairnessFlag(db, {
      tradeId: "trade_lopsided_1",
      leagueId: input.leagueId,
      balance: evaluation.balance,
      gap: evaluation.gap,
      giving: evaluation.giving,
      receiving: evaluation.receiving,
      occurredAt: NOW,
      newId: nextFlagId,
      audit: logger,
    });

    expect(flag).not.toBeNull();
    const flags = await openFlags(db);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ flagType: "trade_fairness", subjectType: "trade", subjectId: "trade_lopsided_1", leagueId: input.leagueId });
    // The analyzer's own machine-readable reasons, stored VERBATIM — not re-summarized.
    expect(flags[0]!.evidence).toMatchObject({
      verdict: "lopsided",
      flags: ["value_gap_over_threshold"],
      givingValue: expect.any(Number),
      receivingValue: expect.any(Number),
      gap: evaluation.gap,
      threshold: INTEGRITY_CONFIG.trade.fairnessFlagThreshold,
      giving: [expect.objectContaining({ playerId: "p_star" })],
      receiving: [expect.objectContaining({ playerId: "p_scrub" })],
    });
  });

  it("raises no flag for a trade below the threshold", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    const evaluation = await db.transaction((tx) =>
      evaluateTradeBeforeExecute(tx, {
        leagueId: league.leagueId,
        weekNumber: 4,
        proposerTeamId: league.teamA,
        counterpartyTeamId: league.teamB,
        proposerAssetIds: ["p_even_a"],
        counterpartyAssetIds: ["p_even_b"],
      }),
    );

    const flag = await raiseTradeFairnessFlag(db, {
      tradeId: "trade_even_1",
      leagueId: league.leagueId,
      balance: evaluation.balance,
      gap: evaluation.gap,
      giving: evaluation.giving,
      receiving: evaluation.receiving,
      occurredAt: NOW,
      newId: nextFlagId,
      audit: logger,
    });

    expect(flag).toBeNull();
    expect(await openFlags(db)).toEqual([]);
  });

  it("flips outcomes on the threshold seam alone, with no code change — the spec's own exit criterion", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, input));

    const belowFlipped = await raiseTradeFairnessFlag(db, {
      tradeId: "trade_seam_low",
      leagueId: input.leagueId,
      balance: evaluation.balance,
      gap: evaluation.gap,
      giving: evaluation.giving,
      receiving: evaluation.receiving,
      occurredAt: NOW,
      fairnessFlagThreshold: 5,
      newId: nextFlagId,
      audit: logger,
    });
    const aboveFlipped = await raiseTradeFairnessFlag(db, {
      tradeId: "trade_seam_high",
      leagueId: input.leagueId,
      balance: evaluation.balance,
      gap: evaluation.gap,
      giving: evaluation.giving,
      receiving: evaluation.receiving,
      occurredAt: NOW,
      fairnessFlagThreshold: 999,
      newId: nextFlagId,
      audit: logger,
    });

    expect(belowFlipped).not.toBeNull();
    expect(aboveFlipped).toBeNull();
  });

  it("is idempotent on a re-raise for the same trade — no second flag, no second event", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, input));
    const raiseInput = {
      tradeId: "trade_reraise_1",
      leagueId: input.leagueId,
      balance: evaluation.balance,
      gap: evaluation.gap,
      giving: evaluation.giving,
      receiving: evaluation.receiving,
      occurredAt: NOW,
      newId: nextFlagId,
      audit: logger,
    };

    const first = await raiseTradeFairnessFlag(db, raiseInput);
    const second = await raiseTradeFairnessFlag(db, raiseInput);

    expect(second).toEqual(first);
    expect(await openFlags(db)).toHaveLength(1);
    expect(await auditEventsOn(db, "platform", "flag_raised")).toHaveLength(1);
  });
});

describe("sweepUnflaggedTrades", () => {
  /** One ACCEPTED `trade_proposals` row, inserted directly — standing in for the moment
   *  `acceptTrade` already committed but its own after-commit `raiseTradeFairnessFlag` call
   *  never landed (a dead process, or a throwing DI in a `trades.test.ts` scenario). */
  async function insertAcceptedTrade(
    db: Db,
    opts: {
      readonly id: string;
      readonly leagueId: string;
      readonly proposerTeamId: string;
      readonly counterpartyTeamId: string;
      readonly weekNumber: number;
      readonly give: readonly string[];
      readonly get: readonly string[];
    },
  ): Promise<void> {
    const now = new Date(NOW);
    await db.insert(tradeProposals).values({
      id: opts.id,
      leagueId: opts.leagueId,
      proposerTeamId: opts.proposerTeamId,
      counterpartyTeamId: opts.counterpartyTeamId,
      weekNumber: opts.weekNumber,
      proposerAssets: opts.give.map((playerId) => ({ kind: "player" as const, playerId })),
      counterpartyAssets: opts.get.map((playerId) => ({ kind: "player" as const, playerId })),
      fingerprint: `fp_${opts.id}`,
      note: null,
      status: "accepted",
      proposedAt: now,
      expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
      settledAt: now,
      settledByUserId: null,
    });
  }

  it("catches a trade whose after-commit flag write never landed", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertAcceptedTrade(db, {
      id: "trade_sweep_missed",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      weekNumber: 4,
      give: ["p_star"],
      get: ["p_scrub"],
    });

    const result = await sweepUnflaggedTrades(db, { leagueId: league.leagueId, newId: nextFlagId, audit: logger, clock: { now: () => NOW } });

    expect(result).toEqual({ tradesChecked: 1, flagsRaised: 1 });
    const flags = await openFlags(db);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ subjectType: "trade", subjectId: "trade_sweep_missed", leagueId: league.leagueId });
  });

  it("re-raises nothing for a trade already flagged, however many times the sweep runs", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertAcceptedTrade(db, {
      id: "trade_sweep_twice",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      weekNumber: 4,
      give: ["p_star"],
      get: ["p_scrub"],
    });

    const deps = { newId: nextFlagId, audit: logger, clock: { now: () => NOW } };
    await sweepUnflaggedTrades(db, { leagueId: league.leagueId, ...deps });
    const second = await sweepUnflaggedTrades(db, { leagueId: league.leagueId, ...deps });

    expect(second).toEqual({ tradesChecked: 0, flagsRaised: 0 });
    expect(await openFlags(db)).toHaveLength(1);
    expect(await auditEventsOn(db, "platform", "flag_raised")).toHaveLength(1);
  });

  it("degrades honestly, never crashing the rest of the sweep, when a trade's players have left the pool", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    // p_ghost never existed on either roster: `reDeriveAcceptedTradeValue`'s own length check
    // catches it, this candidate is skipped, and the run still completes.
    await insertAcceptedTrade(db, {
      id: "trade_sweep_ghost",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      weekNumber: 4,
      give: ["p_ghost"],
      get: ["p_scrub"],
    });

    const result = await sweepUnflaggedTrades(db, { leagueId: league.leagueId, newId: nextFlagId, audit: logger, clock: { now: () => NOW } });

    expect(result).toEqual({ tradesChecked: 1, flagsRaised: 0 });
    expect(await openFlags(db)).toEqual([]);
  });

  it("skips a trade below the threshold — the re-derivation agrees with the accept-time one", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertAcceptedTrade(db, {
      id: "trade_sweep_even",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      weekNumber: 4,
      give: ["p_even_a"],
      get: ["p_even_b"],
    });

    const result = await sweepUnflaggedTrades(db, { leagueId: league.leagueId, newId: nextFlagId, audit: logger, clock: { now: () => NOW } });

    expect(result).toEqual({ tradesChecked: 1, flagsRaised: 0 });
    expect(await openFlags(db)).toEqual([]);
  });

  it("scopes to one league when --league is supplied, and leaves the rest for the next run", async () => {
    await truncateAll(db);
    const leagueA = await fairnessLeague(db);
    const leagueB = await fairnessLeague(db, "_scope_b");
    await insertAcceptedTrade(db, {
      id: "trade_scope_a",
      leagueId: leagueA.leagueId,
      proposerTeamId: leagueA.teamA,
      counterpartyTeamId: leagueA.teamB,
      weekNumber: 4,
      give: ["p_star"],
      get: ["p_scrub"],
    });
    await insertAcceptedTrade(db, {
      id: "trade_scope_b",
      leagueId: leagueB.leagueId,
      proposerTeamId: leagueB.teamA,
      counterpartyTeamId: leagueB.teamB,
      weekNumber: 4,
      give: ["p_star_scope_b"],
      get: ["p_scrub_scope_b"],
    });

    const result = await sweepUnflaggedTrades(db, { leagueId: leagueA.leagueId, newId: nextFlagId, audit: logger, clock: { now: () => NOW } });

    expect(result).toEqual({ tradesChecked: 1, flagsRaised: 1 });
    const flags = await openFlags(db);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.subjectId).toBe("trade_scope_a");
  });

  it("sweeps every league at once when no --league is supplied", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertAcceptedTrade(db, {
      id: "trade_all_leagues",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      weekNumber: 4,
      give: ["p_star"],
      get: ["p_scrub"],
    });

    // No `leagueId` at all — the manual re-run's ordinary shape, since this detector has no
    // per-league trigger to scope a targeted re-run to.
    const result = await sweepUnflaggedTrades(db, { newId: nextFlagId, audit: logger, clock: { now: () => NOW } });

    expect(result).toEqual({ tradesChecked: 1, flagsRaised: 1 });
    const flags = await openFlags(db);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.subjectId).toBe("trade_all_leagues");
  });

  it("degrades honestly when a whole team no longer resolves in the league — not only a ghost player", async () => {
    await truncateAll(db);
    const leagueA = await fairnessLeague(db);
    const leagueB = await fairnessLeague(db, "_no_team");
    // A real team (FK-satisfying), just not a member of leagueA — `assembleAdvisorContext`'s own
    // team-in-league check answers `null` for it, the same "team resolves nowhere near this
    // trade's own league" shape `evaluateTradeBeforeExecute`'s own refusal test drives directly.
    await insertAcceptedTrade(db, {
      id: "trade_no_team",
      leagueId: leagueA.leagueId,
      proposerTeamId: leagueA.teamA,
      counterpartyTeamId: leagueB.teamA,
      weekNumber: 4,
      give: ["p_star"],
      get: ["p_star_no_team"],
    });

    const result = await sweepUnflaggedTrades(db, { leagueId: leagueA.leagueId, newId: nextFlagId, audit: logger, clock: { now: () => NOW } });

    expect(result).toEqual({ tradesChecked: 1, flagsRaised: 0 });
    expect(await openFlags(db)).toEqual([]);
  });
});
