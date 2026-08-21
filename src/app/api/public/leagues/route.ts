import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { listPublicLeagues } from "@/league-service/browse";
import type { BrowseBody } from "@/matchmaking/contract";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import { browseRateLimited } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ONE unauthenticated read in this application, and the only route in it that does not go
 * through `src/app/api/leagues/_shared.ts`'s `withCurrentUser`. That is deliberate, not an
 * oversight: a stranger deciding whether this product is worth signing up for has to be able
 * to see what leagues are open, and requiring an account first is the wall every competitor
 * puts up. `middleware.ts` does not redirect anything outside `/app`, so a signed-out request
 * reaches this handler with no session and that is the expected case.
 *
 * What keeps it safe is `listPublicLeagues`'s projection, not this handler: see its doc
 * comment for the three rules, and `@/matchmaking/contract` for the field-by-field boundary.
 * There is no per-caller behavior here at all — the response does not depend on who is asking,
 * which is exactly why it needs no identity.
 *
 * Anonymous-request abuse is bounded, not ignored: `browseRateLimited` (`./_shared.ts`) applies
 * a per-IP ceiling BEFORE the query runs, keyed off the forwarded-for header rather than a
 * session — see its docblock for exactly what that does and does not guarantee on this
 * single-instance Phase 1 deployment.
 *
 * The try/catch below is the same error boundary `withCurrentUser` gives every gated route
 * (log the real detail server-side, answer a generic 500) — copied in rather than reused,
 * because `withCurrentUser` opens with a session read this route must never perform.
 */
export async function GET(request: Request) {
  const limited = browseRateLimited(request);
  if (limited !== null) return limited;

  const params = new URL(request.url).searchParams;
  const filter = normalizeBrowseFilter({
    format: params.get("format"),
    experienceTier: params.get("experienceTier"),
    stakeTier: params.get("stakeTier"),
    participationTier: params.get("participationTier"),
  });
  try {
    return ok<BrowseBody>({ leagues: await listPublicLeagues(getDb(), filter) });
  } catch (error: unknown) {
    console.error("[public-leagues] route handler failed", { path: new URL(request.url).pathname }, error);
    return fail("Something went wrong on our side. Please try again.", 500);
  }
}
