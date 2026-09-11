import { MODERATION_CONFIG } from "@/moderation/config";

/**
 * Every tunable league chat has. No component, service or route may inline one of these.
 *
 * The reaction set is deliberately CLOSED and small: a fixed set is one row shape, one
 * keyboard-reachable menu, and one thing to render — an open emoji picker is a moderation
 * surface and an i18n surface that this phase has no answer for.
 */
/** Referenced twice below — the GIF's alt text IS a message body, so it is capped by the same number. */
const MAX_BODY_LENGTH = 500;

export const CHAT_CONFIG = {
  /** Longest message body accepted, in characters (after trimming). */
  maxBodyLength: MAX_BODY_LENGTH,
  /** Messages per history page. Every read is paginated — no unbounded chat query exists. */
  pageSize: 50,
  /** The complete reaction set. The stream's events wear the same five (Sideline P5: "reactions
   *  attach to all of them"), so there is one set to render and one set to validate. */
  reactions: ["🔥", "😂", "😭", "👏", "🤝"],
  /**
   * The ceiling on reaction toggles by ONE authenticated caller, shared by the message route and
   * the stream-event route — a reaction is one act with one budget, the same argument
   * `chatReportRateLimit` makes for a report. Generous on purpose: tapping five pills across a
   * screenful of picks is a person enjoying the room, and the bound exists to stop a script
   * looping a write endpoint, not to ration the gesture.
   */
  reactionRateLimit: { maxRequests: 120, windowMs: 60_000 },
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
    /**
     * Length ceilings on the three STRINGS a GIF message carries. Every one of them is
     * client-reported, and without a cap a league member can write unbounded text into
     * `chat_messages` — the dimensions were bounded from the start and the strings were not.
     * 2048 is the practical URL ceiling every browser and CDN already assumes; a real Giphy
     * rendition url runs well under 200 characters.
     */
    maxUrlLength: 2048,
    /** The alt text becomes the message body (`ChatComposer`), so it is capped by the same rule. */
    maxAltLength: MAX_BODY_LENGTH,
  },
  /**
   * The closed report-reason set a chat report picks from — `MODERATION_CONFIG.reasons`
   * (`@/moderation/config`), not a second copy of it. Founder decision #2's default is "mirror
   * `reviews`' existing closed set exactly; one vocabulary, two record types", so this is a
   * re-export, the same "diff at every consumer is zero" discipline `REVIEW_CONFIG.reportReasons`
   * already established (`@/reviews/config`).
   */
  reportReasons: MODERATION_CONFIG.reasons,
} as const;

export type ReactionEmoji = (typeof CHAT_CONFIG.reactions)[number];

/** The one membership check for the reaction set — shared by the Zod boundary and the UI. */
export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (CHAT_CONFIG.reactions as readonly string[]).includes(value);
}

export type ChatReportReasonValue = (typeof CHAT_CONFIG.reportReasons)[number]["value"];
