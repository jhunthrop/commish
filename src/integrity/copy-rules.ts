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
 * The three rules, and why each is mechanical rather than a review note:
 *
 *  - NO EM OR EN DASH. The founder rule. Two characters, not one: an en dash reads as an em dash
 *    at body size and every sweep in this repo that checked only `—` has missed `–` at least
 *    once.
 *  - NOTHING ACCUSATORY (`INTEGRITY_CONFIG.notices.accusatoryTerms`). Copy here explains what the
 *    PLATFORM did. It never suggests the member did something wrong, because the member is
 *    reading it at the moment they are least inclined to give us the benefit of the doubt.
 *  - NO PASSIVE CONSTRUCTION (`INTEGRITY_CONFIG.notices.passiveConstructions`). "Was removed",
 *    "was made", "is kept" all hide who did the thing, and the answer is always "we did".
 *
 * A rule about copy is only real if something checks the copy, which is why this returns every
 * violation rather than a boolean: a failing sweep should name the rule and the words that broke
 * it, not just go red.
 */
export interface CopyViolation {
  readonly rule: "dash" | "accusatory" | "passive";
  readonly found: string;
}

const DASHES = /[—–]/g;

export function copyViolations(text: string): readonly CopyViolation[] {
  const lower = text.toLowerCase();
  return [
    ...[...text.matchAll(DASHES)].map((match): CopyViolation => ({ rule: "dash", found: match[0] })),
    ...INTEGRITY_CONFIG.notices.accusatoryTerms
      .filter((term) => lower.includes(term))
      .map((term): CopyViolation => ({ rule: "accusatory", found: term })),
    ...INTEGRITY_CONFIG.notices.passiveConstructions
      .filter((phrase) => lower.includes(phrase))
      .map((phrase): CopyViolation => ({ rule: "passive", found: phrase })),
  ];
}
