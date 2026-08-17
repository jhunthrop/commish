import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players, playerStatLines, scoringSettings } from "@/db/schema";
import type { DraftPoolEntry } from "@/domain/draft";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring";

/**
 * The draftable pool, ranked. Ranking is projected season points under the league's own
 * scoring settings, computed with the same scoring engine that scores real weeks — so a
 * PPR league's board looks like a PPR board. Ties break on player id so the order is total,
 * which is what makes autopick reproducible.
 *
 * The ranking is snapshotted into the START_DRAFT action; nothing re-ranks mid-draft.
 */
export async function buildDraftPool(db: Db, leagueId: string): Promise<readonly DraftPoolEntry[]> {
  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  const rules = settings === undefined ? PPR_SCORING : settings;

  const roster = await db.select().from(players);
  const lines = await db.select().from(playerStatLines);
  const positionById = new Map(roster.map((p) => [p.id, p.position]));

  const projected = new Map<string, number>();
  for (const line of lines) {
    const position = positionById.get(line.playerId);
    if (position === undefined) continue;
    projected.set(line.playerId, (projected.get(line.playerId) ?? 0) + computeFantasyPoints(line, position, rules));
  }

  return [...roster]
    .sort((a, b) => {
      const diff = (projected.get(b.id) ?? 0) - (projected.get(a.id) ?? 0);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    })
    .map((p) => ({ playerId: p.id, position: p.position }));
}
