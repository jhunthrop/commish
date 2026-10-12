import { CAPSULE_MODEL } from "./config";
import type { PlayerFacts } from "./facts";
import {
  ABSENCE_MODULES,
  absenceSlotKey,
  NARRATIVE_KEYS,
  NARRATIVE_WORD_CAPS,
  whyGroupSlotKey,
  type NarrativeSlots,
} from "./narrative-slots";
import { groundingOf, isVoiceRuleViolation, validateNarrativeSlot, voiceRuleCorrectionFor } from "./validate";

/**
 * THE NARRATIVE (founder amendment, 2026-09-07): "use the LLM to make every part of the player peek
 * feel dynamic and alive like a real person is writing it, unless it's simply displaying a stat."
 *
 * ONE CALL FOR THE WHOLE PLAYER (refrains round, 2026-09-07). The slots used to be their own
 * gateway call beside the two reads' own two. They now come back in the same JSON object as the
 * reads (`bundle.ts`), written by a model that knows what the reads already said, which is the one
 * thing three separate calls could never guarantee. This module decides WHICH slots are asked for
 * and grades what came back; `prompt.ts` asks and `generate.ts` calls.
 *
 * WHICH SLOTS ARE ASKED FOR IS A FUNCTION OF THE FACTS, never a fixed list. A player with no prior
 * season is not asked for a `story` sentence, he is asked for the `absence:story` note that says so
 * in a human voice. Asking for a slot the fact sheet cannot support is how a model gets invited to
 * invent, and this engine does not invite that.
 *
 * EVERY SLOT IS GRADED, SEPARATELY. `validateNarrativeSlot` runs the same grounding the reads are
 * held to (every number and multi-word name traces to the fact sheet, no banned vocabulary, no
 * em-dash, no semicolon, no competitor) plus its own word cap. A slot that fails is DROPPED, and
 * its module renders the deterministic template sentence it always had. One bad sentence costs one
 * sentence, never the page. A slot is not retried for a fabrication: it is one sentence, and the
 * template sentence behind it is honest. A slot refused ONLY for a voice rule (a set phrase or a
 * writer's aside, `voice-rules.ts`) is the one exception: how it was said is fixable without a
 * new claim, so it is asked again, a bounded number of times (`CAPSULE_CONFIG
 * .narrativeVoiceRewritesPerSlot`, `voiceRewritable` and `slotRewritePrompt` below).
 */

/** One slot the model is asked to write, with what it is for and how long it may be. */
export interface NarrativeSlotRequest {
  readonly key: string;
  readonly maxWords: number;
  /** The one line the prompt states about this slot. Written in the second person, about THIS
   *  player, because a slot brief that reads as a template produces a sentence that reads as one. */
  readonly brief: string;
}

/** One slot the validator refused: the sentence as written and every violation it carried, so a
 *  rejected sentence can be read back beside its reason (written rate round, 2026-09-08). */
export interface RefusedSlot {
  readonly key: string;
  readonly text: string;
  readonly violations: readonly string[];
}

export interface NarrativeResult {
  readonly slots: NarrativeSlots;
  readonly model: string | null;
  /** One line per slot the validator refused, for the sweep's own detail lines: an operator
   *  needs to see WHICH sentence the model kept failing to ground, not just a count. */
  readonly rejected: readonly string[];
  /** The same refusals with the sentence itself, for the acceptance script's own dump. */
  readonly refused: readonly RefusedSlot[];
  /** Set when no slot survived at all, naming why (a refused gateway, a body with no narrative
   *  object in it). */
  readonly failure: string | null;
}

/** A refused slot whose every violation is a voice rule's, and so is worth one rewrite. */
export function voiceRewritable(slot: RefusedSlot): boolean {
  return slot.violations.length > 0 && slot.violations.every(isVoiceRuleViolation);
}

/** The rewrite request for one voice-refused slot: its own brief, the sentence as written, and the
 *  correction for each rule it broke. Only the sentence comes back. */
export function slotRewritePrompt(request: NarrativeSlotRequest, slot: RefusedSlot): string {
  const corrections = slot.violations.map((violation) => voiceRuleCorrectionFor(violation)).filter((line): line is string => line !== null);
  return [
    `This is one sentence you wrote for the ${request.key} module: ${request.brief}`,
    `What you wrote: "${slot.text}"`,
    ...corrections,
    `Keep every number and name it already has, stay under ${request.maxWords} words, and answer with the rewritten sentence alone, no quotes and nothing around it.`,
  ].join("\n\n");
}

/** `result` with `key` now written as `text`, and its refusal removed. */
export function withRewrittenSlot(result: NarrativeResult, key: string, text: string, model: string): NarrativeResult {
  const refused = result.refused.filter((slot) => slot.key !== key);
  return {
    ...result,
    slots: { ...result.slots, [key]: text },
    model,
    refused,
    rejected: refused.map((slot) => `${slot.key}: ${slot.violations[0] ?? "unknown violation"}`),
  };
}

/** No slots, no failure: the state before a call, and the honest one when nothing was asked. */
export const EMPTY_NARRATIVE: NarrativeResult = { slots: {}, model: null, rejected: [], refused: [], failure: null };

/** The narrative that a whole-player failure leaves behind, naming why. */
export function failedNarrative(failure: string): NarrativeResult {
  return { ...EMPTY_NARRATIVE, failure };
}

