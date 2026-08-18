/**
 * The event taxonomy for the one real-time channel. Every feature publishes through
 * publishEvent() with one of these types — this is the single place they're enumerated,
 * so consumers (web SSE, native SSE clients, later live scoring) all agree.
 */
export type RealtimeEventType =
  | "draft.pick"
  | "draft.nominate"
  | "draft.bid"
  | "draft.timer_expire"
  | "draft.status"
  /**
   * A team replaced its autopick queue. Carries the team id and the post-action clock —
   * never the queue's contents, which are that team's private draft plan. It exists so a
   * queue edit's `sequence` bump reaches every browser: without it the next real event would
   * look like a gap and force a full-state refetch in every open room.
   */
  | "draft.queue"
  /** The AI draft moderator's pacing prompt for the team currently on the clock. */
  | "draft.nudge"
  | "chat.message"
  | "chat.reaction"
  | "score.update";

export interface RealtimeEvent<TPayload = unknown> {
  /** Redis Stream entry id (e.g. "1723900000000-0"). Doubles as the SSE `id:` for Last-Event-ID resume. */
  readonly id: string;
  readonly type: RealtimeEventType;
  readonly leagueId: string;
  readonly payload: TPayload;
  /** ISO timestamp supplied by the publisher's Clock, never Date.now() inside this module. */
  readonly timestamp: string;
}
