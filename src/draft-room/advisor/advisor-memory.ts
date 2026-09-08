import type { AdvisorView, DraftPlan } from "@/draft-service/assistant/view";
import { ADVISOR_ROOM_CONFIG } from "./config";

export interface AdvisorMemoryEntry {
  readonly lastView: AdvisorView | null;
  readonly prePickView: AdvisorView | null;
  readonly previousPlan: DraftPlan | null;
}

/**
 * THE ADVISOR'S MODULE-SCOPE MEMORY (the founder's architecture ruling, 2026-09-05, carried over
 * from the assistant tab): the tab fetches only while mounted, and picking a player on the Pool
 * tab unmounts it. A plain `useState` latch would die with that unmount, so a bounded map keyed
 * by `draftId` is what lets a remount pick up exactly where the last instance left off: the last
 * view, the post-pick beat's latch, and the plan the manager last saw for the changed-since line.
 */
const memory = new Map<string, AdvisorMemoryEntry>();

export function recallAdvisor(draftId: string): AdvisorMemoryEntry | null {
  return memory.get(draftId) ?? null;
}

/** Write-through on every fetch that lands; re-inserting moves the key to the end so eviction
 *  is least-recently-written. */
export function rememberAdvisor(draftId: string, entry: AdvisorMemoryEntry): void {
  memory.delete(draftId);
  memory.set(draftId, entry);
  while (memory.size > ADVISOR_ROOM_CONFIG.rememberedDrafts) {
    const oldestKey = memory.keys().next().value;
    if (oldestKey === undefined) break;
    memory.delete(oldestKey);
  }
}

export function forgetAdvisor(draftId: string): void {
  memory.delete(draftId);
}

/** Test seam only. */
export function resetAdvisorMemoryForTests(): void {
  memory.clear();
}
