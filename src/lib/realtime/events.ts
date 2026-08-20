/**
 * The event taxonomy for the one real-time channel. Every feature publishes through
 * publishEvent() with one of these types — this is the single place they're enumerated,
 * so consumers (web SSE, native SSE clients, later live scoring) all agree.
 *
 * A runtime VALUE, not just a type: `src/identity/notifications.test.ts` iterates it to check
 * that the notification catalog never names an event the product does not publish. The type is
 * derived from the array (`(typeof REALTIME_EVENT_TYPES)[number]`) rather than declared
 * separately, so the list and the union cannot diverge — there is only one place to edit.
 */
export const REALTIME_EVENT_TYPES = [
  "draft.pick",
  "draft.nominate",
  "draft.bid",
  "draft.timer_expire",
  "draft.status",
  /**
   * A team replaced its autopick queue. Carries the team id and the post-action clock —
   * never the queue's contents, which are that team's private draft plan. It exists so a
   * queue edit's `sequence` bump reaches every browser: without it the next real event would
   * look like a gap and force a full-state refetch in every open room.
   */
  "draft.queue",
  /** The AI draft moderator's pacing prompt for the team currently on the clock. */
  "draft.nudge",
  "chat.message",
  "chat.reaction",
  "score.update",
  /**
   * A `member_notices` row was written for one member (`src/integrity-service/notify.ts`). Sent
   * on the LEAGUE stream, not a per-user one — no per-user channel exists — carrying the target
   * `userId` in its payload so every other open browser in the room ignores it. Only sent when
   * the notice HAS a league (ruling 13); a league-less notice (e.g. `review_removed`) reaches its
   * reader on their next inbox load instead, which is what the durable row is for.
   */
  "notice.created",
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export interface RealtimeEvent<TPayload = unknown> {
  /** Redis Stream entry id (e.g. "1723900000000-0"). Doubles as the SSE `id:` for Last-Event-ID resume. */
  readonly id: string;
  readonly type: RealtimeEventType;
  readonly leagueId: string;
  readonly payload: TPayload;
  /** ISO timestamp supplied by the publisher's Clock, never Date.now() inside this module. */
  readonly timestamp: string;
}
