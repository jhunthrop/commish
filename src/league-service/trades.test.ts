import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { leagues, teams, tradeProposals, users } from "@/db/schema";
import { isUniqueViolation } from "@/db/errors";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { TradeAsset } from "@/trades/assets";
import { isExpired, proposalFingerprint, toTradeProposal, tradesQuery, type TradeProposal } from "./trades";

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
