import { and, eq, inArray } from "drizzle-orm";
import { publishQuietly, type PublishErrorSink } from "@/chat-service/chat";
import type { Db } from "@research/db/client";
import { auditEvents, eventReactions } from "@/db/schema";
import type { EventReactionView } from "@/league-room/contract";
import type { PublishFn } from "@/lib/realtime/publish";

export type ToggleEventReactionResult =
  | { readonly ok: true; readonly action: "added" | "removed" }
  | { readonly ok: false; readonly status: number; readonly reason: string };

export interface ToggleEventReactionInput {
  readonly leagueId: string;
  readonly eventId: string;
  readonly userId: string;
  readonly emoji: string;
  readonly publish: PublishFn;
  /** Defaults to logging via `console.error`. Override in tests to assert the swallow. */
  readonly onPublishError?: PublishErrorSink;
}

/** The one sentence a reaction refuses with — the event is gone, or it was never this room's. */
const GONE = "That is no longer here.";

/**
 * A REACTION ON SOMETHING THAT HAPPENED (Sideline P5: "reactions attach to all of them"). The
 * same toggle `toggleReaction` (`@/chat-service/chat`) performs on a message, against the audit
 * event the stream drew — and deliberately the same shape line for line, because a pick and a
 * message are the same gesture to the person tapping.
 *
 * The verdict is read from the write THIS call landed, never from a prior read: `INSERT ... ON
 * CONFLICT DO NOTHING RETURNING` is one atomic statement, so under a concurrent double tap the
 * primary key guarantees exactly one caller's insert returns a row and only that caller reports
 * "added". Everyone else falls through to the DELETE and is judged by its own returned rows, so a
 * caller can never mistake a just-committed insert for an empty table. See `toggleReaction`'s own
 * docblock for the full argument; it is one argument, and this is the second place it holds.
 *
 * THE EVENT IS RE-READ SCOPED TO THE LEAGUE FIRST. The route's membership gate proves who the
 * caller is; this proves the event is one they were allowed to see, so a member of league A
 * cannot react onto league B's pick by guessing an id. There is no separate "your own event"
 * rule: anyone in the league may react, the actor included — a manager laughing at their own
 * pick is the room working.
 */
export async function toggleEventReaction(db: Db, input: ToggleEventReactionInput): Promise<ToggleEventReactionResult> {
  const outcome = await db.transaction(async (tx) => {
    const [event] = await tx
      .select({ id: auditEvents.eventId })
      .from(auditEvents)
      .where(and(eq(auditEvents.eventId, input.eventId), eq(auditEvents.leagueId, input.leagueId)));
    if (event === undefined) return { ok: false as const, status: 404, reason: GONE };

    const inserted = await tx
      .insert(eventReactions)
      .values({ eventId: input.eventId, userId: input.userId, emoji: input.emoji })
      .onConflictDoNothing()
      .returning({ emoji: eventReactions.emoji });

    const didAdd = inserted.length > 0;
    const didRemove = didAdd
      ? false
      : (
          await tx
            .delete(eventReactions)
            .where(and(eq(eventReactions.eventId, input.eventId), eq(eventReactions.userId, input.userId), eq(eventReactions.emoji, input.emoji)))
            .returning({ emoji: eventReactions.emoji })
        ).length > 0;

    return { ok: true as const, didAdd, didRemove };
  });

  if (!outcome.ok) return outcome;
  const { didAdd, didRemove } = outcome;
  const action: "added" | "removed" = didAdd ? "added" : "removed";

  // Only a write THIS call actually made is published — never the phantom no-op where a
  // concurrent caller's DELETE already won and already published the same transition.
  if (didAdd || didRemove) {
    await publishQuietly(
      input.publish,
      { leagueId: input.leagueId, type: "stream.reaction", payload: { eventId: input.eventId, emoji: input.emoji, userId: input.userId, action } },
      input.onPublishError,
    );
  }

  return { ok: true, action };
}

/**
 * Every reaction on a page of stream events, in ONE query, grouped by event. Scoped through
 * `audit_events.league_id` rather than trusting the ids the caller passed: the room reads this
 * with the ids `listLeagueActivity` just returned, but a scope that depends on the caller having
 * been careful is not a scope.
 *
 * An event nobody has reacted to is ABSENT from the map, never an empty array — absence renders
 * as absence, and the caller's own `?? []` is the one place the empty case is spelled.
 */
export async function reactionsForEvents(
  db: Db,
  leagueId: string,
  eventIds: readonly string[],
): Promise<ReadonlyMap<string, readonly EventReactionView[]>> {
  const grouped = new Map<string, EventReactionView[]>();
  if (eventIds.length === 0) return grouped;

  const rows = await db
    .select({ eventId: eventReactions.eventId, emoji: eventReactions.emoji, userId: eventReactions.userId })
    .from(eventReactions)
    .innerJoin(auditEvents, eq(auditEvents.eventId, eventReactions.eventId))
    .where(and(inArray(eventReactions.eventId, [...eventIds]), eq(auditEvents.leagueId, leagueId)));

  for (const row of rows) {
    const held = grouped.get(row.eventId);
    if (held === undefined) grouped.set(row.eventId, [{ emoji: row.emoji, userId: row.userId }]);
    else held.push({ emoji: row.emoji, userId: row.userId });
  }
  return grouped;
}
