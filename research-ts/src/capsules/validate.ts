import { BANNED_VOCABULARY, CAPSULE_CONFIG, COMPETITOR_NAMES, COMPETITOR_NAMES_THAT_ARE_WORDS, COMPETITOR_PRODUCT_CUES, EM_DASH, SEMICOLON, TRADING_REPLACEMENTS } from "./config";
import type { PlayerFacts } from "./facts";
import { NARRATIVE_MIN_WORDS } from "./narrative-slots";
import { extractNumbers, isDerivedFromLedger, isLooseReadingOf, promptNumbers, roundHalfUp } from "./number-grounding";
import { renderFactsForModel } from "./render";
import { voiceRuleHits, type VoiceRuleHit } from "./voice-rules";

export type CapsuleSize = "compact" | "full";

export interface ValidationResult {
  readonly ok: boolean;
  /** Human-readable, quoted verbatim into the one regeneration retry's own prompt — see
   *  `write.ts`'s `generateCapsuleBody`. Empty when `ok`. */
  readonly violations: readonly string[];
  /**
   * SET EXACTLY WHEN THE ONLY THING WRONG IS THE LENGTH (capsule acceptance round, 2026-09-07).
   * Nine of a thirty-player sample failed on the word band alone, most of them by a handful of
   * words, and the retry threw the whole text away and asked for a fresh one, which then failed on
   * something else. A length failure has a cheaper and far more reliable answer: hand the text
   * back and ask for the same text at the right length. `generate.ts` reads this to choose.
   */
  readonly bandFailure: { readonly words: number; readonly minWords: number; readonly maxWords: number } | null;
}

/** The one word count every band, attempt log and acceptance tally is measured by. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
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
  // The subordinating openers (acceptance round, task 10: "When Atlanta" failed as a person).
  // None of these is ever a given name, which is the property the whole list turns on.
  "When", "Where", "While", "If", "After", "Before", "Once", "Since", "Because", "Until", "Whenever",
  // The determiners and question words a call opens on (written rate round, 2026-09-08: "Every
  // Walker" and "What I" failed as people).
  "Every", "Each", "What", "Which", "Whether",
]);

/** THE FIRST PERSON (written rate round, 2026-09-08): "What I", "If I" and "What I'd" were failing
 *  as two-word people. "I", in any contraction, is a word a writer says about himself and is never
 *  half a name, so it breaks a Titlecase run the way a position code does. */
