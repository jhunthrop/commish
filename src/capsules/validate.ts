import { BANNED_VOCABULARY, CAPSULE_CONFIG, COMPETITOR_NAMES, EM_DASH } from "./config";
import type { PlayerFacts } from "./facts";

export type CapsuleSize = "compact" | "full";

export interface ValidationResult {
  readonly ok: boolean;
  /** Human-readable, quoted verbatim into the one regeneration retry's own prompt — see
   *  `write.ts`'s `generateCapsuleBody`. Empty when `ok`. */
  readonly violations: readonly string[];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

/** Every roughly-decimal number token in `text` — `%`/comma-stripped, sign kept. Deliberately
 *  permissive (a false EXTRA match just gets checked against the ledger and either clears it or
 *  fails the capsule into a regeneration, never the other way around). */
/** `(?<![A-Za-z])`/`(?![A-Za-z])` keep this from pulling the "6" out of "RB6" or the "12" out of
 *  "Q12" — a position/market-rank compound token is not a bare number, and validating its digits
 *  against the ledger would demand a `positionAdp`-style string be represented numerically too. */
const NUMBER_TOKEN_PATTERN = /(?<![A-Za-z])-?\d[\d,]*(?:\.\d+)?%?(?![A-Za-z])/g;

function extractNumbers(text: string): readonly { readonly raw: string; readonly value: number }[] {
  const matches = text.match(NUMBER_TOKEN_PATTERN) ?? [];
  return matches.map((raw) => ({ raw, value: Number(raw.replace(/,/g, "").replace(/%$/, "")) })).filter((n) => Number.isFinite(n.value));
}

/** `value` is an honest reading of some entry in `ledger` when it equals that entry, or a
 *  plain rounding of it, at any of a few common precisions — "a fabricated number is caught; a
 *  rounded one passes" is the explicit bar this function exists to clear. */
function isDerivedFromLedger(value: number, ledger: readonly number[]): boolean {
  for (const entry of ledger) {
    if (value === entry) return true;
    if (Math.round(entry) === value) return true;
    if (Math.trunc(entry) === value) return true;
    if (Math.ceil(entry) === value) return true;
    if (Math.floor(entry) === value) return true;
    if (Number(entry.toFixed(1)) === value) return true;
    if (Number(entry.toFixed(2)) === value) return true;
  }
  return false;
}

/** Sequences of two-or-more consecutive Titlecase words — the shape a genuine proper name takes
 *  ("Justin Jefferson", "Kansas City"). A LONE capitalized word is left alone: ordinary sentence
 *  capitalization, a position abbreviation (`RB`) or a stray "Age 29" reads as a false positive
 *  far more often than it reads as a fabricated name, and a name-check that nukes every ordinary
 *  capsule into a template defeats the point of writing one at all. */
function extractProperNamePhrases(text: string): readonly string[] {
  const matches = text.match(/\b[A-Z][a-zA-Z'.-]*(?:\s+[A-Z][a-zA-Z'.-]*)+\b/g) ?? [];
  return [...new Set(matches)];
}

function containsBannedVocabulary(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of BANNED_VOCABULARY) {
    const pattern = /^[a-z]+$/.test(term) ? new RegExp(`\\b${term}\\b`, "i") : null;
    const hit = pattern !== null ? pattern.test(text) : lower.includes(term.toLowerCase());
    if (hit) return term;
  }
  return null;
}

function containsCompetitorName(text: string): string | null {
  const lower = text.toLowerCase();
  for (const name of COMPETITOR_NAMES) if (lower.includes(name)) return name;
  return null;
}

/** THE BANNED FRAMING (founder ruling, 2026-09-04): "calling the p10 'his floor' without the
 *  injury context (a bare 'floor of 91' reads as a talent claim; it is an availability fact)."
 *  `render.ts` never uses the word at all (it frames the low tail as "the injury seasons"
 *  directly), so any capsule that says "floor" is EITHER quoting the fact sheet's own vocabulary
 *  it was told not to, or introducing the word on its own — either way it must pair the word with
 *  real injury/availability language somewhere in the same text, or this fails it. */
