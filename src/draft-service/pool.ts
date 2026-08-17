import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players, playerStatLines, scoringSettings } from "@/db/schema";
import type { DraftPoolEntry } from "@/domain/draft";
import type { Player } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring";

/**
 * The league's players, best projected season first, ties broken by player id so the order is
 * total. Projection uses the league's own scoring settings via the same scoring engine that
 * scores real weeks, so a PPR league's board looks like a PPR board.
 */
export async function rankedPlayers(db: Db, leagueId: string): Promise<readonly Player[]> {
  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  const rules = settings === undefined ? PPR_SCORING : settings;

  const roster = await db.select().from(players);
  const lines = await db.select().from(playerStatLines);
  const positionById = new Map(roster.map((player) => [player.id, player.position]));

  const projected = new Map<string, number>();
  for (const line of lines) {
    const position = positionById.get(line.playerId);
    if (position === undefined) continue;
    projected.set(line.playerId, (projected.get(line.playerId) ?? 0) + computeFantasyPoints(line, position, rules));
  }

  return [...roster].sort((a, b) => {
    const diff = (projected.get(b.id) ?? 0) - (projected.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

/**
 * The draftable pool as the engine wants it: id + position, in `rankedPlayers` order. This is
 * the ranking snapshotted into the START_DRAFT action; nothing re-ranks mid-draft.
 */
export async function buildDraftPool(db: Db, leagueId: string): Promise<readonly DraftPoolEntry[]> {
  return (await rankedPlayers(db, leagueId)).map((player) => ({ playerId: player.id, position: player.position }));
}
