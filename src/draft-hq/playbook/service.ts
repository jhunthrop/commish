/**
 * THE PLAYBOOK'S OWN DATA (spec §8) — strategy cards, the slot advisor, and the scarcity curve,
 * every number real: `canonicalSimFor` reuses `requestSimRun` (the identical cache, evidence pool
 * and sync-run path Task 2 built for the Simulator) rather than a second sim pipeline, so a
 * Playbook read and a Simulator run of the same league+slot can never quietly disagree. Runs are
 * pinned at `SIM_CONFIG.syncRunThreshold` (100) specifically so a Playbook page render always
 * gets a finished sim inline — never a "pending" state on a page that has no run button of its
 * own to explain one.
 */
import type { Db } from "@/db/client";
import { valueBoard, type LeagueShape } from "@/projections/decide/replacement";
import { evidencePoolFor } from "@/draft-service/sim/evidence";
import { requestSimRun } from "@/draft-service/sim/service";
import type { BuildOutcome, SimSummary } from "@/draft-service/sim/types";
import { SIM_CONFIG, SIM_SHARPNESS } from "@/draft-service/sim/config";
import { totalRosterSlots } from "@/draft-engine";

export interface CanonicalSimResult {
  readonly outcome: "ready" | "no_evidence_board" | "over_budget" | "league_not_found";
  readonly summary: SimSummary | null;
}

/** The canonical, cached sim for one league (or the generic default) at one slot — what every
 *  strategy card and the slot advisor's own claim reads from. */
export async function canonicalSimFor(db: Db, userId: string, params: { readonly leagueId: string | null; readonly shape: LeagueShape; readonly slot: number }): Promise<CanonicalSimResult> {
  const result = await requestSimRun(db, userId, {
    leagueId: params.leagueId,
    slot: params.slot,
    rounds: totalRosterSlots(params.shape.rosterSlots),
    runs: SIM_CONFIG.syncRunThreshold,
    sharpness: SIM_SHARPNESS.mixed,
  });
  if (result.outcome === "over_budget") return { outcome: "over_budget", summary: null };
  if (result.outcome === "league_not_found") return { outcome: "league_not_found", summary: null };
  if (result.run.status === "failed" || result.run.summary === null) return { outcome: "no_evidence_board", summary: null };
  if ("bySlot" in result.run.summary) return { outcome: "no_evidence_board", summary: null }; // never requested here; defensive only
  return { outcome: "ready", summary: result.run.summary };
}

/**
 * ONE HONEST SENTENCE PER BUILD, template-derived from the sim's own numbers — never a
 * hand-written hot take (spec §8's own rule). Every clause names a number the summary actually
 * carries: how often the build emerged naturally across the runs, its measured top-3 rate, and
 * how that rate compares to the arithmetic baseline. `runsWithLabel === 0` (the label never fired
 * in this sample) says so plainly rather than dividing by zero into a fabricated rate.
 */
export function describeBuild(build: BuildOutcome, runs: number, baselineTop3Rate: number): string {
  if (build.runsWithLabel === 0) {
    return `This build did not emerge in any of the ${runs} simulated rooms from this slot this run.`;
  }
  const sharePct = Math.round((build.runsWithLabel / runs) * 100);
  const ratePct = Math.round(build.top3FinishRate * 100);
  const baselinePct = Math.round(baselineTop3Rate * 100);
  const comparison =
    build.top3FinishRate > baselineTop3Rate
      ? `above the ${baselinePct}% baseline`
      : build.top3FinishRate < baselineTop3Rate
        ? `below the ${baselinePct}% baseline`
        : `even with the ${baselinePct}% baseline`;
  return `This build emerged in ${sharePct}% of the ${runs} simulated rooms from this slot and finished top-3 ${ratePct}% of those times, ${comparison}.`;
}

export interface ScarcityPoint {
  readonly round: number;
  readonly valueOverReplacement: number;
}

/**
 * POSITIONAL SCARCITY, BY ROUND — real replacement-level data (`@/projections/decide/replacement.ts`),
 * sampled at each round's own leading overall pick. Every player is priced by value over
 * replacement under `shape` (the league's own team count and roster slots, exactly like the
 * Board's own `boardRows`), sorted best first; round R's point is the VOR of the
 * `(R-1) * teamCount + 1`-th player in that order — the player whose round a real 12-team room
 * would be taking him in, if the room drafted strictly by value. A round past the pool's own
 * depth is left off rather than extrapolated.
 */
export async function scarcityCurve(db: Db, shape: LeagueShape, rounds: number): Promise<readonly ScarcityPoint[] | null> {
  const { pool } = await evidencePoolFor(db);
  if (pool.length === 0) return null;
  const valued = valueBoard(pool.map((entry) => ({ playerId: entry.playerId, position: entry.position, projectedPoints: entry.projectedPoints })), shape);
  const sorted = [...valued].sort((a, b) => b.valueOverReplacement - a.valueOverReplacement);
  const points: ScarcityPoint[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const index = (round - 1) * shape.teamCount;
    const player = sorted[index];
    if (player === undefined) break;
    points.push({ round, valueOverReplacement: player.valueOverReplacement });
  }
  return points.length === 0 ? null : points;
}
