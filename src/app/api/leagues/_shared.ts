import { getDb } from "@research-ts/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fail } from "@/lib/api/respond";
import { requireLeagueMember, resolveLeagueMembership } from "@/lib/leagues/membership";
import { HOUSE_AUTHORITY_REFUSALS, type LeagueAuthority } from "@/league-service/authority";

export interface LeagueRouteContext {
  readonly params: Promise<{ readonly leagueId: string }>;
}

export interface LeagueActor {
  readonly userId: string;
  readonly leagueId: string;
  /** The caller's team in this league, or null if they don't have one. */
  readonly teamId: string | null;
  readonly isCommissioner: boolean;
  /** Who runs this league — a member or the platform. `withCommissioner` reads this to tell a
   *  house league's "there is no commissioner seat" apart from an ordinary member's "you aren't
   *  the commissioner". */
  readonly authority: LeagueAuthority;
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

/**
 * Commissioner-only routes: minting an invite, and scoring a week. A house league answers with
 * `HOUSE_AUTHORITY_REFUSALS.invite` instead of the ordinary 403 — ruling 32 refuses rather than
 * routing to the operator console, and the refusal is true (a house league genuinely has no
 * commissioner seat) rather than the ordinary sentence about a commissioner who simply isn't the
 * caller.
 */
export async function withCommissioner(
  request: Request,
  context: LeagueRouteContext,
  handler: LeagueHandler,
): Promise<Response> {
  return withLeagueActor(request, context, async (actor, req) => {
    if (!actor.isCommissioner) {
      const reason = actor.authority.kind === "house" ? HOUSE_AUTHORITY_REFUSALS.invite : "Only the commissioner can do that.";
      return fail(reason, 403);
    }
    return handler(actor, req);
  });
}
