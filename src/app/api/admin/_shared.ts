import { notFound } from "next/navigation";
import { fail } from "@/lib/api/respond";
import { requireAdmin, type CurrentUser } from "@/lib/auth/current-user";

type AdminHandler = (operatorUserId: string, request: Request) => Promise<Response>;
/** The FULL operator, not just an id: a page needs `displayName`/`avatarUrl` for `TopBar`
 *  the same way every other page under `/app` does, and `withAdmin` already paid for the one
 *  `getCurrentUser` round trip `requireAdmin` makes — a second lookup for the same row would be
 *  the N+1 every batched-lookup discipline in this codebase exists to avoid. */
type AdminPageRender<T> = (operator: CurrentUser) => Promise<T>;

/**
 * THE ONE GATE, on both sides of the wire. Every route under `src/app/app/(shell)/admin/**`
 * (Task 2 moved it under the `(shell)` route group; no URL changed) and `src/app/api/admin/**`
 * goes through this — `admin-routes.test.ts`
 * (`@/app/app/(shell)/admin/admin-routes.test.ts`) is the tripwire that keeps that true as routes are
 * added, the same "enumerate the tree, fail if anything is ungated" discipline
 * `advisory-only.test.ts` and `seed-operator.test.ts`'s `grepSourceTree` use. Its own second
 * check — that `requireAdmin` (`@/lib/auth/current-user`) is called from nowhere else in `src`
 * — is why this is ONE overloaded name rather than two: a page calling `requireAdmin` directly
 * instead of going through here would be an authorization change nobody reviewed, exactly the
 * failure mode that scan exists to catch, and giving the Server Component half of this gate a
 * second identifier would be one more spelling for that scan to miss.
 *
 * `requireAdmin` THROWS rather than returning a result — this is the one place that translation
 * happens, by the two messages that function can throw:
 *
 *   - "Not authenticated." (nobody signed in at all) -> 401 on the API-route overload. THIS is
 *     the one distinction worth making — a caller with no session gets told to sign in, not
 *     turned away identically to an ordinary member who is. Unreachable on the PAGE overload:
 *     `src/middleware.ts` already redirects a signed-out `GET /app/**` to hosted sign-in before a
 *     Server Component ever runs, so a page-side `requireAdmin` failure is a non-operator every
 *     time in practice — collapsed to the same `notFound()` regardless, since a Server Component
 *     has no response envelope to answer 401 with.
 *   - "Not an operator." (signed in, not an admin) -> 404, NEVER 403, on both overloads (ruling
 *     14). This is the highest-value target in the codebase, landing before Phase 2 Plan D's
 *     hardening: a 403 confirms to a signed-in stranger that the admin surface exists and only
 *     needs a different account; a 404 tells them nothing they did not already have. The same
 *     non-oracle discipline `publicJoinPrecondition` and the league page already hold to for a
 *     stranger who guesses a real id.
 *
 * Anything else `requireAdmin` could throw (a genuine, unexpected failure reached through
 * `getCurrentUser`) is NOT folded into either of those on the API-route overload: it is a real
 * 500, logged server-side with the real detail, same as `withCurrentUser`'s own handler-error
 * boundary — a caller who cannot sign in because the database is down must not be told "you're
 * not signed in". The page overload has no such envelope to answer with either way; it renders
 * `notFound()`, and the unexpected failure still surfaces (uncaught) to Next's own error
 * boundary rather than being swallowed as a silent 404.
 */
export function withAdmin(request: Request, handler: AdminHandler): Promise<Response>;
export function withAdmin<T>(render: AdminPageRender<T>): Promise<T>;
export async function withAdmin<T>(requestOrRender: Request | AdminPageRender<T>, handler?: AdminHandler): Promise<Response | T> {
  if (typeof requestOrRender === "function") {
    const operator = await requireAdmin().catch((error: unknown) => {
      if (error instanceof Error && (error.message === "Not authenticated." || error.message === "Not an operator.")) notFound();
      throw error;
    });
    return requestOrRender(operator);
  }

  const request = requestOrRender;
  let operatorUserId: string;
  try {
    operatorUserId = (await requireAdmin()).id;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Not authenticated.") return fail("Not signed in.", 401);
    if (error instanceof Error && error.message === "Not an operator.") return fail("Not found.", 404);
    console.error("[admin] auth check failed", { path: new URL(request.url).pathname }, error);
    return fail("Something went wrong on our side. Please try again.", 500);
  }

  try {
    return await handler!(operatorUserId, request);
  } catch (error: unknown) {
    console.error("[admin] route handler failed", { path: new URL(request.url).pathname }, error);
    return fail("Something went wrong on our side. Please try again.", 500);
  }
}
