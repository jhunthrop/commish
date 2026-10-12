import { z } from "zod";
import { getDb } from "@research-ts/db/client";
import { ok, parseQuery } from "@/lib/api/respond";
import { defaultSheetFor } from "@/draft-hq/sheet/service";
import type { SheetWithEntries } from "@/draft-hq/sheet/types";
import { assertLeagueAccessible, withCurrentUser } from "@/app/api/draft/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ leagueId: z.string().min(1).nullish() });

/**
 * THE ROOM'S OWN LOOKUP (spec §4's sync contract) — "does this caller already have a sheet for
 * this league (or the format-default, with no `leagueId`)?" `data: null` is a real, honest
 * answer: the caller has never started one, and the SHEET drawer tab offers to seed one rather
 * than treating this like an error.
 */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) => {
    const url = new URL(request.url);
    const parsed = parseQuery({ leagueId: url.searchParams.get("leagueId") }, querySchema);
    if (!parsed.ok) return parsed.response;
    const leagueId = parsed.value.leagueId ?? null;

    const refused = await assertLeagueAccessible(userId, leagueId);
    if (refused !== null) return refused;

    const sheet = await defaultSheetFor(getDb(), userId, leagueId);
    return ok<SheetWithEntries | null>(sheet);
  });
}
