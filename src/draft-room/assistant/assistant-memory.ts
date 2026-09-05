import type { AssistantCallView } from "@/draft-service/assistant/call";

export interface AssistantMemoryEntry {
  readonly lastCall: AssistantCallView | null;
  readonly prePickCall: AssistantCallView | null;
}

/** How many drafts' worth of assistant state this tab remembers at once. A manager is in one
 *  draft room at a time in the overwhelming case — this is headroom for a stray tab left open
 *  on an old room, not a working set to size for, so a small, fixed bound is enough to keep the
 *  map from growing across a long session without ever mattering to a real user. */
const MAX_REMEMBERED_DRAFTS = 5;

/**
 * THE ASSISTANT'S OWN MODULE-SCOPE MEMORY (the founder's architecture ruling, 2026-09-05):
 * `useAssistant` fetches only while `DrawerAssistantTab` is mounted, and mounting is gated by
 * which quilt tab is showing (`pool-drawer.tsx`/`mobile-room.tsx` render tabs with a ternary, not
 * a display toggle) — that gate is load-bearing (the final review's cost bound depends on the
 * assistant never fetching in the background), so it stays. But picking a player lives on the
 * POOL tab, not the Assistant tab: submitting your own pick means leaving the Assistant tab,
 * which UNMOUNTS it and everything `useAssistant` held in local `useState`/`useRef`. Returning to
 * the tab afterward remounts a brand-new hook instance with nothing to compare the fresh call
 * against, so the post-pick beat's own latch (`use-assistant.ts`'s `prePickCall`) could never
 * form — not a bug in the latch's own onTheClock logic, but the component tree underneath it
 * disappearing mid-flow.
 *
 * This module-scope `Map`, keyed by `draftId`, is the fix: the same pattern `player-peek.tsx`'s
 * module-scope `host` establishes elsewhere in this codebase for a value that must outlive the
 * component that last touched it. A hook instance hydrates from here on mount and writes through
 * on every update, so a remount after the Pool-tab round trip picks up exactly where the last
 * instance left off. NOT a React Context: a context would need a provider mounted ABOVE the tab
 * gate to survive the same unmount, which either pins the fetch to that higher level (the exact
 * cost-bound violation the founder ruled against) or still needs some scope-crossing store
 * underneath it — so a context here buys nothing a plain module-scope map doesn't already give,
 * at the price of a wider surface (a provider, a hook, a value shape threaded through the tree)
 * for a need that is really just "remember one small record per draftId across remounts."
 */
const memory = new Map<string, AssistantMemoryEntry>();

/** The remembered state for `draftId`, or `null` if this tab has never fetched for it (or it has
 *  since aged out of the bounded map below). */
export function recallAssistant(draftId: string): AssistantMemoryEntry | null {
  return memory.get(draftId) ?? null;
}

/** Write-through on every fetch that lands. Re-inserting the key (delete, then set) moves it to
 *  the end of the `Map`'s iteration order, which is what makes the eviction below an actual
 *  least-recently-WRITTEN order rather than a least-recently-created one. */
export function rememberAssistant(draftId: string, entry: AssistantMemoryEntry): void {
  memory.delete(draftId);
  memory.set(draftId, entry);
  while (memory.size > MAX_REMEMBERED_DRAFTS) {
    const oldestKey = memory.keys().next().value;
    if (oldestKey === undefined) break;
    memory.delete(oldestKey);
  }
}

/** Drops one draft's entry outright — called when this seat loses its seat (`myTeamId === null`,
 *  nothing left to remember) and when the hook moves on to a different `draftId` (the room this
 *  entry belonged to is behind it now). A draft this tab never visited is simply absent already,
 *  so this is safe to call unconditionally. */
export function forgetAssistant(draftId: string): void {
  memory.delete(draftId);
}

/** Test-only escape hatch: this module's state is a singleton for the life of the process, so a
 *  test file exercising more than one draft (or the same `draftId` across independent `it`
 *  blocks) must clear it between cases to avoid one test's fetch bleeding into the next's. Never
 *  called from application code. */
export function resetAssistantMemoryForTests(): void {
  memory.clear();
}
