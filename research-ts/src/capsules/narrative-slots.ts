/**
 * THE NARRATIVE'S OWN VOCABULARY — the slot keys, the accessor every module reads a slot through,
 * and the normalization the repetition check counts by.
 *
 * WHY THIS FILE IS PURE (no database, no `node:crypto`, no gateway). Every module that renders a
 * slot is a client component, and `store.ts` (where the capsule row lives) pulls Drizzle in behind
 * it. A client component may import a TYPE from there, never a value, so the one function a module
 * actually calls lives here, in a file that imports nothing at all.
 *
 * THE RULE THE SLOTS EXIST FOR (founder, 2026-09-07): "use the LLM to make every part of the player
 * peek feel dynamic and alive like a real person is writing it, unless it's simply displaying a
 * stat." A module that displays a statistic states it from the engine, formatted like a person
 * would. A module that says something in a SENTENCE gets that sentence from the writer, and falls
 * back to its own template sentence when the writer has not produced a validated one.
 */

/** The word ceilings the validator holds a slot to. The call is a lead sentence, so it is held
 *  tighter than the module sentences that sit beside a number. */
export const NARRATIVE_WORD_CAPS = {
  call: 30,
  module: 40,
} as const;

/** A slot shorter than this is not a sentence, whatever the model returned. */
export const NARRATIVE_MIN_WORDS = 3;

/** One player's validated sentences, by slot key. Never partially typed: a value that is not a
 *  non-empty string is not a slot, and `narrativeSlot` refuses it at the boundary. */
export type NarrativeSlots = Readonly<Record<string, string>>;

/** Anything that carries a narrative — the stored capsule row, the product-surface view, or a
 *  test's own literal. Structural on purpose, so this file depends on none of them. */
export interface NarrativeCarrier {
  readonly narrative: NarrativeSlots | null;
}

/** The fixed slots. A why-group's key is built (`whyGroupSlotKey`) because it names one group. */
export const NARRATIVE_KEYS = {
  /** The verdict's own lead sentence. */
  call: "call",
  /** The per-game story the Call card states beside the rank ("the question is games"). */
  perGame: "perGame",
  /** The Role module's year-over-year sentence. */
  trend: "trend",
  /** The season strip's own last-season sentence. */
  story: "story",
  /** The Books module's market and win-total sentence. */
  books: "books",
  /** The tier standing, when the board found a real cliff. */
  tier: "tier",
} as const;

export type NarrativeKey = (typeof NARRATIVE_KEYS)[keyof typeof NARRATIVE_KEYS];

/** One evidence group's own sentence, keyed by the SAME group key `groups.ts` renders with, so a
 *  module can address the group it is drawing without a second grouping rule. */
export function whyGroupSlotKey(groupKey: string): string {
  return `whyGroup:${groupKey}`;
}

/** The modules that can have nothing to say, so that even absence is said in a human voice rather
 *  than as a blank or a repeated stock phrase. */
export const ABSENCE_MODULES = {
  usage: "usage",
  story: "story",
  books: "books",
} as const;

export type AbsenceModule = (typeof ABSENCE_MODULES)[keyof typeof ABSENCE_MODULES];

export function absenceSlotKey(module: AbsenceModule): string {
  return `absence:${module}`;
}

/**
 * THE ONE ACCESSOR. A module never reaches into the JSON itself: it asks for a key and gets either
 * a validated sentence or `null`, and renders its own template sentence for `null`. Tolerant by
 * construction — a capsule that predates the narrative column, a row whose JSON is an array or a
 * number, a slot holding a non-string, and an empty or whitespace-only slot all read as absence,
 * which is the state every calling module already knows how to render.
 */
export function narrativeSlot(capsule: NarrativeCarrier | null | undefined, key: string): string | null {
  const narrative = capsule?.narrative;
  if (narrative === null || narrative === undefined || typeof narrative !== "object" || Array.isArray(narrative)) return null;
  const value = (narrative as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The form the repetition check counts by: case-folded, punctuation dropped, whitespace collapsed.
 * Two sentences that differ only in a comma or a capital are the SAME stock sentence to a reader,
 * and a check that counted them apart would miss exactly the sameness it exists to find.
 */
export function normalizeSentence(text: string): string {
  return text
    .toLowerCase()
    // A period BETWEEN digits is part of a number ("20.9") and survives; every other period is
    // punctuation and goes, so a trailing full stop never makes two identical sentences differ.
    .replace(/(?<!\d)\.(?!\d)/g, " ")
    .replace(/[^a-z0-9%. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One slot's text split into sentences, exactly as written. The one splitter both readers use,
 *  so a verbatim sentence and its normalized form are always the same sentence at the same index. */
export function sentencesVerbatim(text: string): readonly string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => normalizeSentence(sentence) !== "");
}

/** Every sentence in one slot's text, normalized. A slot may hold two sentences; the repetition
 *  check counts SENTENCES, because a stock second sentence is just as dead as a stock first one. */
export function sentencesOf(text: string): readonly string[] {
  return sentencesVerbatim(text).map((sentence) => normalizeSentence(sentence));
}
