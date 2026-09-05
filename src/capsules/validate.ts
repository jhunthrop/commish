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

/** `(?<![A-Za-z0-9])`/`(?![A-Za-z])` keep this from pulling the "6" out of "RB6" or the "12" out
 *  of "Q12" — a position/market-rank compound token is not a bare number, and validating its
 *  digits against the ledger would demand a `positionAdp`-style string be represented numerically
 *  too. The lookbehind ALSO excludes a preceding DIGIT (fix round 1, MEDIUM d) so the leading `-`
 *  in a range or a year span ("20-25 touches", "2023-2024") is never consumed as a sign: at the
 *  position right after "20", the previous character is a digit, so a match cannot START there,
 *  and the regex engine instead starts fresh at the digit right after the hyphen — "25", positive,
 *  never "-25". A genuine negative ("-1.8 a game") is untouched: the character before its `-` is
 *  a space, not alphanumeric, so the sign is still consumed normally. */
const NUMBER_TOKEN_PATTERN = /(?<![A-Za-z0-9])-?\d[\d,]*(?:\.\d+)?%?(?![A-Za-z])/g;

/** Spelled-out cardinals one through twenty (fix round 1, HIGH) — "he caught seven passes" is
 *  otherwise invisible to `extractNumbers`, which reads digits only. Capped at twenty: past that,
 *  analyst prose overwhelmingly reverts to digits ("he ran for 340 yards"), so there is no real
 *  coverage gap above it worth the false-positive risk of matching an ordinary sentence's stray
 *  number word in a longer list. */
const CARDINAL_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const CARDINAL_WORD_PATTERN = new RegExp(`\\b(${Object.keys(CARDINAL_WORDS).join("|")})\\b`, "gi");

/** Ordinals 1st through 30th (fix round 1, HIGH) — "his 3rd season", "in his 21st start". The
 *  leading `\b` already excludes a compound token ("RB21st" has no boundary between "B" and "2"),
 *  so this needs no separate digit-only guard the way `NUMBER_TOKEN_PATTERN` does. */
const ORDINAL_PATTERN = /\b([1-9]|1[0-9]|2[0-9]|30)(st|nd|rd|th)\b/gi;

