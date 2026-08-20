/**
 * Every tunable league chat has. No component, service or route may inline one of these.
 *
 * The reaction set is deliberately CLOSED and small: a fixed set is one row shape, one
 * keyboard-reachable menu, and one thing to render — an open emoji picker is a moderation
 * surface and an i18n surface that this phase has no answer for.
 */
export const CHAT_CONFIG = {
  /** Longest message body accepted, in characters (after trimming). */
  maxBodyLength: 500,
  /** Messages per history page. Every read is paginated — no unbounded chat query exists. */
  pageSize: 50,
  /** The complete reaction set. */
  reactions: ["🔥", "😂", "😭", "👏", "🤝"],
  /**
   * Cap applied when LIVE frames land (`mergeMessages` drops the oldest past this). Pages a
   * user explicitly loads via backward pagination prepend without trimming — scrolling into
   * history may hold more than this, by design.
   */
  maxHeldMessages: 500,
  /**
   * The dimension bounds a GIF message must fall within, checked server-side
   * (`chat-service/schemas.ts`'s `chatGifSchema`) because the client sends back a search
   * result's own reported dimensions and a client-reported number is client-controlled input.
   * The ceiling is generous — real Giphy renditions top out well under it — and exists to reject
   * a garbage or adversarial value, not to constrain a real one.
   */
  gif: {
    minDimensionPx: 1,
    maxDimensionPx: 4096,
  },
} as const;

export type ReactionEmoji = (typeof CHAT_CONFIG.reactions)[number];

/** The one membership check for the reaction set — shared by the Zod boundary and the UI. */
export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (CHAT_CONFIG.reactions as readonly string[]).includes(value);
}