function hasUnframedFloorClaim(text: string): boolean {
  if (!/\bfloor\b/i.test(text)) return false;
  return !/injur|missed time|games missed|availability/i.test(text);
}

/**
 * THE MANDATED-TENSION CHECK (founder, live-fire review) — a capsule may never be a one-sided
 * rave on genuinely mixed evidence. When `facts.evidence` carries a "law" item whose own
 * `|netEffectPoints|` is at or above `CAPSULE_CONFIG.tensionThresholdPoints` AND is negative, the
 * STRONGEST such item's own number must appear (exactly or as an honest rounding — the same test
 * `isDerivedFromLedger` runs) somewhere in the output before this function will call the capsule
 * honest. No negative group above the threshold means nothing to require — a genuinely one-sided
 * case gets a one-sided capsule.
 */
function strongestNegativeLawEffect(facts: PlayerFacts): number | null {
  const negatives = facts.evidence
    .filter((item): item is Extract<PlayerFacts["evidence"][number], { kind: "law" }> => item.kind === "law" && item.netEffectPoints < 0)
    .filter((item) => Math.abs(item.netEffectPoints) >= CAPSULE_CONFIG.tensionThresholdPoints);
  if (negatives.length === 0) return null;
  return negatives.reduce((strongest, item) => (Math.abs(item.netEffectPoints) > Math.abs(strongest) ? item.netEffectPoints : strongest), negatives[0]!.netEffectPoints);
}

/**
 * THE VALIDATOR — the law's own enforcement arm (spec's hard rule: "honest data absolute; the
 * validator is the law's enforcement arm"). Every number and every multi-word proper name in
 * `body` must trace to `facts`; the copy rules bind (no em-dash, no competitor name, the size's
 * own word band); and mixed evidence must carry its own tension before the call. `size` picks
 * which word band applies (`CAPSULE_CONFIG.sizes`).
 */
export function validateCapsule(body: string, facts: PlayerFacts, size: CapsuleSize): ValidationResult {
  const violations: string[] = [];
  const trimmed = body.trim();

  if (trimmed === "") {
    return { ok: false, violations: ["The completion was empty."] };
  }

  const { minWords, maxWords } = CAPSULE_CONFIG.sizes[size];
  const words = wordCount(trimmed);
  if (words < minWords || words > maxWords) {
    violations.push(`Word count ${words} is outside the required ${minWords}-${maxWords} word band.`);
  }

  if (trimmed.includes(EM_DASH)) {
    violations.push("The text contains an em-dash. Rewrite without one.");
  }

  const bannedTerm = containsBannedVocabulary(trimmed);
  if (bannedTerm !== null) {
    violations.push(`The text uses the banned term "${bannedTerm}". Rewrite without it.`);
  }

  const competitor = containsCompetitorName(trimmed);
  if (competitor !== null) {
    violations.push(`The text names a competitor product ("${competitor}"). Remove it.`);
  }

  if (hasUnframedFloorClaim(trimmed)) {
    violations.push('The text says "floor" without pairing it with injury/availability context. The low tail is an availability fact, not a talent claim.');
  }

  for (const { raw, value } of extractNumbers(trimmed)) {
    if (!isDerivedFromLedger(value, facts.numberLedger)) {
      violations.push(`The number "${raw}" does not trace to any supplied fact.`);
    }
  }

  for (const phrase of extractProperNamePhrases(trimmed)) {
    const grounded = facts.nameLedger.some((name) => phrase.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(phrase.toLowerCase()));
    if (!grounded) violations.push(`The name "${phrase}" does not trace to any supplied fact.`);
  }

  const requiredTension = strongestNegativeLawEffect(facts);
  if (requiredTension !== null) {
    const cited = extractNumbers(trimmed).some(({ value }) => isDerivedFromLedger(value, [requiredTension]));
    if (!cited) violations.push(`Mixed evidence: the strongest downside (${requiredTension} pts/game) must be cited as an honest hesitation before the call.`);
  }

  return { ok: violations.length === 0, violations };
}
