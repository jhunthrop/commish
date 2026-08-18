import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fail } from "@/lib/api/respond";
import { requireLeagueMember, resolveLeagueMembership } from "@/lib/leagues/membership";

export interface LeagueRouteContext {
  readonly params: Promise<{ readonly leagueId: string }>;
}

export interface LeagueActor {
  readonly userId: string;
  readonly leagueId: string;
  /** The caller's team in this league, or null if they don't have one. */
  readonly teamId: string | null;
  readonly isCommissioner: boolean;
}

type LeagueHandler = (actor: LeagueActor, request: Request) => Promise<Response>;
type UserHandler = (userId: string, request: Request) => Promise<Response>;

/**
 * The league half of what `src/app/api/drafts/[draftId]/_shared.ts` does for drafts, and for
 * the same reasons: 401 JSON (never a redirect), the membership lookup in exactly one place,
 * and one error boundary that logs the real detail server-side and answers a generic,
 * plain-language 500 — raw exception text must never reach a client.
 *
 * Handlers return the web `Response`, not `NextResponse`: the SSE route built on
 * `withLeagueMemberActor` answers with a streaming `Response`, and `fail()`'s `NextResponse`
 * is a `Response` already, so one type covers both without widening anything.
 */
export async function withCurrentUser(request: Request, handler: UserHandler): Promise<Response> {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  try {
    return await handler(user.id, request);
  } catch (error: unknown) {
    console.error("[league] route handler failed", { path: new URL(request.url).pathname }, error);
    return fail("Something went wrong on our side. Please try again.", 500);
  }
}

export async function withLeagueActor(
  request: Request,
  { params }: LeagueRouteContext,
  handler: LeagueHandler,
): Promise<Response> {
  return withCurrentUser(request, async (userId, req) => {
    const { leagueId } = await params;
    const membership = await resolveLeagueMembership(getDb(), leagueId, userId);
    if (!membership.ok) return fail(membership.error, membership.status);
    return handler({ userId, ...membership.membership }, req);
  });
}

/** `withLeagueActor` plus the one 403 rule every league surface shares. */
export async function withLeagueMemberActor(
  request: Request,
  context: LeagueRouteContext,
  handler: LeagueHandler,
): Promise<Response> {
  return withLeagueActor(request, context, async (actor, req) => {
    const denied = requireLeagueMember(actor);
    if (denied !== null) return denied;
    return handler(actor, req);
  });
}

/** Commissioner-only routes: minting an invite, and scoring a week. */
export async function withCommissioner(
  request: Request,
  context: LeagueRouteContext,
  handler: LeagueHandler,
): Promise<Response> {
  return withLeagueActor(request, context, async (actor, req) => {
    if (!actor.isCommissioner) return fail("Only the commissioner can do that.", 403);
    return handler(actor, req);
  });
}