const FIRST_PERSON_PATTERN = /^I(?:['’][a-z]+)?$/;

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

/**
 * POSITION AND SLOT CODES ARE WORDS, NOT NAME PARTS (capsule acceptance round, 2026-09-07). "He's
 * QB" was read as the two-word proper name "He QB" once the contraction was split, and failed
 * grounding as a fabricated person. A code in this set breaks a Titlecase run exactly the way a
 * comma does, so it can never join the word beside it into a name.
 */
const POSITION_CODES: ReadonlySet<string> = new Set([
  "QB", "RB", "WR", "TE", "K", "DEF", "DST", "FLEX", "ADP", "PPR", "NFL", "TD", "TDS",
  // THE INJURY DESIGNATIONS (acceptance round, task 10) — the fact sheet prints "designation Q as
  // of ...", and a capsule writing "the Q designation" was failing as the two-word person "The Q".
  // These are report codes; a code is a word, and a word is never half a name.
  "Q", "O", "D", "IR", "PUP", "NFI", "SUSP", "DNP", "LP", "FP",
]);

/** A code, or its plural ("WRs", "RBs" — written rate round, 2026-09-08: "Past WRs" failed as a
 *  person), with any trailing period stripped. */
function isPositionCode(bare: string): boolean {
  const code = bare.toUpperCase().replace(/\.$/, "");
  return POSITION_CODES.has(code) || (code.endsWith("S") && POSITION_CODES.has(code.slice(0, -1)));
}

/** The possessive or contraction a Titlecase token may carry ("Herbert's", "He's", "Mahomes’"),
 *  stripped before the token is considered as part of a name — the apostrophe inside a genuine
 *  name ("Ja'Marr", "De'Von") is untouched, since it is never at the end. */
function stripTrailingClitic(word: string): string {
  return word.replace(/[’']s$/i, "").replace(/[’']$/, "");
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
  const wordPattern = /\b[A-Z][a-zA-Z'’.-]*/g;
  const words: { readonly text: string; readonly start: number; readonly end: number }[] = [];
  for (const match of text.matchAll(wordPattern)) {
    // The contraction goes before the run is built, and a position code never joins a run at all
    // (see `POSITION_CODES` and `stripTrailingClitic`).
    const bare = stripTrailingClitic(match[0]);
    if (bare === "" || isPositionCode(bare) || DESIGNATIONS.has(bare.replace(/\.$/, "")) || FIRST_PERSON_PATTERN.test(bare)) continue;
    words.push({ text: bare, start: match.index, end: match.index + match[0].length });
  }

  const phrases = new Set<string>();
  let i = 0;
  while (i < words.length) {
    const run = [words[i]!];
    let j = i;
    // `text.slice(...)` between two kept tokens contains the dropped code when one sat between
    // them, so the whitespace-only test below also enforces "nothing was dropped in between".
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
  "Take", "Grab", "Pick", "Rank", "Pass", "Wait", "Roster", "Hold",
  "Bet", "Watch", "Ride", "Ditch", "Cut", "Drop", "Add", "Claim", "Rostering",
  // Lane 303 (B306): the call's imperatives before a surname ("Keep Engram", "Leave Rudolph").
  "Keep", "Leave", "Bench", "Play",
]);

/** Lane 303 (B306): an injury designation is a word of the report, never half a name ("He's
 *  Questionable" was read as the person "He Questionable"); it breaks a Titlecase run as a code does.
 *  So "Fakename Out" leaves the lone surname "Fakename", which is never checked: the lone-word policy
 *  of `extractProperNamePhrases` (a lower-case "out" never joined a run either), no new class (the
 *  Lane 303 review's L4). */
const DESIGNATIONS: ReadonlySet<string> = new Set(["Questionable", "Doubtful", "Out", "Probable"]);

/** True when `word` alone equals the trailing word of some MULTI-word ledger entry — the exact
 *  word-suffix relationship `isNameGrounded` already grants a full shorthand phrase ("St. Brown"
 *  as the tail of "Amon-Ra St. Brown"), narrowed here to a single lone word. Used ONLY by the
 *  verb+lastname branch in `isNameGroundedWithShedding`, and only once that branch has confirmed
 *  the word standing in front of `word` is a sentence verb, never a name — see that function's own
 *  docblock for why gating on `SENTENCE_VERB_WORDS` is what keeps this from reopening CRITICAL 1's
 *  bypass (a bare decomposed surname passing on its own). */
function isLoneWordSurnameOf(word: string, nameLedger: readonly string[]): boolean {
  const lowerWord = word.toLowerCase();
  // ANY WORD AFTER THE FIRST, not only the last (written rate round, 2026-09-08): "Take Cook" was
  // failing against "James Cook III", whose last word is the suffix. Still gated on the verb in
  // front, so a given name in that slot never reaches this test.
  return nameLedger.some((name) => {
    const nameWords = splitWords(name.toLowerCase());
    return nameWords.length >= 2 && nameWords.slice(1).includes(lowerWord);
  });
}

/** True when `word` alone IS a ledger entry — the ledger decomposes every name and team form it
 *  carries into its own words (`facts.ts`'s `buildNameLedger`), so "Giants" is an entry in its own
 *  right for a player whose team is the Giants. Used only by the determiner exit below. */
function isLedgeredWord(word: string, nameLedger: readonly string[]): boolean {
  const lower = word.toLowerCase();
  return nameLedger.some((name) => name.toLowerCase() === lower);
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
      // DETERMINER + LEDGERED WORD (capsule acceptance round, 2026-09-07) — "The Giants lean on
      // him" merged a sentence-initial determiner into the team nickname the fact sheet had just
      // given the writer, and failed as a fabricated two-word name. The exit is as narrow as the
      // verb one above and safe for the same reason: `COMMON_SENTENCE_STARTERS` holds determiners
      // and pronouns, never a given name, and the SECOND word must still be a whole ledger entry
      // in its own right, so "The Herbert" grounds nothing.
      if (words.length === 2 && COMMON_SENTENCE_STARTERS.has(words[0]!) && isLedgeredWord(words[1]!, nameLedger)) return true;
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
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A single word is matched whole with its plain inflections; a phrase is matched as written. */
function bannedTermPattern(term: string): RegExp {
  return /^[a-z]+$/.test(term) ? new RegExp(`\\b${term}(?:s|d|ed|ing)?\\b`, "i") : new RegExp(escapeForPattern(term), "i");
}

export function bannedTermIn(text: string): string | null {
  for (const term of BANNED_VOCABULARY) if (bannedTermPattern(term).test(text)) return term;
  return null;
}

/** The first sentence of `text` carrying `term`, for the violation to quote. */
function sentenceCarrying(text: string, term: string): string {
  const pattern = bannedTermPattern(term);
  return splitSentences(text).find((sentence) => pattern.test(sentence)) ?? text;
}

/** The drafting phrases a trading word is corrected to, or `null` for a banned word that is not a
 *  trading word (the lab-report and all-time terms have no one replacement, only the rule). */
function tradingReplacementFor(term: string): readonly string[] | null {
  return TRADING_REPLACEMENTS[term] ?? null;
}

function quoted(phrases: readonly string[]): string {
  return phrases.map((phrase) => `"${phrase}"`).join(", ");
}

/** The violation's own shape, read back by `tradingWordCorrectionFor`: the term, then the
 *  sentence it sits in (quoted, up to the remedy that follows the closing quote). */
const BANNED_TERM_VIOLATION_PATTERN = /^The text uses the banned term "([^"]+)" in the sentence "(.+)"\. (?:Rewrite without it\.|Say it in drafting words instead)/;

/**
 * THE REPLACEMENT RIDES WITH THE VIOLATION (production follow-up, 2026-09-08). "Rewrite without it"
 * is the rule; a trading word's violation also names the drafting phrase for the word it found, so
 * both correction paths (the soft one below and a from-scratch rewrite quoting the violations) hand
 * the writer the words to use rather than only the word not to.
 *
 * AND THE SENTENCE RIDES WITH IT TOO (written rate round, 2026-09-08). One soft correction of seven
 * in the dev run fixed its other point and returned "the wrinkle nobody can price yet" unchanged:
 * told only that the text used "price", the writer did not find it. The violation quotes the
 * sentence, so both correction paths point at it.
 */
function bannedTermViolation(term: string, text: string): string {
  const replacement = tradingReplacementFor(term);
  const remedy = replacement === null ? "Rewrite without it." : `Say it in drafting words instead: ${quoted(replacement)}.`;
  return `The text uses the banned term "${term}" in the sentence "${sentenceCarrying(text, term)}". ${remedy}`;
}

const PRODUCT_CUE_AFTER = new RegExp(`^(?:['’]s)?\\s+(?:${COMPETITOR_PRODUCT_CUES.join("|")})\\b`, "i");
const ON_BEFORE = /\bon\s+$/i;
/** Opening quotes and brackets that sit between a sentence's end and its first word. */
const SENTENCE_OPENERS = /[\s"'“‘(]+$/;

/** True when the text before `index` ends a sentence (or is the start of the text), so the word at
 *  `index` is capitalised because every sentence's first word is. */
function atSentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(SENTENCE_OPENERS, "");
  return before === "" || /[.!?]$/.test(before);
}

/**
 * "SLEEPER" THE WORD VERSUS SLEEPER THE APP (written rate round, 2026-09-08). A competitor whose
 * name is an English word (`COMPETITOR_NAMES_THAT_ARE_WORDS`) is the product only when the prose
 * treats it as one: capitalised anywhere but a sentence start, followed by a product cue ("sleeper
 * league", "Sleeper's ADP"), or preceded by "on" ("on sleeper"). "A sleeper" and "an underdog" are
 * the fantasy words the writer is asked for and pass.
 */
function isProductReference(text: string, name: string): boolean {
  const pattern = new RegExp(`\\b${name}\\b`, "gi");
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    const capitalised = /^[A-Z]/.test(match[0]);
    if (capitalised && !atSentenceStart(text, index)) return true;
    if (PRODUCT_CUE_AFTER.test(text.slice(index + match[0].length))) return true;
    if (ON_BEFORE.test(text.slice(0, index))) return true;
  }
  return false;
}

function containsCompetitorName(text: string): string | null {
  const lower = text.toLowerCase();
  for (const name of COMPETITOR_NAMES) {
    if (COMPETITOR_NAMES_THAT_ARE_WORDS.includes(name)) {
      if (isProductReference(text, name)) return name;
    } else if (lower.includes(name)) return name;
  }
  return null;
}

/** THE BANNED FRAMING (founder ruling, 2026-09-04): "calling the p10 'his floor' without the
 *  injury context (a bare 'floor of 91' reads as a talent claim; it is an availability fact)."
 *  `render.ts` never uses the word at all (it frames the low tail as "the injury seasons"
 *  directly), so any capsule that says "floor" is EITHER quoting the fact sheet's own vocabulary
 *  it was told not to, or introducing the word on its own — either way it must pair the word with
 *  real injury/availability language somewhere in the same text, or this fails it.
 *
 *  AND A FLOOR IS ONLY BARE WITH A NUMBER ON IT (iteration 3: still 62 rejections of the whole
 *  hundred, the top read-side cause by a distance). The founder's ruling is about the p10 restated
 *  as a talent claim, which is a floor with a FIGURE beside it. "He has a high floor" carries no
 *  figure, states no p10, and is a thing every analyst alive says about a role. The check now
 *  fires on a floor sentence that carries a number and no availability language anywhere, which is
 *  the sentence the ruling actually names.
 *
 *  THE VOCABULARY WAS THE BUG (acceptance round, task 10, iteration 2: 29 of 48 sizes died on this
 *  one rule). The check accepted four phrasings, and the model writes the idea a dozen ways: "the
 *  games he misses", "if he stays healthy", "durability", "sidelined". Every one of those frames
 *  the low end as availability exactly as the rule intends, and every one of them was being failed.
 *  `AVAILABILITY_LANGUAGE` is the widened list; the rule itself is unchanged, and a bare "floor of
 *  91" with no availability language anywhere still fails.
 *
 *  KNOWN LIMIT, ACCEPTED (fix round 1, LOW 3): the injury/availability word need only appear
 *  ANYWHERE in the text, not in the same sentence as "floor" — a capsule could in principle say
 *  "floor of 91" in one sentence and mention an unrelated injury elsewhere and still clear this
 *  check. Tightening to same-sentence proximity is a real improvement but a low-value one against
 *  the actual failure mode this exists to catch (a bare, unexplained floor claim with NO injury
 *  language anywhere), so it is left as a document limitation rather than built. */
const AVAILABILITY_LANGUAGE =
  /injur|health|hurt|miss(?:es|ed|ing)?\s+(?:time|games?|weeks?|snaps?)|games?\s+(?:he\s+)?miss|availab|durab|absen|sidelin|out for|stay(?:s|ing)? on the field|on the field for all/i;

function hasUnframedFloorClaim(text: string): boolean {
  const sentences = splitSentences(text).filter((sentence) => /\bfloor\b/i.test(sentence));
  if (sentences.length === 0) return false;
  if (AVAILABILITY_LANGUAGE.test(text)) return false;
  // A BARE FLOOR is a floor with a NUMBER on it. "He has a high floor" is an ordinary thing an
  // analyst says about a role; "his floor is 178" is the p10 restated as a talent claim, and the
  // founder's ruling names exactly that one ("a bare 'floor of 91' reads as a talent claim").
  return sentences.some((sentence) => /\d/.test(sentence));
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
  // SIGNED ONLY on this branch (`allowMagnitude: false`) — the mandate is satisfied outright by a
  // SIGNED citation, and by an unsigned one only inside a cost-cue sentence (the branch below).
  // The general number check grants an unsigned magnitude everywhere, because "costs him 10.9" is
  // an honest reading of -10.9; letting that same allowance satisfy the MANDATE would let a rave
  // cite the bare magnitude of its own downside as though it were a positive stat, which is
  // exactly the bypass `probe3` pins closed.
  if (extractNumbers(text).some(({ value }) => isDerivedFromLedger(value, [requiredTension], false))) return true;
  const magnitude = Math.abs(requiredTension);
  return splitSentences(text).some((sentence) => COST_CUE_PATTERN.test(sentence) && extractNumbers(sentence).some(({ value }) => isDerivedFromLedger(Math.abs(value), [magnitude])));
}

/**
 * WHAT A TEXT IS GRADED AGAINST — the seam any writer grounds through. A capsule read is grounded
 * on a player's facts (`groundingOf`); a second writer hands the same shape in (its own number and
 * name ledgers plus the sheet it was prompted with), so "anything the prompt renders is quotable"
 * holds for either without the validator knowing whose prompt it was. The draft advisor no longer
 * writes prose (spec section 7), so the capsule writer is the one caller today.
 */
export interface GroundingSource {
  readonly numberLedger: readonly number[];
  readonly nameLedger: readonly string[];
  /** The rendered prompt the text was written from. Its numbers are quotable by construction. */
  readonly promptText: string;
  /** The strongest downside, cited when a band mandates tension. Null when nothing mandates it. */
  readonly tension: number | null;
}

/** A narrative slot never carries the tension mandate, so its source never needs one. */
export type NarrativeGrounding = Omit<GroundingSource, "tension">;

/** A player's facts as the validator reads them: the ledgers, the rendered sheet, the downside. */
export function groundingOf(facts: PlayerFacts): GroundingSource {
  return {
    numberLedger: facts.numberLedger,
    nameLedger: facts.nameLedger,
    promptText: renderFactsForModel(facts),
    tension: strongestNegativeLawEffect(facts),
  };
}

/**
 * THE TWO SOFT RULES (acceptance round, task 10) — the violations that say a sentence is framed
 * wrongly rather than that it states something untrue.
 *
 * 71 of 100 players in a live run were failing on "floor", and every one of them was prose the
 * founder would have accepted with one clause changed. A rule that rejects that much honest
 * writing is a rule being enforced at the wrong moment: the fix is to hand the text back with the
 * rule stated and let the writer correct it, and to fall to the template only if he will not.
 * `generate.ts` reads these to choose a correction over a rewrite; the rules themselves are
 * unchanged, and a second failure still fails.
 */
export const UNFRAMED_FLOOR_VIOLATION =
  'The text says "floor" beside a number without saying that the number comes from seasons shortened by injury.';

/**
 * THE CORRECTION EACH SOFT VIOLATION IS HANDED BACK WITH. It says WHAT to fix, never a clause to
 * paste (refrains round, 2026-09-07): the prior floor correction offered "games missed, not talent"
 * and a read came back carrying the validator's own rule wording as prose. A correction that names
 * the sentence and the idea, and asks for the writer's own words, cannot be passed off as a sentence.
 */
export const SOFT_CORRECTIONS: Readonly<Record<string, string>> = {
  [UNFRAMED_FLOOR_VIOLATION]:
    'One sentence uses "floor" beside a number. Rewrite that sentence, in your own words, so a reader knows the number comes from seasons shortened by injury, or take the word "floor" out of it.',
};

const TENSION_NUMBER_PATTERN = /\((-?\d+(?:\.\d+)?) pts\/game\)/;

/** A trading word is HOW something was said, the way a bare floor is (production follow-up,
 *  2026-09-08): the prose is kept and the sentence carrying the word is rewritten with the drafting
 *  phrase named. A lab-report or all-time term has no soft form and still costs a rewrite. */
function tradingWordCorrectionFor(violation: string): string | null {
  const match = BANNED_TERM_VIOLATION_PATTERN.exec(violation);
  if (match === null) return null;
  const [, term, sentence] = match;
  const replacement = tradingReplacementFor(term!);
  if (replacement === null) return null;
  return `Your text uses the trading word "${term}". Rewrite this sentence: "${sentence}". Say it in your own words, with drafting words instead: ${quoted(replacement)}. Then leave everything else as it is.`;
}

/** The voice-rule violation's own shape, read back by `voiceRuleCorrectionFor`: the rule, what it
 *  matched, and the sentence it sits in. */
const VOICE_RULE_VIOLATION_PATTERN = /^The text carries a (set phrase|aside \([^)]+\)), "([^"]+)", in the sentence "(.+)"\. Rewrite that sentence\.$/;

