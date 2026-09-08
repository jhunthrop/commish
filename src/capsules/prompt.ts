import { BUNDLE_KEYS } from "./bundle";
import { CAPSULE_CONFIG, DRAFTING_SENTENCES, LAB_REPORT_TERMS, TRADING_TERMS } from "./config";
import type { PlayerFacts } from "./facts";
import type { NarrativeSlotRequest } from "./narrative";
import { renderFactsForModel } from "./render";
import type { CapsuleSize } from "./validate";

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
- Open on the fact that matters most for him. Never open with a set-up phrase, a greeting, a question, his name followed by a verdict, or any sentence that could open a note about a different player. Where drafters are taking him is rarely the most interesting thing about him, so open there only when it is. The example phrases in these instructions are vocabulary, never sentences to open with.
- There is no fixed order and no fixed shape. If the worry is the story, start there. If the role is the story, start there. Two notes on this board should not walk the same path.
- Never tour the usage numbers. At most one usage share appears in a note, and only when it decides the case. Never list snap share, target share and red-zone share together, and never chain three ranks in one breath.
- A rank reads as something a person would say out loud, never as a code read off a table.
- End on your call, in this player's own terms: the round or the pick where you would take him, what you would need to see first, who you would take instead, what he does to a roster. Never a sentence that announces a verdict by formula.
- Never quote or paraphrase these instructions, the fact sheet's own sentences, or a correction you were given. If a sentence of yours would fit a style guide or a stat table, cut it.

WORDS
- Fantasy football words, never trading words. Talk about ADP, picks and rounds: "let him fall", "draft him", "let him go", a reach, a steal, a sleeper, a bust, points over replacement. Never these words: ${nameTerms(TRADING_TERMS)}. "Upside" and "downside" only when tied to a fantasy outcome (a top-five finish, a lost month), never as bare nouns.
- The three sentences to catch yourself on: ${DRAFTING_SENTENCES.map((pair) => `not "${pair.insteadOf}" but "${pair.write}"`).join(", ")}.
- Phrases this board has worn out, never to be written or paraphrased: ${CAPSULE_CONFIG.repetition.refrainStems.map((stem) => `"${stem}"`).join(", ")}.
- Never these words either: ${nameTerms(LAB_REPORT_TERMS)}. Say "our number", "our projection", "we project him for 136 points", "the case", "costs him", "is worth". "Our number" takes a plain verb (has him at, puts him at, is), never "says".
- Never write the word "floor". Say what the low end actually is: the weeks he missed, the weeks he scored under the bar, the season the range bottoms out at.
- Write like you talk. Contractions are welcome. Short sentences land harder than long ones. Never an em-dash, never a semicolon. Use a period, a comma, or "and".
- Never name a rival fantasy product.

HONESTY, NO EXCEPTIONS
- Use ONLY the numbers and names on the fact sheet. Never invent a stat, an injury, a teammate, a coach, or any other name or figure not printed there.
- Quote a number as the sheet gives it, or as a plain rounding of it. Never combine two figures into a third the sheet does not print. If you want the gap between our number and where drafters take him, use the gap the sheet states.
- Never say a risk, an injury or a competitor is ABSENT unless the sheet says so. Silence on the sheet is silence from you. Do not reassure the reader about a thing you have no fact for.
- Never make an all-time or historical-record claim. This engine holds no such data.
- If the sheet carries a real downside (a factor that costs him points a game, or a year-over-year number that fell), name it with its own number before your call. Never a one-sided rave on mixed facts.
- The sheet gives two ranges: the middle range most outcomes fall in, and the full tails. Reason from the middle range. If you mention the low tail, say in the same breath that it comes from seasons cut short by injury. Never present the full tails as what he is expected to score.
- A sportsbook line or a win total is the books' number, something they posted, never a claim you or this engine make. Say so.`;

const READ_LABEL: Record<CapsuleSize, string> = { compact: "short note", full: "long note" };

function bandOf(size: CapsuleSize): string {
  return `${CAPSULE_CONFIG.sizes[size].minWords} to ${CAPSULE_CONFIG.sizes[size].maxWords} words`;
}

/** The middle of a band, the number the writer is told to aim for: asked for a range, the model
 *  lands at its bottom and under it (the first one-call run rejected five long notes at 222 to 238
 *  words against a 240 floor); asked for the midpoint, it lands inside. */
function targetOf(size: CapsuleSize): number {
  const { minWords, maxWords } = CAPSULE_CONFIG.sizes[size];
  return Math.round((minWords + maxWords) / 2);
}