function extractNumbers(text: string): readonly { readonly raw: string; readonly value: number }[] {
  const digitMatches = text.match(NUMBER_TOKEN_PATTERN) ?? [];
  const digitNumbers = digitMatches
    .map((raw) => ({ raw, value: Number(raw.replace(/,/g, "").replace(/%$/, "")) }))
    .filter((n) => Number.isFinite(n.value));

  const cardinalNumbers = [...text.matchAll(CARDINAL_WORD_PATTERN)].map((match) => ({ raw: match[0], value: CARDINAL_WORDS[match[1]!.toLowerCase()]! }));
  const ordinalNumbers = [...text.matchAll(ORDINAL_PATTERN)].map((match) => ({ raw: match[0], value: Number(match[1]) }));

  return [...digitNumbers, ...cardinalNumbers, ...ordinalNumbers];
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

/**
 * NAME GROUNDING (fix round 1, CRITICAL 1) — a REAL security-shaped bug in the prior version:
 * `nameLedger` decomposes a full name into its individual words ("Rashad Long" → also "Rashad",
 * "Long") so a capsule can say "Long" alone and still be honest, and it carries the player's OWN
 * position/team as single-word entries too ("RB", "SF"). The prior check was bidirectional
 * substring containment against every ledger entry regardless of word count, which meant a
 * two-word FABRICATED name passed the moment it merely CONTAINED — or was contained by — any
 * ledger fragment. Two ways that bit: a decomposed single word licensing an entirely different
 * two-word phrase ("Marcus Long" passing because "Long" is in the ledger), and a short
 * position/team code appearing as a coincidental SUBSTRING inside a fabricated name's letters
 * ("Justin Herbert" passing because "RB" — the subject's own position — is a substring of
 * "heRBert").
 *
 * THE FIX: a multi-word candidate phrase must EXACT-MATCH (case-insensitive, whole phrase) a
 * multi-word ledger entry — never a substring in either direction, and never built from
 * decomposed single words. A single-word candidate may still match a single-word ledger entry
 * (kept for the day `extractProperNamePhrases` widens to single-word candidates; nothing in this
 * engine emits one today, since a lone capitalized word is deliberately left unchecked — see that
 * function's own docblock). This engine only ever has ONE person's full name in the ledger (the
 * subject himself), so a genuinely different two-word name — a fabricated teammate, a coach, a
 * rival — can never exact-match and is correctly caught.
 */
function isNameGrounded(phrase: string, nameLedger: readonly string[]): boolean {
  // Re-review round 2 (availability, not fabrication): honest prose about the SUBJECT uses
  // possessives ("Herbert's arm") and surname shorthand for multi-part surnames ("St. Brown"
  // for "Amon-Ra St. Brown"). A possessive is stripped before comparison, and a multi-word
  // candidate may match as the exact TRAILING WORDS of a ledger entry — a word-suffix test,
  // never a substring test, so "Marcus Long" still cannot ride "Rashad Long", and a fabricated
  // possessive still fails with its name.
  const cleaned = phrase.trim().replace(/[’']s?$/i, "");
  const isMultiWord = cleaned.includes(" ");
  const lowerPhrase = cleaned.toLowerCase();
  return nameLedger.some((name) => {
    const nameIsMultiWord = name.trim().includes(" ");
    if (isMultiWord !== nameIsMultiWord) return false;
    const lowerName = name.toLowerCase();
    if (lowerName === lowerPhrase) return true;
    // Word-suffix shorthand: the candidate's words must equal the ledger entry's LAST N words,
    // and only for entries longer than the candidate (a two-word ledger entry offers no
    // shorthand a two-word candidate would need).
    if (!nameIsMultiWord || !isMultiWord) return false;
    const nameWords = lowerName.split(" ");
    const phraseWords = lowerPhrase.split(" ");
    if (phraseWords.length >= nameWords.length) return false;
    return nameWords.slice(nameWords.length - phraseWords.length).join(" ") === lowerPhrase;
  });
}

/** Simple inflections of a single-word banned term (fix round 1, LOW) — "GOATed" is otherwise
 *  invisible to a bare `\bgoat\b`, since a plain word boundary sits between "t" and "e" only when
 *  nothing follows "goat" at all. Deliberately narrow (s/d/ed/ing) rather than a general stemmer:
 *  wide enough to catch the realistic case, not so wide it starts matching an unrelated word that
 *  merely shares a prefix. */
function containsBannedVocabulary(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of BANNED_VOCABULARY) {
    const pattern = /^[a-z]+$/.test(term) ? new RegExp(`\\b${term}(?:s|d|ed|ing)?\\b`, "i") : null;
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
 *  real injury/availability language somewhere in the same text, or this fails it.
 *
 *  KNOWN LIMIT, ACCEPTED (fix round 1, LOW 3): the injury/availability word need only appear
 *  ANYWHERE in the text, not in the same sentence as "floor" — a capsule could in principle say
 *  "floor of 91" in one sentence and mention an unrelated injury elsewhere and still clear this
 *  check. Tightening to same-sentence proximity is a real improvement but a low-value one against
 *  the actual failure mode this exists to catch (a bare, unexplained floor claim with NO injury
 *  language anywhere), so it is left as a document limitation rather than built. */
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

/** A cost-cue word — "this costs him 1.8 a game", "down 1.8 a game", "shaves 1.8 off his ceiling".
 *  Naive sentence split on `.`/`!`/`?` — good enough to scope the unsigned-magnitude allowance
 *  (below) to the SAME clause the cue word appears in, rather than the whole capsule. */
const COST_CUE_PATTERN = /\b(costs?|minus|down|shaves?)\b/i;

function splitSentences(text: string): readonly string[] {
  return text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== "");
}

/** Fix round 1, LOW 2 — a signed citation ("-1.8") always satisfies the tension mandate; an
 *  UNSIGNED one ("1.8") also satisfies it, but ONLY in a sentence that also carries an explicit
 *  cost-cue word, since "he averaged 1.8 yards" and "this costs him 1.8 a game" read very
 *  differently and only the second is an honest hesitation about the SAME downside. */
function citesTensionNumber(text: string, requiredTension: number): boolean {
  if (extractNumbers(text).some(({ value }) => isDerivedFromLedger(value, [requiredTension]))) return true;
  const magnitude = Math.abs(requiredTension);
  return splitSentences(text).some((sentence) => COST_CUE_PATTERN.test(sentence) && extractNumbers(sentence).some(({ value }) => isDerivedFromLedger(Math.abs(value), [magnitude])));
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
    if (!isNameGrounded(phrase, facts.nameLedger)) {
      violations.push(`The name "${phrase}" does not trace to any supplied fact.`);
    }
  }

  const requiredTension = strongestNegativeLawEffect(facts);
  if (requiredTension !== null && !citesTensionNumber(trimmed, requiredTension)) {
    violations.push(`Mixed evidence: the strongest downside (${requiredTension} pts/game) must be cited as an honest hesitation before the call.`);
  }

  return { ok: violations.length === 0, violations };
}
