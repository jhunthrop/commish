import { getDb } from "@research/db/client";
import { fail, ok, parseQuery } from "@/lib/api/respond";
import { claimMockSeat } from "@/mock-draft-service/claim";
import { mockRoomSummary, type MockRoomSummary } from "@/mock-draft-service/lobby";
import { claimMockSeatSchema } from "@/mock-draft-service/schemas";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { claimMockRateLimited, readMockRateLimited, systemClock } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly code: string }>;
}

export interface ClaimMockSeatBody {
  readonly leagueId: string;
  readonly draftId: string;
  readonly teamId: string;
  /** `true` when this person already held a seat — a re-entry, never an error. */
  readonly alreadySeated: boolean;
}

/**
 * One room's summary, for the link landing — a signed-in caller only (the founder's sign-in-first
 * ruling: no anonymous rooms, unlike `GET /api/invites/[code]`'s own unauthenticated preview for
 * a real league). `mockRoomSummary`'s own no-existence-oracle rule answers a stale or swept code
 * identically to one that never existed, and it names no member other than the caller — the
 * disclosure this surface owes a visitor who has not joined yet.
 */
export async function GET(request: Request, { params }: RouteContext) {
  return withCurrentUser(request, async (userId) => {
    const limited = readMockRateLimited(userId);
    if (limited !== null) return limited;

    const { code } = await params;
    const result = await mockRoomSummary(getDb(), code, userId, systemClock);
    if (!result.ok) return fail(result.reason, result.status);
    return ok<MockRoomSummary>(result.summary);
  });
}

/**
 * Join a mock draft by its share code. The code is the URL segment itself — validated
 * through the SAME `claimMockSeatSchema` `schemas.ts` states is the claim door's only input, run
 * against the path param rather than a JSON body (this route takes none). Re-claiming a seat you
 * already hold answers success, never an error — the identical re-entry rule `acceptInvite`
 * keeps for a real league's own invite code.
 */
export async function POST(request: Request, { params }: RouteContext) {
  return withCurrentUser(request, async (userId) => {
    const limited = claimMockRateLimited(userId);
    if (limited !== null) return limited;

    const { code } = await params;
    const parsed = parseQuery({ code }, claimMockSeatSchema);
    if (!parsed.ok) return parsed.response;

    const result = await claimMockSeat(getDb(), { code: parsed.value.code, userId }, { clock: systemClock, newId: () => crypto.randomUUID() });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<ClaimMockSeatBody>({ leagueId: result.leagueId, draftId: result.draftId, teamId: result.teamId, alreadySeated: result.alreadySeated });
  });
}
