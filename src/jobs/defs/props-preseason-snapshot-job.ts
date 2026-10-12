// THE PRE-KICKOFF PROPS SNAPSHOT AS A LEAGUE-APP JOB. The work and its self-disable at kickoff are
// the research core's (`@research/projections/odds/preseason-snapshot`, whose docblock carries
// the reasoning); this binding owns the payload and the schedule's fire instant.
import type { Db } from "@research/db/client";
import type { JsonObject } from "@research/domain/json";
import type { Clock } from "@research/domain/timing";
import {
  REAL_PROPS_PRESEASON_DEPS,
  snapshotPreseasonProps,
  type PropsPreseasonSnapshotDeps,
  type PropsPreseasonSnapshotPayload,
} from "@research/projections/odds/preseason-snapshot";
import { defineJob, type AnyJobDefinition, type StepOutcome } from "../contract";

export const PROPS_PRESEASON_SNAPSHOT_JOB_NAME = "props-preseason-snapshot";

export function parsePropsPreseasonSnapshotPayload(raw: JsonObject): PropsPreseasonSnapshotPayload {
  const firedAt = raw.firedAt;
  if (firedAt === undefined) return {};
  if (typeof firedAt !== "string" || Number.isNaN(Date.parse(firedAt))) {
    throw new Error(`props-preseason-snapshot payload: firedAt must be an ISO instant string, got ${JSON.stringify(firedAt)}.`);
  }
  return { firedAt };
}

export async function runPropsPreseasonSnapshotStep(
  db: Db,
  clock: Clock,
  payload: PropsPreseasonSnapshotPayload,
  deps: PropsPreseasonSnapshotDeps = REAL_PROPS_PRESEASON_DEPS,
): Promise<StepOutcome> {
  const { summary } = await snapshotPreseasonProps(db, clock, payload, deps);
  return { summary, detail: [] };
}

export const propsPreseasonSnapshotJob: AnyJobDefinition = defineJob<PropsPreseasonSnapshotPayload>({
  name: PROPS_PRESEASON_SNAPSHOT_JOB_NAME,
  maxAttempts: 3,
  // Up to 21 sequential fetches (one /events call plus up to MAX_EVENTS_PER_RUN event-odds calls).
  timeoutMs: 5 * 60_000,
  backoff: { baseMs: 60_000, maxMs: 10 * 60_000 },
  parsePayload: parsePropsPreseasonSnapshotPayload,
  steps: [{ name: "snapshot", run: (ctx, payload) => runPropsPreseasonSnapshotStep(ctx.db, ctx.clock, payload) }],
});
