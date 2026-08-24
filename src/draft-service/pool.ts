import { eq, lte } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { players, playerStatLines, scoringSettings } from "@/db/schema";
import type { DraftPoolEntry } from "@/domain/draft";
import type { Player } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { LEAGUE_CONFIG } from "@/league";
import { computeFantasyPoints } from "@/scoring";

/**
 * Cross-call cache for `rankedPlayers`, keyed by league id.
 *
 * `rankedPlayers` is expensive — every player × every week of stat lines, run through the
 * scoring engine — and this phase calls it repeatedly for the SAME league: once per
 * `GET /api/drafts/[draftId]/players`, once from `startDraft`, and up to 14 times from the
 * season seed. The player/stat-line universe is fixed for this phase (no live feed, see
 * docs/design-system.md), and a league's `scoring_settings` row currently has no update path
 * — it is written once at league creation (`src/league-service/creation.ts`) and never
 * touched again — so a cache keyed on leagueId alone cannot go stale under real usage today.
 *
 * THE INVARIANT THIS RELIES ON: if a commissioner-settings feature ever lets a league's
 * scoring rules change after creation (the same latent gap `docs/draft-engine.md` already
 * flags for `slotConfig`/`auctionBudget`), that write path MUST call
 * `invalidateRankedPlayersCache(leagueId)` afterward, or the draft pool would keep ranking
 * players by the league's old rules.
 */
const cache = new Map<string, readonly Player[]>();

/** Drops one league's cached ranking — call after any future write to its scoring settings. */
export function invalidateRankedPlayersCache(leagueId: string): void {
  cache.delete(leagueId);
}

/** Test-only escape hatch. `truncateAll` calls this so a reseeded test DB never serves a
 *  ranking cached against data that no longer exists. */
export function resetRankedPlayersCacheForTests(): void {
  cache.clear();
}

/**
 * The league's players, best projected season first, ties broken by player id so the order is
 * total. Projection uses the league's own scoring settings via the same scoring engine that
 * scores real weeks, so a PPR league's board looks like a PPR board.
 */
export async function rankedPlayers(db: Db | DbTx, leagueId: string): Promise<readonly Player[]> {
  const cached = cache.get(leagueId);
  if (cached !== undefined) return cached;

  const [settingsRows, roster, lines] = await Promise.all([
    db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId)),
    db.select().from(players),
    // A season projection never needs a week beyond the longest a league can run — bounds the
    // read against a dataset that grows beyond one season's worth of stat lines.
    db.select().from(playerStatLines).where(lte(playerStatLines.week, LEAGUE_CONFIG.maxWeeks)),
  ]);
  const rules = settingsRows[0] ?? PPR_SCORING;
  const positionById = new Map(roster.map((player) => [player.id, player.position]));

  const projected = new Map<string, number>();
  for (const line of lines) {
    const position = positionById.get(line.playerId);
    if (position === undefined) continue;
    projected.set(line.playerId, (projected.get(line.playerId) ?? 0) + computeFantasyPoints(line, position, rules));
  }

  const ranked = [...roster].sort((a, b) => {
    const diff = (projected.get(b.id) ?? 0) - (projected.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  cache.set(leagueId, ranked);
  return ranked;
}

/**
 * The draftable pool as the engine wants it: id + position, in `rankedPlayers` order. This is
 * the ranking snapshotted into the START_DRAFT action; nothing re-ranks mid-draft.
 *
 * Takes `Db | DbTx` (Phase 3.6, Task 8's binding precondition): `startDraft`'s
 * `DraftActionSource` thunk (`@/draft-service/store`) now calls this INSIDE the transaction that
 * holds `drafts FOR UPDATE`, the same seam `slotPreferencesFor`/`loadDraftConfig` already read
 * through under. `rankedPlayers`' own cross-call cache is unaffected either way — it is keyed on
 * `leagueId` alone and reads no transaction state.
 */
export async function buildDraftPool(db: Db | DbTx, leagueId: string): Promise<readonly DraftPoolEntry[]> {
  return (await rankedPlayers(db, leagueId)).map((player) => ({ playerId: player.id, position: player.position }));
}
