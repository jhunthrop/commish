import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db, DbTx } from "@/db/client";
import { auditEvents, integrityFlags, leagues, memberNotices, playerStatLines, players, rosterSlots, statWeeks, teams, tradeProposals, users } from "@/db/schema";
import { isUniqueViolation } from "@/db/errors";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventType } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import type { RosterSlotConfig } from "@/domain/roster";
import { copyViolations } from "@/integrity/copy-rules";
import type { AuditLogger } from "@/integrity-service/audit-logger";
import { notifyAffectedMember } from "@/integrity-service/notify";
import { raiseTradeFairnessFlag, sweepUnflaggedTrades } from "@/integrity-service/trade-fairness";
import type { TradeAsset } from "@/trades/assets";
import { TRADE_CONFIG } from "@/trades/config";
import { seasonCurrentWeek } from "./test-support";
import { applyTradeInTx } from "./trade-transfer";
import {
  acceptTrade,
  blockHeldTradeInTx,
  listTrades,
  proposalFingerprint,
  proposeTrade,
  refusalFor,
  rejectTrade,
  releaseHeldTradeInTx,
  toTradeProposal,
  tradesQuery,
  withdrawTrade,
  type TradeProposal,
} from "./trades";

const db = createTestDb();

const HOUR_MS = 60 * 60 * 1000;

function player(playerId: string): TradeAsset {
  return { kind: "player", playerId };
}

/** One league, two teams — `team_a` proposes, `team_b` answers. Every table test and query
 *  test in this file negotiates between these same two teams. */
async function seedTradeableLeague(db: Db): Promise<void> {
  await db.insert(users).values([
    { id: "u_a", email: "u_a@test.local", displayName: "Manager A" },
    { id: "u_b", email: "u_b@test.local", displayName: "Manager B" },
  ]);
  await db.insert(leagues).values({ id: "lg_1", name: "Trade League", format: "snake", teamCount: 2, commissionerUserId: "u_a" });
  await db.insert(teams).values([
    { id: "team_a", leagueId: "lg_1", userId: "u_a", name: "Team A" },
    { id: "team_b", leagueId: "lg_1", userId: "u_b", name: "Team B" },
  ]);
}

/** Inserts one `team_a` -> `team_b` offer, fingerprinted the same way the (later) propose
 *  service will. `status` defaults to `open`, matching every real proposal on creation. */
async function insertProposal(
  db: Db,
  input: { readonly id: string; readonly from?: readonly string[]; readonly to?: readonly string[]; readonly status?: string },
): Promise<void> {
  const proposerAssets = (input.from ?? ["p_default_from"]).map(player);
  const counterpartyAssets = (input.to ?? ["p_default_to"]).map(player);
  const now = new Date("2026-08-21T12:00:00.000Z");
  await db.insert(tradeProposals).values({
    id: input.id,
    leagueId: "lg_1",
    proposerTeamId: "team_a",
    counterpartyTeamId: "team_b",
    weekNumber: 1,
    proposerAssets,
    counterpartyAssets,
    fingerprint: proposalFingerprint({
      leagueId: "lg_1",
      proposerTeamId: "team_a",
      counterpartyTeamId: "team_b",
      proposerAssets,
      counterpartyAssets,
    }),
    note: null,
    status: input.status ?? "open",
    proposedAt: now,
    expiresAt: new Date(now.getTime() + 72 * HOUR_MS),
  });
}

/** Test-only: the propose route's real open-cap check is a counted read inside the proposing
 *  transaction (Task 3), never a stored rollup column. This mirrors that shape without owning it. */
async function openProposalCount(db: Db, proposerTeamId: string): Promise<number> {
  const rows = await db
    .select({ id: tradeProposals.id })
    .from(tradeProposals)
    .where(and(eq(tradeProposals.proposerTeamId, proposerTeamId), eq(tradeProposals.status, "open")));
  return rows.length;
}

describe("trade_proposals", () => {
  it("allows two DIFFERENT open offers between the same two teams", async () => {
    await truncateAll(db);
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_1", from: ["p_rb1"], to: ["p_wr1"] });
    await insertProposal(db, { id: "tr_2", from: ["p_rb1"], to: ["p_te1"] });
    expect(await openProposalCount(db, "team_a")).toBe(2);
  });

  it("refuses a second open offer with the identical package, on the fingerprint index", async () => {
    await truncateAll(db);
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_1", from: ["p_rb1"], to: ["p_wr1"] });
    await expect(insertProposal(db, { id: "tr_2", from: ["p_rb1"], to: ["p_wr1"] })).rejects.toSatisfy((error: unknown) =>
      isUniqueViolation(error, "trade_proposals_open_fingerprint_idx"),
    );
  });

  it("allows the identical package again once the first one is settled", async () => {
    await truncateAll(db);
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_1", from: ["p_rb1"], to: ["p_wr1"] });
    await db.update(tradeProposals).set({ status: "rejected", settledAt: new Date() }).where(eq(tradeProposals.id, "tr_1"));
    await expect(insertProposal(db, { id: "tr_2", from: ["p_rb1"], to: ["p_wr1"] })).resolves.toBeUndefined();
  });

  it("keeps an accepted trade accepted after a reversal, and stamps the reversal beside it", async () => {
    await truncateAll(db);
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_1", status: "accepted" });
    await db.update(tradeProposals).set({ reversedAt: new Date(), reversedByFlagId: "fl_1" }).where(eq(tradeProposals.id, "tr_1"));
    const [row] = await db.select().from(tradeProposals);
    expect(row!.status).toBe("accepted");
    expect(row!.reversedAt).not.toBeNull();
  });
});

describe("proposalFingerprint", () => {
  const BASE = {
    leagueId: "lg_1",
    proposerTeamId: "team_a",
    counterpartyTeamId: "team_b",
    proposerAssets: [player("p1")],
    counterpartyAssets: [player("p2")],
  };

  it("hashes the same offer to the same value however the sides were ordered on the way in", () => {
    const a = proposalFingerprint({ ...BASE, proposerAssets: [player("p1"), player("p2")] });
    const b = proposalFingerprint({ ...BASE, proposerAssets: [player("p2"), player("p1")] });
    expect(a).toBe(b);
  });

  it("hashes the MIRROR offer differently, because who is asking is part of the offer", () => {
    const forward = proposalFingerprint(BASE);
    const mirror = proposalFingerprint({
      ...BASE,
      proposerTeamId: BASE.counterpartyTeamId,
      counterpartyTeamId: BASE.proposerTeamId,
      proposerAssets: BASE.counterpartyAssets,
      counterpartyAssets: BASE.proposerAssets,
    });
    expect(mirror).not.toBe(forward);
  });
});

