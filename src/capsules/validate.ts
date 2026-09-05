import { BANNED_VOCABULARY, CAPSULE_CONFIG, COMPETITOR_NAMES, EM_DASH, SEMICOLON } from "./config";
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

/** In-name abbreviations that end in a period WITHOUT ending the candidate name (fix round 2,
 *  PART A, live full-board regeneration 2026-09-05) — "St." ("Amon-Ra St. Brown"), the short
 *  honorifics/suffixes it stands beside ("Jr.", "Sr.", "Mr.", "Mrs.", "Ms.", "Dr."), and a lone
 *  initial ("T." inside "T.J. Hockenson", matched separately by `INITIALS_PATTERN` below). Bare,
 *  i.e. with its own trailing period already stripped before the lookup. */
const IN_NAME_ABBREVIATIONS = new Set(["St", "Jr", "Sr", "Mr", "Mrs", "Ms", "Dr"]);

/** A chain of single-letter initials with their own periods ("T", "T.J", "T.J.K") — the OTHER
 *  in-name abbreviation shape `IN_NAME_ABBREVIATIONS` does not cover, since it is not a fixed
 *  word. Tested against the token with its OWN trailing period already stripped, exactly like
 *  `IN_NAME_ABBREVIATIONS` — "T.J." strips to "T.J", which this matches. */
const INITIALS_PATTERN = /^[A-Z](?:\.[A-Z])*$/;

/** A curated set of capitalized words that begin a NEW sentence and can never continue a name —
 *  pronouns, determiners, and common transition words (fix round 2 review, code review 2026-09-05:
 *  "Tyrone Tracy Jr. He is a stud" was over-merging into "Tyrone Tracy Jr. He"). Used ONLY to
 *  decide whether an in-name ABBREVIATION's period is also a sentence end — a real name-continuing
 *  word after an abbreviation ("St. Brown") is never in this list, so that case is unaffected. */
const COMMON_SENTENCE_STARTERS = new Set([
  "He", "She", "It", "They", "This", "That", "The", "A", "An", "His", "Her", "Their",
  "There", "But", "And", "Yet", "So", "Still", "Also", "However", "Meanwhile", "Now", "Then",
]);

function isInNameAbbreviation(bareWord: string): boolean {
  return IN_NAME_ABBREVIATIONS.has(bareWord) || INITIALS_PATTERN.test(bareWord);
}

/** True when the run must stop AFTER `word` — either `word` is an ordinary word ending a
 *  sentence (any trailing period that is not a sanctioned in-name abbreviation), or `word` IS an
 *  abbreviation ("Jr.", "St.", ...) but `nextWord` is a `COMMON_SENTENCE_STARTERS` word that
 *  cannot itself continue a name ("Jr. He", never "St. Brown"). `nextWord` is `null` when `word`
 *  is the last Titlecase token in the text. */
function isRunBreak(word: string, nextWord: string | null): boolean {
  if (!word.endsWith(".")) return false;
  const bare = word.slice(0, -1);
  if (!isInNameAbbreviation(bare)) return true;
  return nextWord !== null && COMMON_SENTENCE_STARTERS.has(nextWord);
}

/** True when `word`'s own trailing period is punctuation to be stripped from the emitted
 *  candidate, rather than part of the name. An abbreviation's period is NEVER stripped, even when
 *  `isRunBreak` also stopped the run right after it (fix round 2 review) — "Tyrone Tracy Jr." must
 *  still render with its period whether or not "He" followed it. */
function isPunctuationPeriod(word: string): boolean {
  if (!word.endsWith(".")) return false;
  return !isInNameAbbreviation(word.slice(0, -1));
}

