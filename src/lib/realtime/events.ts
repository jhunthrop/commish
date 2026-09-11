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
   * A member-facing integrity notice was created for them (`member_notices`). Delivered on a
   * PER-USER stream key (`REALTIME_CONFIG.userStreamKey`), never the league broadcast — a
   * private notice ("your trade is on hold for review") must not be readable by leaguemates,
   * and even a content-free frame on the league stream would leak that a specific member got a
   * specific kind of notice. The payload carries only `{ noticeId, noticeType }`; the words come
   * from an authenticated read of `GET /api/notices`. See `src/integrity-service/notify.ts`.
   */
  "notice.created",
  /**
   * SIDELINE (P5, the room is a place): a member's live connection to this league opened or
   * closed. Payload `{ userId, present }`. Presence is DERIVED from the SSE connections the
   * server already holds (`src/lib/realtime/presence.ts`), never from anything a client claims,
   * and the frame carries no words: a browser answers it by re-reading
   * `GET /api/leagues/[leagueId]/presence`, the same membership-gated read every league route
   * shares. Published to the league stream: who is in the room is a fact the whole room may see.
   */
  "presence.changed",
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
