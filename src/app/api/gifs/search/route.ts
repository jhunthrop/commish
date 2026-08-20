import { withCurrentUser } from "@/app/api/leagues/_shared";
import { GIF_CONFIG } from "@/gifs/config";
import type { GifSearchBody } from "@/gifs/provider";
import { createGifProvider } from "@/gifs/registry";
import { fail, ok } from "@/lib/api/respond";
import { gifSearchRateLimited } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 404s cleanly — never a 200 with an empty result set — when no GIF provider is configured. That
 * is exactly the case `ChatPageBody.gifSearchEnabled` exists to keep the composer from ever
 * reaching: this route's shape is the unconfigured-degrade path's other half, proven directly
 * rather than only inferred from the button never rendering.
 *
 * Signed-in only, same as every other chat surface, and rate-limited per user
 * (`gifSearchRateLimited`) once signed in — an open GIF search would otherwise let one caller
 * spend a real, paid-per-call upstream quota with nothing standing between typing and a request.
 */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const limited = gifSearchRateLimited(userId);
    if (limited !== null) return limited;

    const provider = createGifProvider();
    if (provider === null) return fail("GIF search isn't available.", 404);

    const query = new URL(req.url).searchParams.get("q") ?? "";
    const results = await provider.search(query, GIF_CONFIG.searchResultLimit);
    return ok<GifSearchBody>({ results });
  });
}
