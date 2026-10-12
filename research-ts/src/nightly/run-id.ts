import type { RunStore } from "./run-store";

/** The pointer a reader follows to the newest run that passed every gate. */
export const LATEST_KEY = "runs/latest.json";

/** `runs/<runId>/<path>`: every artifact of one run lives under its id. */
export function runKey(runId: string, path: string): string {
  return `runs/${runId}/${path}`;
}

/**
 * A run's id: its UTC start to the hour (`2026-10-12T05`, spec §2.1), with `.2`, `.3` appended when
 * an earlier run in the same hour already wrote a manifest, so a rerun never overwrites the run it
 * is meant to be compared with.
 */
export async function nextRunId(store: RunStore, startedAt: Date): Promise<string> {
  const base = startedAt.toISOString().slice(0, 13);
  if ((await store.get(runKey(base, "manifest.json"))) === null) return base;
  for (let attempt = 2; ; attempt += 1) {
    const candidate = `${base}.${attempt}`;
    if ((await store.get(runKey(candidate, "manifest.json"))) === null) return candidate;
  }
}
