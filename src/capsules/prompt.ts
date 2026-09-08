import { BUNDLE_KEYS } from "./bundle";
import { CAPSULE_CONFIG, DRAFTING_SENTENCES, LAB_REPORT_TERMS, TRADING_TERMS } from "./config";
import type { PlayerFacts } from "./facts";
import type { NarrativeSlotRequest } from "./narrative";
import { renderFactsForModel } from "./render";
import { wordCount, type CapsuleSize } from "./validate";

/**
 * THE WRITER'S INSTRUCTIONS (refrains round, 2026-09-07).
 *
 * WHAT THE FOUNDER READ. Every production peek opened the same way ("Let's talk about X, because"),
 * carried the same three sentences ("Here's the honest worry", "The band says most seasons land
 * between", "The volume case is thin"), toured the same three usage ranks whether or not they
 * decided the case, and closed on a formula ("So the call is a fade"). One read echoed the
 * validator's own rule wording as prose. The prior instructions caused most of it: a fixed
 * five-beat structure produces five-beat notes, "the honest worry" as a beat name produces "here's
 * the honest worry" as a sentence, and a sheet that states "Most seasons land between" gets that
 * sentence back.
 *
 * WHAT CHANGED. The writer is told to pick the two or three facts that decide THIS player's case,
 * to open on the one that matters, that there is no fixed order, never to tour the usage ranks,
 * never to write the stems the board has worn out (`CAPSULE_CONFIG.repetition.refrainStems`, the
 * same list `sameness.ts` measures), never to restate an instruction or a correction, and to end
 * on the call in the player's own terms. Every honesty rule from before is kept word for word in
 * substance: they are the law, and `validate.ts` enforces them after the fact either way.
 *
 * THE DRAFTING REGISTER (founder ruling, same night: "we say market everywhere like this is a stock
 * trading app, it's a fantasy football app"). The prompt teaches the fantasy words and bans the
 * trading ones, and `BANNED_VOCABULARY` refuses them mechanically.
 *
 * ONE SYSTEM PROMPT FOR THE WHOLE PLAYER. The bundle call and a part's correction call share it, so
 * a corrected read is held to exactly what the first draft was.
 */

/** The board's worn-out language, quoted into the prompt: whole stock sentences the repetition
 *  check caught (`repetition.ts`) and the stems and openers the sameness measure flagged
 *  (`sameness.ts`). Both empty on a healthy board. */
export interface WornPhrases {
  readonly sentences: readonly string[];
  readonly phrases: readonly string[];
}

export const NO_WORN_PHRASES: WornPhrases = { sentences: [], phrases: [] };

/** A prior attempt at one read, handed back for correction — see `correctionPromptFor`. */
export interface PriorAttempt {
  readonly body: string;
  readonly violations: readonly string[];
  /** Set when the ONLY thing wrong with `body` was its word count (acceptance round, 2026-09-07):
   *  the retry asks for the same text at the right length and nothing more. */
  readonly lengthCorrection?: { readonly words: number; readonly minWords: number; readonly maxWords: number };
  /** Set when every violation was about HOW something was said (the unframed floor, the uncited
   *  downside): the retry keeps the prose and fixes the point. */
  readonly softCorrections?: readonly string[];
  /** Set when the bundle simply left this read out: the retry writes it fresh. */
  readonly missing?: boolean;
}

/** The banned groups as the prompt names them, from the one list the validator enforces. */
const nameTerms = (terms: readonly string[]): string => terms.join(", ");

