import { desc, eq } from "drizzle-orm";
import type { getDb } from "@/db/client";
import { captureSnapshots } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

/**
 * Every current injury designation, keyed by player id, off the latest harvested
 * `tank01_injuries_by_date` snapshot. One small read; a player the feed does not name is simply
 * absent — healthy as far as the source says. Extracted from `player.ts`'s single-player read
 * when injured reserve became the second consumer (roadmap item 3, 2026-08-30).
 */
export async function injuryDesignations(db: Db): Promise<ReadonlyMap<string, string>> {
  const [snapshot] = await db
    .select({ payload: captureSnapshots.payload })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, "tank01_injuries_by_date"))
    .orderBy(desc(captureSnapshots.capturedAt))
    .limit(1);
  const body = snapshot?.payload as Record<string, unknown> | undefined;
  const list = body?.injList;
  if (!Array.isArray(list)) return new Map();
  const designations = new Map<string, string>();
  for (const raw of list) {
    const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    if (typeof entry.playerID === "string" && typeof entry.designation === "string" && entry.designation !== "") {
      designations.set(entry.playerID, entry.designation);
    }
  }
  return designations;
}

/**
 * Designations that justify an injured-reserve placement. "Q" (questionable) deliberately does
 * NOT: a questionable player probably plays, and parking him on IR while he does is the stash
 * exploit every incumbent's rule exists to stop.
 */
export const IR_ELIGIBLE_DESIGNATIONS: ReadonlySet<string> = new Set(["O", "IR", "PUP", "NFI", "SUS", "D"]);
