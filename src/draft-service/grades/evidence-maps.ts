/**
 * THE ONE PLACE `GradeDraftInput`'s TWO EVIDENCE MAPS COME FROM (Task 11 extraction) — both
 * `draft-grades-job.ts` (a real, completed draft, storing its grade) and the mock debrief's
 * read-time grade (`@/mock-draft-service/debrief`, never stored) derive `pointsByPlayerId` and
 * `valueByPlayerId` from an already-loaded evidence pool the identical way: raw projected points
 * for the first, `valueBoardIndexed`'s value-over-replacement for the second, against the
 * league's own roster shape. Pulled out here rather than left inline twice, so a future change to
 * either derivation cannot drift between the stored-grade path and the read-time one.
 *
 * Pure: no I/O. Both callers already hold `pool` (from `evidencePoolFor`, a DB read that stays
 * their own).
 */
import type { SimPlayerEvidence } from "@/draft-service/sim/types";
import { valueBoardIndexed, type LeagueShape } from "@research/projections/decide/replacement";

export interface GradeEvidenceMaps {
  readonly pointsByPlayerId: ReadonlyMap<string, number>;
  readonly valueByPlayerId: ReadonlyMap<string, number>;
}

export function gradeEvidenceMaps(pool: readonly SimPlayerEvidence[], shape: LeagueShape): GradeEvidenceMaps {
  const pointsByPlayerId = new Map(pool.map((entry) => [entry.playerId, entry.projectedPoints] as const));
  const { byPlayerId } = valueBoardIndexed(
    pool.map((entry) => ({ playerId: entry.playerId, position: entry.position, projectedPoints: entry.projectedPoints })),
    shape,
  );
  const valueByPlayerId = new Map([...byPlayerId].map(([playerId, valued]) => [playerId, valued.valueOverReplacement] as const));
  return { pointsByPlayerId, valueByPlayerId };
}
