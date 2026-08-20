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
 */
export function auditEventsForPicks(previous: DraftState, next: DraftState, actorId: string | null): readonly AuditEventInput[] {
  const positionOf = new Map(next.pool.map((entry) => [entry.playerId, entry.position]));
  return next.picks.slice(previous.picks.length).map((pick) => ({
    eventType: "draft_pick" as const,
    actorId: pick.auto ? null : actorId,
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
