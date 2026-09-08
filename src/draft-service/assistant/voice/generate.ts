/**
 * THE ADVISOR'S VOICE — spec 3.5: two written elements per turn, both through the narrative
 * slot machinery with grounding and per-slot fallback. The strategy note (two sentences at most:
 * what the room is doing and what it means for your next pick) and one reason sentence per
 * now-card candidate.
 *
 * SAME GATEWAY, SAME VALIDATOR. The call rides `postChatCompletion` (`@/capsules/write`), the
 * one gateway client, and every slot is graded by `validateNarrativeSlot` (`@/capsules/validate`)
 * against THIS TURN's own ledger (`ledger.ts`): every number and every multi-word name must
 * trace to what the card shows, no em-dash, no semicolon, no competitor, no banned vocabulary,
 * a word cap per slot. A slot that fails is dropped and its template renders. Two slots that
 * say the same sentence keep only the first (the repetition rule, per card).
 *
 * The validator is typed over a whole `PlayerFacts`; for a narrative slot it reads exactly two
 * of its fields, the number and name ledgers (`validateGrounded`'s own path with
 * `requireTension: false`). `groundingFactsFor` is the smallest honest bridge until that module
 * accepts a narrower ledger type. `grounding.test.ts` pins that the bridge still passes and fails
 * on the same inputs.
 *
 * NOTHING HERE THROWS: a refused gateway or an unparseable body is a result with no slots.
 */
import { NARRATIVE_MIN_WORDS, normalizeSentence } from "@/capsules/narrative-slots";
import { validateNarrativeSlot } from "@/capsules/validate";
import { addGatewayUsage, CapsuleGenerationError, postChatCompletion, type CapsuleWriterDeps, type GatewayUsage } from "@/capsules/write";
import type { PlayerFacts } from "@/capsules/facts";
import { pickLabel } from "@/domain/pick-label";
import { ADVISOR_CONFIG } from "../config";
import { runsPhrase } from "../template";
import type { AdvisorView, TurnLedger } from "../view";

export const STRATEGY_SLOT = "strategy";

export function reasonSlotKey(playerId: string): string {
  return `reason:${playerId}`;
}

export interface VoiceResult {
  readonly strategy: string | null;
  readonly reasons: Readonly<Record<string, string>>;
  readonly rejected: readonly string[];
  readonly usage: GatewayUsage | null;
  readonly failure: string | null;
}

const EMPTY: VoiceResult = { strategy: null, reasons: {}, rejected: [], usage: null, failure: null };

/** The two ledgers the validator reads for a narrative slot, in the shape it is typed over. */
export function groundingFactsFor(ledger: TurnLedger): PlayerFacts {
  const facts: Pick<PlayerFacts, "numberLedger" | "nameLedger"> = { numberLedger: ledger.numbers, nameLedger: ledger.names };
  return facts as PlayerFacts;
}

const VOICE_RULES = `You are the sharpest manager in a fantasy football draft room, leaning over a friend's shoulder during a live draft. You write short, plain, confident sentences in the second person about THIS turn in THIS room.

Hard rules, no exceptions:
- Use ONLY the numbers and names in the turn sheet. Never invent a player, a stat, an injury, a team or a figure not printed there.
- Quote a number as the sheet gives it. Odds are runs of our simulator: say "57 of 200 runs", never a probability you worked out yourself.
- Never write an em-dash and never write a semicolon. Two short sentences beat one stitched one.
- Never name a rival fantasy product.
- Never use the words: percentile, projection, evidence, measured, coefficient, implying, implied.
- Never write "last man in his tier" or any phrase like it.
- Do not repeat yourself between slots. Each sentence earns its place.
- Say what the room is doing and what it means for the manager's next pick. Take a side.`;

function candidateLines(view: AdvisorView): string {
  return view.now
    .map((candidate) => {
      const odds = candidate.makeItBack === null ? "no next turn to wait for" : `${runsPhrase(candidate.makeItBack)} still have him at your next turn`;
      const slot = candidate.fillsSlot === null ? "no open slot" : `fills your ${candidate.fillsSlot} slot`;
      return `- ${view.names[candidate.playerId] ?? candidate.playerId} (${candidate.position} No. ${candidate.positionRank}, ${candidate.valueOverReplacement.toFixed(1)} points over replacement, ${slot}, ${odds})`;
    })
    .join("\n");
}

function planLines(view: AdvisorView): string {
  return view.plan.turns
    .map((turn) => {
      const targets = turn.targets
        .map((target) => {
          const own = target.oddsByTurn[turn.turn - 1];
          return `${view.names[target.playerId] ?? target.playerId}${own === null || own === undefined ? "" : ` (${runsPhrase(own)})`}`;
        })
        .join(", ");
      return `- Turn ${turn.turn}, pick ${pickLabel(turn.pickNumber, view.teamCount)}: a ${turn.position}. Targets: ${targets}.`;
    })
    .join("\n");
}