export const WRITER_RULES = `You write the scouting notes on one player's page for a fantasy football manager about to draft. You sound like a sharp analyst talking to a friend in the same league: direct, specific, opinionated, never a lab report and never a style guide.

HOW A NOTE IS BUILT
- Read the whole fact sheet, then pick the two or three facts that decide THIS player's case. Build the note on those and leave the rest of the sheet unquoted. The reader has the sheet's numbers on the same screen. What he does not have is your judgment about which ones matter for this player.
- Open on the fact that matters most for him. Never open with a set-up phrase, a greeting, a question, his name followed by a verdict, or any sentence that could open a note about a different player. Where drafters are taking him is rarely the most interesting thing about him, so open there only when it is. Never open on the depth chart: where he sits on it belongs in the middle of a note, once the reader knows why it matters. The example phrases in these instructions are vocabulary, never sentences to open with.
- There is no fixed order and no fixed shape. If the worry is the story, start there. If the role is the story, start there. Two notes on this board should not walk the same path.
- Never tour the usage numbers. At most one usage share appears in a note, and only when it decides the case. Never list snap share, target share and red-zone share together, and never chain three ranks in one breath.
- A rank reads as something a person would say out loud, never as a code read off a table.
- End on your call, in this player's own terms: whether you take him at his ADP, earlier or later, what you would need to see first, who you would take instead, what he does to a roster. Never a sentence that announces a verdict by formula.
- Never quote or paraphrase these instructions, the fact sheet's own sentences, or a correction you were given. If a sentence of yours would fit a style guide or a stat table, cut it.

WORDS
- Fantasy football words, never trading words. Talk about ADP, picks and rounds: "let him fall", "draft him", "let him go", a reach, a steal, a sleeper, a bust, points over replacement. Never these words: ${nameTerms(TRADING_TERMS)}. "Upside" and "downside" only when tied to a fantasy outcome (a finish near the top of his position, a lost month), never as bare nouns.
- The three sentences to catch yourself on: ${DRAFTING_SENTENCES.map((pair) => `not "${pair.insteadOf}" but "${pair.write}"`).join(", ")}.
- Phrases this board has worn out, never to be written or paraphrased: ${CAPSULE_CONFIG.repetition.refrainStems.map((stem) => `"${stem}"`).join(", ")}.
- Never these words either: ${nameTerms(LAB_REPORT_TERMS)}. Say "our number", "our projection", "we project him for 136 points", "the case", "costs him", "is worth". "Our number" takes a plain verb (has him at, puts him at, is), never "says".
- Never write the word "floor". Say what the low end actually is: the weeks he missed, the weeks he scored under the bar, the season the range bottoms out at.
- Write like you talk. Contractions are welcome. Short sentences land harder than long ones. Never an em-dash, never a semicolon. Use a period, a comma, or "and".
- Never name a rival fantasy product.

HONESTY, NO EXCEPTIONS
- Use ONLY the numbers and names on the fact sheet. Never invent a stat, an injury, a teammate, a coach, or any other name or figure not printed there.
- Quote a number as the sheet gives it, or as a plain rounding of it. Never combine two figures into a third the sheet does not print. If you want the gap between our number and where drafters take him, use the gap the sheet states.
- The only pick numbers you may write are the sheet's own: his ADP and the rounded pick beside it. Your call goes against that number in words (a round earlier than that, a few picks after his ADP, wait on him), never a pick you chose and never a threshold you made up for games or points. A rank is the sheet's rank, never a round-number tier of your own.
- Never say a risk, an injury or a competitor is ABSENT unless the sheet says so. Silence on the sheet is silence from you. Do not reassure the reader about a thing you have no fact for.
- Never make an all-time or historical-record claim. This engine holds no such data.
- If the sheet carries a real downside (a factor that costs him points a game, or a year-over-year number that fell), name it with its own number before your call. Never a one-sided rave on mixed facts.
- The sheet gives two ranges: the middle range most outcomes fall in, and the full tails. Reason from the middle range. If you mention the low tail, say in the same breath that it comes from seasons cut short by injury. Never present the full tails as what he is expected to score.
- A sportsbook line or a win total is the books' number, something they posted, never a claim you or this engine make. Say they posted it, or where their line sits, never that they set it.`;

const READ_LABEL: Record<CapsuleSize, string> = { compact: "short note", full: "long note" };

/** The middle of a band, the number the writer is told to aim for: asked for a range, the model
 *  lands at its bottom and under it (the first one-call run rejected five long notes at 222 to 238
 *  words against a 240 floor); asked for the midpoint, it lands inside. */
function targetOf(size: CapsuleSize): number {
  const { minWords, maxWords } = CAPSULE_CONFIG.sizes[size];
  return Math.round((minWords + maxWords) / 2);
}