/** Sequences of two-or-more consecutive Titlecase words — the shape a genuine proper name takes
 *  ("Justin Jefferson", "Kansas City"). A LONE capitalized word is left alone: ordinary sentence
 *  capitalization, a position abbreviation (`RB`) or a stray "Age 29" reads as a false positive
 *  far more often than it reads as a fabricated name, and a name-check that nukes every ordinary
 *  capsule into a template defeats the point of writing one at all.
 *
 * SENTENCE-BOUNDARY TOKENIZATION (fix round 2, PART A, live full-board regeneration 2026-09-05,
 * 454/659 template fallbacks) — the prior single regex treated a period as just another
 * name-internal character, so a legitimately ledgered name immediately followed by the NEXT
 * sentence's capitalized first word ("Tre Tucker. The", "Bijan Robinson. He") merged into one
 * candidate and failed grounding wholesale, even though "Tre Tucker" alone was perfectly honest.
 * `T.` never anchored the OLD regex's match either (its trailing `\b` could not close across a
 * period followed by whitespace), which meant "Tyrone Tracy Jr." silently matched as "Tyrone
 * Tracy Jr" — no trailing period — and then failed grounding against a ledger entry that DOES
 * carry the period (`facts.ts`'s `buildNameLedger` splits the name on whitespace verbatim).
 *
 * THE FIX: build candidates word-by-word instead of one regex. Two whitespace-adjacent Titlecase
 * tokens still join into the same run exactly as before (a non-whitespace separator, e.g. a
 * comma, still breaks the run — unchanged). The new rule (`isRunBreak`): a token ending in an
 * ordinary (non-abbreviation) period always stops the run there; a token ending in a sanctioned
 * in-name abbreviation's period ("Jr.", "St.", "T.") stops the run ONLY when the very next word is
 * a `COMMON_SENTENCE_STARTERS` word that could never continue a name — so "St. Brown" still joins
 * (`"Brown"` is not a sentence starter) while "Jr. He" still splits, in BOTH cases keeping the
 * abbreviation's own period in the rendered candidate (`isPunctuationPeriod` only ever strips a
 * TRUE sentence-ending period, never an abbreviation's). */
function extractProperNamePhrases(text: string): readonly string[] {
  const wordPattern = /\b[A-Z][a-zA-Z'.-]*/g;
  const words: { readonly text: string; readonly start: number; readonly end: number }[] = [];
  for (const match of text.matchAll(wordPattern)) words.push({ text: match[0], start: match.index, end: match.index + match[0].length });

  const phrases = new Set<string>();
  let i = 0;
  while (i < words.length) {
    const run = [words[i]!];
    let j = i;
    while (j + 1 < words.length && /^\s+$/.test(text.slice(words[j]!.end, words[j + 1]!.start)) && !isRunBreak(words[j]!.text, words[j + 1]!.text)) {
      run.push(words[j + 1]!);
      j += 1;
    }
    if (run.length >= 2) {
      const last = run[run.length - 1]!;
      const rendered = run.map((word, idx) => (idx === run.length - 1 && isPunctuationPeriod(last.text) ? word.text.slice(0, -1) : word.text));
      phrases.add(rendered.join(" "));
    }
    i = j + 1;
  }
  return [...phrases];
}

/** The one word-splitter every name/phrase comparison in this file uses (code review 2026-09-05,
 *  minor: `candidate.split(" ")` and `name.split(/\s+/)` had drifted apart) — a candidate is always
 *  built from single-space joins (`extractProperNamePhrases`), but a ledger entry is arbitrary
 *  input, so splitting on run of whitespace everywhere is the one rule that is correct for both. */
function splitWords(text: string): readonly string[] {
  return text.trim().split(/\s+/);
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
    const nameWords = splitWords(lowerName);
    const phraseWords = splitWords(lowerPhrase);
    if (phraseWords.length >= nameWords.length) return false;
    return nameWords.slice(nameWords.length - phraseWords.length).join(" ") === lowerPhrase;
  });
}

/**
 * A curated set of imperative sentence-starters that show up as the FIRST word of a fabricated
 * two-word candidate in fantasy-analyst prose ("Buy McCaffrey", "Fade St. Brown") — fix round 2,
 * PART B, live full-board regeneration 2026-09-05. None of these is ever a person's given name,
 * which is exactly why it is safe to gate the verb+lastname shorthand below on membership in this
 * list: an ACTUAL given name occupying that slot ("Marcus Long") is never in it, so that case
 * never reaches the shorthand branch at all and keeps failing exactly as CRITICAL 1 requires.
 *
 * THIS IS A CORRECTNESS PROPERTY, NOT JUST A WORD LIST (code review 2026-09-05, CRITICAL): the
 * reviewer's own executed probe found "Chase" — a common real NFL given name (Chase Brown, Chase
 * Claypool, Chase Edmonds) — sitting in this set, which let "Chase McCaffrey" false-pass against a
 * ledgered "Christian McCaffrey" exactly like the fabrication CRITICAL 1 exists to catch. "Chase"
 * is removed. EVERY entry below has been re-audited against real NFL given names as of this fix;
 * whoever adds a new one MUST do the same re-audit before committing it, and should re-check the
 * existing set whenever a word on it becomes a common given name in the league (names trend; this
 * list can silently rot). When in doubt, leave the word out — a missed imperative just falls back
 * to a template regeneration, never a fabrication passing as fact.
 */