function signalLines(view: AdvisorView): string {
  const { run, collapses, ahead } = view.signals;
  const lines = [
    run === null ? "- No run on right now." : `- Run: ${run.count} of the last ${run.window} picks were ${run.position}.`,
    ...collapses.map((row) => `- Tier: ${row.playersLeftInTier} ${row.position} left in tier ${row.tierLabel}, then a ${row.dropToNextTier.toFixed(1)} point drop.`),
    ...ahead.map((seat) => {
      const read = seat.topPosition === null ? "no read" : `most often a ${seat.topPosition.position} (${Math.round(seat.topPosition.share * seat.runs)} of ${seat.runs} runs)`;
      const basis = seat.driver.kind === "autopick" ? "on autopick" : seat.driver.basis === "prior" ? "read from the neutral prior, too few picks yet" : `read from their own ${seat.driver.picksObserved} picks`;
      return `- Seat ${seat.seat} at pick ${pickLabel(seat.pickNumber, view.teamCount)}: ${read}, ${basis}.`;
    }),
  ];
  return lines.join("\n");
}

/** The user message: the turn sheet and the slot spec. Exported so a test can read it. */
export function voicePromptFor(view: AdvisorView): string {
  const clock = view.onTheClock ? "You are on the clock." : `${view.picksUntilYourTurn} picks until your turn, at ${pickLabel(view.pickNumber, view.teamCount)}.`;
  const slots = [
    `- "${STRATEGY_SLOT}" (at most ${ADVISOR_CONFIG.voice.strategyMaxWords} words, two sentences at most): what the room is doing and what that means for your next pick.`,
    ...view.now.map((candidate) => `- "${reasonSlotKey(candidate.playerId)}" (one sentence, under ${ADVISOR_CONFIG.voice.reasonWordsAsked} words): why ${view.names[candidate.playerId] ?? candidate.playerId} is or is not the pick right now, about him in this room.`),
  ];
  return [
    `Turn sheet. ${clock} Pick ${pickLabel(view.stamp.computedAtPick, view.teamCount)} is up in a ${view.teamCount} team room.`,
    `The room:\n${signalLines(view)}`,
    `Your plan:\n${planLines(view)}`,
    `The picks for right now, best first:\n${candidateLines(view)}`,
    `Write these slots. Return ONE JSON object and nothing else: no prose around it, no code fence, no keys other than these.\n${slots.join("\n")}`,
  ].join("\n\n");
}

function parseSlotObject(content: string): Record<string, unknown> | null {
  const fenced = content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const TIER_PHRASE = /last (man|one|guy) in (his|the|its) tier/i;

/** One slot graded: the shared validator, then the advisor's own phrase ban. */
export function gradeSlot(text: string, ledger: TurnLedger, maxWords: number): readonly string[] {
  const result = validateNarrativeSlot(text, groundingFactsFor(ledger), maxWords);
  const violations = result.ok ? [] : result.violations;
  return TIER_PHRASE.test(text) ? [...violations, 'The text says "last man in his tier", which this product never says.'] : violations;
}

interface Graded {
  readonly accepted: Readonly<Record<string, string>>;
  readonly rejected: readonly string[];
}

/** Every slot the model returned, graded, with the per-card repetition rule applied in slot
 *  order: a sentence already said by an earlier slot is dropped. */
export function gradeSlots(parsed: Record<string, unknown>, view: AdvisorView): Graded {
  const keys = [STRATEGY_SLOT, ...view.now.map((candidate) => reasonSlotKey(candidate.playerId))];
  const said = new Set<string>();
  let accepted: Record<string, string> = {};
  const rejected: string[] = [];
  for (const key of keys) {
    const raw = parsed[key];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const text = raw.trim();
    const violations = gradeSlot(text, view.ledger, key === STRATEGY_SLOT ? ADVISOR_CONFIG.voice.strategyMaxWords : ADVISOR_CONFIG.voice.reasonMaxWords);
    if (violations.length > 0) {
      rejected.push(`${key}: ${violations[0]}`);
      continue;
    }
    const normalized = normalizeSentence(text);
    if (said.has(normalized)) {
      rejected.push(`${key}: repeats another slot on this card`);
      continue;
    }
    said.add(normalized);
    accepted = { ...accepted, [key]: text };
  }
  return { accepted, rejected };
}

function resultFrom(graded: Graded, usage: GatewayUsage | null): VoiceResult {
  const { [STRATEGY_SLOT]: strategy, ...rest } = graded.accepted;
  const reasons = Object.fromEntries(Object.entries(rest).map(([key, text]) => [key.slice("reason:".length), text]));
  return { strategy: strategy ?? null, reasons, rejected: graded.rejected, usage, failure: null };
}

/** One turn's voice. Never throws; see the module docblock. */
export async function generateAdvisorVoice(view: AdvisorView, deps: CapsuleWriterDeps): Promise<VoiceResult> {
  const messages = [
    { role: "system", content: VOICE_RULES },
    { role: "user", content: voicePromptFor(view) },
  ];
  let usage: GatewayUsage | null = null;
  try {
    const response = await postChatCompletion(messages, ADVISOR_CONFIG.voice.maxTokens, deps, NARRATIVE_MIN_WORDS);
    usage = addGatewayUsage(usage, response.usage);
    const parsed = parseSlotObject(response.content);
    if (parsed === null) return { ...EMPTY, usage, failure: "the voice completion was not a JSON object" };
    return resultFrom(gradeSlots(parsed, view), usage);
  } catch (error: unknown) {
    if (error instanceof CapsuleGenerationError && error.billedUsage !== null) usage = addGatewayUsage(usage, error.billedUsage);
    return { ...EMPTY, usage, failure: error instanceof Error ? error.message : String(error) };
  }
}
