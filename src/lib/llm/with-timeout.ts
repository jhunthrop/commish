/**
 * Rejects after `ms`, and always clears its timer so no handle is left dangling.
 *
 * Shared by both AI surfaces (`src/ai-advisor/llm-fallback.ts`, `src/draft-service/nudge-copy.ts`)
 * — the wrapper itself carries no product logic, just "give the model a bounded window, then
 * give up," so there is exactly one implementation rather than two identical ones drifting.
 *
 * `label` names WHO timed out in the rejection message only — both callers swallow this error
 * and fall back to their deterministic answer, so nothing user-facing depends on its text.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
