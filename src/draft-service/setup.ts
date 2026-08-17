import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues } from "@/db/schema";
import { DRAFT_CLOCK_SCHEDULE, type DraftConfig } from "@/draft-engine";

/**
 * The static half of a draft's state: what the reducer needs and the action log doesn't
 * carry, read straight from the rows that own it. Null when the draft doesn't exist.
 */
export async function loadDraftConfig(db: Db, draftId: string): Promise<DraftConfig | null> {
  const [row] = await db
    .select({
      draftId: drafts.id,
      leagueId: drafts.leagueId,
      format: drafts.format,
      kickoffAt: drafts.kickoffAt,
      auctionBudget: drafts.auctionBudget,
      slotConfig: leagues.rosterSlots,
    })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(eq(drafts.id, draftId));
  if (row === undefined) return null;
  return {
    draftId: row.draftId,
    leagueId: row.leagueId,
    format: row.format,
    kickoffAt: row.kickoffAt.toISOString(),
    auctionBudget: row.auctionBudget,
    slotConfig: row.slotConfig,
    clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };
}
