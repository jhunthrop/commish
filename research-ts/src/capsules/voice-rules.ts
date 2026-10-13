/**
 * THE WRITER'S VOICE RULES, in one place (the prep site carve-out, 2026-10-12): what a capsule may
 * never ship with, however well grounded its numbers are. The validator (`validate.ts`) rejects a
 * read or a narrative slot carrying any of these and the writer is re-prompted to rewrite the one
 * sentence: a read through its correction call (`softCorrectionFor`), a narrative slot through its
 * own rewrite, at most `CAPSULE_CONFIG.narrativeVoiceRewritesPerSlot` times and within the player's
 * call ceiling (`generate.ts`'s `rewriteVoiceSlots`). A read that still carries one after its
 * correction falls to the template like any other failed read; a slot that still does renders its
 * template sentence.
 *
 * Found in the approved mocks (`docs/design/mocks/2026-10-12-commish/direction.html`, "What did not
 * reconcile"): a stored capsule carried an unedited writer aside ("not that word, let me say it
 * plainly") and another a set phrase the copy rules cut ("the honest worry"). Both were written,
 * validated and served, because nothing graded HOW a sentence was said, only what it cited.
 *
 * NOT THE REFRAIN STEMS. `CAPSULE_CONFIG.repetition.refrainStems` measures how much of the board
 * shares a frame and queues regeneration past a share; a frame on a few players is voice. The set
 * phrases here are wrong on any one player, so they are a per-capsule rejection.
 */

/** Set phrases: stock frames a person would not say to a friend about a player. Matched case-folded
 *  on word boundaries, curly and straight apostrophes alike. */
export const SET_PHRASES: readonly string[] = [
  "the honest worry",
  "the honest hesitation",
  "the stat that sells me",
  "the price is wrong",
  "with a plan behind him",
  "let's talk about",
  "here's the thing",
  "make no mistake",
  "at the end of the day",
  "the bottom line",
  "all things considered",
  "it's worth noting",
  "needless to say",
];

/**
 * Writer asides: the model talking to itself or to its editor rather than to the reader. Each is a
 * named pattern so a violation says which rule fired. Deliberately narrow: "wait" and "actually"
 * are drafting words ("wait on a tight end"), so they are not here on their own.
 */
export const ASIDE_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "let me", pattern: /\blet me (?:say|put|try|rephrase|start|be (?:clear|plain|honest))\b/i },
  { name: "not that word", pattern: /\bnot that word\b/i },
  { name: "the wrong word", pattern: /\b(?:that'?s|that is) (?:the wrong|not the right) word\b/i },
  { name: "scratch that", pattern: /\b(?:scratch|strike) that\b/i },
  { name: "or rather", pattern: /\bor rather\b/i },
  { name: "put plainly", pattern: /\b(?:to )?put (?:it )?(?:plainly|simply|another way)\b/i },
  { name: "in other words", pattern: /\bin other words\b/i },
  { name: "I mean", pattern: /\bI mean\b/ },
  { name: "a rewrite note", pattern: /\bhere'?s (?:my|the|a) (?:rewrite|revision|draft|version)\b/i },
  { name: "an editorial bracket", pattern: /\[[^\]]*\]/ },
  { name: "the model naming itself", pattern: /\bas an? (?:AI|language model|assistant)\b/i },
];

/** One voice-rule hit: which rule, and the text it matched. */
export interface VoiceRuleHit {
  readonly rule: string;
  readonly found: string;
}

function normaliseApostrophes(text: string): string {
  return text.replace(/[’‘]/g, "'");
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SET_PHRASE_PATTERNS: readonly { readonly phrase: string; readonly pattern: RegExp }[] = SET_PHRASES.map((phrase) => ({
  phrase,
  pattern: new RegExp(`\\b${escapeForPattern(phrase)}\\b`, "i"),
}));

/** Every set phrase and aside in `text`, set phrases first, in rule order. Empty means clean. */
export function voiceRuleHits(text: string): readonly VoiceRuleHit[] {
  const normalised = normaliseApostrophes(text);
  const phrases = SET_PHRASE_PATTERNS.flatMap(({ phrase, pattern }) => (pattern.test(normalised) ? [{ rule: "set phrase", found: phrase }] : []));
  const asides = ASIDE_PATTERNS.flatMap(({ name, pattern }) => {
    const match = pattern.exec(normalised);
    return match === null ? [] : [{ rule: `aside (${name})`, found: match[0] }];
  });
  return [...phrases, ...asides];
}
