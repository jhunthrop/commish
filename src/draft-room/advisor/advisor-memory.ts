import type { AdvisorView } from "@/draft-service/assistant/view";
import { ADVISOR_ROOM_CONFIG } from "./config";

export interface AdvisorMemoryEntry {
  readonly lastView: AdvisorView | null;
}

/**
 * THE ADVISOR'S MODULE-SCOPE MEMORY (the founder's architecture ruling, 2026-09-05, carried over
 * from the assistant tab): a remount picks up exactly where the last instance left off, the last
 * view on screen until the refetch lands. A bounded map keyed by `draftId`.
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
