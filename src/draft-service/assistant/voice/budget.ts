/**
 * THE WRITER'S BUDGET — spec 3.5: "with a two-second budget; if the writer is late the template
 * shows and the written one replaces it when it lands. No gateway call is ever on the critical
 * path of the Draft button."
 *
 * One in-flight generation per room state (`key` is `draftId:teamId:sequence`), started the
 * first time the advisor is asked for it and kept in a bounded module-scope map. A request waits
 * at most `budgetMs` for it: a landed result is `ready`, a still-running one is `pending` (the
 * client polls again and finds it landed), a finished one with nothing usable is `absent`. The
 * generation itself keeps running after the budget expires, which is the whole point.
 */
import type { AdvisorVoice } from "../view";
import type { VoiceResult } from "./generate";

interface Slot {
  readonly promise: Promise<VoiceResult>;
  readonly settled: VoiceResult | null;
}

const MAX_SLOTS = 64;
const slots = new Map<string, Slot>();

function remember(key: string, slot: Slot): void {
  slots.delete(key);
  slots.set(key, slot);
  while (slots.size > MAX_SLOTS) {
    const oldest = slots.keys().next().value;
    if (oldest === undefined) break;
    slots.delete(oldest);
  }
}

function voiceOf(result: VoiceResult): AdvisorVoice {
  const usable = result.strategy !== null || Object.keys(result.reasons).length > 0;
  return usable ? { status: "ready", strategy: result.strategy, reasons: result.reasons } : { status: "absent", strategy: null, reasons: {} };
}

const PENDING: AdvisorVoice = { status: "pending", strategy: null, reasons: {} };

function start(key: string, factory: () => Promise<VoiceResult>): Slot {
  const promise = factory().then((result) => {
    const current = slots.get(key);
    if (current !== undefined && current.promise === promise) remember(key, { promise, settled: result });
    return result;
  });
  const slot: Slot = { promise, settled: null };
  remember(key, slot);
  return slot;
}

function withinBudget(promise: Promise<VoiceResult>, budgetMs: number): Promise<VoiceResult | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), budgetMs);
    void promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** The voice for `key`, started on first ask, answered within `budgetMs`. */
export async function voiceWithinBudget(key: string, factory: () => Promise<VoiceResult>, budgetMs: number): Promise<AdvisorVoice> {
  const slot = slots.get(key) ?? start(key, factory);
  if (slot.settled !== null) return voiceOf(slot.settled);
  const result = await withinBudget(slot.promise, budgetMs);
  return result === null ? PENDING : voiceOf(result);
}

/** Test seam only. */
export function resetVoiceBudgetForTests(): void {
  slots.clear();
}