function voiceRuleViolation(hit: VoiceRuleHit, text: string): string {
  const lowered = hit.found.toLowerCase();
  const sentence = splitSentences(text).find((one) => one.replace(/[’‘]/g, "'").toLowerCase().includes(lowered)) ?? text;
  return `The text carries a ${hit.rule}, "${hit.found}", in the sentence "${sentence}". Rewrite that sentence.`;
}

/** Whether a violation is a voice rule's (a set phrase or an aside), which is corrected by a
 *  rewrite of its one sentence rather than a fresh write. */
export function isVoiceRuleViolation(violation: string): boolean {
  return VOICE_RULE_VIOLATION_PATTERN.test(violation);
}

/** A set phrase or an aside is corrected like a trading word: the one sentence is rewritten to say
 *  only its point, and the rest of the prose is kept. */
export function voiceRuleCorrectionFor(violation: string): string | null {
  const match = VOICE_RULE_VIOLATION_PATTERN.exec(violation);
  if (match === null) return null;
  const [, , found, sentence] = match;
  return `Rewrite this sentence: "${sentence}". Say only what it means, plainly and in your own words, without "${found}" or anything like it. Then leave everything else as it is.`;
}

/** True for a violation that is a framing note, not a fabrication — see `SOFT_CORRECTIONS`. */
export function softCorrectionFor(violation: string): string | null {
  if (violation in SOFT_CORRECTIONS) return SOFT_CORRECTIONS[violation] ?? null;
  const tradingWord = tradingWordCorrectionFor(violation);
  if (tradingWord !== null) return tradingWord;
  const voiceRule = voiceRuleCorrectionFor(violation);
  if (voiceRule !== null) return voiceRule;
  if (violation.startsWith("Mixed evidence:")) {
    const number = TENSION_NUMBER_PATTERN.exec(violation)?.[1];
    const downside = number === undefined ? "the strongest downside on the sheet" : `the ${number} pts/game downside`;
    return `Your text never cites ${downside}. Work that number in somewhere before your last sentence, in your own words, and leave everything else as it is.`;
  }
  return null;
}

