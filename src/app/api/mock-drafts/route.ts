import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { createMockRoom } from "@/mock-draft-service/creation";
import { listOpenMockRooms, myMockRooms, type MockLobbyRoomSummary, type MyMockRoomSummary } from "@/mock-draft-service/lobby";
import { createMockRoomSchema } from "@/mock-draft-service/schemas";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { createMockRateLimited, mockLifecycleDeps, readMockRateLimited } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/mock-drafts`'s whole answer: the open lobby (join a stranger) and the caller's own
 *  rooms (re-entry) — two different promises, the identical member-list/shelf split `BrowseBody`
 *  (`@/matchmaking/contract`) already keeps for a real league, never one merged array. */
export interface MockLobbyBody {
  readonly open: readonly MockLobbyRoomSummary[];
  readonly mine: readonly MyMockRoomSummary[];
}

export interface CreateMockRoomBody {
  readonly leagueId: string;
  readonly teamId: string;
  readonly draftId: string;
  readonly shareCode: string;
  /** ISO instant the fill window fires — `now` for solo, since it starts itself in the same
   *  call (`createMockRoom`'s own docblock). */
  readonly startsAt: string;
}

/**
 * The lobby read (ruling 10: request-time truth, no anonymous or pre-seat SSE). Every mock route
 * requires a signed-in caller (no anonymous rooms), so "mine" always has an owner to scope to —
 * unlike `GET /api/public/leagues`, this is never reachable signed out.
 */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) => {
    const limited = readMockRateLimited(userId);
    if (limited !== null) return limited;

    const db = getDb();
    const [open, mine] = await Promise.all([listOpenMockRooms(db), myMockRooms(db, userId)]);
    return ok<MockLobbyBody>({ open, mine });
  });
}

/**
 * Create a mock draft. Every field but `mode` has a default (`createMockRoomSchema`'s own
 * doc), so `{ "mode": "solo" }` is a complete request body — the same handful-of-interactions
 * doctrine `POST /api/leagues` holds for a real league.
 *
 * For `mode: "solo"`, `createMockRoom` seats every bot and starts the draft itself before this
 * handler ever returns — the response above carries no separate "already started" flag because
 * none is needed: by the time a client reads `draftId` from this response, `drafts.status` for
 * that id is already whatever `createMockRoom`'s own post-commit start left it as, real by
 * construction rather than mirrored here.
 */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const limited = createMockRateLimited(userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, createMockRoomSchema);
    if (!parsed.ok) return parsed.response;

    const result = await createMockRoom(getDb(), { hostUserId: userId, ...parsed.value }, mockLifecycleDeps());
    if (!result.ok) return fail(result.reason, result.status);
    return ok<CreateMockRoomBody>(
      { leagueId: result.leagueId, teamId: result.teamId, draftId: result.draftId, shareCode: result.shareCode, startsAt: result.startsAt },
      { status: 201 },
    );
  });
}
