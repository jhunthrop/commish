import { eq } from "drizzle-orm";
import type { Db, DbTx } from "@research/db/client";
import { players } from "@research/db/schema";
import { scoringSettings } from "@/db/schema";
import type { DraftPoolEntry } from "@research/domain/draft";
import type { Player } from "@research/domain/player";
import { PPR_SCORING } from "@research/domain/scoring";
import { LEAGUE_CONFIG } from "@/league";
import { leagueBoardFormat } from "@/league-service/board-format";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";
import { reasonsByLeaguePlayerId } from "@research/projections/preseason/reasons-by-player";
import { rosterStatusNoteOf } from "@research/projections/preseason/roster-status";
import { computeFantasyPoints } from "@research/scoring";
import { seasonStatTotalsByPlayer } from "./season-totals";

/**
 * Cross-call cache for `rankedPlayers`, keyed by league id.
 *
 * `rankedPlayers` is expensive — every player × every week of stat lines, run through the
 * scoring engine — and this phase calls it repeatedly for the SAME league: once per
 * `GET /api/drafts/[draftId]/players`, once from `startDraft`, and up to 14 times from the
 * season seed. The player/stat-line universe is fixed for this phase (no live feed), and a league's `scoring_settings` row currently has no update path
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
 * The league's players in draft order: ADP ascending first (`players.adp`, written by the stats
 * provider's feed via `ingestAdp` — lower means the market takes that player earlier), and every
 * player the feed does not rank AFTER every player it does. That null-last rule is the point,
 * not a tie-break detail: with a real feed configured, real NFL players carry ADP and fabricated
 * demo players never do, so the demo pool sinks below the real one instead of leading it on the
 * strength of stat lines only the demo data has.
 *
 * Projection (the league's own scoring settings through the same engine that scores real weeks,
 * so a PPR league's board still looks like a PPR board) is the tie-break within an equal ADP and
 * the whole ordering of the no-ADP tail — which also keeps mock-mode boards and every pre-ADP
 * test fixture ranking exactly as before. Final tie-break is player id, so the order is total.
 */
export async function rankedPlayers(db: Db | DbTx, leagueId: string): Promise<readonly Player[]> {
  const cached = cache.get(leagueId);
  if (cached !== undefined) return cached;

  const [settingsRows, roster, totals] = await Promise.all([
    db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId)),
    db.select().from(players),
    // A season projection never needs a week beyond the longest a league can run — bounds the
    // read against a dataset that grows beyond one season's worth of stat lines. Summed in
    // Postgres (Neon cost audit finding 6): one short row per player instead of every game line.
    seasonStatTotalsByPlayer(db, LEAGUE_CONFIG.maxWeeks),
  ]);
  const rules = settingsRows[0] ?? PPR_SCORING;
  const positionById = new Map(roster.map((player) => [player.id, player.position]));

  const projected = new Map<string, number>();
  for (const [playerId, season] of totals) {
    const position = positionById.get(playerId);
    if (position === undefined) continue;
    projected.set(playerId, computeFantasyPoints(season.line, position, rules) + season.defenseTierPoints);
  }

  const ranked = [...roster].sort((a, b) => {
    if (a.adp !== null && b.adp !== null && a.adp !== b.adp) return a.adp - b.adp;
    if ((a.adp === null) !== (b.adp === null)) return a.adp === null ? 1 : -1;
    const diff = (projected.get(b.id) ?? 0) - (projected.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  // NEVER cache a ranking built before any player exists (Phase 4.5, Task 6). A start attempted
  // against an unseeded `players` table is REFUSED ("There are no players to draft yet.") and
  // then legitimately retried — a commissioner presses again, `autoStartDueDrafts` finds the
  // still-scheduled draft next tick, and a mock room's due scan retries by design (a failed solo
  // self-start leaves `startsAt = now` precisely so the ticker finishes it). Caching the empty
  // answer would turn every one of those retries into the same refusal for the rest of the
  // process's life, long after the players landed — the retry loop this line exists to unbreak.
  if (ranked.length > 0) cache.set(leagueId, ranked);
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
  const ranked = await rankedPlayers(db, leagueId);
  const excluded = await excludedFromAutopick(db, leagueId, ranked);
  return ranked.map((player) =>
    excluded.has(player.id) ? { playerId: player.id, position: player.position, excludedFromAutopick: true } : { playerId: player.id, position: player.position },
  );
}

/**
 * THE ROSTER-STATUS GATE'S MARK ON THE POOL (founder report 2026-09-08): every league player the
 * served board has off an active roster, read off the board's own `roster_status` reason through
 * the same crosswalk the pool's reason chips use (`reasonsByLeaguePlayerId`, memoized per board).
 * The LEAGUE'S OWN board decides (`leagueBoardFormat`), the same way its reason chips do; the
 * gate reads one roster, so every format agrees, but reading the league's board keeps one rule
 * for which store a room consults. Snapshotted into START_DRAFT with the pool: see
 * `DraftPoolEntry.excludedFromAutopick`.
 */
async function excludedFromAutopick(db: Db | DbTx, leagueId: string, ranked: readonly Player[]): Promise<ReadonlySet<string>> {
  const board = await leagueBoardFormat(db, leagueId);
  const reasons = await reasonsByLeaguePlayerId(db, ranked, board.source, PRODUCT_SEASON);
  return new Set(Object.entries(reasons).flatMap(([playerId, list]) => (rosterStatusNoteOf(list)?.excluded === true ? [playerId] : [])));
}
