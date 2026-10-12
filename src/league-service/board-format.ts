import { eq } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@research/db/client";
import { PPR_SCORING } from "@research/domain/scoring";
import { boardFormatForLeagueRules, type LeagueBoardFormat } from "@research/board/format-resolution";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";
import type { ScoringRules } from "@research/scoring/compute";
import { scoringSettings } from "@/db/schema";

/**
 * THE LEAGUE'S HALF OF WHICH BOARD A LEAGUE READS. The resolution from a set of rules is the
 * research core's (`@research/board/format-resolution`); reading a league's own `scoring_settings`
 * row is the league app's, so it lives here (the prep site carve-out, 2026-10-12).
 */

/** A league's own rules, or the product's PPR fallback for a league whose row was never written. */
export async function leagueScoringRules(db: Db | ReadonlyDb, leagueId: string): Promise<ScoringRules> {
  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  return settings ?? PPR_SCORING;
}

/** The board a league reads, from its stored scoring row. One small query. */
export async function leagueBoardFormat(db: Db | ReadonlyDb, leagueId: string, season: number = PRODUCT_SEASON): Promise<LeagueBoardFormat> {
  return boardFormatForLeagueRules(await leagueScoringRules(db, leagueId), season);
}
