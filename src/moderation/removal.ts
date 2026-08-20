import { MODERATION_CONFIG, type ModerationReasonValue } from "./config";

/**
 * Every reason a report or a removal may name — narrowed to the closed union, unlike the array
 * `src/reviews/config.ts` shipped before this module existed (`readonly string[]`, an explicit
 * widening annotation that let a typo past the compiler at every call site). `isRemovalReason`
 * below is the guard a caller holding a bare `string` needs to narrow back down to this type.
 */
export const REMOVAL_REASON_VALUES: readonly ModerationReasonValue[] = MODERATION_CONFIG.reasons.map((reason) => reason.value);

/**
 * The typo-proof gate for a caller holding a bare `string`. `REMOVAL_REASON_VALUES.includes(x)`
 * cannot be called with one directly once the array's own element type is the closed union —
 * TypeScript refuses the comparison outright — so this is a type PREDICATE, not just a boolean: a
 * caller that checks it first gets `ModerationReasonValue` back from an unnarrowed `string`, at
 * the type level as well as at runtime.
 *
 * No production caller reaches for this yet. `scripts/remove-review.ts` still validates against
 * `@/reviews/config`'s re-exported `REMOVAL_REASON_VALUES` — deliberately WIDENED back to
 * `readonly string[]` there so that script's existing `.includes(reason)` check keeps compiling
 * unchanged (ruling 21's "diff at every consumer is zero"; see that module's own docblock). This
 * function is the narrow door for whatever calls next instead — Task 6's chat report surface, or a
 * future rewrite of the script itself — to use rather than re-deriving the same check by hand.
 */
export function isRemovalReason(value: string): value is ModerationReasonValue {
  return (REMOVAL_REASON_VALUES as readonly string[]).includes(value);
}

/**
 * The sentence fragment a removed author reads. A stored value outside the closed set falls back
 * to the generic phrase rather than being printed raw: rows written before the operator script
 * constrained `--reason`, or by hand in SQL, must not put an operator's private wording into a
 * sentence on a member's own profile.
 */
export function removalPhraseFor(storedReason: string | null): string {
  return MODERATION_CONFIG.reasons.find((reason) => reason.value === storedReason)?.removalPhrase ?? "breaking the review rules";
}

/**
 * The whole sentence, in ONE place. `ReviewComposer` renders it on the author's own profile and
 * `scripts/remove-review.ts` prints it in the operator's confirmation preview — two surfaces that
 * had drifted into two string literals that only happened to agree, before `@/reviews/config`
 * first unified them. That unification moved here unchanged: the wording is reviews' own, and
 * this module does not generalize it to a subject-agnostic phrasing on this consumer's behalf.
 */
export function removalSentenceFor(storedReason: string | null): string {
  return `Your review was removed for ${removalPhraseFor(storedReason)}. It can't be edited.`;
}
