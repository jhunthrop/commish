import { getDb } from "@research-ts/db/client";
import { resolveFlag } from "@/integrity-service/flags";
import { resolveFlagSchema } from "@/integrity-service/schemas";
import { getScoreCache } from "@/league-service/score-cache-instance";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { withAdmin } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly flagId: string }>;
}

/** Keyed per operator id, an authenticated write with an irreversible consequence — same "one
 *  budget, per authenticated writer" shape every rate-limited write route in this codebase uses. */
const resolveRequests = createRateLimiter(INTEGRITY_CONFIG.moderation.resolveRateLimit);

/** The 429 this route answers with, or `null` when the caller is inside the ceiling — same
 *  shape as `reportRateLimited` (`src/app/api/reviews/_shared.ts`). */
function resolveRateLimited(operatorUserId: string): Response | null {
  if (resolveRequests.allow(operatorUserId)) return null;
  return fail("Too many decisions in a short time. Give it a minute and try again.", 429);
}

/**
 * ONE WAY, ONCE. `withAdmin` -> rate limit -> `await params` -> `parseJson` -> `resolveFlag` ->
 * `fail`/`ok`, the fixed order every route in this codebase uses. The schema
 * (`resolveFlagSchema`, `@/integrity-service/schemas`) already narrows `decision` past the closed
 * `RESOLUTION_DECISIONS` enum with `decisionIsAvailable`, so a request naming a decision wired for
 * NO subject at all (`account_restricted` is not even declared; nothing IN the enum is unwired
 * everywhere today) is a 400 naming the field, before `resolveFlag` is ever called. WHICH subjects
 * a wired decision actually applies to — the reason `trade_reversed` against a `review_report`
 * flag still 400s — is answered one layer deeper, by `resolveFlag`'s own `decisionIsWiredFor`
 * check, because that answer needs the flag's own row.
 *
 * `operatorUserId` comes from `withAdmin`'s own verified session, never from the body — a body
 * that could name a different operator would let one admin sign another admin's decision.
 */
export async function POST(request: Request, { params }: RouteContext) {
  return withAdmin(request, async (operatorUserId, req) => {
    const limited = resolveRateLimited(operatorUserId);
    if (limited !== null) return limited;

    const { flagId } = await params;
    const parsed = await parseJson(req, resolveFlagSchema);
    if (!parsed.ok) return parsed.response;

    // `cache`: the real score cache, supplied here rather than defaulted inside the service — the
    // identical shape `POST /api/leagues/[leagueId]/trades/[tradeId]` uses for `acceptTrade`'s own
    // eviction. A `trade_reversed` decision moves both rosters, so the league's current-week
    // scores are stale the moment it commits (final review, MEDIUM 4); every other decision
    // ignores it.
    const result = await resolveFlag(getDb(), {
      flagId,
      decision: parsed.value.decision,
      note: parsed.value.note,
      operatorUserId,
      cache: getScoreCache(),
    });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<{ readonly flagId: string; readonly decision: typeof result.decision }>({ flagId: result.flagId, decision: result.decision });
  });
}
