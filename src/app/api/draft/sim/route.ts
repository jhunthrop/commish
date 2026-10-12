import { getDb } from "@research/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { createSimRunSchema } from "@/draft-service/sim/schemas";
import { requestSimRun } from "@/draft-service/sim/service";
import { listSimRunsForUser } from "@/draft-service/sim/store";
import { toSimRunView, type SimRunView } from "@/draft-service/sim/view";
import { assertLeagueAccessible, withCurrentUser } from "@/app/api/draft/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_LIMIT = 20;

/** Every sim the caller has requested, newest first — the Simulator page's "my sims" list. */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) => {
    const db = getDb();
    const rows = await listSimRunsForUser(db, userId, LIST_LIMIT);
    const views = await Promise.all(rows.map((row) => toSimRunView(db, row)));
    return ok<readonly SimRunView[]>(views);
  });
}

/**
 * Requests a sim run: a cache hit or a run at or under `SIM_CONFIG.syncRunThreshold` returns
 * finished immediately; a larger run returns `pending` and the caller polls
 * `GET /api/draft/sim/[simRunId]` (Task 3's query invalidation drives that from the page).
 */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const parsed = await parseJson(req, createSimRunSchema);
    if (!parsed.ok) return parsed.response;

    const db = getDb();
    const leagueId = parsed.value.leagueId ?? null;
    const refused = await assertLeagueAccessible(userId, leagueId);
    if (refused !== null) return refused;

    const result = await requestSimRun(db, userId, {
      leagueId,
      slot: parsed.value.slot,
      rounds: parsed.value.rounds,
      runs: parsed.value.runs,
      sharpness: parsed.value.sharpness,
    });

    switch (result.outcome) {
      case "league_not_found":
        return fail("That league could not be found.", 404);
      case "over_budget":
        return fail("You already have sims running. Wait for one to finish before starting another.", 429);
      case "cached":
      case "completed":
      case "queued":
        return ok<SimRunView>(await toSimRunView(db, result.run));
    }
  });
}
