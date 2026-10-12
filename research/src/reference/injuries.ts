import { desc, eq } from "drizzle-orm";
import type { getDb } from "@research/db/client";
import { captureSnapshots } from "@research/db/schema";

type Db = ReturnType<typeof getDb>;

export interface InjurySnapshot {
  /** When the snapshot naming these designations was captured; `null` when no snapshot exists
   *  yet at all. */
  readonly capturedAt: Date | null;
  readonly designations: ReadonlyMap<string, string>;
}

/**
 * The latest harvested `tank01_injuries_by_date` snapshot, in full: every current designation
 * keyed by player id, and WHEN it was captured — the capture instant a consumer needs to state
 * "as of" honestly (`src/capsules/collect.ts`'s own `injuryAsOf` fact) rather than silently
 * implying a designation is current as of the moment it happens to be read. One small read.
 */
export async function injurySnapshot(db: Db): Promise<InjurySnapshot> {
  const [snapshot] = await db
    .select({ payload: captureSnapshots.payload, capturedAt: captureSnapshots.capturedAt })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, "tank01_injuries_by_date"))
    .orderBy(desc(captureSnapshots.capturedAt))
    .limit(1);
  if (snapshot === undefined) return { capturedAt: null, designations: new Map() };
  const body = snapshot.payload as Record<string, unknown> | undefined;
  const list = body?.injList;
  const designations = new Map<string, string>();
  if (Array.isArray(list)) {
    for (const raw of list) {
      const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
      if (typeof entry.playerID === "string" && typeof entry.designation === "string" && entry.designation !== "") {
        designations.set(entry.playerID, entry.designation);
      }
    }
  }
  return { capturedAt: snapshot.capturedAt, designations };
}

/**
 * Every current injury designation, keyed by player id — a player the feed does not name is
 * simply absent, healthy as far as the source says. Extracted from `player.ts`'s single-player
 * read when injured reserve became the second consumer (roadmap item 3, 2026-08-30); now a thin
 * wrapper over `injurySnapshot`, whose own capture instant a later consumer (the player capsule
 * sweep) also needed.
 */
export async function injuryDesignations(db: Db): Promise<ReadonlyMap<string, string>> {
  return (await injurySnapshot(db)).designations;
}

/**
 * Designations that justify an injured-reserve placement. "Q" (questionable) deliberately does
 * NOT: a questionable player probably plays, and parking him on IR while he does is the stash
 * exploit every incumbent's rule exists to stop.
 */
export const IR_ELIGIBLE_DESIGNATIONS: ReadonlySet<string> = new Set(["O", "IR", "PUP", "NFI", "SUS", "D"]);