/** What one piece of generated text is held to. The two long reads require the tension citation;
 *  a narrative slot does not — see `validateNarrativeSlot`. */
interface GroundingBand {
  readonly minWords: number;
  readonly maxWords: number;
  readonly requireTension: boolean;
}

/**
 * THE VALIDATOR — the law's own enforcement arm (spec's hard rule: "honest data absolute; the
 * validator is the law's enforcement arm"). Every number and every multi-word proper name in
 * `body` must trace to `facts`; the copy rules bind (no em-dash, no competitor name, the band's
 * own word range); and mixed evidence must carry its own tension before the call where the band
 * asks for it.
 *
 * ONE SET OF RULES, TWO CALLERS (dossier-voice round §3.5): the two long reads
 * (`validateCapsule`) and every narrative slot (`validateNarrativeSlot`) are graded by this one
 * function, so a sentence a module renders is held to exactly what a read is held to. A second
 * grounding implementation for the slots would be a second place for a fabricated number to get in.
 */
function validateGrounded(body: string, source: GroundingSource, band: GroundingBand): ValidationResult {
  const violations: string[] = [];
  const trimmed = body.trim();

  if (trimmed === "") {
    return { ok: false, violations: ["The completion was empty."], bandFailure: null };
  }

  // THE BAND IS GRADED FIRST, AND ALONE (capsule acceptance round). A text of the wrong length is
  // returned with that one violation and nothing else, so the caller can ask for a length
  // correction rather than a whole new attempt. Grounding is graded on the corrected text, which
  // is the text that would actually ship.
  const { minWords, maxWords } = band;
  const words = wordCount(trimmed);
  if (words < minWords || words > maxWords) {
    return {
      ok: false,
      violations: [`Word count ${words} is outside the required ${minWords}-${maxWords} word band.`],
      bandFailure: { words, minWords, maxWords },
    };
  }

  if (trimmed.includes(EM_DASH)) {
    violations.push("The text contains an em-dash. Rewrite without one.");
  }

  if (trimmed.includes(SEMICOLON)) {
    violations.push("The text contains a semicolon. Split it into two sentences instead.");
  }

  const bannedTerm = bannedTermIn(trimmed);
  if (bannedTerm !== null) {
    violations.push(bannedTermViolation(bannedTerm, trimmed));
  }

  const competitor = containsCompetitorName(trimmed);
  if (competitor !== null) {
    violations.push(`The text names a competitor product ("${competitor}"). Remove it.`);
  }

  // THE VOICE RULES (prep site carve-out, 2026-10-12): a set phrase or a writer's aside is how a
  // sentence was said, so it is a soft correction of that one sentence (`voiceRuleCorrectionFor`).
  for (const hit of voiceRuleHits(trimmed)) violations.push(voiceRuleViolation(hit, trimmed));

  if (hasUnframedFloorClaim(trimmed)) {
    violations.push(UNFRAMED_FLOOR_VIOLATION);
  }

  const printed = promptNumbers(source.promptText);
  const ledger = [...source.numberLedger, ...printed];
  for (const { raw, value } of extractNumbers(trimmed)) {
    // THE TEN AND THE HUNDRED (written rate round, 2026-09-08): "1400-plus receiving yards"
    // against a printed 1429, "360-point seasons" against 362.9, were roundings the tolerance
    // missed, not fabrications. Of PRINTED figures only: see `LOOSE_READING_UNITS`.
    if (!isDerivedFromLedger(value, ledger) && !isLooseReadingOf(value, printed)) {
      violations.push(`The number "${raw}" does not trace to any supplied fact.`);
    }
  }

  for (const phrase of extractProperNamePhrases(trimmed)) {
    if (!isNameGroundedWithShedding(phrase, source.nameLedger)) {
      violations.push(`The name "${phrase}" does not trace to any supplied fact.`);
    }
  }

  const requiredTension = band.requireTension ? source.tension : null;
  if (requiredTension !== null && !citesTensionNumber(trimmed, requiredTension)) {
    // Worded as a fact about the text, never as a sentence to write: a model handed "must be cited
    // as an honest hesitation" wrote "here's the honest worry" on three reads of three.
    violations.push(`Mixed evidence: the strongest downside (${roundHalfUp(requiredTension, 1)} pts/game) is never cited. It has to appear, with that number, before the call.`);
  }

  return { ok: violations.length === 0, violations, bandFailure: null };
}

/** One whole read, at its own size's word band, with the mandated-tension check that a note long
 *  enough to make a case must carry its strongest downside. */
export function validateCapsule(body: string, facts: PlayerFacts, size: CapsuleSize): ValidationResult {
  return validateGrounded(body, groundingOf(facts), { ...CAPSULE_CONFIG.sizes[size], requireTension: true });
}

/**
 * ONE NARRATIVE SLOT (dossier-voice round §3.5). The same grounding, the same copy rules, a
 * tighter word band, and NO tension mandate: a thirty-word call cannot be asked to state the
 * strongest downside AND the call, and the modules that display the downside are on the same
 * screen either way. The reads above still carry the mandate, so nothing about the page as a whole
 * gets to be one-sided on mixed evidence.
 */
export function validateNarrativeSlot(body: string, source: NarrativeGrounding, maxWords: number): ValidationResult {
  return validateGrounded(body, { ...source, tension: null }, { minWords: NARRATIVE_MIN_WORDS, maxWords, requireTension: false });
}
