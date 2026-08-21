import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db, DbTx } from "@/db/client";
import { auditEvents, leagues, memberNotices, players, rosterSlots, statWeeks, teams, tradeProposals, users } from "@/db/schema";
import { isUniqueViolation } from "@/db/errors";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventType } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import type { RosterSlotConfig } from "@/domain/roster";
import { copyViolations } from "@/integrity/copy-rules";
import type { AuditLogger } from "@/integrity-service/audit-logger";
import { notifyAffectedMember } from "@/integrity-service/notify";
import type { TradeAsset } from "@/trades/assets";
import { TRADE_CONFIG } from "@/trades/config";
import { applyTradeInTx } from "./trade-transfer";
import {
  acceptTrade,
  isExpired,
  listTrades,
  proposalFingerprint,
  proposeTrade,
  refusalFor,
  rejectTrade,
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

describe("tradesQuery", () => {
  it("inbox is the counterparty's open offers; outbox is the proposer's; history is the league's whole record", async () => {
    await truncateAll(db);
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_open", from: ["p_rb1"], to: ["p_wr1"] });
    await insertProposal(db, { id: "tr_settled", from: ["p_rb2"], to: ["p_wr2"] });
    await db.update(tradeProposals).set({ status: "rejected", settledAt: new Date() }).where(eq(tradeProposals.id, "tr_settled"));

    const inbox = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_b", box: "inbox" });
    expect(inbox.map((row) => row.id)).toEqual(["tr_open"]);

    const outbox = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_a", box: "outbox" });
    expect(outbox.map((row) => row.id)).toEqual(["tr_open"]);

    const history = await tradesQuery(db, { leagueId: "lg_1", teamId: "team_a", box: "history" });
    expect(history.map((row) => row.id).sort()).toEqual(["tr_open", "tr_settled"]);
  });
});

describe("isExpired", () => {
  it("is true for an open offer past its expiry", () => {
    expect(isExpired({ status: "open", expiresAt: "2026-08-01T00:00:00.000Z" }, "2026-08-02T00:00:00.000Z")).toBe(true);
  });

  it("is false for an open offer still inside its window", () => {
    expect(isExpired({ status: "open", expiresAt: "2026-08-04T00:00:00.000Z" }, "2026-08-02T00:00:00.000Z")).toBe(false);
  });

  it("is false for a terminal row, even one whose expiry has long since passed", () => {
    expect(isExpired({ status: "accepted", expiresAt: "2026-08-01T00:00:00.000Z" }, "2026-08-02T00:00:00.000Z")).toBe(false);
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
  readonly weekNumber: number;
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
    weekNumber: 1,
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
      weekNumber: 1,
      proposerAssets: [playerAsset("p_rb_a")],
      counterpartyAssets: [playerAsset("p_rb_b")],
      note: null,
    });
    expect(result).toMatchObject({ ok: true });
  });
});

describe("rejectTrade and withdrawTrade", () => {
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

  async function acceptAs(userId: string, tradeId: string) {
    return acceptTrade(db, { tradeId, leagueId: "lg_1", userId, clock: fixedClock(NOW), deliver: deliverNoticeFake });
  }

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
  });

  it("refuses a caller with no team at all in this league, the same 404 as the wrong manager", async () => {
    const trade = await openAcceptTrade(db);
    const result = await acceptAs("u_dave", trade.id);
    expect(result).toEqual({ ok: false, status: 404, reason: "We couldn't find that offer." });
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
  });

  it("passes an applyTradeInTx 'no room' refusal straight through, with its own message", async () => {
    // Two players in, one out: `team_b` clears its one WR for `p_rb1` (fine — a bench spot just
    // opened) but has nowhere left for `p_te1`, since its own single bench spot is already spent.
    const trade = await openAcceptTrade(db, { give: ["p_rb1", "p_te1"], get: ["p_wr1"] });
    const result = await acceptAs("u_bob", trade.id);
    expect(result).toMatchObject({ ok: false, status: 409, reason: expect.stringContaining("no room") });
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

  it("refuses to move a roster while the week is locked, and says which week", async () => {
    // The same rule `setLineup` enforces, read the same way: a week is locked once it has
    // STARTED, not once it has been scored.
    await lockWeek(db, 4);
    const trade = await openAcceptTrade(db, { weekNumber: 4 });
    const result = await acceptAs("u_bob", trade.id);
    expect(result).toEqual({ ok: false, status: 409, reason: "Week 4 has started, so rosters can't change until it ends." });
  });

  it("takes FOR SHARE on the week before it validates, so a kickoff mid-transaction cannot slip through", async () => {
    // The read-validate-write hole `setLineup` already closed, in the transaction that moves more
    // than `setLineup` does. A concurrent writer flips `stat_weeks[4]` to `in_progress` and holds
    // the transaction open (uncommitted) — the same rendezvous `trade-transfer.test.ts`'s own
    // `materializeLockedLineupsInTx` FOR SHARE proof uses, since under READ COMMITTED a plain
    // unlocked SELECT would NOT block on this and would read the stale pre-flip value instead.
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

  it("evicts the cached score for the trade's own week after the transaction commits, never inside it", async () => {
    const trade = await openAcceptTrade(db, { weekNumber: 4 });
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
});
