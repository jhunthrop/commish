import { asc, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { statWeeks } from "@/db/schema";

/**
 * The earliest week not yet final — the week the odds and salary feeds are asking about.
 *
 * Falls back to week 1 when `stat_weeks` is empty, which is the preseason: exactly when ADP drift
 * and injury designations matter most and the scoring half of the tick has nothing to do at all.
 *
 * Shared by the ingestion worker (`@/stats-pipeline`, its `getCapture()`) and the capture harvest
 * job, so both derive the same week rather than two copies of this query drifting apart.
 */
export async function currentNflWeek(db: Db): Promise<number> {
  const [row] = await db
    .select({ week: statWeeks.week })
    .from(statWeeks)
    .where(ne(statWeeks.status, "final"))
    .orderBy(asc(statWeeks.week))
    .limit(1);
  return row?.week ?? 1;
}
