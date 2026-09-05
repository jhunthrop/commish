import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { createSimRunSchema } from "@/draft-service/sim/schemas";
import { requestSimRun } from "@/draft-service/sim/service";
import { listSimRunsForUser, type SimRunRow } from "@/draft-service/sim/store";
import { assertLeagueAccessible, withCurrentUser } from "@/app/api/draft/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_LIMIT = 20;

export interface SimRunView {
  readonly id: string;
  readonly leagueId: string | null;
  readonly config: SimRunRow["config"];
  readonly status: SimRunRow["status"];
  readonly requestedAt: string;
  readonly finishedAt: string | null;
  readonly summary: SimRunRow["summary"];
  readonly error: string | null;
}

function toView(row: SimRunRow): SimRunView {
  return {
    id: row.id,
    leagueId: row.leagueId,
    config: row.config,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    summary: row.summary,
    error: row.error,
  };
}

/** Every sim the caller has requested, newest first — the Simulator page's "my sims" list. */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) => {
    const rows = await listSimRunsForUser(getDb(), userId, LIST_LIMIT);
    return ok<readonly SimRunView[]>(rows.map(toView));
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

    const leagueId = parsed.value.leagueId ?? null;
    const refused = await assertLeagueAccessible(userId, leagueId);
    if (refused !== null) return refused;

    const result = await requestSimRun(getDb(), userId, {
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
        return ok<SimRunView>(toView(result.run));
    }
  });
}
