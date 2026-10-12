import { cookies } from "next/headers";
import { getDb } from "@research/db/client";
import { ok } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { returnFromSignIn } from "@/league-service/join";
import { ENFORCEMENT_REFUSALS } from "@/league-service/enforcement";
import { SEAT_HOLD_COOKIE } from "@/matchmaking/seat-hold";
import type { SeatConfirmBody } from "../contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string }>;
}

/**
 * A1 (2026-08-27 flow analysis, finding 1). The ONE write the hold page's signed-in "return"
 * used to make on a bare GET — `returnFromSignIn` — now lives here, behind an explicit POST the
 * visitor triggers themselves by tapping `SeatConfirmPanel`'s own "Take your seat" action.
 * `returnFromSignIn` (`@/league-service/join`) is unchanged: same signature, same three
 * outcomes, same hold/expiry semantics — this route only decides WHEN it runs and translates its
 * outcome into `SeatConfirmBody` for the client to render.
 *
 * `withCurrentUser` is a defensive backstop, not the ordinary path: `SeatConfirmPanel` only ever
 * renders once the page's own server render has already confirmed a session (`getCurrentUser()`
 * in `page.tsx`), so a 401 here means the session died between that render and this tap — the
 * same case `fetchWithSessionWatch` already recovers from everywhere else in the product.
 */
export async function POST(request: Request, { params }: RouteContext) {
  return withCurrentUser(request, async (userId) => {
    const { leagueId } = await params;
    const jar = await cookies();
    const holdToken = jar.get(SEAT_HOLD_COOKIE)?.value ?? null;
    const result = await returnFromSignIn(getDb(), { leagueId, userId, holdToken, now: new Date().toISOString() });

    if (result.ok) {
      return ok<SeatConfirmBody>({ outcome: "seated", leagueId: result.leagueId, holdExpired: result.expiredHold, reason: null });
    }
    if (result.reason === ENFORCEMENT_REFUSALS.join) {
      return ok<SeatConfirmBody>({ outcome: "tier_blocked", leagueId, holdExpired: false, reason: result.reason });
    }
    return ok<SeatConfirmBody>({ outcome: "seat_taken", leagueId, holdExpired: false, reason: result.reason });
  });
}
