import { getDb } from "@research-ts/db/client";
import { ok } from "@/lib/api/respond";
import { advanceDraftNow } from "@/draft-service";
import { rankedPlayers } from "@/draft-service/pool";
import type { DraftPlayersBody } from "@/draft-room/contract";
import { leagueBoardFormat } from "@/league-service/board-format";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { reasonsByLeaguePlayerId } from "@research-ts/projections/preseason/reasons-by-player";
import { chipEligibleLaws, registry } from "@research-ts/projections/laws/registry";
import { byeWeeksByTeam } from "@research-ts/reference/nfl-schedule";
import { withLeagueMember, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Player metadata for the room's pool, in the same ranked order `START_DRAFT` snapshots.
 * Deliberately a second request instead of a field on `GET /api/drafts/[draftId]`: the draft
 * view is refetched on every gap and every reconnect, while this dictionary never changes
 * during a draft. It rides the same `withLeagueMember` seam as the state route (both built
 * on `withDraftActor`), so its authorization can never drift from the state route's.
 *
 * Task 8: `reasons`/`laws` ride the same one-per-draft cadence as `players` — the client hook
 * fetches this route once per `draftId`, never on a resync, so a law's own reasons cost nothing
 * beyond the first load. Since the Neon cost audit (finding 6) the reasons and the byes are
 * also memoized per process, so a warm instance answers a second draft's first load from memory.
 */
export async function GET(request: Request, context: RouteContext) {
  return withLeagueMember(request, context, async (actor) => {
    // ADVANCE-ON-READ (driver 1): this route is the room's other first-load read, so it too
    // fast-forwards the draft before answering — see `advanceDraftNow`'s own docblock.
    await advanceDraftNow(actor.draftId);
    const db = getDb();
    const players = await rankedPlayers(db, actor.leagueId);
    // The league's own board (the scoring-formats round): a half-PPR room reads the half board's
    // reasons, decided by its scoring row, never by a selector.
    const board = await leagueBoardFormat(db, actor.leagueId);
    const [reasons, byes] = await Promise.all([reasonsByLeaguePlayerId(db, players, board.source, PRODUCT_SEASON), byeWeeksByTeam(db)]);
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
