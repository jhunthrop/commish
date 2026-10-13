import type { RunStore } from "./run-store";

/** The pointer a reader follows to the newest run that passed every gate. */
export const LATEST_KEY = "runs/latest.json";

/** `runs/<runId>/<path>`: every artifact of one run lives under its id. */
export function runKey(runId: string, path: string): string {
  return `runs/${runId}/${path}`;
}

/** The first file a run writes, the moment its id is taken, so an id is spoken for even when the
 *  run dies before its manifest. */
export const STARTED_FILE = "started.json";

/**
 * A run's id: its UTC start to the hour (`2026-10-12T05`, spec §2.1), with `.2`, `.3` appended when
 * an earlier run in the same hour already took the id. An id is taken by its `started.json`, not its
 * manifest, so a run that crashed half way keeps its partial files and is never overwritten.
 */
export async function nextRunId(store: RunStore, startedAt: Date): Promise<string> {
  const base = startedAt.toISOString().slice(0, 13);
  const taken = async (candidate: string): Promise<boolean> => (await store.get(runKey(candidate, STARTED_FILE))) !== null || (await store.get(runKey(candidate, "manifest.json"))) !== null;
  if (!(await taken(base))) return base;
  for (let attempt = 2; ; attempt += 1) {
    const candidate = `${base}.${attempt}`;
    if (!(await taken(candidate))) return candidate;
  }
}
