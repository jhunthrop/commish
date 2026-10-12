import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { teams, tradeProposals, tradeVetoes } from "@/db/schema";
import type { Clock } from "@research/domain/timing";
import { LEAGUE_CONFIG } from "@/league";
import { acceptTrade, TRADE_GOVERNANCE_REFUSALS } from "./trades";

const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * Votes required to veto, from the league's own size — the reference product's 5-of-12 shape
 * (floor(n/3)+1), floored at 3 so a tiny league cannot be vetoed by one grudge.
 */
export function vetoVotesRequired(teamCount: number): number {
  return Math.max(3, Math.floor(teamCount / 3) + 1);
}

/**
 * THE LAZY REVIEW FINALIZER (roadmap item 5) — the waiver processor's own pattern: runs at the
 * top of every trades read and write, so a closed window resolves on the next touch and no cron
 * can fail silently. A vetoed-out trade settles `vetoed`; an unvetoed one EXECUTES by
 * re-entering `acceptTrade` with `finalizeReview`, which lands the whole battle-tested
 * execution path (transfer, supersede sweep, notices, audit, fairness flag) unchanged.
 */
export async function processTradeReviews(db: Db, clock: Clock = systemClock): Promise<{ readonly executed: number; readonly vetoed: number }> {
  const now = new Date(clock.now());
  const due = await db
    .select()
    .from(tradeProposals)
    .where(and(eq(tradeProposals.status, "under_review"), lte(tradeProposals.reviewEndsAt, now)));
  let executed = 0;
  let vetoed = 0;

  for (const trade of due) {
    const [teamCountRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(teams)
      .where(eq(teams.leagueId, trade.leagueId));
    const [voteRow] = await db.select({ n: sql<number>`count(*)::int` }).from(tradeVetoes).where(eq(tradeVetoes.tradeId, trade.id));

    if ((voteRow?.n ?? 0) >= vetoVotesRequired(teamCountRow?.n ?? 0)) {
      const [settled] = await db
        .update(tradeProposals)
        .set({ status: "vetoed", settledAt: now })
        .where(and(eq(tradeProposals.id, trade.id), eq(tradeProposals.status, "under_review")))
        .returning();
      if (settled !== undefined) vetoed += 1;
      continue;
    }

    const [counterparty] = await db.select({ userId: teams.userId }).from(teams).where(eq(teams.id, trade.counterpartyTeamId));
    if (counterparty === undefined) continue;
    const result = await acceptTrade(db, {
      tradeId: trade.id,
      leagueId: trade.leagueId,
      userId: counterparty.userId,
      finalizeReview: true,
      clock,
    });
    if (result.ok && result.outcome === "executed") executed += 1;
    // A refusal here (a locked week, drifted ownership) leaves the row under_review — the next
    // touch retries, and `applyTradeInTx`'s own supersede/refusal machinery says why if it can
    // never complete.
  }
  return { executed, vetoed };
}

export type VetoResult = { readonly ok: true; readonly votes: number; readonly required: number } | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * One member's veto vote. Parties to the trade cannot vote (their yes and no are the trade
 * itself); a second vote refuses in words; reaching the threshold settles the trade VETOED
 * immediately rather than waiting out the window — a decided question does not linger.
 */
export async function vetoTrade(db: Db, input: { readonly leagueId: string; readonly tradeId: string; readonly userId: string }, clock: Clock = systemClock): Promise<VetoResult> {
  const [trade] = await db
    .select()
    .from(tradeProposals)
    .where(and(eq(tradeProposals.id, input.tradeId), eq(tradeProposals.leagueId, input.leagueId)));
  if (trade === undefined || trade.status !== "under_review") {
    return { ok: false, status: 409, reason: TRADE_GOVERNANCE_REFUSALS.notUnderReview };
  }
  const [voterTeam] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));
  if (voterTeam === undefined) return { ok: false, status: 403, reason: "You do not have a team in this league." };
  if (voterTeam.id === trade.proposerTeamId || voterTeam.id === trade.counterpartyTeamId) {
    return { ok: false, status: 409, reason: TRADE_GOVERNANCE_REFUSALS.partyCannotVeto };
  }

  const inserted = await db
    .insert(tradeVetoes)
    .values({ tradeId: input.tradeId, userId: input.userId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return { ok: false, status: 409, reason: TRADE_GOVERNANCE_REFUSALS.alreadyVetoed };

  const [teamCountRow] = await db.select({ n: sql<number>`count(*)::int` }).from(teams).where(eq(teams.leagueId, input.leagueId));
  const [voteRow] = await db.select({ n: sql<number>`count(*)::int` }).from(tradeVetoes).where(eq(tradeVetoes.tradeId, input.tradeId));
  const votes = voteRow?.n ?? 0;
  const required = vetoVotesRequired(teamCountRow?.n ?? 0);
  if (votes >= required) {
    await db
      .update(tradeProposals)
      .set({ status: "vetoed", settledAt: new Date(clock.now()) })
      .where(and(eq(tradeProposals.id, input.tradeId), eq(tradeProposals.status, "under_review")));
  }
  return { ok: true, votes, required };
}