const SENTENCE_VERB_WORDS = new Set([
  "Buy", "Sell", "Draft", "Target", "Avoid", "Fade", "Stash", "Trust", "Start", "Sit",
  "Take", "Grab", "Pick", "Rank", "Skip", "Pass", "Wait", "Roster", "Hold",
  "Bet", "Watch", "Ride", "Ditch", "Cut", "Drop", "Add", "Claim", "Rostering",
]);

/** True when `word` alone equals the trailing word of some MULTI-word ledger entry — the exact
 *  word-suffix relationship `isNameGrounded` already grants a full shorthand phrase ("St. Brown"
 *  as the tail of "Amon-Ra St. Brown"), narrowed here to a single lone word. Used ONLY by the
 *  verb+lastname branch in `isNameGroundedWithShedding`, and only once that branch has confirmed
 *  the word standing in front of `word` is a sentence verb, never a name — see that function's own
 *  docblock for why gating on `SENTENCE_VERB_WORDS` is what keeps this from reopening CRITICAL 1's
 *  bypass (a bare decomposed surname passing on its own). */
function isLoneWordSurnameOf(word: string, nameLedger: readonly string[]): boolean {
  const lowerWord = word.toLowerCase();
  return nameLedger.some((name) => {
    const nameWords = splitWords(name.toLowerCase());
    return nameWords.length >= 2 && nameWords[nameWords.length - 1] === lowerWord;
  });
}

/**
 * Sentence-initial capitalized verbs merge into a name's capitalized run ("Buy Jahmyr Gibbs",
 * "Draft St. Brown" — first live sweep, 2026-09-05), so a failed multi-word candidate sheds its
 * LEADING word and tries again. Fabrication-safe by construction: shedding only ever reduces the
 * candidate, and the reduced phrase still faces the same exact-or-suffix grounding — "Buy Justin
 * Herbert" sheds to "Justin Herbert", which fails for any other subject exactly as before.
 *
 * VERB + LASTNAME (fix round 2, PART B, live full-board regeneration 2026-09-05) — "Buy McCaffrey"
 * false-rejected with a ledgered "Christian McCaffrey": the floor below stops shedding at two
 * words on purpose (reducing to the single decomposed ledger fragment "McCaffrey" would reopen
 * CRITICAL 1's own bypass), so the ordinary shedding loop above never gets a chance to check the
 * bare surname alone. The floor stays exactly as strict for the general case; what changes is one
 * narrow, ADDITIONAL exit at the floor: when the candidate is still two words, its FIRST word is a
 * known sentence verb (never a name — `SENTENCE_VERB_WORDS`), and its SECOND word alone is a
 * word-suffix of some ledgered multi-word name (`isLoneWordSurnameOf`, the same suffix test
 * `isNameGrounded` already runs, just narrowed to one trailing word), the candidate grounds. A real
 * given name in the verb's slot ("Marcus Long") is never in `SENTENCE_VERB_WORDS`, so it never
 * reaches this exit and still fails exactly as before; an unledgered surname after a genuine verb
 * ("Buy Fakename") still finds no ledger entry ending in "fakename" and still fails too.
 */
function isNameGroundedWithShedding(phrase: string, nameLedger: readonly string[]): boolean {
  let candidate = phrase.trim();
  for (;;) {
    if (isNameGrounded(candidate, nameLedger)) return true;
    const words = splitWords(candidate);
    // Never shed below two words: a two-word candidate IS the name under test, and reducing it
    // to a single decomposed ledger fragment would reopen exactly the bypass CRITICAL 1 closed
    // ("Marcus Long" must never pass by shedding to "Long").
    if (words.length <= 2) {
      if (words.length === 2 && SENTENCE_VERB_WORDS.has(words[0]!) && isLoneWordSurnameOf(words[1]!, nameLedger)) return true;
      return false;
    }
    candidate = words.slice(1).join(" ");
  }
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

  if (trimmed.includes(SEMICOLON)) {
    violations.push("The text contains a semicolon. Split it into two sentences instead.");
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
    if (!isNameGroundedWithShedding(phrase, facts.nameLedger)) {
      violations.push(`The name "${phrase}" does not trace to any supplied fact.`);
    }
  }

  const requiredTension = strongestNegativeLawEffect(facts);
  if (requiredTension !== null && !citesTensionNumber(trimmed, requiredTension)) {
    violations.push(`Mixed evidence: the strongest downside (${requiredTension} pts/game) must be cited as an honest hesitation before the call.`);
  }

  return { ok: violations.length === 0, violations };
}
