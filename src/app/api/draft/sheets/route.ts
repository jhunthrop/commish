import { getDb } from "@research/db/client";
import { ok, parseJson } from "@/lib/api/respond";
import { createSheet, listSheets } from "@/draft-hq/sheet/service";
import { createSheetSchema } from "@/draft-hq/sheet/schemas";
import type { Sheet, SheetSummary } from "@/draft-hq/sheet/types";
import { assertLeagueAccessible, withCurrentUser } from "@/app/api/draft/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every sheet the caller owns — the picker's own read. */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) => {
    const sheets = await listSheets(getDb(), userId);
    return ok<readonly SheetSummary[]>(sheets);
  });
}

/** Creates a fresh, empty sheet. `leagueId` (optional) scopes it to one league's own rules; the
 *  caller must belong to that league. */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const parsed = await parseJson(req, createSheetSchema);
    if (!parsed.ok) return parsed.response;

    const leagueId = parsed.value.leagueId ?? null;
    const refused = await assertLeagueAccessible(userId, leagueId);
    if (refused !== null) return refused;

    const sheet = await createSheet(getDb(), userId, { name: parsed.value.name, leagueId });
    return ok<Sheet>(sheet);
  });
}
