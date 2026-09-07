// THE REGISTRY — every job definition the runners can execute, keyed by name. Definitions are
// code; a `jobs` row whose name is not here dead-letters (the executor's own no-definition path)
// rather than guessing. `registry.test.ts` pins that every schedule's job is registered.
import type { AnyJobDefinition } from "./contract";
import { adpSnapshotJob } from "./defs/adp-snapshot-job";
import { capsuleSweepJob } from "./defs/capsule-sweep-job";
import { captureHarvestJob } from "./defs/capture-harvest-job";
import { draftGradesJob } from "./defs/draft-grades-job";
import { draftSweepJob } from "./defs/draft-sweep-job";
import { peekDocumentJob } from "./defs/peek-document-job";
import { propsPreseasonSnapshotJob } from "./defs/props-preseason-snapshot-job";
import { seasonWeekJob } from "./defs/season-week-job";
import { simJob } from "./defs/sim-job";
import { winTotalsJob } from "./defs/win-totals-job";

const ALL_DEFINITIONS: readonly AnyJobDefinition[] = [
  seasonWeekJob,
  draftSweepJob,
  simJob,
  adpSnapshotJob,
  propsPreseasonSnapshotJob,
  capsuleSweepJob,
  draftGradesJob,
  captureHarvestJob,
  winTotalsJob,
  peekDocumentJob,
];

export const JOB_DEFINITIONS: ReadonlyMap<string, AnyJobDefinition> = new Map(
  ALL_DEFINITIONS.map((definition) => [definition.name, definition]),
);

if (JOB_DEFINITIONS.size !== ALL_DEFINITIONS.length) {
  throw new Error("job registry: two definitions share a name.");
}
