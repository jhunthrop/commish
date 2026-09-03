import type { Db } from "@/db/client";
import { getDb } from "@/db/client";
import { ok } from "@/lib/api/respond";
import { rankedPlayers } from "@/draft-service/pool";
import type { DraftPlayersBody } from "@/draft-room/contract";
import type { Player } from "@/domain/player";
import type { BoardReason } from "@/projections/preseason/board";
import { nflPlayerIdsFor } from "@/projections/crosswalk";
import { BOARD_SOURCE, boardReasons } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { chipEligibleLaws, registry } from "@/projections/laws/registry";
import { byeWeeksByTeam } from "@/league-service/nfl-schedule";
import { withLeagueMember, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The pool's own law-backed reasons, keyed by the LEAGUE's own player id — `boardReasons` keys
 * by `nfl_players.id` (a gsis id), and the draft room only ever knows a `players.id`, so this is
 * the one place the two id spaces meet for this surface. A player the crosswalk could not place,
 * or one the board never ranked, is simply absent from the result — the same "absence means
 * nothing to say" rule `boardReasons` itself keeps, carried through one more join.
 */
async function reasonsByLeaguePlayerId(db: Db, players: readonly Player[]): Promise<Readonly<Record<string, readonly BoardReason[]>>> {
  const [crosswalk, byNflPlayerId] = await Promise.all([
    nflPlayerIdsFor(db, players.map((player) => player.id)),
    boardReasons(db, BOARD_SOURCE, PRODUCT_SEASON),
  ]);
  const out: Record<string, readonly BoardReason[]> = {};
  for (const player of players) {
    const nflPlayerId = crosswalk.get(player.id);
    if (nflPlayerId === undefined) continue;
    const reasons = byNflPlayerId.get(nflPlayerId);
    if (reasons !== undefined) out[player.id] = reasons;
  }
  return out;
}

/**
 * Player metadata for the room's pool, in the same ranked order `START_DRAFT` snapshots.
 * Deliberately a second request instead of a field on `GET /api/drafts/[draftId]`: the draft
 * view is refetched on every gap and every reconnect, while this dictionary never changes
 * during a draft. It rides the same `withLeagueMember` seam as the state route (both built
 * on `withDraftActor`), so its authorization can never drift from the state route's.
 *
 * Task 8: `reasons`/`laws` ride the same one-per-draft cadence as `players` — the client hook
 * fetches this route once per `draftId`, never on a resync, so a law's own reasons cost nothing
 * beyond the first load.
 */
export async function GET(request: Request, context: RouteContext) {
  return withLeagueMember(request, context, async (actor) => {
    const db = getDb();
    const players = await rankedPlayers(db, actor.leagueId);
    const [reasons, byes] = await Promise.all([reasonsByLeaguePlayerId(db, players), byeWeeksByTeam(db)]);
    const body: DraftPlayersBody = {
      players,
      reasons,
      // Chip-eligible only (IMPORTANT 3 RULING, fix round; widened Task 8) — every tribal law plus
      // every CONFIRMED discovered one; see `chipEligibleLaws`'s own docblock.
      laws: chipEligibleLaws(registry()),
      // The Quilt's BYES tab and lens (2026-09-02): a real-schedule fact, same one-per-draft
      // cadence as `players` — a bye week does not change during a draft.
      byeWeeks: Object.fromEntries(byes),
    };
    return ok(body);
  });
}
