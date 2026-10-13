import { inArray } from "drizzle-orm";
import type { DbTx } from "@research-ts/db/client";
import { teams } from "@/db/schema";
import type { DraftState } from "@/draft-engine";
import type { AuditEventInput } from "@/domain/audit";

/**
 * The audit events one accepted action produced, derived by diffing the pick list — the same
 * previous/next diff `draftEventsFor` already uses to derive realtime frames, so a pick reaches
 * the audit log and the wire from one comparison rather than two rules that can disagree.
 *
 * `occurredAt` is the pick's OWN timestamp (the action's injected clock), not now: the spec's
 * exit criterion is one correct event per pick with the correct `occurredAt`, and re-reading a
 * clock here would stamp the commit rather than the pick.
 *
 * A queue edit is deliberately not audited. `SET_QUEUE` is a team's private draft plan, and the
 * member-visible activity feed is exactly where it must not appear.
 *
 * `actorId` is the SUBMITTING action's actor — correct by construction for snake, where every
 * `auto: false` pick is a `MAKE_PICK` a person submitted directly and every `TIMER_EXPIRE` pick
 * is `auto: true`. It is NOT enough for auction: the only action that ever closes a lot is
 * `TIMER_EXPIRE` (submitted by the ticker, no actor), yet a contested lot the clock closes is a
 * real person's win (`auto: false` — `auction.ts`'s `reduceAuctionExpiry` sets `auto` from
 * whether the winner is the original, unopposed nominee, not from who submitted the closing
 * action). `ownerOf` is exactly that gap's fix: a pick that is `auto: false` but has no
 * submitting actor is attributed to the WINNING TEAM's owner instead — never left `actorType:
 * "user"` with `actorId: null`, a row that claims a person acted and names no one.
 */
export function auditEventsForPicks(
  previous: DraftState,
  next: DraftState,
  actorId: string | null,
  /** Team id → owning user id, for exactly the teams `ownerIdsForContestedPicks` found needed. */
  ownerOf: ReadonlyMap<string, string> = new Map(),
): readonly AuditEventInput[] {
  const positionOf = new Map(next.pool.map((entry) => [entry.playerId, entry.position]));
  return next.picks.slice(previous.picks.length).map((pick) => ({
    eventType: "draft_pick" as const,
    actorId: pick.auto ? null : (actorId ?? ownerOf.get(pick.teamId) ?? null),
    actorType: pick.auto ? ("system" as const) : ("user" as const),
    leagueId: next.config.leagueId,
    payload: {
      draftId: next.config.draftId,
      teamId: pick.teamId,
      playerId: pick.playerId,
      position: positionOf.get(pick.playerId) ?? null,
      round: pick.round,
      pickNumber: pick.pickNumber,
      slot: pick.slot,
      slotIndex: pick.slotIndex,
      price: pick.price,
      auto: pick.auto,
    },
    occurredAt: pick.timestamp,
  }));
}

/**
 * Team owner ids for the teams a batch of new picks might need auction-winner attribution for —
 * one query, called BEFORE `auditEventsForPicks` and before the chain anchor lock (ruling 3: the
 * anchor is always the LAST lock a transaction takes). A plain read — no `FOR UPDATE` — so it
 * takes no lock of its own and cannot be the second half of an ordering cycle.
 */
export async function ownerIdsForContestedPicks(tx: DbTx, teamIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (teamIds.length === 0) return new Map();
  const rows = await tx.select({ id: teams.id, userId: teams.userId }).from(teams).where(inArray(teams.id, teamIds));
  return new Map(rows.map((row) => [row.id, row.userId]));
}
