import { INTEGRITY_CONFIG } from "./config";

/**
 * THE house rules for copy this product writes in its own voice, in one implementation.
 *
 * There used to be two rulebooks. Notice templates were swept for accusatory terms, passive
 * constructions and dashes; activity headlines were swept for dashes only. The asymmetry was
 * visible in the activity sweep's own fixture, which was itself one of the passive constructions
 * the other surface bans. Both surfaces are read by the same member, on the same page, minutes
 * apart, so there is one rulebook and this is it.
 *
 * The five rules, and why each is mechanical rather than a review note:
 *
 *  - NO EM OR EN DASH. The founder rule. Two characters, not one: an en dash reads as an em dash
 *    at body size and every sweep in this repo that checked only `—` has missed `–` at least
 *    once.
 *  - NOTHING ACCUSATORY (`INTEGRITY_CONFIG.notices.accusatoryTerms`). Copy here explains what the
 *    PLATFORM did. It never suggests the member did something wrong, because the member is
 *    reading it at the moment they are least inclined to give us the benefit of the doubt.
 *  - NO PASSIVE CONSTRUCTION (`INTEGRITY_CONFIG.notices.passiveConstructions`). "Was removed",
 *    "was made", "is kept" all hide who did the thing, and the answer is always "we did".
 *  - NO CONTRACTION (C1, ruled — `docs/design-system.md`, "Copy"). "You do not have to wait
 *    here," never "You don't." This product tells people things about money, seats and fairness,
 *    and the expanded register is what keeps those sentences from reading as chat. Matches the
 *    closed set of English contractions (negation, `'re`/`'ve`/`'ll`/`'d`/`'m`, and the
 *    interrogative/pronoun `'s` forms) rather than every apostrophe-`s` in the language, so a
 *    genuine possessive ("the commissioner's note") is left alone. **One named exception**
 *    (`CONTRACTION_ALLOWLIST`): the just-seated heading, `` `${leagueName} · You're in` ``
 *    (`waiting-room.tsx`, D1) — recorded as a decision somebody made once, not a precedent the
 *    next writer generalizes from, so it is allowlisted by exact phrase rather than by loosening
 *    the rule.
 *  - NOTHING FROM THE FORBIDDEN VOCABULARY (C3, ruled). No surface invents "autopick,"
 *    "auto-draft," or "we will draft for you" — the one sanctioned phrase for the safety net is
 *    "the room picks for you from your queue," and every surface that reassures a member about
 *    missing a draft quotes it exactly.
 *
 * A rule about copy is only real if something checks the copy, which is why this returns every
 * violation rather than a boolean: a failing sweep should name the rule and the words that broke
 * it, not just go red.
 */
export interface CopyViolation {
  readonly rule: "dash" | "accusatory" | "passive" | "contraction" | "forbiddenVocabulary";
  readonly found: string;
}

const DASHES = /[—–]/g;

/**
 * The closed set of English contractions this house style expands, as one alternation:
 * negation (`isn't`, `can't`, ... `'t`), the four verb-elision suffixes on `I/you/we/they`, `I'm`,
 * and the `'s`/`'d` forms on the pronouns and interrogatives they actually attach to (`it's`,
 * `who's`, `there's`, `nobody's`, `that'd`, ...). Deliberately NOT `\w+'s` — that would also flag
 * every possessive in the product ("the league's median", "a manager's roster"), which C1 never
 * ruled on and this sweep has no business rewriting.
 */
const CONTRACTIONS =
  /\b(?:ain't|won't|shan't|(?:is|are|was|were|does|do|did|has|have|had|could|would|should|might|must|need|dare)n't|(?:I|you|we|they)'(?:re|ve|ll|d)|I'm|(?:it|that|this|there|here|what|who|where|when|why|how|let|nobody|somebody|everybody|everyone|someone|nothing|one)'(?:s|d)|y'all|ma'am|o'clock)\b/gi;

/**
 * The exact phrases the contraction sweep never flags. Subtracted from the text before the
 * `CONTRACTIONS` scan runs, so the allowlist is a string match rather than a second regex that
 * could drift out of sync with the first.
 */
const CONTRACTION_ALLOWLIST: readonly string[] = ["You're in"];

/**
 * C3's forbidden vocabulary family — the words this product's copy never invents for the
 * safety-net idea, because "the room picks for you from your queue" is the one sanctioned phrase
 * and a second name for the same idea is exactly the "two names for one idea" confusion the
 * first-timer persona flagged.
 */
const FORBIDDEN_VOCABULARY: readonly string[] = [
  "autopick",
  "auto-pick",
  "autodraft",
  "auto-draft",
  "auto draft",
  "we'll draft for you",
  "we will draft for you",
];

export function copyViolations(text: string): readonly CopyViolation[] {
  const lower = text.toLowerCase();
  const withoutAllowlisted = CONTRACTION_ALLOWLIST.reduce((acc, phrase) => acc.split(phrase).join(""), text);
  return [
    ...[...text.matchAll(DASHES)].map((match): CopyViolation => ({ rule: "dash", found: match[0] })),
    ...INTEGRITY_CONFIG.notices.accusatoryTerms
      .filter((term) => lower.includes(term))
      .map((term): CopyViolation => ({ rule: "accusatory", found: term })),
    ...INTEGRITY_CONFIG.notices.passiveConstructions
      .filter((phrase) => lower.includes(phrase))
      .map((phrase): CopyViolation => ({ rule: "passive", found: phrase })),
    ...[...withoutAllowlisted.matchAll(CONTRACTIONS)].map((match): CopyViolation => ({ rule: "contraction", found: match[0] })),
    ...FORBIDDEN_VOCABULARY.filter((term) => lower.includes(term)).map((term): CopyViolation => ({ rule: "forbiddenVocabulary", found: term })),
  ];
}
