import { cookies } from "next/headers";
import { getDb } from "@research-ts/db/client";
import { fail, ok } from "@/lib/api/respond";
import type { SeatHoldBody } from "@/league-room/contract";
import { SEAT_HOLD_COOKIE } from "@/matchmaking/seat-hold";
import { claimSeatHold, liveHoldExpiry } from "@/league-service/seat-hold";
import { holdRateLimited } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string }>;
}

/**
 * Claims a seat hold for a visitor who has not signed in yet (Task 6 Step 3) — the app's second
 * unauthenticated write, after nothing: `middleware.ts` never gates anything outside `/app`, and
 * this route needs no session on purpose. The token IS NOT an identity and grants nothing beyond
 * "the right to find a seat still there" — the join door still calls `requireCurrentUser()` and
 * still runs `tierJoinPrecondition` (`publicJoinPrecondition`, `@/league-service/join`).
 *
 * **Idempotent, not additive.** A visitor who refreshes the interstitial (or double-clicks) is not
 * minting a second hold — `liveHoldExpiry` checks the INCOMING cookie first, and a live hold for
 * THIS exact league is simply re-served, its own expiry unchanged. Only a missing, expired,
 * consumed, or other-league cookie reaches `claimSeatHold` for a fresh token.
 *
 * **The cookie:** httpOnly (never readable by this page's own client JS — the countdown's expiry
 * comes back in the JSON body instead), `SameSite=Lax` and `Path=/` (Step 4: a path scoped to this
 * route would not survive to the top-level GET WorkOS redirects back to, or be readable by the
 * join door). `Path` is a scoping convenience, never a security boundary — httpOnly, `SameSite=Lax`
 * and the token's own opacity are what carry the security, exactly as Step 3 argues.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const limited = holdRateLimited(request);
  if (limited !== null) return limited;

  const { leagueId } = await params;
  const db = getDb();
  const now = new Date().toISOString();
  const jar = await cookies();

  const existingToken = jar.get(SEAT_HOLD_COOKIE)?.value ?? null;
  const reusedExpiry = existingToken === null ? null : await liveHoldExpiry(db, existingToken, leagueId, now);

  const token = existingToken !== null && reusedExpiry !== null ? existingToken : crypto.randomUUID();
  const claim = reusedExpiry !== null ? { ok: true as const, expiresAt: reusedExpiry } : await claimSeatHold(db, { leagueId, token, now });
  if (!claim.ok) return fail(claim.reason, 409);

  const response = ok<SeatHoldBody>({ expiresAt: claim.expiresAt });
  const maxAgeSeconds = Math.max(1, Math.round((Date.parse(claim.expiresAt) - Date.now()) / 1000));
  response.cookies.set({
    name: SEAT_HOLD_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds,
  });
  return response;
}