/** ONE COUNT TO HIT, NEVER A RANGE (written rate round, 2026-09-08). "About 270 words (240 to 300
 *  words)" put 15 of 40 long notes under the floor at 201 to 239 words: the range's bottom read as
 *  the target. The band stays in the validator; the writer hears one number. */
function lengthOf(size: CapsuleSize): string {
  return `${targetOf(size)} words`;
}

/** A slot's count to aim for, under its cap: see `CAPSULE_CONFIG.narrativeTargetShareOfCap`. */
function slotLengthOf(maxWords: number): string {
  return `about ${Math.round(maxWords * CAPSULE_CONFIG.narrativeTargetShareOfCap)} words, never more than ${maxWords}`;
}

function slotSpecFor(requests: readonly NarrativeSlotRequest[]): string {
  return requests.map((request) => `  - "${request.key}" (${slotLengthOf(request.maxWords)}): ${request.brief}`).join("\n");
}

function partsSpecFor(facts: PlayerFacts, requests: readonly NarrativeSlotRequest[]): string {
  return [
    `Write three parts for ${facts.identity.name}. Return ONE JSON object with exactly the keys "${BUNDLE_KEYS.compact}", "${BUNDLE_KEYS.full}" and "${BUNDLE_KEYS.narrative}", and nothing else: no code fence, no text before or after it. Each note is one JSON string. A paragraph break inside the long note is written as the two characters \\n\\n, never a raw line break.`,
    `"${BUNDLE_KEYS.compact}": the short note for his card, ${lengthOf("compact")}, one paragraph. Two or three facts that decide his case, the real downside if the sheet carries one, and the call in his own terms at the end.`,
    `"${BUNDLE_KEYS.full}": the long note for his page, ${lengthOf("full")}, up to three paragraphs in no fixed order. The same facts as the short note plus the one or two that deepen it, the role behind the numbers, the real downside with its number, and the call. Do not reuse the short note's sentences.`,
    // The register restated beside the slots (written rate round, 2026-09-08): a slot has no
    // correction, and four of forty players lost one to "buy-low", "we price it at", "discount".
    `"${BUNDLE_KEYS.narrative}": an object holding one sentence per key below. Each sits on his page beside a number a module already prints, so say what the number means rather than restating it. No two sentences alike, and none that repeats a sentence from the notes above. Every sentence keeps the same words as the notes: drafting words, never a trading word, never "floor".\n${slotSpecFor(requests)}`,
  ].join("\n\n");
}

function wornSection(worn: WornPhrases): string | null {
  const lines = [...worn.sentences, ...worn.phrases];
  if (lines.length === 0) return null;
  return `These are already on too many other players' pages. Do not write them, do not open with them, and do not write a near copy of them:\n${lines.map((line) => `- "${line}"`).join("\n")}`;
}

/** The user message of the one call: the fact sheet, the three parts, the worn language. */
export function bundlePromptFor(facts: PlayerFacts, requests: readonly NarrativeSlotRequest[], worn: WornPhrases): string {
  const sections = [`Fact sheet:\n${renderFactsForModel(facts)}`, partsSpecFor(facts, requests), wornSection(worn)];
  return sections.filter((section): section is string => section !== null).join("\n\n");
}

const SAME_TEXT_OTHERWISE = "change nothing else: the same facts, the same numbers, the same order, the same voice.";

const SENTENCE_COUNT_WORDS = ["one", "two", "three"] as const;

/** How many sentences a deficit is worth: one at the least, `maxSentencesAdded` at the most. */
function sentencesFor(deficit: number): string {
  const { wordsPerSentence, maxSentencesAdded } = CAPSULE_CONFIG.lengthCorrection;
  const count = Math.min(maxSentencesAdded, Math.max(1, Math.round(deficit / wordsPerSentence)));
  const word = SENTENCE_COUNT_WORDS[count - 1] ?? String(count);
  return count === 1 ? `${word} sentence of fact from the sheet that sharpens the case` : `${word} sentences of fact from the sheet that sharpen the case`;
}

/**
 * The length correction. A small overrun (`CAPSULE_CONFIG.lengthCorrection.trimOverrunWords` or
 * fewer over the cap) asks for the same text minus one sentence at the end, the smallest edit that
 * lands inside the band; anything else states the middle of the band as the count to hit, with the
 * ask sized to the distance (`sentencesFor`): a fixed "two or three sentences" took a 237-word note
 * to 302 (written rate round, 2026-09-08).
 */
