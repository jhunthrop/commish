/**
 * THE ADVISOR CORE — the live strategist's whole computation over an already-valued board and a
 * replayed `DraftState`, minus the two DB reads and the writer. `assistantCallCore` (`call.ts`)
 * stays the engine underneath for the now card (candidates by value and need, make-it-back odds,
 * the build labels); this adds the opponent model, the three-turn plan, the room signals, the
 * template floor and the turn's own fact ledger, and stamps the result with the pick and the
 * engine sequence it was computed at.
 *
 * Pure, so the Draft HQ demo computes REAL advisor views over its replayed room the same way a
 * live room does — one function, never a second implementation of "what the advisor says".
 */
import { assignSlot, rosterFor, type DraftState } from "@/draft-engine";
import { inferSeatDrivers } from "../sim/seat-model";
import { upcomingTurnsFor } from "../sim/horizon-odds";
import { assistantCallCore, type AssistantCallCoreInput, type AssistantCandidate, type ValuedEntry } from "./call";
import { ADVISOR_CONFIG } from "./config";
import { buildTurnLedger } from "./ledger";
import { computePlan } from "./plan";
import { roomSignals } from "./signals";
import { strategyTemplate, templateFamily, templateReason, type TemplateContext } from "./template";
import type { AdvisorView, AdvisorVoice, NowCandidate } from "./view";

export interface AdvisorCoreInput extends Omit<AssistantCallCoreInput, "shortlistSize" | "drivers"> {
  /** Display names by player id; a name the caller cannot supply renders as the id. */
  readonly names: Readonly<Record<string, string>>;
  /** Plan runs, for a caller that wants fewer than the configured 200 (tests, the demo). */
  readonly runs?: number;
}

const VOICE_ABSENT: AdvisorVoice = { status: "absent", strategy: null, reasons: {} };

type NowFacts = Omit<NowCandidate, "templateReason" | "templateShape">;

function nowFacts(candidate: AssistantCandidate, state: DraftState, askingTeamId: string, valued: ReadonlyMap<string, ValuedEntry>): NowFacts {
  const entry = valued.get(candidate.playerId);
  const assigned = assignSlot({ position: candidate.position, roster: rosterFor(state, askingTeamId), slotConfig: state.config.slotConfig });
  return {
    playerId: candidate.playerId,
    position: candidate.position,
    valueOverReplacement: entry?.valueOverReplacement ?? 0,
    positionRank: entry?.positionRank ?? 0,
    makeItBack: candidate.makeItBack === null || candidate.makeItBack.survival === null ? null : { survival: candidate.makeItBack.survival, runs: candidate.makeItBack.runs },
    fillsSlot: assigned.ok ? assigned.slot : null,
    reasons: candidate.reasons,
  };
}

/** The now rows with their template sentences, shapes dealt per fact family in row order so no
 *  two rows on the card share one (`template.ts`'s own docblock). */
function nowRows(facts: readonly NowFacts[], context: TemplateContext): readonly NowCandidate[] {
  const dealt = new Map<"cliff" | "value", number>();
  return facts.map((row) => {
    const family = templateFamily(row.reasons);
    const variant = dealt.get(family) ?? 0;
    dealt.set(family, variant + 1);
    const sentence = templateReason(row, context, variant);
    return { ...row, templateReason: sentence.text, templateShape: sentence.shape };
  });
}

function picksUntil(state: DraftState, pickNumber: number): number {
  return Math.max(0, pickNumber - state.pickNumber);
}

/** `null` only when the asking seat has no further turn to advise — `assistantCallCore`'s own
 *  defensive case. See the module docblock. */
export function advisorCore(input: AdvisorCoreInput): AdvisorView | null {
  const { state, askingTeamId, valued, names } = input;
  const drivers = inferSeatDrivers(state);
  const runs = input.runs ?? ADVISOR_CONFIG.plan.runs;
  const call = assistantCallCore({ ...input, shortlistSize: ADVISOR_CONFIG.now.shortlistSize, drivers, runs });
  if (call === null) return null;

  const teamCount = state.draftOrder.length;
  const nextPickNumber = upcomingTurnsFor(state, askingTeamId, 1)[0] ?? null;
  const context: TemplateContext = { names, teamCount, nextPickNumber };
  const { plan, odds } = computePlan({ state, askingTeamId, valued, seed: seedFor(input.seedNamespace, state.sequence), drivers, runs });
  const signals = roomSignals({ state, valued, odds, drivers });

  const partial = {
    pickNumber: call.pickNumber,
    onTheClock: call.onTheClock,
    picksUntilYourTurn: picksUntil(state, call.pickNumber),
    teamCount,
    stamp: { computedAtPick: state.pickNumber, sequence: state.sequence },
    now: nowRows(call.candidates.map((candidate) => nowFacts(candidate, state, askingTeamId, valued)), context),
    plan,
    signals,
    yourBuild: call.yourBuild,
    winningBuilds: call.winningBuilds,
    computedBasis: call.computedBasis,
    names,
  };
  return { ...partial, strategyTemplate: strategyTemplate(plan, signals, context), voice: VOICE_ABSENT, ledger: buildTurnLedger(partial) };
}

/** A small deterministic seed from the room's namespace and sequence: the same room state
 *  plans the same way on every recompute, and a new pick is a new draw. */
function seedFor(namespace: string, sequence: number): number {
  let hash = 2166136261;
  for (const char of `${namespace}:${sequence}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
