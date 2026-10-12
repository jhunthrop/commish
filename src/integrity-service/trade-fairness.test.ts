import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@research/db/client";
import { players, playerStatLines } from "@research/db/schema";
import { auditEvents, drafts, integrityFlags, rosterSlots, teams, tradeProposals, users } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { assembleAdvisorContext } from "@/ai-advisor/context";
import { createTradeAnalyzer } from "@/ai-advisor/trade";
import type { LlmClient } from "@/lib/llm/client";
import type { TradeProposal } from "@/domain/trade";
import type { AuditEventType } from "@/domain/audit";
import { advisorFixture } from "@/league-service/test-support";
import { createLeague } from "@/league-service/creation";
import { writeSchedule } from "@/league-service/schedule";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { createAuditLogger, type AuditLogger } from "./audit-logger";
import { raiseFlag } from "./raise-flag";
import {
  closeSupersededHoldFlag,
  closeSupersededHoldFlagsQuietly,
  evaluateTradeBeforeExecute,
  raiseTradeFairnessFlag,
  sweepSupersededHoldFlags,
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
    owner: { kind: "member", userId: userA, teamName: "Team A" },
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  const teamId = created.teamId;
  if (teamId === null) throw new Error("expected a team id");
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
    { teamId, slot: "RB", slotIndex: 0, playerId: pStar },
    { teamId, slot: "BENCH", slotIndex: 0, playerId: pEvenA },
    { teamId: teamB, slot: "RB", slotIndex: 0, playerId: pScrub },
    { teamId: teamB, slot: "BENCH", slotIndex: 0, playerId: pEvenB },
  ]);
  await db.insert(playerStatLines).values([
    ...[1, 2, 3].map((week) => ({ playerId: pStar, week, rushingYards: 300, rushingTouchdowns: 5 })),
    ...[1, 2, 3].map((week) => ({ playerId: pEvenA, week, rushingYards: 50 })),
    ...[1, 2, 3].map((week) => ({ playerId: pEvenB, week, rushingYards: 50 })),
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [teamId, teamB], weeks: 4 }));

  return { leagueId: created.leagueId, teamA: teamId, teamB };
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
  it("holds a genuinely lopsided trade by DEFAULT now that Plan D's own number ships", async () => {
    await truncateAll(db);
    expect(INTEGRITY_CONFIG.trade.autoHoldThreshold).toBe(35);
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, input));
    expect(evaluation.gap).toBeGreaterThan(50);
    expect(evaluation.hold).toBe(true);
    expect(evaluation.flagWorthy).toBe(true);
  });

  it("never holds a trade when the threshold is explicitly disabled (null), however lopsided it is", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...input, autoHoldThreshold: null }));
    expect(evaluation.hold).toBe(false);
    expect(evaluation.flagWorthy).toBe(true);
  });

  it("holds at a test-seam threshold independent of the shipped default, proving the branch reads its argument and not a hardcoded 35", async () => {
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
      basis: "accept_evaluation",
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
      // Fix round 1 (review MEDIUM 1): which caller produced this evidence, written verbatim.
      basis: "accept_evaluation",
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
      basis: "accept_evaluation",
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
      basis: "accept_evaluation",
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
      basis: "accept_evaluation",
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
      basis: "accept_evaluation" as const,
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
      /** Defaults to `accepted`. Named only by the final-review F1 regression pair below, whose
       *  whole subject is which STATUSES the candidate query may and may not reach. */
      readonly status?: string;
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
      status: opts.status ?? "accepted",
      proposedAt: now,
      expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
      settledAt: now,
      settledByUserId: null,
    });
  }

  /** The `trade_hold` flag `holdTradeInTx` (`@/league-service/trades`) raises inside the accept
   *  transaction, then the stamp an operator's own Release or Block decision leaves on it. Built
   *  through `raiseFlag` and a guarded stamp rather than a raw insert, so the row this asserts
   *  against is the row production writes. */
  async function insertResolvedHoldFlag(
    db: Db,
    opts: { readonly tradeId: string; readonly flagId: string; readonly leagueId: string; readonly resolution: "trade_released" | "trade_blocked" },
  ): Promise<void> {
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_hold",
        subjectId: opts.tradeId,
        leagueId: opts.leagueId,
        evidence: {},
        raisedByUserId: null,
        occurredAt: NOW,
        newId: () => opts.flagId,
        audit: logger,
      }),
    );
    await db
      .update(integrityFlags)
      .set({ resolvedAt: new Date(NOW), resolvedByUserId: null, resolution: opts.resolution, resolutionNote: null })
      .where(eq(integrityFlags.id, opts.flagId));
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
    // Fix round 1 (review MEDIUM 1): the sweep's own basis, distinct from the after-commit
    // caller's — an operator reading this flag's evidence can tell it was re-derived, not frozen
    // at accept time.
    expect(flags[0]!.evidence).toMatchObject({ basis: "sweep_rederivation" });
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

  // -----------------------------------------------------------------------------------------
  // Final review F1 (HIGH): the sweep re-litigated every operator-RELEASED trade as a fresh open
  // question, and offered a REVERSAL of the decision just made. The reviewer's live reproduction,
  // kept here as the regression: before the fix this pair produced `flagsRaised: 1` and a new
  // open `subjectType: "trade"` flag.
  // -----------------------------------------------------------------------------------------

  it("never re-litigates a trade an operator RELEASED — the hold's own flag is the fairness disposition", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    // Exactly what `releaseHeldTradeInTx` leaves behind: the row stamped back to `accepted`, and
    // its `trade_hold` flag resolved `trade_released`. Grotesquely lopsided on purpose — this
    // trade WOULD flag on its own numbers, which is the whole point: the operator already said
    // yes to those numbers, at the stricter of the two thresholds.
    await insertAcceptedTrade(db, {
      id: "trade_released",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      weekNumber: 4,
      give: ["p_star"],
      get: ["p_scrub"],
    });
    await insertResolvedHoldFlag(db, { tradeId: "trade_released", flagId: "flag_released_hold", leagueId: league.leagueId, resolution: "trade_released" });

    const result = await sweepUnflaggedTrades(db, { leagueId: league.leagueId, newId: nextFlagId, audit: logger, clock: { now: () => NOW } });

    // Excluded by the CANDIDATE query, not skipped after re-derivation — a decided trade costs no
    // slot of the batch bound (`unflaggedAcceptedTrades`' own docblock).
    expect(result).toEqual({ tradesChecked: 0, flagsRaised: 0 });
    expect(await openFlags(db)).toEqual([]);
    // No second flag of ANY kind over this trade: the released hold is still the only one.
    const all = await db.select().from(integrityFlags).where(eq(integrityFlags.subjectId, "trade_released"));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ subjectType: "held_trade", resolution: "trade_released" });
  });

  it("never re-litigates a trade whose hold is still OPEN either — an unanswered question is not a second one", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    // The reachable variant the released case does not cover: `closeSupersededHoldFlag`'s own
    // crash window can leave an OPEN `trade_hold` flag over a row a later path stamped back to
    // `accepted`. The disposition is the flag's existence, never its resolution state.
    await insertAcceptedTrade(db, {
      id: "trade_open_hold",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      weekNumber: 4,
      give: ["p_star"],
      get: ["p_scrub"],
    });
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_hold",
        subjectId: "trade_open_hold",
        leagueId: league.leagueId,
        evidence: {},
        raisedByUserId: null,
        occurredAt: NOW,
        newId: () => "flag_open_hold",
        audit: logger,
      }),
    );

    const result = await sweepUnflaggedTrades(db, { leagueId: league.leagueId, newId: nextFlagId, audit: logger, clock: { now: () => NOW } });

    expect(result).toEqual({ tradesChecked: 0, flagsRaised: 0 });
    const open = await openFlags(db);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ subjectType: "held_trade", subjectId: "trade_open_hold" });
  });

  it("never sees a BLOCKED trade at all — it never executed, so it was never sweepable", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    // `blockHeldTradeInTx` stamps `status = "blocked"` and moves nothing. The rosters never
    // changed, so there is no completed trade here for a fairness verdict to be about — the
    // candidate query's own `status = 'accepted'` is what keeps it out, one layer earlier than
    // the flag exclusion above.
    await insertAcceptedTrade(db, {
      id: "trade_blocked",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      weekNumber: 4,
      give: ["p_star"],
      get: ["p_scrub"],
      status: "blocked",
    });
    await insertResolvedHoldFlag(db, { tradeId: "trade_blocked", flagId: "flag_blocked_hold", leagueId: league.leagueId, resolution: "trade_blocked" });

    const result = await sweepUnflaggedTrades(db, { leagueId: league.leagueId, newId: nextFlagId, audit: logger, clock: { now: () => NOW } });

    expect(result).toEqual({ tradesChecked: 0, flagsRaised: 0 });
    expect(await openFlags(db)).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// Plan D, Task 5, fix round 1 (Finding 1): the crash-window re-close, and the honest resolution
// it re-closes with. `closeSupersededHoldFlag`'s own after-commit call (`acceptTrade`'s and
// `resolveFlag`'s `trade_released` branch, both via `closeSupersededHoldFlagsQuietly`) is proven
// end to end from the league side already (`src/league-service/trades.test.ts`'s "supersedes a
// held trade" test) — this suite proves the CLOSING MACHINERY itself, directly and in isolation,
// including the one path that test can't reach: a process that dies AFTER the superseding trade's
// own supersede sweep commits but BEFORE the after-commit close call ever runs, and the sweep
// script (`sweepSupersededHoldFlags`) that is the only thing standing between that flag and
// staying open forever.
// -------------------------------------------------------------------------------------------
describe("closeSupersededHoldFlag / closeSupersededHoldFlagsQuietly / sweepSupersededHoldFlags", () => {
  /** A HELD trade with its own OPEN `trade_hold` flag — the exact state `holdTradeInTx`
   *  (`@/league-service/trades`) produces, built directly. Mirrors `insertAcceptedTrade` above,
   *  status `held` and a real flag from `raiseFlag` rather than none at all. */
  async function insertHeldTradeWithFlag(
    db: Db,
    opts: {
      readonly id: string;
      readonly flagId: string;
      readonly leagueId: string;
      readonly proposerTeamId: string;
      readonly counterpartyTeamId: string;
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
      weekNumber: 4,
      proposerAssets: opts.give.map((playerId) => ({ kind: "player" as const, playerId })),
      counterpartyAssets: opts.get.map((playerId) => ({ kind: "player" as const, playerId })),
      fingerprint: `fp_${opts.id}`,
      note: null,
      status: "held",
      proposedAt: now,
      expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
    });
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_hold",
        subjectId: opts.id,
        leagueId: opts.leagueId,
        evidence: {},
        raisedByUserId: null,
        occurredAt: NOW,
        newId: () => opts.flagId,
        audit: logger,
      }),
    );
  }

  async function flagRow(db: Db, flagId: string) {
    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flagId));
    return row!;
  }

  it("closes an open trade_hold flag once its trade has moved to superseded, with a real flag_resolved event on the platform chain", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertHeldTradeWithFlag(db, {
      id: "trade_close_1",
      flagId: "flag_close_1",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      give: ["p_even_a"],
      get: ["p_even_b"],
    });
    // A raw write standing in for `acceptTrade`'s/`releaseHeldTradeInTx`'s own supersede sweep
    // having already moved this row — this suite is about the CLOSING half alone.
    await db.update(tradeProposals).set({ status: "superseded" }).where(eq(tradeProposals.id, "trade_close_1"));

    const closed = await closeSupersededHoldFlag(db, { tradeId: "trade_close_1", leagueId: league.leagueId, occurredAt: NOW, audit: logger });

    expect(closed).toBe(true);
    const flag = await flagRow(db, "flag_close_1");
    // `resolvedByUserId: null` — the SAME shape a stale-tab operator's own detail read now
    // recognizes as resolved (`flagDetail`'s fix round 1 loosening), never the collision the
    // review's own bug trace names.
    expect(flag).toMatchObject({ resolvedByUserId: null, resolution: "superseded_before_review" });
    expect(flag.resolvedAt).not.toBeNull();
    expect(flag.resolutionNote).not.toBeNull();
    const [event] = await auditEventsOn(db, "platform", "flag_resolved");
    expect(event).toMatchObject({
      actorId: null,
      actorType: "system",
      leagueId: null, // platform chain — ruling 1
      payload: { flagId: "flag_close_1", flagType: "trade_hold", decision: "superseded_before_review", subjectId: "trade_close_1" },
    });
  });

  it("sweepSupersededHoldFlags leaves a flag alone whose trade is still held — nothing superseded it yet", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertHeldTradeWithFlag(db, {
      id: "trade_untouched",
      flagId: "flag_untouched",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      give: ["p_even_a"],
      get: ["p_even_b"],
    });

    // No supersede at all — the trade named by `flag_untouched` is still exactly `held`, so the
    // candidate query's own `tradeProposals.status = 'superseded'` join predicate must exclude it.
    const result = await sweepSupersededHoldFlags(db, { leagueId: league.leagueId, clock: { now: () => NOW }, audit: logger });
    expect(result).toEqual({ flagsChecked: 0, flagsClosed: 0 });
    expect((await flagRow(db, "flag_untouched")).resolvedAt).toBeNull();
  });

  it("is idempotent — a second close on an already-closed flag writes nothing and answers false", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertHeldTradeWithFlag(db, {
      id: "trade_close_2",
      flagId: "flag_close_2",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      give: ["p_even_a"],
      get: ["p_even_b"],
    });
    await db.update(tradeProposals).set({ status: "superseded" }).where(eq(tradeProposals.id, "trade_close_2"));

    const first = await closeSupersededHoldFlag(db, { tradeId: "trade_close_2", leagueId: league.leagueId, occurredAt: NOW, audit: logger });
    const second = await closeSupersededHoldFlag(db, { tradeId: "trade_close_2", leagueId: league.leagueId, occurredAt: NOW, audit: logger });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await auditEventsOn(db, "platform", "flag_resolved")).toHaveLength(1); // no second event
  });

  it("closeSupersededHoldFlagsQuietly swallows one failure, logs it, and still closes the rest — the identical isolation raiseFairnessFlagQuietly keeps", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertHeldTradeWithFlag(db, {
      id: "trade_quiet_fail",
      flagId: "flag_quiet_fail",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      give: ["p_even_a"],
      get: ["p_even_b"],
    });
    await insertHeldTradeWithFlag(db, {
      id: "trade_quiet_ok",
      flagId: "flag_quiet_ok",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      give: ["p_star"],
      get: ["p_scrub"],
    });
    await db.update(tradeProposals).set({ status: "superseded" }).where(inArray(tradeProposals.id, ["trade_quiet_fail", "trade_quiet_ok"]));

    let calls = 0;
    const flakyAudit: AuditLogger = {
      ...logger,
      record: async (tx, event) => {
        calls += 1;
        if (calls === 1) throw new Error("platform chain append failed");
        return logger.record(tx, event);
      },
    };
    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});

    await closeSupersededHoldFlagsQuietly(db, { tradeIds: ["trade_quiet_fail", "trade_quiet_ok"], leagueId: league.leagueId, occurredAt: NOW, audit: flakyAudit });

    expect(spyError).toHaveBeenCalledWith(
      "[integrity-service] superseded-hold flag close failed",
      { tradeId: "trade_quiet_fail", leagueId: league.leagueId },
      expect.any(Error),
    );
    // The failed one rolled its whole transaction back — still open, the same crash-window state
    // `sweepSupersededHoldFlags` exists to find.
    expect((await flagRow(db, "flag_quiet_fail")).resolvedAt).toBeNull();
    // The SECOND id was never touched by the first one's failure — the loop kept going.
    expect((await flagRow(db, "flag_quiet_ok")).resolvedAt).not.toBeNull();
    spyError.mockRestore();
  });

  it("sweeps with the default system clock when the caller supplies none — the manual re-run's own ordinary shape", async () => {
    // Every OTHER `sweepSupersededHoldFlags` test in this suite passes an explicit `clock`, which
    // left this one `??` branch uncovered — `scripts/sweep-trade-fairness.ts`'s own `main()` never
    // supplies one.
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertHeldTradeWithFlag(db, {
      id: "trade_default_clock",
      flagId: "flag_default_clock",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      give: ["p_even_a"],
      get: ["p_even_b"],
    });
    await db.update(tradeProposals).set({ status: "superseded" }).where(eq(tradeProposals.id, "trade_default_clock"));

    const result = await sweepSupersededHoldFlags(db, { leagueId: league.leagueId, audit: logger });

    expect(result).toEqual({ flagsChecked: 1, flagsClosed: 1 });
    expect((await flagRow(db, "flag_default_clock")).resolvedAt).not.toBeNull();
  });

  it("re-closes a flag the crash window left open — the after-commit call never landed, but the trade already moved to superseded", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertHeldTradeWithFlag(db, {
      id: "trade_crash",
      flagId: "flag_crash",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      give: ["p_even_a"],
      get: ["p_even_b"],
    });
    // The identical crash window `raiseTradeFairnessFlag`'s own after-commit gap already carries
    // (that function's own docblock): the superseding trade's transaction committed, but the
    // process died before `closeSupersededHoldFlagsQuietly`'s own call ever ran.
    await db.update(tradeProposals).set({ status: "superseded" }).where(eq(tradeProposals.id, "trade_crash"));
    expect((await flagRow(db, "flag_crash")).resolvedAt).toBeNull();

    const result = await sweepSupersededHoldFlags(db, { leagueId: league.leagueId, clock: { now: () => NOW }, audit: logger });

    expect(result).toEqual({ flagsChecked: 1, flagsClosed: 1 });
    const flag = await flagRow(db, "flag_crash");
    expect(flag).toMatchObject({ resolvedByUserId: null, resolution: "superseded_before_review" });
    expect(flag.resolvedAt).not.toBeNull();
    expect(await auditEventsOn(db, "platform", "flag_resolved")).toHaveLength(1);
  });

  it("serializes two concurrent sweeps over the same candidate — exactly one closes it, the identical guard resolveFlag's own operator race already proves", async () => {
    // The guard is in `closeSupersededHoldFlag`'s own UPDATE `WHERE resolved_at IS NULL`, not a
    // prior read — the same "a prior read would let both pass it" reasoning `resolveFlag`'s own
    // "serializes two operators resolving at the same instant" test states, restated for the
    // sweep's own per-candidate close call.
    await truncateAll(db);
    const league = await fairnessLeague(db);
    await insertHeldTradeWithFlag(db, {
      id: "trade_sweep_race",
      flagId: "flag_sweep_race",
      leagueId: league.leagueId,
      proposerTeamId: league.teamA,
      counterpartyTeamId: league.teamB,
      give: ["p_even_a"],
      get: ["p_even_b"],
    });
    await db.update(tradeProposals).set({ status: "superseded" }).where(eq(tradeProposals.id, "trade_sweep_race"));

    const [a, b] = await Promise.all([
      sweepSupersededHoldFlags(db, { leagueId: league.leagueId, clock: { now: () => NOW }, audit: logger }),
      sweepSupersededHoldFlags(db, { leagueId: league.leagueId, clock: { now: () => NOW }, audit: logger }),
    ]);

    // At least one sweep saw the candidate while it was still open (whichever ran its own SELECT
    // first), and the guarded UPDATE is what keeps the OTHER from also counting it closed —
    // exactly one, never zero and never two.
    expect(a.flagsClosed + b.flagsClosed).toBe(1);
    expect((await flagRow(db, "flag_sweep_race")).resolvedAt).not.toBeNull();
    expect(await auditEventsOn(db, "platform", "flag_resolved")).toHaveLength(1);
  });

  it("scopes to one league when leagueId is supplied, and sweeps every league when omitted — the manual re-run's own ordinary shape", async () => {
    await truncateAll(db);
    const leagueA = await fairnessLeague(db, "_sweep_a");
    const leagueB = await fairnessLeague(db, "_sweep_b");
    await insertHeldTradeWithFlag(db, {
      id: "trade_sweep_a",
      flagId: "flag_sweep_a",
      leagueId: leagueA.leagueId,
      proposerTeamId: leagueA.teamA,
      counterpartyTeamId: leagueA.teamB,
      give: ["p_even_a_sweep_a"],
      get: ["p_even_b_sweep_a"],
    });
    await insertHeldTradeWithFlag(db, {
      id: "trade_sweep_b",
      flagId: "flag_sweep_b",
      leagueId: leagueB.leagueId,
      proposerTeamId: leagueB.teamA,
      counterpartyTeamId: leagueB.teamB,
      give: ["p_even_a_sweep_b"],
      get: ["p_even_b_sweep_b"],
    });
    await db.update(tradeProposals).set({ status: "superseded" }).where(inArray(tradeProposals.id, ["trade_sweep_a", "trade_sweep_b"]));

    const scoped = await sweepSupersededHoldFlags(db, { leagueId: leagueA.leagueId, clock: { now: () => NOW }, audit: logger });
    expect(scoped).toEqual({ flagsChecked: 1, flagsClosed: 1 });
    expect((await flagRow(db, "flag_sweep_a")).resolvedAt).not.toBeNull();
    expect((await flagRow(db, "flag_sweep_b")).resolvedAt).toBeNull(); // untouched — a different league

    const all = await sweepSupersededHoldFlags(db, { clock: { now: () => NOW }, audit: logger });
    expect(all).toEqual({ flagsChecked: 1, flagsClosed: 1 }); // only flag_sweep_b was still open
    expect((await flagRow(db, "flag_sweep_b")).resolvedAt).not.toBeNull();
  });
});