/**
 * THE SLOTS THIS PLAYER'S OWN FACT SHEET SUPPORTS.
 *
 * The order is the order the page reads in, which is also the order the model writes in: the call
 * first, so every sentence after it is written knowing what the call already claimed.
 */
export function narrativeRequestsFor(facts: PlayerFacts): readonly NarrativeSlotRequest[] {
  const { market, availability, lastSeasonStory, booksNumbers, usage, trend } = facts;
  const requests: NarrativeSlotRequest[] = [
    {
      key: NARRATIVE_KEYS.call,
      maxWords: NARRATIVE_WORD_CAPS.call,
      brief: "The lead. One sentence a sharp analyst would open with about THIS player, the thing you would say first if a friend asked about him. Take a side.",
    },
  ];

  if (availability !== null) {
    requests.push({
      key: NARRATIVE_KEYS.perGame,
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: "The games question, beside the per-game figure the page already shows. Say what his expected games mean for what he is worth, and never restate the rank itself.",
    });
  }

  if (trend?.pointsPerGame?.material === true) {
    requests.push({
      key: NARRATIVE_KEYS.trend,
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: "What his year-over-year move actually was, and whether it changes your read. The page prints the two seasons and the delta, so say what they mean.",
    });
  }

  if (lastSeasonStory !== null) {
    requests.push({
      key: NARRATIVE_KEYS.story,
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: "Last season in one line, the shape of it rather than the totals the page already lists beside you.",
    });
  } else {
    requests.push({
      key: absenceSlotKey(ABSENCE_MODULES.story),
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: "There is no prior season on record for him. Say that plainly, in a way that tells the reader what it means for him rather than apologising for a gap.",
    });
  }

  // Gated on a PROPS line rather than on any books number at all (review I6): the absence note is
  // rendered in the props row, so a player with a win total and no props needs the note, not the
  // sentence. The win total is still his to mention in the books sentence when he has both.
  if (booksNumbers.propsLines.length > 0) {
    requests.push({
      key: NARRATIVE_KEYS.books,
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: "What the books are saying about him, phrased as their number and not as a prediction of yours.",
    });
  } else {
    requests.push({
      key: absenceSlotKey(ABSENCE_MODULES.books),
      maxWords: NARRATIVE_WORD_CAPS.module,
      // Not "which is nothing about his talent" (production follow-up, 2026-09-08): a brief that
      // hands the writer a finished idea gets it back as one sentence on fifteen players ("It says
      // nothing about whether he can play"). The idea stays; the sentence is his to make.
      brief: "The books have posted nothing on him. Say so plainly, then say what a reader should take from that in his own terms (his role, where drafters take him), never as a verdict on his talent.",
    });
  }

  if (usage === null) {
    requests.push({
      key: absenceSlotKey(ABSENCE_MODULES.usage),
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: "His role last season was never tracked. Say that without dressing it up, and say what a reader should watch instead.",
    });
  }

  if (market.playersLeftInTier !== null && market.dropToNextTier !== null) {
    requests.push({
      key: NARRATIVE_KEYS.tier,
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: "Where he sits in his tier and what the drop behind him is worth to a drafter. Never call a small step a cliff.",
    });
  }

  for (const item of facts.evidence) {
    requests.push({
      key: whyGroupSlotKey(item.groupKey),
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: `The evidence line for "${briefLabelOf(item)}": why it moves his outlook, in the words you would use out loud.`,
    });
  }

  return requests;
}

function briefLabelOf(item: PlayerFacts["evidence"][number]): string {
  switch (item.kind) {
    case "law":
      return item.headline;
    case "offseason_share_gained":
      return "his role grew this offseason";
    case "offseason_share_lost":
      return "his role shrank this offseason";
    case "changed_team":
      return `he changed teams, ${item.from} to ${item.to}`;
    case "new_play_caller":
      return `a new play caller at ${item.team}`;
    case "rookie":
      return "he is a rookie";
    // The fact, not the opener the board wore out (written rate round, 2026-09-08).
    case "market_unlisted":
      return "he has no ADP on file";
  }
}

/**
 * Every requested slot the model returned as a real string AND the validator accepted. A slot the
 * model skipped is not a failure: the module renders its template sentence, which is what a
 * skipped slot means. `raw` is the bundle's own narrative object (`bundle.ts`), or `null` when
 * the bundle carried none, which is a failure worth naming in the sweep's detail lines.
 */
export function settleNarrative(raw: Readonly<Record<string, unknown>> | null, facts: PlayerFacts, requests: readonly NarrativeSlotRequest[], model: string = CAPSULE_MODEL): NarrativeResult {
  if (raw === null) return failedNarrative("the answer carried no narrative object");
  const grounding = groundingOf(facts);
  const slots: Record<string, string> = {};
  const refused: RefusedSlot[] = [];
  for (const request of requests) {
    const value = raw[request.key];
    if (typeof value !== "string" || value.trim() === "") continue;
    const text = value.trim();
    const result = validateNarrativeSlot(text, grounding, request.maxWords);
    if (result.ok) slots[request.key] = text;
    else refused.push({ key: request.key, text, violations: result.violations });
  }
  const rejected = refused.map((slot) => `${slot.key}: ${slot.violations[0] ?? "unknown violation"}`);
  return { slots, model: Object.keys(slots).length > 0 ? model : null, rejected, refused, failure: null };
}