describe("toTradeProposal", () => {
  const baseRow: typeof tradeProposals.$inferSelect = {
    id: "tr_1",
    leagueId: "lg_1",
    proposerTeamId: "team_a",
    counterpartyTeamId: "team_b",
    weekNumber: 3,
    proposerAssets: [player("p1")],
    counterpartyAssets: [player("p2")],
    fingerprint: "fp_1",
    note: "let's talk",
    status: "open",
    proposedAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: new Date("2026-08-04T00:00:00.000Z"),
    settledAt: null,
    settledByUserId: null,
    reversedAt: null,
    reversedByFlagId: null,
  };

  it("ISO-strings every timestamp and leaves an unsettled row's optional fields null", () => {
    const proposal = toTradeProposal(baseRow);
    expect(proposal).toEqual({
      id: "tr_1",
      leagueId: "lg_1",
      proposerTeamId: "team_a",
      counterpartyTeamId: "team_b",
      weekNumber: 3,
      proposerAssets: [player("p1")],
      counterpartyAssets: [player("p2")],
      fingerprint: "fp_1",
      note: "let's talk",
      status: "open",
      proposedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-04T00:00:00.000Z",
      settledAt: null,
      settledByUserId: null,
      reversedAt: null,
      reversedByFlagId: null,
    } satisfies TradeProposal);
  });

  it("ISO-strings the settlement and reversal timestamps once they are stamped", () => {
    const proposal = toTradeProposal({
      ...baseRow,
      status: "accepted",
      settledAt: new Date("2026-08-02T00:00:00.000Z"),
      settledByUserId: "u_b",
      reversedAt: new Date("2026-08-03T00:00:00.000Z"),
      reversedByFlagId: "fl_1",
    });
    expect(proposal.settledAt).toBe("2026-08-02T00:00:00.000Z");
    expect(proposal.settledByUserId).toBe("u_b");
    expect(proposal.reversedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(proposal.reversedByFlagId).toBe("fl_1");
  });
});

/** A third team in `lg_1`, with no part in any `team_a`/`team_b` proposal — the bystander every
 *  fix round 1 (F1) privacy test negotiates against. */
async function addBystanderTeam(db: Db): Promise<void> {
  await db.insert(users).values({ id: "u_c", email: "u_c@test.local", displayName: "Manager C" });
  await db.insert(teams).values({ id: "team_c", leagueId: "lg_1", userId: "u_c", name: "Team C" });
}

describe("tradesQuery", () => {
  it("inbox is the counterparty's open offers; outbox is the proposer's", async () => {
    await truncateAll(db);
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_open", from: ["p_rb1"], to: ["p_wr1"] });
    await insertProposal(db, { id: "tr_settled", from: ["p_rb2"], to: ["p_wr2"] });
    await db.update(tradeProposals).set({ status: "rejected", settledAt: new Date() }).where(eq(tradeProposals.id, "tr_settled"));

    const inbox = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_b", box: "inbox" });
    expect(inbox.map((row) => row.id)).toEqual(["tr_open"]);

    const outbox = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_a", box: "outbox" });
    expect(outbox.map((row) => row.id)).toEqual(["tr_open"]);
  });

  /**
   * Fix round 1, F1 (HIGH — the code review's own MEDIUM undersold it, and the member panel
   * named it its sharpest finding). Before this fix, `history` answered with every row in the
   * league regardless of status, which meant a still-negotiating or dead proposal between two
   * OTHER teams rendered on the trades page as a done deal to the whole league — exactly the
   * disclosure `trade_proposed`'s hidden activity-feed visibility (ruling 12,
   * `@/integrity/activity-view.ts`) exists to prevent. The wire-level proof: a THIRD team's own
   * `history` read for `team_a`/`team_b`'s negotiation.
   */
  it("never answers a third team's history with another pair's open or dead proposal", async () => {
    await truncateAll(db);
    await seedTradeableLeague(db);
    await addBystanderTeam(db);
    await insertProposal(db, { id: "tr_open", from: ["p_rb1"], to: ["p_wr1"] });
    await insertProposal(db, { id: "tr_rejected", from: ["p_rb2"], to: ["p_wr2"] });
    await insertProposal(db, { id: "tr_withdrawn", from: ["p_rb3"], to: ["p_wr3"] });
    await insertProposal(db, { id: "tr_expired", from: ["p_rb4"], to: ["p_wr4"] });
    await insertProposal(db, { id: "tr_superseded", from: ["p_rb5"], to: ["p_wr5"] });
    // Plan D, Task 5, fix round 1 (Finding 2): the brief's own privacy rule — the two managers of
    // a held trade see it honestly, but the league (and a fortiori a bystander team) does NOT
    // learn about it — had no wire-level regression test naming `held` specifically.
    await insertProposal(db, { id: "tr_held", from: ["p_rb6"], to: ["p_wr6"] });
    await db.update(tradeProposals).set({ status: "rejected", settledAt: new Date() }).where(eq(tradeProposals.id, "tr_rejected"));
    await db.update(tradeProposals).set({ status: "withdrawn", settledAt: new Date() }).where(eq(tradeProposals.id, "tr_withdrawn"));
    await db.update(tradeProposals).set({ status: "expired" }).where(eq(tradeProposals.id, "tr_expired"));
    await db.update(tradeProposals).set({ status: "superseded", settledAt: new Date() }).where(eq(tradeProposals.id, "tr_superseded"));
    await db.update(tradeProposals).set({ status: "held" }).where(eq(tradeProposals.id, "tr_held"));

    const bystanderHistory = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_c", box: "history" });
    expect(bystanderHistory).toEqual([]);
  });

  it("answers a third team's history with an ACCEPTED trade between two other teams, reversed or not", async () => {
    await truncateAll(db);
    await seedTradeableLeague(db);
    await addBystanderTeam(db);
    await insertProposal(db, { id: "tr_accepted", from: ["p_rb1"], to: ["p_wr1"] });
    await insertProposal(db, { id: "tr_reversed", from: ["p_rb2"], to: ["p_wr2"] });
    await db.update(tradeProposals).set({ status: "accepted", settledAt: new Date() }).where(eq(tradeProposals.id, "tr_accepted"));
    await db
      .update(tradeProposals)
      .set({ status: "accepted", settledAt: new Date(), reversedAt: new Date() })
      .where(eq(tradeProposals.id, "tr_reversed"));

    const bystanderHistory = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_c", box: "history" });
    expect(bystanderHistory.map((row) => row.id).sort()).toEqual(["tr_accepted", "tr_reversed"]);
  });

  it("never duplicates the caller's own OPEN offer into history — it already lives in inbox/outbox", async () => {
    await truncateAll(db);
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_open", from: ["p_rb1"], to: ["p_wr1"] });

    const proposerHistory = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_a", box: "history" });
    expect(proposerHistory).toEqual([]);
    const counterpartyHistory = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_b", box: "history" });
    expect(counterpartyHistory).toEqual([]);
  });

  it("keeps a member's own dead offer visible to BOTH parties, not just the proposer", async () => {
    await truncateAll(db);
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_rejected", from: ["p_rb1"], to: ["p_wr1"] });
    await db.update(tradeProposals).set({ status: "rejected", settledAt: new Date() }).where(eq(tradeProposals.id, "tr_rejected"));

    const proposerHistory = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_a", box: "history" });
    expect(proposerHistory.map((row) => row.id)).toEqual(["tr_rejected"]);

    const counterpartyHistory = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_b", box: "history" });
    expect(counterpartyHistory.map((row) => row.id)).toEqual(["tr_rejected"]);
  });
});

/**
 * Task 3: the negotiation. Everything below negotiates over ONE fixture — `team_a` (u_alice)
 * and `team_b` (u_bob), both full and legal under a compact 5-slot roster with exactly one QB
 * slot and a two-player bench, so the "no room" precondition (a two-QB package into a full
 * bench) has a real roster to refuse against. `u_carol` fields no team here at all, for the
 * non-oracle 404 tests.
 */
const FULL_LEAGUE_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
  { slot: "BENCH", count: 2, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

// `npm test` is plain `vitest run`, which loads no `.env.local` — `vitest.setup.mts`'s own
// docblock explains why `DATABASE_URL` gets away with this (a hardcoded fallback inside
// `createTestDb`) and sets the same kind of fallback itself for `SESSION_SIGNAL_SALT`, since
// production code intentionally has none. `REDIS_URL` has no such fallback either
// (`src/lib/realtime/redis.ts`'s `requireRedisUrl`), and exactly one test below needs a REAL
// `deliverNotice` (the "every dependency defaulted" case, to cover that default's own branch) —
// so it gets the identical `??=` treatment, scoped to this file, matching docker-compose's own
// default port.
process.env.REDIS_URL ??= "redis://localhost:6379";

const NOW = "2026-08-21T12:00:00.000Z";

function fixedClock(iso: string): Clock {
  return { now: () => iso };
}

const deliverNoticeFake = async (): Promise<void> => {};

let tradeIdCounter = 0;
function newTradeId(): () => string {
  tradeIdCounter += 1;
  const prefix = tradeIdCounter;
  let sequence = 0;
  return () => `trade_${prefix}_${(sequence += 1)}`;
}

function playerAsset(playerId: string): TradeAsset {
  return { kind: "player", playerId };
}

async function seedFullTradeLeague(db: Db): Promise<void> {
  await db.insert(users).values([
    { id: "u_alice", email: "u_alice@test.local", displayName: "Alice" },
    { id: "u_bob", email: "u_bob@test.local", displayName: "Bob" },
    { id: "u_carol", email: "u_carol@test.local", displayName: "Carol" },
  ]);
  await db.insert(leagues).values({
    id: "lg_1",
    name: "Full Trade League",
    format: "snake",
    teamCount: 2,
    commissionerUserId: "u_alice",
    rosterSlots: FULL_LEAGUE_SLOTS,
  });
  await db.insert(teams).values([
    { id: "team_a", leagueId: "lg_1", userId: "u_alice", name: "Team Alice" },
    { id: "team_b", leagueId: "lg_1", userId: "u_bob", name: "Team Bob" },
  ]);
  await db.insert(players).values([
    { id: "p_qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "p_qb2", name: "QB Two", position: "QB", nflTeam: "SF" },
    { id: "p_rb_a", name: "RB Alpha", position: "RB", nflTeam: "DAL" },
    { id: "p_wr_a", name: "WR Alpha", position: "WR", nflTeam: "MIA" },
    { id: "p_te_a", name: "TE Alpha", position: "TE", nflTeam: "PHI" },
    { id: "p_qb_b", name: "QB Bravo", position: "QB", nflTeam: "BUF" },
    { id: "p_rb_b", name: "RB Bravo", position: "RB", nflTeam: "NYJ" },
    { id: "p_wr1", name: "WR Bravo", position: "WR", nflTeam: "SEA" },
    { id: "p_bench_b1", name: "Bench Bravo One", position: "RB", nflTeam: "DEN" },
    { id: "p_bench_b2", name: "Bench Bravo Two", position: "WR", nflTeam: "LAC" },
  ]);
  await db.insert(rosterSlots).values([
    { teamId: "team_a", slot: "QB", slotIndex: 0, playerId: "p_qb1" },
    { teamId: "team_a", slot: "RB", slotIndex: 0, playerId: "p_rb_a" },
    { teamId: "team_a", slot: "WR", slotIndex: 0, playerId: "p_wr_a" },
    { teamId: "team_a", slot: "BENCH", slotIndex: 0, playerId: "p_qb2" },
    { teamId: "team_a", slot: "BENCH", slotIndex: 1, playerId: "p_te_a" },
    { teamId: "team_b", slot: "QB", slotIndex: 0, playerId: "p_qb_b" },
    { teamId: "team_b", slot: "RB", slotIndex: 0, playerId: "p_rb_b" },
    { teamId: "team_b", slot: "WR", slotIndex: 0, playerId: "p_wr1" },
    { teamId: "team_b", slot: "BENCH", slotIndex: 0, playerId: "p_bench_b1" },
    { teamId: "team_b", slot: "BENCH", slotIndex: 1, playerId: "p_bench_b2" },
  ]);
}

interface ProposeInputOpts {
  readonly as?: "u_alice" | "u_bob";
  readonly give?: readonly string[];
  readonly receive?: readonly string[];
  readonly counterparty?: "self";
  readonly note?: string | null;
}

/** A legal, default 1-for-1 RB swap between `team_a` and `team_b`, proposed by `u_alice` unless
 *  `opts.as` says otherwise. Every test overrides exactly the one field it is about. */
async function proposeInput(
  db: Db,
  opts: ProposeInputOpts = {},
): Promise<{
  readonly leagueId: string;
  readonly userId: string;
  readonly counterpartyTeamId: string;
  readonly proposerAssets: readonly TradeAsset[];
  readonly counterpartyAssets: readonly TradeAsset[];
  readonly note: string | null;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly deliver: () => Promise<void>;
}> {
  void db; // pure builder; `db` is part of the brief's own call shape, not read here.
  const proposerUserId = opts.as ?? "u_alice";
  const proposerTeamId = proposerUserId === "u_alice" ? "team_a" : "team_b";
  const counterpartyTeamId = opts.counterparty === "self" ? proposerTeamId : proposerTeamId === "team_a" ? "team_b" : "team_a";
  const give = opts.give ?? (proposerTeamId === "team_a" ? ["p_rb_a"] : ["p_rb_b"]);
  const receive = opts.receive ?? (proposerTeamId === "team_a" ? ["p_rb_b"] : ["p_rb_a"]);
  return {
    leagueId: "lg_1",
    userId: proposerUserId,
    counterpartyTeamId,
    proposerAssets: give.map(playerAsset),
    counterpartyAssets: receive.map(playerAsset),
    note: opts.note ?? null,
    clock: fixedClock(NOW),
    newId: newTradeId(),
    deliver: deliverNoticeFake,
  };
}

async function noticesFor(db: Db, userId: string): Promise<readonly (typeof memberNotices.$inferSelect)[]> {
  return db.select().from(memberNotices).where(eq(memberNotices.userId, userId));
}

async function auditEventsOn(db: Db, scope: string, eventType: AuditEventType): Promise<readonly (typeof auditEvents.$inferSelect)[]> {
  return db.select().from(auditEvents).where(and(eq(auditEvents.chainScope, scope), eq(auditEvents.eventType, eventType)));
}

/** Ten DISTINCT open offers from `team_a`, filling `TRADE_CONFIG.maxOpenProposalsPerTeam`. Asset
 *  ids are filler, resolved against no real roster — the open-offer cap counts rows, not
 *  legality, and this only ever seeds the cap, never proposes through the real service. */
async function tenOpenOffers(db: Db, opts: { readonly from: "team_a" }, count: number = TRADE_CONFIG.maxOpenProposalsPerTeam): Promise<void> {
  const counterpartyTeamId = opts.from === "team_a" ? "team_b" : "team_a";
  for (let i = 0; i < count; i += 1) {
    const proposerAssets = [playerAsset(`p_filler_from_${i}`)];
    const counterpartyAssets = [playerAsset(`p_filler_to_${i}`)];
    await db.insert(tradeProposals).values({
      id: `tr_filler_${i}`,
      leagueId: "lg_1",
      proposerTeamId: opts.from,
      counterpartyTeamId,
      weekNumber: 1,
      proposerAssets,
      counterpartyAssets,
      fingerprint: proposalFingerprint({ leagueId: "lg_1", proposerTeamId: opts.from, counterpartyTeamId, proposerAssets, counterpartyAssets }),
      note: null,
      status: "open",
      proposedAt: new Date(NOW),
      expiresAt: new Date(new Date(NOW).getTime() + TRADE_CONFIG.proposalTtlHours * 60 * 60 * 1000),
    });
  }
}

/** One open, unexpired `team_a` -> `team_b` offer, inserted directly — the brief's own
 *  `openTrade`, for the two decisions' tests. `opts.proposer`/`opts.counterparty` document who is
 *  who; this fixture always maps `u_alice` to `team_a` and `u_bob` to `team_b`. */
async function openTrade(
  db: Db,
  opts: { readonly proposer?: "u_alice"; readonly counterparty?: "u_bob"; readonly proposedAt?: string } = {},
): Promise<{ readonly id: string }> {
  void opts.proposer;
  void opts.counterparty;
  const proposedAt = new Date(opts.proposedAt ?? NOW);
  const expiresAt = new Date(proposedAt.getTime() + TRADE_CONFIG.proposalTtlHours * 60 * 60 * 1000);
  const proposerAssets = [playerAsset("p_rb_a")];
  const counterpartyAssets = [playerAsset("p_rb_b")];
  const id = `open_trade_${(tradeIdCounter += 1)}`;
  await db.insert(tradeProposals).values({
    id,
    leagueId: "lg_1",
    proposerTeamId: "team_a",
    counterpartyTeamId: "team_b",
    weekNumber: 1,
    proposerAssets,
    counterpartyAssets,
    fingerprint: proposalFingerprint({ leagueId: "lg_1", proposerTeamId: "team_a", counterpartyTeamId: "team_b", proposerAssets, counterpartyAssets }),
    note: null,
    status: "open",
    proposedAt,
    expiresAt,
  });
  return { id };
}

/** An `AuditLogger` whose `record`/`recordAll` both fail — the binding tx rule proved by
 *  driving it for real: an audit failure fails the whole caller transaction, no partial write. */
const failingAudit: AuditLogger = {
  record: async () => {
    throw new Error("audit append failed");
  },
  recordAll: async () => {
    throw new Error("audit append failed");
  },
};

describe("proposeTrade", () => {
  beforeEach(async () => {
    await truncateAll(db);
    await seedFullTradeLeague(db);
  });

  it("resolves the proposing team from the session and refuses a body that names another one", async () => {
    // The rule the draft engine has honored since Phase 1, and the one a trade is most tempting
    // to break: a trade names two teams and only one of them is yours. `proposeTrade` takes a
    // userId and derives proposerTeamId; there is no input field to spoof.
    const input = await proposeInput(db, { as: "u_alice" });
    expect(Object.keys(input)).not.toContain("proposerTeamId");
    const result = await proposeTrade(db, input);
    expect(result).toMatchObject({ ok: true });
    const [row] = await db.select().from(tradeProposals);
    expect(row!.proposerTeamId).toBe("team_a");
  });

  /** Final review, CRITICAL 1: the same rule, one field over. There is no `weekNumber` input
   *  either — the service derives the league's own current week (`currentWeekOf`, `./schedule`)
   *  and stores THAT, so the valuation basis is never something a caller chose. */
  it("derives the valuation week from the league's own schedule, with no input field to name one", async () => {
    const input = await proposeInput(db, { as: "u_alice" });
    expect(Object.keys(input)).not.toContain("weekNumber");
    await seasonCurrentWeek(db, { leagueId: "lg_1", homeTeamId: "team_a", awayTeamId: "team_b", week: 3 });

    expect(await proposeTrade(db, input)).toMatchObject({ ok: true });
    const [row] = await db.select().from(tradeProposals);
    expect(row!.weekNumber).toBe(3);
  });

  it("refuses an offer naming a player the proposer does not own", async () => {
    const result = await proposeTrade(db, await proposeInput(db, { give: ["p_not_mine"] }));
    expect(result).toEqual({ ok: false, status: 422, reason: "One of those players isn't on your team." });
  });

  it("refuses an offer naming a player the counterparty does not own", async () => {
    const result = await proposeTrade(db, await proposeInput(db, { receive: ["p_not_theirs"] }));
    expect(result).toEqual({ ok: false, status: 422, reason: "One of those players isn't on that team." });
  });

  it("refuses a team trading with itself, in the service and not only in the schema", async () => {
    // `isBalancedProposal` already answers this and has since Phase 1. The service asks it
    // rather than restating it — the same discipline `removeReview` and `resolveFlag` both keep.
    const result = await proposeTrade(db, await proposeInput(db, { counterparty: "self" }));
    expect(result).toEqual({ ok: false, status: 422, reason: "You can't trade with your own team." });
  });

  it("refuses an empty side too, via isBalancedProposal, not only via the schema", async () => {
    const result = await proposeTrade(db, await proposeInput(db, { give: [] }));
    expect(result).toEqual({ ok: false, status: 422, reason: "Both sides need to send at least one player." });
  });

  it("refuses when the caller has no team of their own in this league", async () => {
    const input = await proposeInput(db, { as: "u_alice" });
    const result = await proposeTrade(db, { ...input, userId: "u_carol" });
    expect(result).toEqual({ ok: false, status: 403, reason: "You don't have a team in this league." });
  });

  it("refuses a counterparty team this league doesn't have", async () => {
    const input = await proposeInput(db, { as: "u_alice" });
    const result = await proposeTrade(db, { ...input, counterpartyTeamId: "team_ghost" });
    expect(result).toEqual({ ok: false, status: 404, reason: "We couldn't find that team in this league." });
  });

  it("refuses an eleventh open offer and says what to do about it", async () => {
    await tenOpenOffers(db, { from: "team_a" });
    const result = await proposeTrade(db, await proposeInput(db, { as: "u_alice" }));
    expect(result).toEqual({
      ok: false,
      status: 409,
      reason: `You have ${TRADE_CONFIG.maxOpenProposalsPerTeam} offers out already. Withdraw one before you send another.`,
    });
  });

  it("serializes two concurrent proposes racing for the SAME last cap slot, under real contention (F2)", async () => {
    // Nine existing open offers — one short of the cap. Two DIFFERENT, otherwise legal swaps
    // race for the tenth (and only remaining) slot. A count taken without a preceding lock would
    // let both see "9 open" and both insert, landing 11; the `teams FOR UPDATE` fix serializes
    // them so exactly one lands and the loser gets the cap's own product copy, never a raw
    // constraint error.
    await tenOpenOffers(db, { from: "team_a" }, TRADE_CONFIG.maxOpenProposalsPerTeam - 1);
    const [a, b] = await Promise.all([
      proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_rb_a"], receive: ["p_rb_b"] })),
      proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_qb2"], receive: ["p_qb_b"] })),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser).toMatchObject({
      ok: false,
      status: 409,
      reason: `You have ${TRADE_CONFIG.maxOpenProposalsPerTeam} offers out already. Withdraw one before you send another.`,
    });
    const openRows = await db
      .select({ id: tradeProposals.id })
      .from(tradeProposals)
      .where(and(eq(tradeProposals.proposerTeamId, "team_a"), eq(tradeProposals.status, "open")));
    expect(openRows).toHaveLength(TRADE_CONFIG.maxOpenProposalsPerTeam);
  });

  it("refuses an offer that would leave the receiving roster illegal, before anybody has to answer it", async () => {
    // Two quarterbacks into a one-QB league with a full bench has no legal home, and finding
    // that out at ACCEPT time would mean a manager agreeing to something the product then
    // refuses. Running it here is about not wasting somebody's yes.
    const result = await proposeTrade(db, await proposeInput(db, { give: ["p_qb1", "p_qb2"], receive: ["p_wr1"] }));
    expect(result).toMatchObject({ ok: false, status: 422, reason: expect.stringContaining("no room") });
  });

  it("refuses an offer that would leave the PROPOSER's OWN roster illegal, the same check on the other side", async () => {
    const result = await proposeTrade(db, await proposeInput(db, { give: ["p_rb_a"], receive: ["p_qb_b", "p_rb_b"] }));
    expect(result).toMatchObject({ ok: false, status: 422, reason: expect.stringContaining("no room") });
  });

  it("tells the counterparty, and tells nobody else", async () => {
    await proposeTrade(db, await proposeInput(db, { as: "u_alice" }));
    const [notice] = await noticesFor(db, "u_bob");
    expect(notice!.noticeType).toBe("trade_proposed");
    expect(await noticesFor(db, "u_alice")).toEqual([]);
    expect(await noticesFor(db, "u_carol")).toEqual([]);
    expect(copyViolations(`${notice!.title} ${notice!.body}`)).toEqual([]);
  });

  it("writes trade_proposed on the LEAGUE chain, where a trade belongs", async () => {
    // ruling 1: a trade is league content, and the chain scope is the league even though the
    // VISIBILITY is hidden — the two are independent on purpose.
    await proposeTrade(db, await proposeInput(db));
    expect(await auditEventsOn(db, "lg_1", "trade_proposed")).toHaveLength(1);
    expect(await auditEventsOn(db, "platform", "trade_proposed")).toHaveLength(0);
  });

  it("carries the proposer's own note through to the counterparty's notice, for quoteFor to render later", async () => {
    await proposeTrade(db, await proposeInput(db, { note: "one more year of this and I'm out" }));
    const [notice] = await noticesFor(db, "u_bob");
    expect(notice!.context.note).toBe("one more year of this and I'm out");
  });

  it("returns the proposer's own private, advisory verdict on success, never shown to the counterparty", async () => {
    const result = await proposeTrade(db, await proposeInput(db));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    // Neither player in this fixture has a stat line, so both sides value at zero — the point is
    // that a real `tradeBalance` verdict comes back at all, not this particular arithmetic.
    expect(result.verdict).toEqual({ givingValue: 0, receivingValue: 0, delta: 0, verdict: "even", flags: [] });
    const [notice] = await noticesFor(db, "u_bob");
    expect(notice!.context).not.toHaveProperty("verdict");
  });

  it("refuses a second open offer with the identical package, on the fingerprint index", async () => {
    const input = await proposeInput(db, { as: "u_alice" });
    expect(await proposeTrade(db, input)).toMatchObject({ ok: true });
    expect(await proposeTrade(db, input)).toEqual({ ok: false, status: 409, reason: "You already have this exact trade open." });
  });

  it("serializes two concurrent IDENTICAL proposals under real contention, never a raw constraint error (F3)", async () => {
    // Two DIFFERENT row ids (each `proposeInput` call mints its own), the SAME package — so the
    // SAME fingerprint. Driven through `Promise.all` on the pooled `db`, the idiom
    // `join.test.ts`'s own concurrent-join race uses, so this is a real two-connection race, not
    // a sequential await pretending to be one.
    const [a, b] = await Promise.all([
      proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_rb_a"], receive: ["p_rb_b"] })),
      proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_rb_a"], receive: ["p_rb_b"] })),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser).toEqual({ ok: false, status: 409, reason: "You already have this exact trade open." });
    expect(await db.select().from(tradeProposals).where(eq(tradeProposals.proposerTeamId, "team_a"))).toHaveLength(1);
  });

  it("propagates a write failure that isn't the fingerprint conflict, rather than swallowing it", async () => {
    const clashingId = () => "trade_pk_clash";
    await proposeTrade(db, { ...(await proposeInput(db, { as: "u_alice", give: ["p_rb_a"], receive: ["p_rb_b"] })), newId: clashingId });
    // A DIFFERENT package (no fingerprint collision) forced onto the SAME id (a primary key
    // collision instead) — `isUniqueViolation` does not recognize that constraint, so the
    // catch re-throws rather than answering a graceful 409.
    const second = await proposeInput(db, { as: "u_alice", give: ["p_qb2"], receive: ["p_qb_b"] });
    await expect(proposeTrade(db, { ...second, newId: clashingId })).rejects.toThrow();
  });

  it("rolls back the whole proposal when the audit append fails", async () => {
    const input = await proposeInput(db, { as: "u_alice" });
    await expect(proposeTrade(db, { ...input, audit: failingAudit })).rejects.toThrow("audit append failed");
    expect(await db.select().from(tradeProposals)).toEqual([]);
    expect(await noticesFor(db, "u_bob")).toEqual([]);
  });

  it("accepts an injected notify, the same seam every other writer in this phase uses", async () => {
    let called = false;
    const spyNotify: typeof notifyAffectedMember = async (tx, notifyInput) => {
      called = true;
      return notifyAffectedMember(tx, notifyInput);
    };
    const result = await proposeTrade(db, { ...(await proposeInput(db, { as: "u_alice" })), notify: spyNotify });
    expect(result).toMatchObject({ ok: true });
    expect(called).toBe(true);
  });

  it("works end to end with every dependency defaulted to the real implementation", async () => {
    const result = await proposeTrade(db, {
      leagueId: "lg_1",
      userId: "u_alice",
      counterpartyTeamId: "team_b",
      proposerAssets: [playerAsset("p_rb_a")],
      counterpartyAssets: [playerAsset("p_rb_b")],
      note: null,
    });
    expect(result).toMatchObject({ ok: true });
  });
});

describe("rejectTrade and withdrawTrade", () => {
  /**
   * The settle path's own `expectNoAcceptanceTookPlace` (final review, HIGH 3): a refusal must
   * leave EXACTLY as much trace as if the call had never been made. `settleProposal` writes three
   * things on success — the status stamp, one notice, one `trade_rejected` audit event — so a
   * refusal is proved by all three still being absent, never by the returned shape alone.
   */
  async function expectNoSettlementTookPlace(db: Db, tradeId: string): Promise<void> {
    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, tradeId));
    expect(row!.status).toBe("open");
    expect(row!.settledAt).toBeNull();
    expect(row!.settledByUserId).toBeNull();
    expect(await auditEventsOn(db, "lg_1", "trade_rejected")).toEqual([]);
    for (const userId of ["u_alice", "u_bob", "u_carol"]) {
      expect(await noticesFor(db, userId)).toEqual([]);
    }
  }

  beforeEach(async () => {
    await truncateAll(db);
    await seedFullTradeLeague(db);
  });

  it("lets only the counterparty reject, and only the proposer withdraw", async () => {
    const trade = await openTrade(db, { proposer: "u_alice", counterparty: "u_bob" });
    expect(await rejectTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_alice", deliver: deliverNoticeFake })).toEqual({
      ok: false,
      status: 404,
      reason: "We couldn't find that offer.",
    });
    expect(await withdrawTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", deliver: deliverNoticeFake })).toEqual({
      ok: false,
      status: 404,
      reason: "We couldn't find that offer.",
    });
  });

  it("answers 404 rather than 403 to the wrong manager, so an id tells a prober nothing", async () => {
    // The codebase's non-oracle discipline, third time: publicJoinPrecondition, withAdmin, here.
    const trade = await openTrade(db, { proposer: "u_alice", counterparty: "u_bob" });
    const result = await rejectTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_carol", deliver: deliverNoticeFake });
    expect(result.status).toBe(404);
  });

  it("refuses a caller with no team at all in this league, the same 404 as the wrong manager", async () => {
    const trade = await openTrade(db);
    const result = await withdrawTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_carol", deliver: deliverNoticeFake });
    expect(result).toEqual({ ok: false, status: 404, reason: "We couldn't find that offer." });
  });

  it("refuses a trade id that names nothing at all", async () => {
    const result = await rejectTrade(db, { tradeId: "trade_ghost", leagueId: "lg_1", userId: "u_bob", deliver: deliverNoticeFake });
    expect(result).toEqual({ ok: false, status: 404, reason: "We couldn't find that offer." });
  });

  it("refuses a real trade id borrowed from another league, no differently than a bogus one (F1)", async () => {
    // The URL says which league this is. A tradeId that is real, but belongs to a DIFFERENT
    // league than the URL's own, must read exactly like a ghost id — never acted on just
    // because the caller happens to ALSO field a team in that other league.
    const trade = await openTrade(db);
    await db.insert(users).values({ id: "u_dave", email: "u_dave@test.local", displayName: "Dave" });
    await db.insert(leagues).values({ id: "lg_2", name: "Other League", format: "snake", teamCount: 2, commissionerUserId: "u_dave" });
    await db.insert(teams).values({ id: "team_other", leagueId: "lg_2", userId: "u_dave", name: "Other Team" });

    const wrongLeague = await rejectTrade(db, { tradeId: trade.id, leagueId: "lg_2", userId: "u_dave", deliver: deliverNoticeFake });
    const ghost = await rejectTrade(db, { tradeId: "trade_totally_ghost", leagueId: "lg_2", userId: "u_dave", deliver: deliverNoticeFake });
    expect(wrongLeague).toEqual(ghost);
    expect(wrongLeague).toEqual({ ok: false, status: 404, reason: "We couldn't find that offer." });

    // And the RIGHT league still acts on the very same offer.
    const rightLeague = await rejectTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", deliver: deliverNoticeFake });
    expect(rightLeague).toMatchObject({ ok: true });
  });

  it("serializes a reject and a withdraw arriving at the same instant, and exactly one lands", async () => {
    // The guard is in the UPDATE's own WHERE. A prior read would let both through.
    const trade = await openTrade(db);
    const [a, b] = await Promise.all([
      rejectTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", deliver: deliverNoticeFake }),
      withdrawTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_alice", deliver: deliverNoticeFake }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    // ONE event type covers both outcomes (`payload.outcome` tells them apart), so whichever of
    // the two won writes exactly one `trade_rejected` event either way — not conditionally on
    // which one it was.
    expect(await auditEventsOn(db, "lg_1", "trade_rejected")).toHaveLength(1);
  });

  /**
   * FINAL REVIEW, HIGH 3. The refusal itself was already right; what it lacked was the Task 5
   * test class — a refusal must leave EXACTLY as much trace as if the call had never happened,
   * asserted directly rather than inferred from the `{ ok: false }` shape.
   */
  it("refuses to answer an offer that has aged out, and says so in the offer's own words", async () => {
    const trade = await openTrade(db, { proposedAt: "2026-08-01T00:00:00.000Z" });
    const result = await rejectTrade(db, {
      tradeId: trade.id,
      leagueId: "lg_1",
      userId: "u_bob",
      clock: fixedClock("2026-08-21T00:00:00.000Z"),
      deliver: deliverNoticeFake,
    });
    expect(result).toEqual({ ok: false, status: 409, reason: "That offer expired before anyone answered it." });
    await expectNoSettlementTookPlace(db, trade.id);
  });

  /**
   * FINAL REVIEW, HIGH 3, the other side of the same ruling: expiry gates ANSWERING an offer, not
   * CLEARING YOUR OWN. A proposer whose offer ran out is doing housekeeping, and refusing that
   * would leave them looking at a card with no control on it that works. Withdraw is the one
   * transition `expiryGuards` lets through.
   */
  it("still lets the proposer withdraw an offer that has aged out — housekeeping, not answering", async () => {
    const trade = await openTrade(db, { proposedAt: "2026-08-01T00:00:00.000Z" });
    const result = await withdrawTrade(db, {
      tradeId: trade.id,
      leagueId: "lg_1",
      userId: "u_alice",
      clock: fixedClock("2026-08-21T00:00:00.000Z"),
      deliver: deliverNoticeFake,
    });
    expect(result).toEqual({ ok: true, tradeId: trade.id, status: "withdrawn" });
    expect((await db.select().from(tradeProposals).where(eq(tradeProposals.id, trade.id)))[0]!.status).toBe("withdrawn");
  });

  /** And an expired offer is still not answerable by the party who never answered it, whichever
   *  role they hold — the wrong-manager 404 and the expiry 409 do not trade places. */
  it("refuses an expired offer's counterparty a withdraw, the same 404 an open one gets", async () => {
    const trade = await openTrade(db, { proposedAt: "2026-08-01T00:00:00.000Z" });
    const result = await withdrawTrade(db, {
      tradeId: trade.id,
      leagueId: "lg_1",
      userId: "u_bob",
      clock: fixedClock("2026-08-21T00:00:00.000Z"),
      deliver: deliverNoticeFake,
    });
    expect(result).toEqual({ ok: false, status: 404, reason: "We couldn't find that offer." });
    await expectNoSettlementTookPlace(db, trade.id);
  });

  /** An expired-but-open offer stays where its two parties can see it: `tradesQuery`'s inbox and
   *  outbox filter on `status = 'open'` and nothing writes `status = 'expired'`, so the row is
   *  still in both boxes — visible, never actionable except by its proposer's withdraw — and the
   *  history filter still refuses it, because history is `ne(status, 'open')` by construction. */
  it("keeps an expired open offer in both parties' boxes, and out of history", async () => {
    const trade = await openTrade(db, { proposedAt: "2026-08-01T00:00:00.000Z" });
    const proposerView = await listTrades(db, { leagueId: "lg_1", teamId: "team_a" });
    const counterpartyView = await listTrades(db, { leagueId: "lg_1", teamId: "team_b" });
    expect(proposerView.outbox.map((row) => row.id)).toEqual([trade.id]);
    expect(counterpartyView.inbox.map((row) => row.id)).toEqual([trade.id]);
    expect(proposerView.history).toEqual([]);
    expect(counterpartyView.history).toEqual([]);
  });

  it("lets the counterparty reject an open offer, notices the proposer and settles the status", async () => {
    const trade = await openTrade(db);
    const result = await rejectTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", deliver: deliverNoticeFake });
    expect(result).toEqual({ ok: true, tradeId: trade.id, status: "rejected" });
    const [notice] = await noticesFor(db, "u_alice");
    expect(notice!.noticeType).toBe("trade_rejected");
    expect(copyViolations(`${notice!.title} ${notice!.body}`)).toEqual([]);
    const [event] = await auditEventsOn(db, "lg_1", "trade_rejected");
    expect(event!.payload).toMatchObject({ outcome: "rejected" });
  });

  it("lets the proposer withdraw an open offer, notices the counterparty and settles the status", async () => {
    const trade = await openTrade(db);
    const result = await withdrawTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_alice", deliver: deliverNoticeFake });
    expect(result).toEqual({ ok: true, tradeId: trade.id, status: "withdrawn" });
    const [notice] = await noticesFor(db, "u_bob");
    expect(notice!.noticeType).toBe("trade_withdrawn");
    expect(copyViolations(`${notice!.title} ${notice!.body}`)).toEqual([]);
    // `trade_withdrawn` is a NOTICE type only — `AUDIT_EVENT_TYPES` is frozen, so the audit event
    // is still spelled `trade_rejected`, with the honest outcome in the payload.
    const [event] = await auditEventsOn(db, "lg_1", "trade_rejected");
    expect(event!.payload).toMatchObject({ outcome: "withdrawn" });
  });

  it("refuses a decision on an offer the RIGHT party already settled, distinctly from a stranger's 404", async () => {
    const trade = await openTrade(db);
    expect(await rejectTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", deliver: deliverNoticeFake })).toMatchObject({ ok: true });
    const second = await rejectTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", deliver: deliverNoticeFake });
    expect(second).toEqual({ ok: false, status: 409, reason: "Someone already answered that offer." });
  });

  it("rolls back the whole settlement when the audit append fails", async () => {
    const trade = await openTrade(db);
    await expect(
      rejectTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", audit: failingAudit, deliver: deliverNoticeFake }),
    ).rejects.toThrow("audit append failed");
    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, trade.id));
    expect(row!.status).toBe("open");
    expect(await noticesFor(db, "u_alice")).toEqual([]);
  });

  it("accepts an injected notify, the same seam every other writer in this phase uses", async () => {
    let called = false;
    const spyNotify: typeof notifyAffectedMember = async (tx, notifyInput) => {
      called = true;
      return notifyAffectedMember(tx, notifyInput);
    };
    const trade = await openTrade(db);
    const result = await withdrawTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_alice", notify: spyNotify, deliver: deliverNoticeFake });
    expect(result).toMatchObject({ ok: true });
    expect(called).toBe(true);
  });

  it("works end to end with every dependency defaulted to the real implementation", async () => {
    const trade = await openTrade(db);
    const result = await rejectTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob" });
    expect(result).toMatchObject({ ok: true });
  });
});

/**
 * `refusalFor`'s own impossible-state guard (its module docblock explains why real Postgres
 * cannot reach it): `settleProposal` already confirms the row exists, inside the same
 * transaction, moments before this ever runs, and nothing in this codebase deletes a
 * `trade_proposals` row. A stub `DbTx` is the only way to put the code in the state it defends
 * against — the same discipline `raiseFlag`'s `existingOpenFlagFor` guard uses.
 */
describe("refusalFor's impossible-state guard", () => {
  it("refuses to invent a result when the row is somehow not there on the re-read", async () => {
    const stub = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
    } as unknown as DbTx;

    const result = await refusalFor(stub, {
      tradeId: "trade_ghost",
      leagueId: "lg_1",
      userId: "u_alice",
      transition: "reject",
      actorTeamId: "team_a",
    });
    expect(result).toEqual({ ok: false, status: 404, reason: "We couldn't find that offer." });
  });
});

describe("listTrades", () => {
  beforeEach(async () => {
    await truncateAll(db);
    await seedFullTradeLeague(db);
  });

  it("splits a league's trades into inbox, outbox and history, with team names resolved", async () => {
    const first = await proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_rb_a"], receive: ["p_rb_b"] }));
    expect(first).toMatchObject({ ok: true });
    const second = await proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_qb2"], receive: ["p_qb_b"] }));
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) return;
    await rejectTrade(db, { tradeId: second.tradeId, leagueId: "lg_1", userId: "u_bob", deliver: deliverNoticeFake });

    const aliceView = await listTrades(db, { leagueId: "lg_1", teamId: "team_a" });
    expect(aliceView.leagueId).toBe("lg_1");
    expect(aliceView.meTeamId).toBe("team_a");
    expect(aliceView.outbox).toHaveLength(1);
    expect(aliceView.outbox[0]!.from.teamName).toBe("Team Alice");
    expect(aliceView.outbox[0]!.to.teamName).toBe("Team Bob");
    expect(aliceView.history.map((row) => row.id)).toContain(second.tradeId);

    const bobView = await listTrades(db, { leagueId: "lg_1", teamId: "team_b" });
    expect(bobView.inbox).toHaveLength(1);
  });

  it("answers empty bands for a league with no trades yet", async () => {
    const page = await listTrades(db, { leagueId: "lg_1", teamId: "team_a" });
    expect(page).toEqual({ leagueId: "lg_1", meTeamId: "team_a", inbox: [], outbox: [], history: [] });
  });

  /**
   * Fix round 1, F1, at the exact function `GET /api/leagues/[leagueId]/trades/route.ts` calls —
   * the wire-level proof, not just `tradesQuery`'s own. A third team's `listTrades` read must
   * never carry another pair's still-open or dead negotiation in its `history` band, and must
   * still carry an accepted one.
   */
  it("never wires a third team's page with another pair's open or dead proposal, but does with an accepted one", async () => {
    await addBystanderTeam(db);

    const open = await proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_rb_a"], receive: ["p_rb_b"] }));
    expect(open).toMatchObject({ ok: true });

    const rejected = await proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_qb2"], receive: ["p_qb_b"] }));
    expect(rejected).toMatchObject({ ok: true });
    if (!rejected.ok) return;
    await rejectTrade(db, { tradeId: rejected.tradeId, leagueId: "lg_1", userId: "u_bob", deliver: deliverNoticeFake });

    // Plan D, Task 5, fix round 1 (Finding 2): the wire-level twin of `tradesQuery`'s own held
    // regression test above, at the exact function `GET /api/leagues/[leagueId]/trades/route.ts`
    // calls. A held trade is inserted directly rather than driven through a real hold (a public,
    // lopsided-enough league) — the auto-hold mechanism itself is `trades.test.ts`'s own
    // `acceptTrade` describe block's job; this test is about `listTrades`' own privacy contract,
    // which does not care how a row became `held`.
    const heldCandidate = await proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_wr_a"], receive: ["p_wr1"] }));
    expect(heldCandidate).toMatchObject({ ok: true });
    if (!heldCandidate.ok) return;
    await db.update(tradeProposals).set({ status: "held" }).where(eq(tradeProposals.id, heldCandidate.tradeId));

    // Bench-for-bench, deliberately: both sides' BENCH slots accept any position, so this swap
    // is legal regardless of who gives up what — unlike a starting-slot swap, which this test has
    // no need to reason about.
    const accepted = await proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_te_a"], receive: ["p_bench_b2"] }));
    expect(accepted).toMatchObject({ ok: true });
    if (!accepted.ok) return;
    await acceptTrade(db, { tradeId: accepted.tradeId, leagueId: "lg_1", userId: "u_bob" });

    const bystanderView = await listTrades(db, { leagueId: "lg_1", teamId: "team_c" });
    expect(bystanderView.inbox).toEqual([]);
    expect(bystanderView.outbox).toEqual([]);
    expect(bystanderView.history.map((row) => row.id)).toEqual([accepted.tradeId]);
  });
});

