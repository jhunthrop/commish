import { CAPSULE_CONFIG, CAPSULE_MODEL } from "./config";
import type { PlayerFacts } from "./facts";
import {
  ABSENCE_MODULES,
  absenceSlotKey,
  NARRATIVE_KEYS,
  NARRATIVE_WORD_CAPS,
  whyGroupSlotKey,
  type NarrativeSlots,
} from "./narrative-slots";
import { renderFactsForModel } from "./render";
import { validateNarrativeSlot } from "./validate";
import { addGatewayUsage, CapsuleGenerationError, postChatCompletion, type CapsuleWriterDeps, type GatewayUsage } from "./write";

/**
 * THE NARRATIVE (founder amendment, 2026-09-07): "use the LLM to make every part of the player peek
 * feel dynamic and alive like a real person is writing it, unless it's simply displaying a stat."
 *
 * ONE CALL, MANY SENTENCES. The two long reads each get their own gateway call because each is one
 * piece of continuous prose. The narrative is a dozen SHORT sentences that must not repeat one
 * another, which is exactly the thing one call can guarantee and twelve cannot: a model writing the
 * trend sentence in the same breath as the call sentence knows what it already said.
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
 * sentence, never the page.
 *
 * NOTHING HERE THROWS. A refused gateway, an unparseable body, a JSON array where an object was
 * asked for: all of them return no slots, which is the state every module already renders.
 */

/** One slot the model is asked to write, with what it is for and how long it may be. */
export interface NarrativeSlotRequest {
  readonly key: string;
  readonly maxWords: number;
  /** The one line the prompt states about this slot. Written in the second person, about THIS
   *  player, because a slot brief that reads as a template produces a sentence that reads as one. */
  readonly brief: string;
}

export interface NarrativeResult {
  readonly slots: NarrativeSlots;
  readonly usage: GatewayUsage | null;
  readonly model: string | null;
  /** One line per slot the validator refused, for the sweep's own detail lines: an operator
   *  needs to see WHICH sentence the model kept failing to ground, not just a count. */
  readonly rejected: readonly string[];
  /** Set when no slot survived at all, naming why (a refused gateway, an unparseable body). */
  readonly failure: string | null;
}

