import type { ReadonlyDb } from "@/db/client";
import { observationsAsOf } from "../store";
import { DEPTH_METRIC, DEPTH_SOURCE, depthRankFor, type DepthChart } from "./depth";
import type { CurrentRosterStatus } from "./roster-status";

/**
 * THE WEEK-ONE DEPTH CHART, READ TWO WAYS off the same gated rows: as the published ORDERING the
 * board applies (`depthChartAsOf`, `depth.ts`'s multiplier) and as PRESENCE, the last word on a
 * player's status when no dated source names him (`depthChartStatuses`, `current-status.ts`). One
 * module so the two readers of one archive can never disagree about which rows it is.
 */

const WEEK_ONE = 1;

/** The published week-one ordering, read through the same gate as everything else. */
export async function depthChartAsOf(db: ReadonlyDb, season: number, asOf: Date): Promise<DepthChart> {
  const rows = await observationsAsOf(db, { season, week: WEEK_ONE, asOf, source: DEPTH_SOURCE });
  return new Map(rows.filter((row) => row.metric === DEPTH_METRIC).map((row) => [row.playerId, depthRankFor(row.value)] as const));
}

/** Presence on the week-one depth chart: he is listed with a club, dated by the listing itself. */
export async function depthChartStatuses(db: ReadonlyDb, season: number, asOf: Date, playerIds: readonly string[]): Promise<ReadonlyMap<string, CurrentRosterStatus>> {
  const rows = await observationsAsOf(db, { season, week: WEEK_ONE, asOf, source: DEPTH_SOURCE, playerIds: [...playerIds] });
  const out = new Map<string, CurrentRosterStatus>();
  for (const row of rows) {
    if (row.metric !== DEPTH_METRIC) continue;
    const held = out.get(row.playerId);
    if (held === undefined || row.asOf > held.observedAt) out.set(row.playerId, { kind: "active", source: "depth_chart", observedAt: row.asOf, team: null, detail: null });
  }
  return out;
}