function lengthOf(size: CapsuleSize): string {
  return `about ${targetOf(size)} words (${bandOf(size)})`;
}

function slotSpecFor(requests: readonly NarrativeSlotRequest[]): string {
  return requests.map((request) => `  - "${request.key}" (at most ${request.maxWords} words): ${request.brief}`).join("\n");
}

function partsSpecFor(facts: PlayerFacts, requests: readonly NarrativeSlotRequest[]): string {
  return [
    `Write three parts for ${facts.identity.name}. Return ONE JSON object with exactly the keys "${BUNDLE_KEYS.compact}", "${BUNDLE_KEYS.full}" and "${BUNDLE_KEYS.narrative}", and nothing else: no code fence, no text before or after it. Each note is one JSON string. A paragraph break inside the long note is written as the two characters \\n\\n, never a raw line break.`,
    `"${BUNDLE_KEYS.compact}": the short note for his card, ${lengthOf("compact")}, one paragraph. Two or three facts that decide his case, the real downside if the sheet carries one, and the call in his own terms at the end.`,
    `"${BUNDLE_KEYS.full}": the long note for his page, ${lengthOf("full")}, up to three paragraphs in no fixed order. The same facts as the short note plus the one or two that deepen it, the role behind the numbers, the real downside with its number, and the call. Do not reuse the short note's sentences.`,
    `"${BUNDLE_KEYS.narrative}": an object holding one sentence per key below. Each sits on his page beside a number a module already prints, so say what the number means rather than restating it. No two sentences alike, and none that repeats a sentence from the notes above.\n${slotSpecFor(requests)}`,
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

/**
 * The length correction. A small overrun (`CAPSULE_CONFIG.lengthCorrection.trimOverrunWords` or
 * fewer over the cap) asks for the same text minus one sentence at the end, the smallest edit that
 * lands inside the band; anything else asks for the middle of the band, cutting or adding.
 */
function lengthInstruction(size: CapsuleSize, quoted: string, correction: NonNullable<PriorAttempt["lengthCorrection"]>): string {
  const { words, minWords, maxWords } = correction;
  const overrun = words - maxWords;
  if (overrun > 0 && overrun <= CAPSULE_CONFIG.lengthCorrection.trimOverrunWords) {
    return `${quoted}\n\nIt is ${words} words, ${overrun} over the ${maxWords} word cap. Return the same text with one sentence taken off the end, and ${SAME_TEXT_OTHERWISE}`;
  }
  const move = overrun > 0 ? "Cut the sentences that carry the least" : "Add two or three more sentences of fact from the sheet that sharpen the case";
  return `${quoted}\n\nIt is ${words} words. It has to be between ${minWords} and ${maxWords} words, so aim for about ${targetOf(size)}. ${move}, and ${SAME_TEXT_OTHERWISE}`;
}

function correctionInstruction(size: CapsuleSize, prior: PriorAttempt): string {
  const label = READ_LABEL[size];
  const shape = size === "compact" ? "one paragraph" : "up to three paragraphs";
  if (prior.missing === true) {
    return `Your previous answer had no ${label} for this player. Write it now: ${lengthOf(size)}, ${shape}, built on the two or three facts that decide his case.`;
  }
  const quoted = `You wrote this ${label}:\n"""${prior.body}"""`;
  if (prior.lengthCorrection !== undefined) return lengthInstruction(size, quoted, prior.lengthCorrection);
  if (prior.softCorrections !== undefined && prior.softCorrections.length > 0) {
    return `${quoted}\n\nIt is nearly right. Fix exactly these points, in your own words, and change nothing else:\n${prior.softCorrections.map((point) => `- ${point}`).join("\n")}`;
  }
  return `${quoted}\n\nIt broke these rules:\n${prior.violations.map((violation) => `- ${violation}`).join("\n")}\n\nWrite the ${label} again from scratch, ${lengthOf(size)}, ${shape}, fixing every point above.`;
}

/** The user message of a per-part correction: the fact sheet, the prior attempt, what to fix, and
 *  a plain-text return so the corrected read is graded exactly as the first draft was. */
export function correctionPromptFor(facts: PlayerFacts, size: CapsuleSize, prior: PriorAttempt): string {
  return [`Fact sheet:\n${renderFactsForModel(facts)}`, correctionInstruction(size, prior), `Return only the corrected ${READ_LABEL[size]}: no JSON, no quotes, no heading.`].join("\n\n");
}
