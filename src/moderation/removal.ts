import { MODERATION_CONFIG, type ModerationReasonValue } from "./config";

/**
 * Every reason a report or a removal may name — narrowed to the closed union, unlike the array
 * `src/reviews/config.ts` shipped before this module existed (`readonly string[]`, an explicit
 * widening annotation that let a typo past the compiler at every call site).
 *
 * There was an `isRemovalReason` type predicate beside this, written as "the narrow door for
 * whatever calls next". Nothing ever called it, and the final review named it as inert residue
 * (LOW 14): a guard with no caller is a guess about a future consumer, and re-adding one is three
 * lines on the commit that first needs it. `scripts/remove-review.ts` validates against
 * `@/reviews/config`'s deliberately widened re-export of this array (ruling 21) and is unaffected.
 */
export const REMOVAL_REASON_VALUES: readonly ModerationReasonValue[] = MODERATION_CONFIG.reasons.map((reason) => reason.value);

/**
 * The sentence fragment a removed review's author reads. A stored value outside the closed set
 * falls back to the generic phrase rather than being printed raw: rows written before the
 * operator script constrained `--reason`, or by hand in SQL, must not put an operator's private
 * wording into a sentence on a member's own profile.
 */
export function removalPhraseFor(storedReason: string | null): string {
  return MODERATION_CONFIG.reasons.find((reason) => reason.value === storedReason)?.removalPhrase ?? "breaking the review rules";
}

/**
 * `removalPhraseFor`'s exact twin, reading `chatRemovalPhrase` instead — what a removed CHAT
 * message's author (and, from Task 6, the operator's own preview of that notice) reads. Fix
 * round 1: `removalPhraseFor`'s generic fallback ("breaking the review rules") was leaking into
 * chat's own removal notice and, before the same round's other fix, the room-visible tombstone —
 * reviews-domain copy in a chat surface. Every caller that renders a `chat_message_removed`
 * reason (or previews one before it's sent) calls this, never `removalPhraseFor`.
 */
export function chatRemovalPhraseFor(storedReason: string | null): string {
  return MODERATION_CONFIG.reasons.find((reason) => reason.value === storedReason)?.chatRemovalPhrase ?? "breaking the chat rules";
}

/**
 * The whole sentence, in ONE place. `ReviewComposer` renders it on the author's own profile and
 * `scripts/remove-review.ts` prints it in the operator's confirmation preview — two surfaces that
 * had drifted into two string literals that only happened to agree, before `@/reviews/config`
 * first unified them. That unification moved here unchanged: the wording is reviews' own, and
 * this module does not generalize it to a subject-agnostic phrasing on this consumer's behalf.
 */
export function removalSentenceFor(storedReason: string | null): string {
  return `We removed your review for ${removalPhraseFor(storedReason)}. It cannot be edited.`;
}