const EMPTY_RESULT: NarrativeResult = { slots: {}, usage: null, model: null, rejected: [], failure: null };

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
      brief: "The games question, beside the per-game figure the page already shows: what his expected games mean for what he is worth. Never restate the rank itself.",
    });
  }

  if (trend?.pointsPerGame?.material === true) {
    requests.push({
      key: NARRATIVE_KEYS.trend,
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: "What his year-over-year move actually was, and whether it changes your read. The page prints the two seasons and the delta; say what they mean.",
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

  if (booksNumbers.propsLines.length > 0 || booksNumbers.teamVegasWinTotal !== null) {
    requests.push({
      key: NARRATIVE_KEYS.books,
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: "What the books are saying about him, phrased as their number and not as a prediction of yours.",
    });
  } else {
    requests.push({
      key: absenceSlotKey(ABSENCE_MODULES.books),
      maxWords: NARRATIVE_WORD_CAPS.module,
      brief: "The books have posted nothing on him. Say so plainly and say what a reader should take from that, which is nothing about his talent.",
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
    case "market_unlisted":
      return "the market has not listed him";
  }
}

/**
 * THE VOICE, FOR SENTENCES RATHER THAN PARAGRAPHS. `write.ts`'s own `VOICE_RULES` govern a whole
 * note; these govern one line at a time, where the failure mode is different: a sentence that could
 * have been written about any player at that position. The two exemplars are voice ONLY, and the
 * prompt says so in the same breath it gives them, because a model handed an example with numbers
 * in it will reach for those numbers.
 */
const NARRATIVE_RULES = `You are a fantasy football analyst writing the sentences on one player's page. Every sentence is short, specific to THIS player, and sounds like a person who watches football talking to a friend.

Hard rules, no exceptions:
- Use ONLY the numbers and names in the fact sheet. Never invent a stat, an injury, a teammate, a coach, or any other figure or name not printed there.
- Quote a number as the sheet gives it, or as a plain rounding of it. Never subtract, add or divide two figures into a third one the sheet does not print.
- Never say a risk, an injury or a competitor is ABSENT unless the fact sheet says so. Silence in the fact sheet means silence from you.
- Never write an em-dash and never write a semicolon. Two short sentences beat one stitched one.
- Never name a rival fantasy product.
- Never use the words: percentile, projection, evidence, measured, coefficient, "effect size", "standard deviation", p10, p90, implying, implied. Say "our number", "the case", "costs him" or "is worth" instead.
- Never make an all-time or historical claim. This engine holds no such data.
- Write from his actual situation: the new play caller, the injury he is coming back from, the tier he sits in, the market disagreeing with our number. Never a frame that would fit any player at his position.
- Do not repeat yourself between slots. Each sentence earns its place or it is not written.
- A number the page already displays beside your sentence does not need restating. Say what it MEANS.
- Where a fact is missing, say it is missing like a person would, and never as an apology or a promise.

The voice, two examples. These are TONE only. Their facts belong to other players and you must never borrow a number or a name from them:
- "The market wants a second-round pick for him and our number says he is a fourth-rounder. Let somebody else pay that."
- "Nobody else in that backfield has taken a carry that mattered. He is the offense, and everything behind him falls off."`;

function slotSpecFor(requests: readonly NarrativeSlotRequest[]): string {
  return requests.map((request) => `- "${request.key}" (at most ${request.maxWords} words): ${request.brief}`).join("\n");
}

/**
 * The user message: the same fact sheet the two reads are written from, the slot spec, and the
 * stock sentences this board has already been caught repeating (`avoid`), quoted verbatim so the
 * model is refusing a specific sentence rather than a vague instruction to be original.
 */
export function narrativePromptFor(facts: PlayerFacts, requests: readonly NarrativeSlotRequest[], avoid: readonly string[]): string {
  const sections = [
    `Fact sheet:\n${renderFactsForModel(facts)}`,
    `Write these slots for ${facts.identity.name}. Return ONE JSON object and nothing else: no prose around it, no code fence, no keys other than these.\n${slotSpecFor(requests)}`,
  ];
  if (avoid.length > 0) {
    sections.push(
      `These sentences are already on too many other players' pages. Do not write them, and do not write a near copy of them:\n${avoid.map((sentence) => `- "${sentence}"`).join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

/** A JSON object out of a completion that may have fenced it or wrapped it in a sentence. Returns
 *  `null` for anything that is not an object of values. */
function parseSlotObject(content: string): Record<string, unknown> | null {
  const fenced = content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Every requested slot the model returned as a real string AND the validator accepted. A slot the
 *  model skipped is not a failure: the module renders its template sentence, which is what a
 *  skipped slot means. */
function validateSlots(
  parsed: Record<string, unknown>,
  facts: PlayerFacts,
  requests: readonly NarrativeSlotRequest[],
): { readonly slots: NarrativeSlots; readonly rejected: readonly string[] } {
  const slots: Record<string, string> = {};
  const rejected: string[] = [];
  for (const request of requests) {
    const raw = parsed[request.key];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const text = raw.trim();
    const result = validateNarrativeSlot(text, facts, request.maxWords);
    if (result.ok) slots[request.key] = text;
    else rejected.push(`${request.key}: ${result.violations[0] ?? "unknown violation"}`);
  }
  return { slots, rejected };
}

/** A narrative call's own degenerate floor. A JSON object of short sentences is legitimately far
 *  shorter than a read, but a handful of words is still a reasoning model's exhaust rather than an
 *  artifact. */
const NARRATIVE_MIN_COMPLETION_WORDS = 8;

/**
 * One player's narrative. Never throws — see this module's own docblock. `avoid` is the board's
 * current stock-sentence list (`repetition.ts`), which is empty on a healthy board.
 */
export async function generateNarrative(facts: PlayerFacts, deps: CapsuleWriterDeps, avoid: readonly string[] = []): Promise<NarrativeResult> {
  const requests = narrativeRequestsFor(facts);
  const messages = [
    { role: "system", content: NARRATIVE_RULES },
    { role: "user", content: narrativePromptFor(facts, requests, avoid) },
  ];

  let usage: GatewayUsage | null = null;
  try {
    const response = await postChatCompletion(messages, CAPSULE_CONFIG.narrative.maxTokens, deps, NARRATIVE_MIN_COMPLETION_WORDS);
    usage = addGatewayUsage(usage, response.usage);
    const parsed = parseSlotObject(response.content);
    if (parsed === null) {
      return { ...EMPTY_RESULT, usage, failure: "the narrative completion was not a JSON object" };
    }
    const { slots, rejected } = validateSlots(parsed, facts, requests);
    return { slots, usage, model: Object.keys(slots).length > 0 ? CAPSULE_MODEL : null, rejected, failure: null };
  } catch (error: unknown) {
    if (error instanceof CapsuleGenerationError && error.billedUsage !== null) usage = addGatewayUsage(usage, error.billedUsage);
    return { ...EMPTY_RESULT, usage, failure: error instanceof Error ? error.message : String(error) };
  }
}
