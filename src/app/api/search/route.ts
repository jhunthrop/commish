import { getDb } from "@research-ts/db/client";
import { ok, parseQuery } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import type { SearchBody } from "@/search/contract";
import { siteSearch } from "@/search/service";
import { searchQuerySchema, searchRateLimited } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/search?q=` — the site search, answered from the in-memory index (`@/search/service`).
 *
 * Behind `withCurrentUser` like every other signed-in read (401 JSON, never a redirect, one error
 * boundary), rate limited per caller (`SEARCH_CONFIG.rateLimit`), and the query validated at the
 * boundary so a malformed or oversized `q` is a 400 naming the field rather than a scan. No
 * database statement runs on a warm instance: the index is memoized at the board's cadence.
 */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) => {
    const limited = searchRateLimited(userId);
    if (limited !== null) return limited;
    const parsed = parseQuery({ q: new URL(request.url).searchParams.get("q") ?? "" }, searchQuerySchema);
    if (!parsed.ok) return parsed.response;
    return ok<SearchBody>(await siteSearch(getDb(), parsed.value.q));
  });
}
