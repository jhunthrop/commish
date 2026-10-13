import { createHash } from "node:crypto";
import type { ArtifactRecord, HeldOutScore, Manifest } from "./artifacts";
import { LATEST_KEY, runKey } from "./run-id";
import type { RunStore } from "./run-store";

/** What `runs/latest.json` holds: the newest run that passed every gate. */
export interface LatestPointer {
  readonly runId: string;
  readonly finishedAt: string;
}

/** Writes one JSON artifact under the run and returns its manifest record. Stable two-space JSON,
 *  so two runs of the same data diff line by line. */
export async function writeArtifact(store: RunStore, runId: string, path: string, value: unknown): Promise<ArtifactRecord> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const key = runKey(runId, path);
  await store.put(key, body);
  return { key, bytes: Buffer.byteLength(body, "utf8"), sha256: createHash("sha256").update(body).digest("hex") };
}

/** Where the held-out backtest's baseline lives: the scores of the newest run whose backtest gate
 *  passed. Kept apart from `runs/latest.json` on purpose: a run failed by another gate (a capsule
 *  missing tonight) still measured the backtest, and the baseline should not stall behind it. */
export const HELD_OUT_BASELINE_KEY = "runs/held-out-baseline.json";

interface HeldOutBaseline {
  readonly runId: string;
  readonly heldOut: readonly HeldOutScore[];
}

/** The backtest baseline the held-out gate compares against, or `null` before any run set one. */
export async function previousHeldOut(store: RunStore): Promise<readonly HeldOutScore[] | null> {
  const body = await store.get(HELD_OUT_BASELINE_KEY);
  return body === null ? null : (JSON.parse(body) as HeldOutBaseline).heldOut;
}

/** Records a run's held-out scores as the new baseline. Called only when its backtest gate passed. */
export async function recordHeldOutBaseline(store: RunStore, runId: string, heldOut: readonly HeldOutScore[]): Promise<void> {
  const baseline: HeldOutBaseline = { runId, heldOut };
  await store.put(HELD_OUT_BASELINE_KEY, `${JSON.stringify(baseline, null, 2)}\n`);
}

/** Moves `runs/latest.json` to a run that passed. A failed run never calls this, so the previous
 *  clean run stays the one the site builds from (spec §4). */
export async function promote(store: RunStore, manifest: Manifest): Promise<void> {
  if (manifest.status !== "passed") throw new Error(`run ${manifest.runId} did not pass its gates and cannot be promoted.`);
  const pointer: LatestPointer = { runId: manifest.runId, finishedAt: manifest.finishedAt };
  await store.put(LATEST_KEY, `${JSON.stringify(pointer, null, 2)}\n`);
}

/** The one line a scheduler log or a report quotes for a run. */
export function manifestSummary(manifest: Manifest): string {
  const failedGates = manifest.gates.filter((gate) => !gate.passed).map((gate) => `${gate.gate} (${gate.reasons.length})`);
  const failedSteps = manifest.steps.filter((step) => step.status === "failed").map((step) => step.name);
  const skipped = manifest.steps.filter((step) => step.status === "skipped").map((step) => step.name);
  return (
    `run ${manifest.runId} ${manifest.status.toUpperCase()}: ${manifest.counts.boards} boards, ${manifest.counts.players} players, ` +
    `${manifest.counts.capsules} capsules, ${manifest.counts.adpFormats} ADP formats, ${manifest.artifacts.length} files` +
    (skipped.length > 0 ? `; skipped ${skipped.join(", ")}` : "") +
    (failedSteps.length > 0 ? `; failed steps ${failedSteps.join(", ")}` : "") +
    (failedGates.length > 0 ? `; failed gates ${failedGates.join(", ")}` : "; every gate passed")
  );
}