function lengthInstruction(size: CapsuleSize, quoted: string, correction: NonNullable<PriorAttempt["lengthCorrection"]>): string {
  const { words, maxWords } = correction;
  const overrun = words - maxWords;
  if (isTrimOverrun(correction)) {
    return `${quoted}\n\nIt is ${words} words, ${overrun} over the ${maxWords} word cap. Return the same text with one sentence taken off the end, and ${SAME_TEXT_OTHERWISE}`;
  }
  const target = targetOf(size);
  const distance = Math.abs(target - words);
  // The added sentences name their own register (written rate round, 2026-09-08): one length
  // correction added "you paid WR1 prices" to a clean note, another added a bare floor claim.
  const move = words > target ? `cut the sentences that carry the least (about ${distance} words)` : `add ${sentencesFor(distance)} (about ${distance} more words, with no trading word and no "floor" in them)`;
  return `${quoted}\n\nIt is ${words} words. Bring it to ${target} words: ${move}, and ${SAME_TEXT_OTHERWISE}`;
}

/** The cap, stated on a soft correction: one compact read went 105 to 121 words fixing a single
 *  sentence (written rate round, 2026-09-08), and "change nothing else" said nothing about length. */
function capReminder(size: CapsuleSize, body: string): string {
  const { maxWords } = CAPSULE_CONFIG.sizes[size];
  return `It is ${wordCount(body)} words now and the cap is ${maxWords}, so it must not grow past ${maxWords} words.`;
}

/** The five things a correction call can ask for, decided from the prior attempt alone. Named
 *  here, where the prompt is chosen, and recorded on the read's own attempt log (`generate.ts`) so
 *  the acceptance script can say which correction a failed read was given. */
export type CorrectionKind = "missing" | "trim" | "length" | "soft" | "rewrite";

function isTrimOverrun(correction: NonNullable<PriorAttempt["lengthCorrection"]>): boolean {
  const overrun = correction.words - correction.maxWords;
  return overrun > 0 && overrun <= CAPSULE_CONFIG.lengthCorrection.trimOverrunWords;
}

export function correctionKindOf(prior: PriorAttempt): CorrectionKind {
  if (prior.missing === true) return "missing";
  if (prior.lengthCorrection !== undefined) return isTrimOverrun(prior.lengthCorrection) ? "trim" : "length";
  if (prior.softCorrections !== undefined && prior.softCorrections.length > 0) return "soft";
  return "rewrite";
}

function correctionInstruction(size: CapsuleSize, prior: PriorAttempt): string {
  const label = READ_LABEL[size];
  const shape = size === "compact" ? "one paragraph" : "up to three paragraphs";
  const quoted = `You wrote this ${label}:\n"""${prior.body}"""`;
  switch (correctionKindOf(prior)) {
    case "missing":
      return `Your previous answer had no ${label} for this player. Write it now: ${lengthOf(size)}, ${shape}, built on the two or three facts that decide his case.`;
    case "trim":
    case "length":
      return lengthInstruction(size, quoted, prior.lengthCorrection!);
    case "soft":
      return `${quoted}\n\nIt is nearly right. Fix exactly these points, in your own words, and change nothing else:\n${prior.softCorrections!.map((point) => `- ${point}`).join("\n")}\n\n${capReminder(size, prior.body)}`;
    case "rewrite":
      return `${quoted}\n\nIt broke these rules:\n${prior.violations.map((violation) => `- ${violation}`).join("\n")}\n\nWrite the ${label} again from scratch, ${lengthOf(size)}, ${shape}, fixing every point above.`;
  }
}

/** The user message of a per-part correction: the fact sheet, the prior attempt, what to fix, and
 *  a plain-text return so the corrected read is graded exactly as the first draft was. */
export function correctionPromptFor(facts: PlayerFacts, size: CapsuleSize, prior: PriorAttempt): string {
  return [`Fact sheet:\n${renderFactsForModel(facts)}`, correctionInstruction(size, prior), `Return only the corrected ${READ_LABEL[size]}: no JSON, no quotes, no heading.`].join("\n\n");
}