/**
 * Task 5: `acceptTrade` — the execution transaction. Three teams this time (`team_a`/`u_alice`,
 * `team_b`/`u_bob`, `team_c`/`u_carol`), because the supersede sweep needs a THIRD party with an
 * offer of her own out to one of the first two. Every roster carries exactly ONE open bench spot
 * — never two — so a straight RB-for-WR swap (the fixture's own default offer) needs the room a
 * trade actually leaves behind rather than room that was there anyway, and a package that asks
 * for a SECOND bench spot genuinely has none to give.
 */
describe("acceptTrade", () => {
  async function seedAcceptTradeLeague(db: Db): Promise<void> {
    await db.insert(users).values([
      { id: "u_alice", email: "u_alice@test.local", displayName: "Alice" },
      { id: "u_bob", email: "u_bob@test.local", displayName: "Bob" },
      { id: "u_carol", email: "u_carol@test.local", displayName: "Carol" },
      // No team of her own — the "caller isn't a member at all" case.
      { id: "u_dave", email: "u_dave@test.local", displayName: "Dave" },
    ]);
    await db.insert(leagues).values({
      id: "lg_1",
      name: "Accept League",
      format: "snake",
      teamCount: 3,
      commissionerUserId: "u_alice",
      rosterSlots: FULL_LEAGUE_SLOTS,
    });
    await db.insert(teams).values([
      { id: "team_a", leagueId: "lg_1", userId: "u_alice", name: "Team Alice" },
      { id: "team_b", leagueId: "lg_1", userId: "u_bob", name: "Team Bob" },
      { id: "team_c", leagueId: "lg_1", userId: "u_carol", name: "Team Carol" },
    ]);
    await db.insert(players).values([
      { id: "p_qb_a", name: "QB Alice", position: "QB", nflTeam: "KC" },
      { id: "p_rb1", name: "RB One", position: "RB", nflTeam: "DAL" },
      { id: "p_wr_a", name: "WR Alice", position: "WR", nflTeam: "MIA" },
      { id: "p_te1", name: "TE One", position: "TE", nflTeam: "PHI" },
      { id: "p_qb_b", name: "QB Bob", position: "QB", nflTeam: "BUF" },
      { id: "p_rb_b", name: "RB Bob", position: "RB", nflTeam: "NYJ" },
      { id: "p_wr1", name: "WR One", position: "WR", nflTeam: "SEA" },
      { id: "p_bench_b1", name: "Bench Bob One", position: "K", nflTeam: "LAC" },
      { id: "p_qb_c", name: "QB Carol", position: "QB", nflTeam: "GB" },
      { id: "p_rb_c", name: "RB Carol", position: "RB", nflTeam: "CIN" },
      { id: "p_wr_c", name: "WR Carol", position: "WR", nflTeam: "LAR" },
      { id: "p_bench_c1", name: "Bench Carol One", position: "K", nflTeam: "TEN" },
    ]);
    await db.insert(rosterSlots).values([
      { teamId: "team_a", slot: "QB", slotIndex: 0, playerId: "p_qb_a" },
      { teamId: "team_a", slot: "RB", slotIndex: 0, playerId: "p_rb1" },
      { teamId: "team_a", slot: "WR", slotIndex: 0, playerId: "p_wr_a" },
      { teamId: "team_a", slot: "BENCH", slotIndex: 0, playerId: "p_te1" },
      { teamId: "team_b", slot: "QB", slotIndex: 0, playerId: "p_qb_b" },
      { teamId: "team_b", slot: "RB", slotIndex: 0, playerId: "p_rb_b" },
      { teamId: "team_b", slot: "WR", slotIndex: 0, playerId: "p_wr1" },
      { teamId: "team_b", slot: "BENCH", slotIndex: 0, playerId: "p_bench_b1" },
      { teamId: "team_c", slot: "QB", slotIndex: 0, playerId: "p_qb_c" },
      { teamId: "team_c", slot: "RB", slotIndex: 0, playerId: "p_rb_c" },
      { teamId: "team_c", slot: "WR", slotIndex: 0, playerId: "p_wr_c" },
      { teamId: "team_c", slot: "BENCH", slotIndex: 0, playerId: "p_bench_c1" },
    ]);
  }

  interface OpenAcceptTradeOpts {
    readonly proposerTeamId?: string;
    readonly counterpartyTeamId?: string;
    readonly give?: readonly string[];
    readonly get?: readonly string[];
    readonly weekNumber?: number;
    readonly proposedAt?: string;
  }

  /** One open, unexpired offer, inserted directly — `team_a` -> `team_b`, `p_rb1` for `p_wr1`,
   *  unless overridden. Every accept test negotiates over this same three-team league. */
  async function openAcceptTrade(db: Db, opts: OpenAcceptTradeOpts = {}): Promise<{ readonly id: string }> {
    const proposerTeamId = opts.proposerTeamId ?? "team_a";
    const counterpartyTeamId = opts.counterpartyTeamId ?? "team_b";
    const proposerAssets = (opts.give ?? ["p_rb1"]).map(playerAsset);
    const counterpartyAssets = (opts.get ?? ["p_wr1"]).map(playerAsset);
    const weekNumber = opts.weekNumber ?? 1;
    const proposedAt = new Date(opts.proposedAt ?? NOW);
    const expiresAt = new Date(proposedAt.getTime() + TRADE_CONFIG.proposalTtlHours * 60 * 60 * 1000);
    const id = `accept_trade_${(tradeIdCounter += 1)}`;
    await db.insert(tradeProposals).values({
      id,
      leagueId: "lg_1",
      proposerTeamId,
      counterpartyTeamId,
      weekNumber,
      proposerAssets,
      counterpartyAssets,
      fingerprint: proposalFingerprint({ leagueId: "lg_1", proposerTeamId, counterpartyTeamId, proposerAssets, counterpartyAssets }),
      note: null,
      status: "open",
      proposedAt,
      expiresAt,
    });
    return { id };
  }

  /** `seasonCurrentWeek` (`./test-support`) bound to this fixture's own two teams. Final review,
   *  CRITICAL 1: `acceptTrade` derives the week it values, locks and evicts at from the league's
   *  own schedule now, so a test that wants a particular week seeds the season that has it.
   *  `openAcceptTrade`'s own `weekNumber` option still writes the row's PROPOSE-time value; it no
   *  longer decides anything about the acceptance. */
  async function leagueSeasonThrough(db: Db, week: number): Promise<void> {
    await seasonCurrentWeek(db, { leagueId: "lg_1", homeTeamId: "team_a", awayTeamId: "team_b", week });
  }

  async function acceptAs(userId: string, tradeId: string, extra: Partial<Parameters<typeof acceptTrade>[1]> = {}) {
    return acceptTrade(db, { tradeId, leagueId: "lg_1", userId, clock: fixedClock(NOW), deliver: deliverNoticeFake, ...extra });
  }

  /** Three completed weeks (1-3) of a monster line for `p_rb1`, so a `weekNumber: 4` trade
   *  giving it up reads as grotesquely lopsided against `p_wr1`'s zero — the identical arithmetic
   *  `trade-fairness.test.ts`'s own `fairnessLeague` fixture uses, reused here rather than
   *  restated so `acceptTrade`'s after-commit call has something real to flag. */
  async function seedLopsidedStatLines(db: Db): Promise<void> {
    await db.insert(playerStatLines).values([1, 2, 3].map((week) => ({ playerId: "p_rb1", week, rushingYards: 300, rushingTouchdowns: 5 })));
  }

  async function openFlags(db: Db) {
    return db.select().from(integrityFlags).where(isNull(integrityFlags.resolvedAt));
  }

  const throwingFairnessRaiser: typeof raiseTradeFairnessFlag = async () => {
    throw new Error("fairness flag write failed");
  };

  async function ownerTeamOf(db: Db, playerId: string): Promise<string | undefined> {
    const [row] = await db.select({ teamId: rosterSlots.teamId }).from(rosterSlots).where(eq(rosterSlots.playerId, playerId));
    return row?.teamId;
  }

  async function tradeRow(db: Db, tradeId: string): Promise<typeof tradeProposals.$inferSelect> {
    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, tradeId));
    return row!;
  }

  async function lockWeek(db: Db, week: number, status: "in_progress" | "final" = "in_progress"): Promise<void> {
    await db.insert(statWeeks).values({ week, status }).onConflictDoUpdate({ target: statWeeks.week, set: { status } });
  }

  /**
   * Fix round 1, CRITICAL: every refusal path must leave EXACTLY as much trace as if
   * `acceptTrade` had never been called — a refusal that commits a partial write (the row
   * stamped `accepted` with nothing actually moved) is the defect this asserts against directly,
   * rather than trusting the returned `{ ok: false }` shape to imply nothing else happened.
   * `expectedTradeStatus` defaults to `"open"` (the untouched row); a caller in a race scenario
   * (superseded, already-settled) passes the row's true prior state instead.
   */
  async function expectNoAcceptanceTookPlace(
    db: Db,
    tradeId: string | null,
    unmoved: readonly { readonly playerId: string; readonly teamId: string }[],
    expectedTradeStatus: string = "open",
  ): Promise<void> {
    if (tradeId !== null) {
      expect((await tradeRow(db, tradeId)).status).toBe(expectedTradeStatus);
    }
    for (const asset of unmoved) {
      expect(await ownerTeamOf(db, asset.playerId)).toBe(asset.teamId);
    }
    expect(await auditEventsOn(db, "lg_1", "trade_accepted")).toEqual([]);
    expect(await auditEventsOn(db, "lg_1", "roster_move")).toEqual([]);
    for (const userId of ["u_alice", "u_bob", "u_carol", "u_dave"]) {
      expect(await noticesFor(db, userId)).toEqual([]);
    }
  }

  beforeEach(async () => {
    await truncateAll(db);
    await seedAcceptTradeLeague(db);
  });

  it("moves both rosters, settles the row and tells both managers, in one transaction", async () => {
    const trade = await openAcceptTrade(db);
    const result = await acceptAs("u_bob", trade.id);
    expect(result).toMatchObject({ ok: true, tradeId: trade.id, supersededCount: 0 });

    expect(await ownerTeamOf(db, "p_rb1")).toBe("team_b");
    expect(await ownerTeamOf(db, "p_wr1")).toBe("team_a");
    expect((await tradeRow(db, trade.id)).status).toBe("accepted");

    const [aliceNotice] = await noticesFor(db, "u_alice");
    const [bobNotice] = await noticesFor(db, "u_bob");
    expect(aliceNotice!.noticeType).toBe("trade_executed");
    expect(bobNotice!.noticeType).toBe("trade_executed");
    expect(copyViolations(`${aliceNotice!.title} ${aliceNotice!.body}`)).toEqual([]);
    expect(copyViolations(`${bobNotice!.title} ${bobNotice!.body}`)).toEqual([]);
  });

  it("carries the fairness verdict Task 6 needs, computed in the same transaction", async () => {
    const trade = await openAcceptTrade(db);
    const result = await acceptAs("u_bob", trade.id);
    expect(result).toMatchObject({ ok: true, fairness: { hold: false, flagWorthy: expect.any(Boolean), gap: expect.any(Number) } });
  });

  it("lets only the counterparty accept", async () => {
    const trade = await openAcceptTrade(db);
    const result = await acceptAs("u_alice", trade.id);
    expect(result).toMatchObject({ ok: false, status: 404 });
    await expectNoAcceptanceTookPlace(db, trade.id, [
      { playerId: "p_rb1", teamId: "team_a" },
      { playerId: "p_wr1", teamId: "team_b" },
    ]);
  });

  it("refuses a caller with no team at all in this league, the same 404 as the wrong manager", async () => {
    const trade = await openAcceptTrade(db);
    const result = await acceptAs("u_dave", trade.id);
    expect(result).toEqual({ ok: false, status: 404, reason: "We couldn't find that offer." });
    await expectNoAcceptanceTookPlace(db, trade.id, [
      { playerId: "p_rb1", teamId: "team_a" },
      { playerId: "p_wr1", teamId: "team_b" },
    ]);
  });

  it("refuses a trade id that names nothing at all, leaving no trace", async () => {
    const result = await acceptAs("u_bob", "trade_totally_ghost");
    expect(result).toEqual({ ok: false, status: 404, reason: "We couldn't find that offer." });
    await expectNoAcceptanceTookPlace(db, null, [
      { playerId: "p_rb1", teamId: "team_a" },
      { playerId: "p_wr1", teamId: "team_b" },
    ]);
  });

  it("moves nothing and writes nothing to move when neither side names an asset", async () => {
    const trade = await openAcceptTrade(db, { give: [], get: [] });
    const result = await acceptAs("u_bob", trade.id);
    expect(result).toMatchObject({ ok: true, supersededCount: 0 });
    expect((await tradeRow(db, trade.id)).status).toBe("accepted");
  });

  it("refuses to answer an offer that has aged out", async () => {
    const trade = await openAcceptTrade(db, { proposedAt: "2026-08-01T00:00:00.000Z" });
    const result = await acceptTrade(db, {
      tradeId: trade.id,
      leagueId: "lg_1",
      userId: "u_bob",
      clock: fixedClock("2026-08-21T00:00:00.000Z"),
      deliver: deliverNoticeFake,
    });
    expect(result).toEqual({ ok: false, status: 409, reason: "That offer expired before anyone answered it." });
    await expectNoAcceptanceTookPlace(db, trade.id, [
      { playerId: "p_rb1", teamId: "team_a" },
      { playerId: "p_wr1", teamId: "team_b" },
    ]);
  });

  it("refuses when a named player left the roster since the offer was made", async () => {
    // The other half of "plan at propose time, enforce at accept time". Between the offer and the
    // yes, another trade may have moved the same player — driven here directly through
    // `applyTradeInTx`, the one real mover in the codebase, rather than through a second accept.
    const trade = await openAcceptTrade(db);
    await db.transaction((tx) =>
      applyTradeInTx(tx, {
        leagueId: "lg_1",
        slotConfig: FULL_LEAGUE_SLOTS,
        proposerTeamId: "team_a",
        counterpartyTeamId: "team_c",
        proposerAssets: [playerAsset("p_rb1")],
        counterpartyAssets: [],
      }),
    );
    const result = await acceptAs("u_bob", trade.id);
    expect(result).toEqual({
      ok: false,
      status: 409,
      reason: "One of the players in this offer has already moved to another team. Ask for a fresh offer.",
    });
    // `p_rb1` stays exactly where the OTHER trade left it — team_c — and `p_wr1`, never named as
    // moved by anything, stays on team_b: this refusal moves nothing of its own.
    await expectNoAcceptanceTookPlace(db, trade.id, [
      { playerId: "p_rb1", teamId: "team_c" },
      { playerId: "p_wr1", teamId: "team_b" },
    ]);
  });

  it("passes an applyTradeInTx 'no room' refusal straight through, with its own message", async () => {
    // Two players in, one out: `team_b` clears its one WR for `p_rb1` (fine — a bench spot just
    // opened) but has nowhere left for `p_te1`, since its own single bench spot is already spent.
    const trade = await openAcceptTrade(db, { give: ["p_rb1", "p_te1"], get: ["p_wr1"] });
    const result = await acceptAs("u_bob", trade.id);
    expect(result).toMatchObject({ ok: false, status: 409, reason: expect.stringContaining("no room") });
    await expectNoAcceptanceTookPlace(db, trade.id, [
      { playerId: "p_rb1", teamId: "team_a" },
      { playerId: "p_te1", teamId: "team_a" },
      { playerId: "p_wr1", teamId: "team_b" },
    ]);
  });

  it("settles every other open offer naming a player that just moved, and calls it superseded", async () => {
    // Not `rejected`: nobody rejected them. Carol has two offers out to Alice for two DIFFERENT
    // players; only the one naming `p_rb1` dies when Bob's trade for it goes through.
    const dead = await openAcceptTrade(db, { proposerTeamId: "team_c", counterpartyTeamId: "team_a", give: ["p_bench_c1"], get: ["p_rb1"] });
    const live = await openAcceptTrade(db, { proposerTeamId: "team_c", counterpartyTeamId: "team_a", give: ["p_bench_c1"], get: ["p_te1"] });
    const executed = await openAcceptTrade(db);

    const result = await acceptAs("u_bob", executed.id);
    expect(result).toMatchObject({ ok: true, supersededCount: 1 });

    expect((await tradeRow(db, dead.id)).status).toBe("superseded");
    expect((await tradeRow(db, live.id)).status).toBe("open");
    const [carolNotice] = await noticesFor(db, "u_carol");
    expect(carolNotice!.noticeType).toBe("trade_superseded");
    expect(copyViolations(`${carolNotice!.title} ${carolNotice!.body}`)).toEqual([]);
  });

  /**
   * FINAL REVIEW, LOW 9. Only the doomed PROPOSER used to be told. The COUNTERPARTY had that offer
   * sitting in their inbox awaiting an answer, and the card simply vanished on the next refetch —
   * asymmetric with the two-recipient discipline `trade_executed` and `trade_reversed` both keep,
   * and undocumented rather than decided. Both affected managers are told now, each in the
   * sentence for their own side.
   */
  it("tells BOTH parties of a superseded offer, each in their own words", async () => {
    // Carol proposes to Alice for `p_rb1`; Bob's trade for the same player kills it. Carol is the
    // doomed proposer, Alice the counterparty who was owed an answer.
    await openAcceptTrade(db, { proposerTeamId: "team_c", counterpartyTeamId: "team_a", give: ["p_bench_c1"], get: ["p_rb1"] });
    const executed = await openAcceptTrade(db);

    expect(await acceptAs("u_bob", executed.id)).toMatchObject({ ok: true, supersededCount: 1 });

    const carolNotices = (await noticesFor(db, "u_carol")).filter((n) => n.noticeType === "trade_superseded");
    const aliceNotices = (await noticesFor(db, "u_alice")).filter((n) => n.noticeType === "trade_superseded");
    expect(carolNotices).toHaveLength(1);
    expect(aliceNotices).toHaveLength(1);

    // Each names the OTHER manager, and each says which direction the dead offer went.
    expect(carolNotices[0]!.body).toContain("the offer you had out to Team Alice");
    expect(aliceNotices[0]!.body).toContain("the offer Team Carol sent you");
    expect(aliceNotices[0]!.title).toBe("An offer waiting on you can no longer go through");
    for (const notice of [...carolNotices, ...aliceNotices]) {
      expect(copyViolations(`${notice.title} ${notice.body}`)).toEqual([]);
    }
  });

  it("frees the fingerprint for reuse once superseded, the same partial-index mechanism a rejection already proves", async () => {
    const dead = await openAcceptTrade(db, { proposerTeamId: "team_c", counterpartyTeamId: "team_a", give: ["p_bench_c1"], get: ["p_rb1"] });
    const executed = await openAcceptTrade(db);

    const result = await acceptAs("u_bob", executed.id);
    expect(result).toMatchObject({ ok: true, supersededCount: 1 });
    expect((await tradeRow(db, dead.id)).status).toBe("superseded");

    // The identical package, re-proposed after the supersede: `trade_proposals_open_fingerprint
    // _idx` (`src/db/schema.ts`) is scoped to `WHERE status = 'open'`, so a row that leaves
    // `open` — by rejection (already proven, "allows the identical package again once the first
    // one is settled") or by this sweep's own `superseded` — frees its fingerprint the same way.
    const reproposed = await openAcceptTrade(db, { proposerTeamId: "team_c", counterpartyTeamId: "team_a", give: ["p_bench_c1"], get: ["p_rb1"] });
    expect((await tradeRow(db, reproposed.id)).status).toBe("open");
  });

  it("refuses to move a roster while the week is locked, and says which week", async () => {
    // The same rule `setLineup` enforces, read the same way: a week is locked once it has
    // STARTED, not once it has been scored.
    await lockWeek(db, 4);
    await leagueSeasonThrough(db, 4);
    const trade = await openAcceptTrade(db, { weekNumber: 4 });
    const result = await acceptAs("u_bob", trade.id);
    expect(result).toEqual({ ok: false, status: 409, reason: "Week 4 has started, so rosters can't change until it ends." });
    // Fix round 1, CRITICAL: this is the exact path that used to commit `status='accepted'`
    // with nothing actually moved — the guarded UPDATE ran before this check and a plain
    // `return` after it committed silently. It must now leave no trace at all.
    await expectNoAcceptanceTookPlace(db, trade.id, [
      { playerId: "p_rb1", teamId: "team_a" },
      { playerId: "p_wr1", teamId: "team_b" },
    ]);
  });

  it("takes FOR SHARE on the week before it validates, so a kickoff mid-transaction cannot slip through", async () => {
    // The read-validate-write hole `setLineup` already closed, in the transaction that moves more
    // than `setLineup` does. A concurrent writer flips `stat_weeks[4]` to `in_progress` and holds
    // the transaction open (uncommitted) — the same rendezvous `trade-transfer.test.ts`'s own
    // `materializeLockedLineupsInTx` FOR SHARE proof uses, since under READ COMMITTED a plain
    // unlocked SELECT would NOT block on this and would read the stale pre-flip value instead.
    await leagueSeasonThrough(db, 4);
    const trade = await openAcceptTrade(db, { weekNumber: 4 });
    // An EXISTING row, not a fresh insert: a `SELECT … FOR SHARE` against a row `flip` is still
    // inserting (never committed, so not yet visible) would not block at all under READ
    // COMMITTED — there is nothing there yet to lock. `persistTick` always upserts an existing
    // week's row in production, so this is the real shape.
    await db.insert(statWeeks).values({ week: 4, status: "scheduled" });

    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const flip = db.transaction(async (tx) => {
      await tx.update(statWeeks).set({ status: "in_progress" }).where(eq(statWeeks.week, 4));
      await released;
    });

    const otherDb = createTestDb();
    const accepting = acceptTrade(otherDb, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", clock: fixedClock(NOW), deliver: deliverNoticeFake });
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    await flip;

    expect(await accepting).toMatchObject({ ok: false, status: 409 });
    await expectNoAcceptanceTookPlace(db, trade.id, [
      { playerId: "p_rb1", teamId: "team_a" },
      { playerId: "p_wr1", teamId: "team_b" },
    ]);
  });

  it("writes trade_accepted AND roster_move on the same league chain, in one batch", async () => {
    // Plan A ruling 3: a transaction appends to at most one chain, and `recordAll` throws on a
    // batch that spans two. Both events are league-scoped, so one call carries both.
    const trade = await openAcceptTrade(db);
    await acceptAs("u_bob", trade.id);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.chainScope, "lg_1"));
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["trade_accepted", "roster_move"]));
    expect(await auditEventsOn(db, "platform", "trade_accepted")).toHaveLength(0);
  });

  /** Final review, CRITICAL 1: the eviction key is the DERIVED current week — the only week whose
   *  scores this trade can have moved — never the week the stored row happens to name. The row
   *  below names week 8; the league is living in week 4. */
  it("evicts the cached score for the league's CURRENT week after the transaction commits, never inside it", async () => {
    await leagueSeasonThrough(db, 4);
    const trade = await openAcceptTrade(db, { weekNumber: 8 });
    const calls: { readonly leagueId: string; readonly week: number }[] = [];
    const cache = {
      invalidate: async (leagueId: string, week: number) => {
        calls.push({ leagueId, week });
      },
    };
    const result = await acceptTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", clock: fixedClock(NOW), deliver: deliverNoticeFake, cache });
    expect(result).toMatchObject({ ok: true });
    expect(calls).toEqual([{ leagueId: "lg_1", week: 4 }]);
  });

  it("rolls back the whole acceptance when the audit append fails", async () => {
    const trade = await openAcceptTrade(db);
    await expect(
      acceptTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", clock: fixedClock(NOW), deliver: deliverNoticeFake, audit: failingAudit }),
    ).rejects.toThrow("audit append failed");
    expect((await tradeRow(db, trade.id)).status).toBe("open");
    expect(await ownerTeamOf(db, "p_rb1")).toBe("team_a");
    expect(await noticesFor(db, "u_alice")).toEqual([]);
  });

  it("works end to end with every dependency defaulted to the real implementation", async () => {
    const trade = await openAcceptTrade(db);
    const result = await acceptTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob" });
    expect(result).toMatchObject({ ok: true });
  });

  it("swallows a cache eviction failure with a log, rather than failing a trade that already committed", async () => {
    // The identical discipline `lineups.test.ts` proves for `setLineup`'s own cache: a dead
    // Redis costs a stale read bounded by the key's TTL, never a 500 for a write that landed.
    const trade = await openAcceptTrade(db);
    const failingCache = {
      invalidate: async () => {
        throw new Error("redis down");
      },
    };
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const result = await acceptTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob", clock: fixedClock(NOW), deliver: deliverNoticeFake, cache: failingCache });
      expect(result).toMatchObject({ ok: true });
    } finally {
      console.error = originalError;
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("[league-service] score cache invalidation failed");
  });

  // -------------------------------------------------------------------------------------------
  // Task 6: the after-commit fairness flag — a SEPARATE transaction, its own failure isolation.
  // -------------------------------------------------------------------------------------------

  it("raises exactly one trade_fairness flag, in its own transaction after commit, for a lopsided trade", async () => {
    await seedLopsidedStatLines(db);
    await leagueSeasonThrough(db, 4);
    const trade = await openAcceptTrade(db, { give: ["p_rb1"], get: ["p_wr1"], weekNumber: 4 });

    const result = await acceptAs("u_bob", trade.id);
    expect(result).toMatchObject({ ok: true, fairness: { flagWorthy: true } });

    const flags = await openFlags(db);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ flagType: "trade_fairness", subjectType: "trade", subjectId: trade.id, leagueId: "lg_1" });
    // Fix round 1 (review MEDIUM 1): the after-commit caller's own basis, distinct from the
    // sweep's — an operator reading this flag's evidence can tell it was frozen at accept time.
    expect(flags[0]!.evidence).toMatchObject({ basis: "accept_evaluation" });
    // Platform-scoped, never the league's own chain — ruling 1.
    expect(await auditEventsOn(db, "platform", "flag_raised")).toHaveLength(1);
    expect(await auditEventsOn(db, "lg_1", "flag_raised")).toHaveLength(0);
  });

  it("raises no flag for a trade that never crosses the threshold", async () => {
    const trade = await openAcceptTrade(db); // p_rb1 for p_wr1, no stat lines at all — an even trade
    const result = await acceptAs("u_bob", trade.id);
    expect(result).toMatchObject({ ok: true, fairness: { flagWorthy: false } });
    expect(await openFlags(db)).toEqual([]);
  });

  it("flags a lopsided trade and never touches either account — the flag-only contract, at the outcome", async () => {
    await seedLopsidedStatLines(db);
    await leagueSeasonThrough(db, 4);
    const trade = await openAcceptTrade(db, { give: ["p_rb1"], get: ["p_wr1"], weekNumber: 4 });

    await acceptAs("u_bob", trade.id);

    expect(await openFlags(db)).toHaveLength(1);
    const [alice] = await db.select().from(users).where(eq(users.id, "u_alice"));
    const [bob] = await db.select().from(users).where(eq(users.id, "u_bob"));
    expect(alice!.isAdmin).toBe(false);
    expect(bob!.isAdmin).toBe(false);
    // The trade STANDS. A flag is a question, never an undo.
    expect((await tradeRow(db, trade.id)).status).toBe("accepted");
    expect(await ownerTeamOf(db, "p_rb1")).toBe("team_b");
  });

  it("never fails a trade because the after-commit flag write failed", async () => {
    await seedLopsidedStatLines(db);
    await leagueSeasonThrough(db, 4);
    const trade = await openAcceptTrade(db, { give: ["p_rb1"], get: ["p_wr1"], weekNumber: 4 });

    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    let result: Awaited<ReturnType<typeof acceptTrade>>;
    try {
      result = await acceptAs("u_bob", trade.id, { raiseFairnessFlag: throwingFairnessRaiser });
    } finally {
      console.error = originalError;
    }

    // The person who accepted did nothing wrong and can do nothing about it.
    expect(result).toMatchObject({ ok: true });
    expect((await tradeRow(db, trade.id)).status).toBe("accepted");
    expect(await openFlags(db)).toEqual([]); // the write never landed — this IS the gap the sweep exists for
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("[league-service] trade fairness flag raise failed");
  });

  it("lets npm run trades:sweep catch a trade whose after-commit flag write never landed", async () => {
    await seedLopsidedStatLines(db);
    await leagueSeasonThrough(db, 4);
    const trade = await openAcceptTrade(db, { give: ["p_rb1"], get: ["p_wr1"], weekNumber: 4 });

    await acceptAs("u_bob", trade.id, { raiseFairnessFlag: throwingFairnessRaiser });
    expect((await tradeRow(db, trade.id)).status).toBe("accepted");
    expect(await openFlags(db)).toEqual([]);

    const swept = await sweepUnflaggedTrades(db, { leagueId: "lg_1" });
    expect(swept.flagsRaised).toBe(1);
    const flags = await openFlags(db);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ subjectType: "trade", subjectId: trade.id });
  });

  // -------------------------------------------------------------------------------------------
  // FINAL REVIEW, CRITICAL 1 — the collusion-evasion hole, turned into regression tests.
  //
  // The reviewer proved this live: a lopsided package named a FUTURE, still-in-season week (8 in
  // a league living in week 4), which gave `assembleAdvisorContext` an empty trend window, valued
  // both sides at zero, produced `gap: 0`, and walked past `trade_fairness` entirely — and
  // `trades:sweep`, the documented operator remedy, re-derived at the same frozen week and
  // reported "checked 1, raised 0". It also read `stat_weeks` at the named week rather than the
  // live one, and evicted the wrong cache key.
  //
  // The rows below are inserted DIRECTLY carrying `weekNumber: 8`, because the wire can no longer
  // carry one at all (`trade-schemas.test.ts` holds that half) — a row in exactly the state the
  // exploit produced, proving the acceptance ignores it.
  // -------------------------------------------------------------------------------------------

  it("values a trade at the DERIVED current week and flags it, however far out the stored row's week is", async () => {
    await seedLopsidedStatLines(db);
    await leagueSeasonThrough(db, 4);
    const trade = await openAcceptTrade(db, { give: ["p_rb1"], get: ["p_wr1"], weekNumber: 8 });

    const result = await acceptAs("u_bob", trade.id);
    // The exploit's own signature was `{ givingValue: 0, receivingValue: 0, verdict: "even" }`.
    expect(result).toMatchObject({ ok: true, fairness: { flagWorthy: true } });
    if (result.ok) expect(result.fairness.gap).toBeGreaterThan(0);
    expect(await openFlags(db)).toHaveLength(1);
    // And the row now records the week it actually happened in, not the week it claimed.
    expect((await tradeRow(db, trade.id)).weekNumber).toBe(4);
  });

  it("lets the sweep re-derive at the RECORDED accept week, so the safety net no longer inherits the evasion", async () => {
    await seedLopsidedStatLines(db);
    await leagueSeasonThrough(db, 4);
    const trade = await openAcceptTrade(db, { give: ["p_rb1"], get: ["p_wr1"], weekNumber: 8 });

    // The after-commit write fails, which is the only state the sweep exists for.
    await acceptAs("u_bob", trade.id, { raiseFairnessFlag: throwingFairnessRaiser });
    expect(await openFlags(db)).toEqual([]);

    const swept = await sweepUnflaggedTrades(db, { leagueId: "lg_1" });
    expect(swept).toEqual({ tradesChecked: 1, flagsRaised: 1 });
    expect(await openFlags(db)).toHaveLength(1);
  });

  it("refuses on the LIVE week even when the stored row names a week that has not started", async () => {
    // Exploit B: the honest week-4 accept was correctly refused while week 4 was in progress, and
    // the identical package naming week 8 moved both rosters mid-week anyway.
    await leagueSeasonThrough(db, 4);
    await lockWeek(db, 4);
    const trade = await openAcceptTrade(db, { weekNumber: 8 });

    const result = await acceptAs("u_bob", trade.id);
    expect(result).toEqual({ ok: false, status: 409, reason: "Week 4 has started, so rosters can't change until it ends." });
    await expectNoAcceptanceTookPlace(db, trade.id, [
      { playerId: "p_rb1", teamId: "team_a" },
      { playerId: "p_wr1", teamId: "team_b" },
    ]);
  });

  // -------------------------------------------------------------------------------------------
  // Plan D, Task 5 — the auto-hold: a number (35), a seventh status (`held`), and the seam Plan C
  // left (`INTEGRITY_CONFIG.trade.autoHoldThreshold`) finally reads a real value.
  // -------------------------------------------------------------------------------------------
  describe("the auto-hold", () => {
    async function makeLeaguePublic(): Promise<void> {
      await db.update(leagues).set({ isPublicMatchmade: true }).where(eq(leagues.id, "lg_1"));
    }

    /** Well past `INTEGRITY_CONFIG.trade.autoHoldThreshold` (35) — the identical `seedLopsided
     *  StatLines` fixture `trade-fairness.test.ts`'s own `grotesquelyLopsided` reuses, which
     *  reads as a 50+ point gap. */
    async function openGrotesquelyLopsidedTrade(): Promise<{ readonly id: string }> {
      await seedLopsidedStatLines(db);
      await leagueSeasonThrough(db, 4);
      return openAcceptTrade(db, { give: ["p_rb1"], get: ["p_wr1"], weekNumber: 4 });
    }

    /** A gap past `fairnessFlagThreshold` (20) but short of `autoHoldThreshold` (35) — Task 6's
     *  own boundary, unchanged by this task. */
    async function openModeratelyLopsidedTrade(): Promise<{ readonly id: string }> {
      await db.insert(playerStatLines).values([1, 2, 3].map((week) => ({ playerId: "p_rb1", week, rushingYards: 150, rushingTouchdowns: 2 })));
      await leagueSeasonThrough(db, 4);
      return openAcceptTrade(db, { give: ["p_rb1"], get: ["p_wr1"], weekNumber: 4 });
    }

    async function openFlagsOfType(db: Db, flagType: string) {
      return db.select().from(integrityFlags).where(and(eq(integrityFlags.flagType, flagType), isNull(integrityFlags.resolvedAt)));
    }

    it("holds a grotesquely lopsided public-league trade instead of executing it", async () => {
      await makeLeaguePublic();
      const trade = await openGrotesquelyLopsidedTrade();
      const result = await acceptAs("u_bob", trade.id);
      expect(result).toMatchObject({ ok: true, outcome: "held" });

      expect((await tradeRow(db, trade.id)).status).toBe("held");
      expect(await ownerTeamOf(db, "p_rb1")).toBe("team_a"); // nothing moved
      expect(await ownerTeamOf(db, "p_wr1")).toBe("team_b");
      const [aliceNotice] = await noticesFor(db, "u_alice");
      const [bobNotice] = await noticesFor(db, "u_bob");
      expect(aliceNotice!.noticeType).toBe("trade_held_for_review");
      expect(bobNotice!.noticeType).toBe("trade_held_for_review");
      expect(copyViolations(`${aliceNotice!.title} ${aliceNotice!.body}`)).toEqual([]);
    });

    it("executes the identical trade in a private league, because the platform is not its commissioner", async () => {
      // Step 5's matched pair, on the trade half — `lg_1` stays private (`isPublicMatchmade`
      // defaults false), and a gap this lopsided still executes.
      const trade = await openGrotesquelyLopsidedTrade();
      const result = await acceptAs("u_bob", trade.id);
      expect(result).toMatchObject({ ok: true, outcome: "executed" });
      expect((await tradeRow(db, trade.id)).status).toBe("accepted");
      expect(await ownerTeamOf(db, "p_rb1")).toBe("team_b");
    });

    it("executes a trade between the two thresholds and flags it, exactly as Plan C shipped", async () => {
      await makeLeaguePublic();
      const trade = await openModeratelyLopsidedTrade();
      const result = await acceptAs("u_bob", trade.id);
      expect(result).toMatchObject({ ok: true, outcome: "executed" });
      if (result.ok && result.outcome === "executed") {
        expect(result.fairness.flagWorthy).toBe(true);
        expect(result.fairness.hold).toBe(false);
      }
      expect(await openFlagsOfType(db, "trade_fairness")).toHaveLength(1);
      expect(await openFlagsOfType(db, "trade_hold")).toHaveLength(0);
    });

    it("writes the hold and the flag that asks about it in ONE transaction, both on the platform chain", async () => {
      await makeLeaguePublic();
      const trade = await openGrotesquelyLopsidedTrade();
      await acceptAs("u_bob", trade.id);

      expect(await auditEventsOn(db, "lg_1", "trade_accepted")).toEqual([]);
      expect(await auditEventsOn(db, "lg_1", "roster_move")).toEqual([]);
      const [event] = await auditEventsOn(db, "platform", "system_action");
      expect(event!.payload).toMatchObject({ action: "trade_held_for_review", tradeId: trade.id });
      expect(await openFlagsOfType(db, "trade_hold")).toHaveLength(1);
    });

    it("leaves nothing behind when the flag write fails inside the hold transaction", async () => {
      await makeLeaguePublic();
      const trade = await openGrotesquelyLopsidedTrade();
      const failingRaise: Parameters<typeof acceptTrade>[1]["raiseFlag"] = async () => {
        throw new Error("flag write failed");
      };
      await expect(acceptAs("u_bob", trade.id, { raiseFlag: failingRaise })).rejects.toThrow();
      expect((await tradeRow(db, trade.id)).status).toBe("open");
      expect(await ownerTeamOf(db, "p_rb1")).toBe("team_a");
      expect(await noticesFor(db, "u_alice")).toEqual([]);
      expect(await noticesFor(db, "u_bob")).toEqual([]);
      expect(await openFlagsOfType(db, "trade_hold")).toHaveLength(0);
    });

    it("holds nothing while enforcement is off, however lopsided", async () => {
      // A public league with tier segregation switched off is exactly as un-enforced as a
      // private one, from `enforcementAppliesTo`'s own point of view — see `./enforcement.ts`.
      // `INTEGRITY_CONFIG.participation.enforceTierSegregation` is a module-level constant here,
      // not a per-call override, so this proves the OTHER half of the gate (public, but not
      // enforced) via the private-league test above rather than flipping a global for one test.
      const trade = await openGrotesquelyLopsidedTrade();
      const result = await acceptAs("u_bob", trade.id);
      expect(result).toMatchObject({ ok: true, outcome: "executed" });
    });

    it("refuses every ordinary lifecycle move on a held trade, one test per verb", async () => {
      await makeLeaguePublic();
      const trade = await openGrotesquelyLopsidedTrade();
      await acceptAs("u_bob", trade.id);
      expect((await tradeRow(db, trade.id)).status).toBe("held");

      const withdrawResult = await withdrawTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_alice" });
      expect(withdrawResult).toEqual({ ok: false, status: 409, reason: "This trade is waiting on a fairness review, so it can't change right now." });

      const rejectResult = await rejectTrade(db, { tradeId: trade.id, leagueId: "lg_1", userId: "u_bob" });
      expect(rejectResult).toEqual({ ok: false, status: 409, reason: "This trade is waiting on a fairness review, so it can't change right now." });

      const acceptResult = await acceptAs("u_bob", trade.id);
      expect(acceptResult).toEqual({ ok: false, status: 409, reason: "This trade is waiting on a fairness review, so it can't change right now." });

      // Still held — none of the three attempts changed anything.
      expect((await tradeRow(db, trade.id)).status).toBe("held");
    });

    /**
     * FINAL REVIEW F17, PINNED RATHER THAN GUARDED. `trade_proposals_open_fingerprint_idx` is
     * partial on `status = 'open'`, so `held` and `blocked` both fall outside it and the identical
     * package can be re-proposed while a hold is pending or after a block. The reviewer's read is
     * that no BYPASS results — the duplicate holds again — and these two tests are what make that
     * a pinned property rather than a reading.
     *
     * WHY A GUARD IS NOT SHIPPED HERE. Refusing a re-proposal would mean asking
     * `WHERE fingerprint = $1 AND status IN ('held','blocked')` on every propose, which no index
     * serves today (the only fingerprint index is the partial one), so it would need a migration —
     * a schema change, at the close of the phase, for a finding with no bypass behind it. The cost
     * of leaving it is bounded and stated: one extra queue entry per re-proposal, each of which an
     * operator answers independently, and no roster moves either way.
     */
    it("permits the identical package to be re-proposed while the first is HELD, and holds it again rather than executing", async () => {
      await makeLeaguePublic();
      const first = await openGrotesquelyLopsidedTrade();
      await acceptAs("u_bob", first.id);
      expect((await tradeRow(db, first.id)).status).toBe("held");

      // The real propose path, same league, same two teams, same package. `held` is outside the
      // partial unique index's own predicate, so nothing refuses it.
      const reproposed = await proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_rb1"], receive: ["p_wr1"] }));
      expect(reproposed).toMatchObject({ ok: true });

      // And accepting it reaches the SAME verdict on the same numbers: a second hold, never an
      // execution. That is the property that makes this queue amplification rather than a bypass.
      const secondAccept = await acceptAs("u_bob", (reproposed as { readonly tradeId: string }).tradeId);
      expect(secondAccept).toMatchObject({ ok: true, outcome: "held" });
      expect(await ownerTeamOf(db, "p_rb1")).toBe("team_a"); // nothing moved, either time
      expect(await ownerTeamOf(db, "p_wr1")).toBe("team_b");

      // Two open holds, one per trade row — the open-subject unique index dedupes per SUBJECT,
      // and these are two different trades naming the same package.
      expect(await openFlagsOfType(db, "trade_hold")).toHaveLength(2);
    });

    it("permits it again after a BLOCK, and still refuses to execute it", async () => {
      await makeLeaguePublic();
      const first = await openGrotesquelyLopsidedTrade();
      await acceptAs("u_bob", first.id);
      // The operator's own decision, stamped directly: this test is about what `proposeTrade`
      // does NEXT, and `blockHeldTradeInTx`'s own path is proven in its own suite.
      await db.update(tradeProposals).set({ status: "blocked" }).where(eq(tradeProposals.id, first.id));

      const reproposed = await proposeTrade(db, await proposeInput(db, { as: "u_alice", give: ["p_rb1"], receive: ["p_wr1"] }));
      expect(reproposed).toMatchObject({ ok: true });

      const secondAccept = await acceptAs("u_bob", (reproposed as { readonly tradeId: string }).tradeId);
      expect(secondAccept).toMatchObject({ ok: true, outcome: "held" });
      // The block is not a bypass to route around: the same package reaches an operator again,
      // and the rosters stay exactly where the operator left them until one answers.
      expect(await ownerTeamOf(db, "p_rb1")).toBe("team_a");
    });

    it("supersedes a held trade when another trade moves one of its players, and tells both parties", async () => {
      await makeLeaguePublic();
      const held = await openGrotesquelyLopsidedTrade();
      await acceptAs("u_bob", held.id);
      expect((await tradeRow(db, held.id)).status).toBe("held");
      const flagBefore = await openFlagsOfType(db, "trade_hold");
      expect(flagBefore).toHaveLength(1);

      // The league goes back to private before the SECOND trade: `p_rb1`'s own stat line is what
      // made the FIRST trade lopsided enough to hold, and it would make this one hold too if the
      // league stayed public — which would never reach the supersede sweep at all (nothing moves
      // on a hold). Flipping the league private isolates the property this test is actually
      // about: a HELD trade dies to the world moving on, independent of whether the trade that
      // moved it was itself ever a hold candidate. `held.id`'s own status is untouched by this —
      // a trade already held stays held regardless of the league's CURRENT enforcement setting.
      await db.update(leagues).set({ isPublicMatchmade: false }).where(eq(leagues.id, "lg_1"));

      // A DIFFERENT trade, between team_a and team_c, also naming p_rb1 — accepting it should
      // supersede the held offer, exactly as it would an open one.
      const competing = await openAcceptTrade(db, { proposerTeamId: "team_a", counterpartyTeamId: "team_c", give: ["p_rb1"], get: ["p_rb_c"] });
      const competingResult = await acceptAs("u_carol", competing.id);
      expect(competingResult).toMatchObject({ ok: true, outcome: "executed" });

      expect((await tradeRow(db, held.id)).status).toBe("superseded");
      expect(await openFlagsOfType(db, "trade_hold")).toHaveLength(0); // the question died with it

      // Fix round 1, Finding 1: the question died with it HONESTLY — a real system resolution,
      // never a raw table write. The flag itself carries a real audit trail, and an operator who
      // still has this flag's URL open reads a genuine "closed" state, not a live, unlabeled
      // pair of Release/Block buttons over a trade that no longer has anything to decide.
      const [flagAfter] = flagBefore;
      const [closedFlag] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flagAfter!.id));
      expect(closedFlag).toMatchObject({
        resolvedByUserId: null,
        resolution: "superseded_before_review",
      });
      expect(closedFlag!.resolvedAt).not.toBeNull();
      expect(closedFlag!.resolutionNote).not.toBeNull();
      const [platformResolved] = await auditEventsOn(db, "platform", "flag_resolved");
      expect(platformResolved).toMatchObject({
        actorId: null,
        actorType: "system",
        leagueId: null,
        payload: { flagId: flagAfter!.id, flagType: "trade_hold", decision: "superseded_before_review", subjectId: held.id },
      });

      const [aliceSupersededNotice] = (await noticesFor(db, "u_alice")).filter((n) => n.noticeType === "trade_superseded");
      const [bobSupersededNotice] = (await noticesFor(db, "u_bob")).filter((n) => n.noticeType === "trade_superseded");
      expect(aliceSupersededNotice).toBeDefined();
      expect(bobSupersededNotice).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------------------------
  // Plan D, Task 5 — the two ways out, driven directly (not through `resolveFlag`): every refusal
  // branch `releaseHeldTradeInTx`/`blockHeldTradeInTx` can answer, on their own.
  // -------------------------------------------------------------------------------------------
  describe("releaseHeldTradeInTx and blockHeldTradeInTx", () => {
    async function insertHeldTrade(opts: OpenAcceptTradeOpts = {}): Promise<{ readonly id: string }> {
      const proposerTeamId = opts.proposerTeamId ?? "team_a";
      const counterpartyTeamId = opts.counterpartyTeamId ?? "team_b";
      const proposerAssets = (opts.give ?? ["p_rb1"]).map(playerAsset);
      const counterpartyAssets = (opts.get ?? ["p_wr1"]).map(playerAsset);
      const proposedAt = new Date(opts.proposedAt ?? NOW);
      const expiresAt = new Date(proposedAt.getTime() + TRADE_CONFIG.proposalTtlHours * 60 * 60 * 1000);
      const id = `held_trade_${(tradeIdCounter += 1)}`;
      await db.insert(tradeProposals).values({
        id,
        leagueId: "lg_1",
        proposerTeamId,
        counterpartyTeamId,
        weekNumber: opts.weekNumber ?? 1,
        proposerAssets,
        counterpartyAssets,
        fingerprint: proposalFingerprint({ leagueId: "lg_1", proposerTeamId, counterpartyTeamId, proposerAssets, counterpartyAssets }),
        note: null,
        status: "held",
        proposedAt,
        expiresAt,
      });
      return { id };
    }

    it("refuses a trade id that names nothing at all", async () => {
      const result = await db.transaction((tx) => releaseHeldTradeInTx(tx, { tradeId: "ghost", leagueId: "lg_1", operatorUserId: "u_alice" }));
      expect(result).toEqual({ ok: false, status: 404, reason: "We couldn't find that trade." });
    });

    it("refuses a trade that is no longer waiting on a decision — never was held at all", async () => {
      const trade = await openAcceptTrade(db); // status: "open"
      const result = await db.transaction((tx) => releaseHeldTradeInTx(tx, { tradeId: trade.id, leagueId: "lg_1", operatorUserId: "u_alice" }));
      expect(result).toEqual({ ok: false, status: 409, reason: "This trade is no longer waiting on a decision." });
    });

    it("refuses on the LIVE week even when the held trade was priced at a week that has not started", async () => {
      await leagueSeasonThrough(db, 4);
      await lockWeek(db, 4);
      const held = await insertHeldTrade();
      const result = await db.transaction((tx) => releaseHeldTradeInTx(tx, { tradeId: held.id, leagueId: "lg_1", operatorUserId: "u_alice" }));
      expect(result).toEqual({ ok: false, status: 409, reason: "Week 4 has started, so rosters can't change until it ends." });
      expect((await tradeRow(db, held.id)).status).toBe("held");
    });

    it("releases a held trade that names no asset on either side, writing nothing to move", async () => {
      const held = await insertHeldTrade({ give: [], get: [] });
      const result = await db.transaction((tx) => releaseHeldTradeInTx(tx, { tradeId: held.id, leagueId: "lg_1", operatorUserId: "u_alice" }));
      expect(result).toMatchObject({ ok: true, tradeId: held.id });
      expect((await tradeRow(db, held.id)).status).toBe("accepted");
    });

    it("releases a held trade and supersedes any other open-or-held offer it invalidates, in one pass", async () => {
      const held = await insertHeldTrade({ give: ["p_rb1"], get: ["p_wr1"] });
      const competingHeld = await insertHeldTrade({ proposerTeamId: "team_a", counterpartyTeamId: "team_c", give: ["p_rb1"], get: ["p_rb_c"] });
      const result = await db.transaction((tx) => releaseHeldTradeInTx(tx, { tradeId: held.id, leagueId: "lg_1", operatorUserId: "u_alice" }));
      expect(result).toMatchObject({ ok: true, tradeId: held.id });

      expect((await tradeRow(db, held.id)).status).toBe("accepted");
      expect((await tradeRow(db, competingHeld.id)).status).toBe("superseded");
      expect(await openFlags(db)).toEqual([]);
      const [carolSuperseded] = (await noticesFor(db, "u_carol")).filter((n) => n.noticeType === "trade_superseded");
      expect(carolSuperseded).toBeDefined();
    });

    it("refuses a block for a trade id that names nothing at all", async () => {
      const result = await db.transaction((tx) => blockHeldTradeInTx(tx, { tradeId: "ghost", leagueId: "lg_1", operatorUserId: "u_alice", note: "" }));
      expect(result).toEqual({ ok: false, status: 404, reason: "We couldn't find that trade." });
    });

    it("refuses to block a trade that is no longer waiting on a decision — never was held at all", async () => {
      const trade = await openAcceptTrade(db);
      const result = await db.transaction((tx) => blockHeldTradeInTx(tx, { tradeId: trade.id, leagueId: "lg_1", operatorUserId: "u_alice", note: "" }));
      expect(result).toEqual({ ok: false, status: 409, reason: "This trade is no longer waiting on a decision." });
    });

    it("heals a retry once a trade is already blocked, without a second write", async () => {
      const held = await insertHeldTrade();
      const first = await db.transaction((tx) => blockHeldTradeInTx(tx, { tradeId: held.id, leagueId: "lg_1", operatorUserId: "u_alice", note: "n" }));
      expect(first).toMatchObject({ ok: true });
      const retry = await db.transaction((tx) => blockHeldTradeInTx(tx, { tradeId: held.id, leagueId: "lg_1", operatorUserId: "u_alice", note: "n" }));
      expect(retry).toEqual({ ok: true, tradeId: held.id, notices: [] });
    });
  });
});
